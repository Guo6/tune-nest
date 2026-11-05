use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;
use reqwest::{header, redirect::Policy, Client, Response};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{State, Url, WebviewWindow};

use crate::ensure_main;

const KEYRING_SERVICE: &str = "TuneNest";
const KEYRING_USER: &str = "qq-music-cookie";
const QQ_QR_APP_ID: &str = "716027609";
const QQ_CONNECT_APP_ID: &str = "100497308";

#[derive(Default)]
pub(crate) struct QqSession {
    cookies: Mutex<HashMap<String, String>>,
    qr: Mutex<Option<QrSession>>,
}

struct QrSession {
    qrsig: String,
    issued: Instant,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("创建 QQ 网络客户端失败：{e}"))
}

fn entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("无法访问系统钥匙串：{e}"))
}

fn cookie_pairs(text: &str, into: &mut HashMap<String, String>) {
    for pair in text.split(';') {
        if let Some((name, value)) = pair.trim().split_once('=') {
            if !name.is_empty() && !value.is_empty() && name.len() < 80 && value.len() < 8192 {
                into.insert(name.to_string(), value.to_string());
            }
        }
    }
}

fn response_cookies(response: &Response, into: &mut HashMap<String, String>) {
    for value in response.headers().get_all(header::SET_COOKIE).iter() {
        if let Ok(text) = value.to_str() {
            // Some proxies combine several Set-Cookie fields. An Expires date
            // can also contain a comma, but its continuation is not a cookie.
            for part in text.split(", ") {
                if let Some(first) = part.split(';').next() {
                    if let Some((name, _)) = first.split_once('=') {
                        if !name.is_empty()
                            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                        {
                            cookie_pairs(first, into);
                        }
                    }
                }
            }
        }
    }
}

fn cookie_header(cookies: &HashMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn saved_cookies(session: &QqSession) -> Result<HashMap<String, String>, String> {
    let mut cookies = session.cookies.lock().map_err(|_| "QQ 登录状态不可用")?;
    if cookies.is_empty() {
        match entry()?.get_password() {
            Ok(text) => cookie_pairs(&text, &mut cookies),
            Err(keyring::Error::NoEntry) => (),
            Err(e) => return Err(format!("读取 QQ 登录状态失败：{e}")),
        }
    }
    Ok(cookies.clone())
}

fn qq_uin(cookies: &HashMap<String, String>) -> Option<String> {
    cookies
        .get("uin")
        .or_else(|| cookies.get("qqmusic_uin"))
        .or_else(|| cookies.get("p_uin"))
        .map(|s| {
            s.trim_start_matches('o')
                .trim_start_matches('0')
                .to_string()
        })
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
}

fn music_key(cookies: &HashMap<String, String>) -> Option<&str> {
    cookies
        .get("qm_keyst")
        .or_else(|| cookies.get("qqmusic_key"))
        .or_else(|| cookies.get("music_key"))
        .map(String::as_str)
}

fn save_session(session: &QqSession, cookies: HashMap<String, String>) -> Result<(), String> {
    if qq_uin(&cookies).is_none() || music_key(&cookies).is_none() {
        return Err("QQ 音乐登录未返回完整凭据".into());
    }
    let value = cookie_header(&cookies);
    if value.len() > 32_768 {
        return Err("QQ 音乐凭据过大".into());
    }
    entry()?
        .set_password(&value)
        .map_err(|e| format!("保存 QQ 登录状态失败：{e}"))?;
    *session.cookies.lock().map_err(|_| "QQ 登录状态不可用")? = cookies;
    Ok(())
}

fn hash33(text: &str, seed: u32) -> u32 {
    text.bytes().fold(seed, |hash, byte| {
        hash.wrapping_add(hash << 5).wrapping_add(byte as u32)
    }) & 0x7fff_ffff
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[tauri::command]
pub(crate) async fn start_qq_qr_login(
    caller: WebviewWindow,
    session: State<'_, QqSession>,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    let mut url = Url::parse("https://ssl.ptlogin2.qq.com/ptqrshow").map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs([
        ("appid", QQ_QR_APP_ID),
        ("e", "2"),
        ("l", "M"),
        ("s", "3"),
        ("d", "72"),
        ("v", "4"),
        ("daid", "383"),
        ("pt_3rd_aid", QQ_CONNECT_APP_ID),
        ("u1", "https://graph.qq.com/oauth2.0/login_jump"),
    ]);
    let response = client()?
        .get(url)
        .header(header::REFERER, "https://y.qq.com/")
        .send()
        .await
        .map_err(|e| format!("获取 QQ 登录二维码失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("QQ 登录二维码请求失败（{}）", response.status()));
    }
    let mut cookies = HashMap::new();
    response_cookies(&response, &mut cookies);
    let qrsig = cookies.remove("qrsig").ok_or("QQ 登录接口没有返回 qrsig")?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 QQ 二维码失败：{e}"))?;
    if bytes.len() < 100 || bytes.len() > 100_000 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("QQ 登录接口没有返回有效二维码图片".into());
    }
    *session.qr.lock().map_err(|_| "QQ 扫码状态不可用")? = Some(QrSession {
        qrsig,
        issued: Instant::now(),
    });
    Ok(json!({ "image": format!("data:image/png;base64,{}", STANDARD.encode(bytes)) }))
}

fn parse_qr_callback(redirect_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(redirect_url).map_err(|_| "QQ 扫码回调地址无效")?;
    // QQ Connect uses graph.qq.com login hosts, while older callbacks use qq.com.
    // Keep the exact signature endpoint allowlist; never follow arbitrary URLs.
    let default_port = match url.scheme() {
        "https" => Some(443),
        "http" => Some(80),
        _ => None,
    };
    if default_port.is_none()
        || !matches!(
            url.host_str(),
            Some("ptlogin2.qq.com")
                | Some("ssl.ptlogin2.qq.com")
                | Some("ptlogin2.graph.qq.com")
                | Some("ssl.ptlogin2.graph.qq.com")
        )
        || url.path() != "/check_sig"
        || url.port_or_known_default() != default_port
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        // Do not expose the query: it contains one-time login credentials.
        return Err(format!(
            "QQ 扫码回调地址不受信任（域名：{}；需要指定 QQ 登录服务的 HTTPS /check_sig 地址）",
            url.host_str().unwrap_or("未知")
        ));
    }
    // Legacy callbacks may advertise HTTP. Upgrade only these validated hosts
    // to their TLS endpoint before any cookie or login token is sent.
    if url.scheme() == "http" {
        let tls_host = match url.host_str() {
            Some("ptlogin2.qq.com") => "ssl.ptlogin2.qq.com",
            Some("ptlogin2.graph.qq.com") => "ssl.ptlogin2.graph.qq.com",
            Some("ssl.ptlogin2.qq.com") => "ssl.ptlogin2.qq.com",
            Some("ssl.ptlogin2.graph.qq.com") => "ssl.ptlogin2.graph.qq.com",
            _ => unreachable!("callback host was checked above"),
        };
        url.set_host(Some(tls_host))
            .map_err(|_| "QQ 扫码回调地址无效")?;
        url.set_scheme("https").map_err(|_| "QQ 扫码回调地址无效")?;
    }
    Ok(url)
}

async fn complete_qr_login(
    session: &QqSession,
    redirect_url: &str,
    qrsig: &str,
) -> Result<(), String> {
    let url = parse_qr_callback(redirect_url)?;
    let http = client()?;
    let mut cookies = HashMap::new();
    cookies.insert("qrsig".into(), qrsig.into());
    let checked = http
        .get(url)
        .header(header::COOKIE, cookie_header(&cookies))
        .send()
        .await
        .map_err(|e| format!("QQ 登录签名校验失败：{}", e.without_url()))?;
    if !checked.status().is_success() && !checked.status().is_redirection() {
        return Err(format!("QQ 登录签名校验失败（HTTP {}）", checked.status()));
    }
    response_cookies(&checked, &mut cookies);
    let p_skey = cookies
        .get("p_skey")
        .ok_or("QQ 登录签名校验缺少 p_skey")?
        .clone();
    let gtk = hash33(&p_skey, 5381);

    let form = [
        ("response_type", "code".to_string()),
        ("client_id", QQ_CONNECT_APP_ID.to_string()),
        (
            "redirect_uri",
            "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/"
                .to_string(),
        ),
        ("scope", "get_user_info,get_app_friends".to_string()),
        ("state", "state".to_string()),
        ("switch", String::new()),
        ("from_ptlogin", "1".to_string()),
        ("src", "1".to_string()),
        ("update_auth", "1".to_string()),
        ("openapi", "1010_1030".to_string()),
        ("g_tk", gtk.to_string()),
        ("auth_time", now_ms().to_string()),
        (
            "ui",
            format!("{:016x}{:016x}", now_ms(), std::process::id()),
        ),
    ];
    let authorized = http
        .post("https://graph.qq.com/oauth2.0/authorize")
        .header(header::COOKIE, cookie_header(&cookies))
        .header(header::REFERER, "https://graph.qq.com/")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("QQ 音乐授权失败：{e}"))?;
    response_cookies(&authorized, &mut cookies);
    let location = authorized
        .headers()
        .get(header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or("QQ 音乐授权没有返回跳转地址")?;
    let location_url = Url::parse(location).map_err(|_| "QQ 音乐授权跳转地址无效")?;
    if location_url.scheme() != "https" || location_url.host_str() != Some("y.qq.com") {
        return Err("QQ 音乐授权跳转地址不受信任".into());
    }
    let code = location_url
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .ok_or("QQ 音乐授权没有返回 code")?;
    let payload = json!({
        "comm": { "g_tk": gtk, "platform": "yqq", "ct": 24, "cv": 0 },
        "req": { "module": "QQConnectLogin.LoginServer", "method": "QQLogin", "param": { "code": code } }
    });
    let music = http
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header(header::COOKIE, cookie_header(&cookies))
        .header(header::REFERER, "https://y.qq.com/")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("QQ 音乐登录凭据交换失败：{e}"))?;
    response_cookies(&music, &mut cookies);
    let body: Value = music.json().await.map_err(|_| "QQ 音乐登录返回格式无效")?;
    let data = &body["req"]["data"];
    let music_id = data["musicid"]
        .as_str()
        .map(str::to_string)
        .or_else(|| data["musicid"].as_u64().map(|n| n.to_string()))
        .or_else(|| data["musicId"].as_u64().map(|n| n.to_string()));
    let key = data["musickey"]
        .as_str()
        .or_else(|| data["musicKey"].as_str());
    if let (Some(id), Some(key)) = (music_id, key) {
        cookies.insert("uin".into(), id);
        cookies.insert("qm_keyst".into(), key.to_string());
    }
    save_session(session, cookies)
}

#[tauri::command]
pub(crate) async fn poll_qq_qr_login(
    caller: WebviewWindow,
    session: State<'_, QqSession>,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    let qrsig = {
        let qr = session.qr.lock().map_err(|_| "QQ 扫码状态不可用")?;
        let active = qr.as_ref().ok_or("请先获取 QQ 登录二维码")?;
        if active.issued.elapsed() > Duration::from_secs(180) {
            return Ok(json!({"status":"expired"}));
        }
        active.qrsig.clone()
    };
    let mut url = Url::parse("https://ssl.ptlogin2.qq.com/ptqrlogin").map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs([
        ("u1", "https://graph.qq.com/oauth2.0/login_jump"),
        ("ptqrtoken", &hash33(&qrsig, 0).to_string()),
        ("ptredirect", "0"),
        ("h", "1"),
        ("t", "1"),
        ("g", "1"),
        ("from_ui", "1"),
        ("ptlang", "2052"),
        ("action", "0-0-0"),
        ("js_ver", "23111510"),
        ("js_type", "1"),
        ("pt_uistyle", "40"),
        ("aid", QQ_QR_APP_ID),
        ("daid", "383"),
        ("pt_3rd_aid", QQ_CONNECT_APP_ID),
    ]);
    let response = client()?
        .get(url)
        .header(header::COOKIE, format!("qrsig={qrsig}"))
        .header(header::REFERER, "https://xui.ptlogin2.qq.com/")
        .send()
        .await
        .map_err(|e| format!("查询 QQ 扫码状态失败：{e}"))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 QQ 扫码状态失败：{e}"))?;
    if !body.starts_with("ptuiCB(") {
        return Err("QQ 扫码状态返回格式无效".into());
    }
    let parts: Vec<&str> = body.split('\'').collect();
    let status = parts.get(1).copied().unwrap_or("");
    match status {
        "66" => Ok(json!({"status":"waiting"})),
        "67" => Ok(json!({"status":"scanned"})),
        "65" => Ok(json!({"status":"expired"})),
        "0" => {
            let redirect = parts.get(5).copied().ok_or("QQ 扫码确认没有返回回调地址")?;
            complete_qr_login(&session, redirect, &qrsig).await?;
            *session.qr.lock().map_err(|_| "QQ 扫码状态不可用")? = None;
            Ok(json!({"status":"success"}))
        }
        _ => Err(format!("QQ 扫码登录失败（状态 {status}）")),
    }
}

#[tauri::command]
pub(crate) fn get_qq_session_state(
    caller: WebviewWindow,
    session: State<'_, QqSession>,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    let cookies = saved_cookies(&session)?;
    Ok(json!({"userId": qq_uin(&cookies), "hasMusicKey": music_key(&cookies).is_some()}))
}

#[tauri::command]
pub(crate) async fn fetch_qq(
    caller: WebviewWindow,
    session: State<'_, QqSession>,
    url: String,
    method: String,
    body: String,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    let parsed = Url::parse(&url).map_err(|_| "QQ 请求地址无效")?;
    let allowed = match parsed.host_str() {
        Some("c.y.qq.com") => {
            parsed.path().starts_with("/rsc/fcgi-bin/")
                || parsed.path().starts_with("/fav/fcgi-bin/")
                || parsed.path().starts_with("/qzone/fcg-bin/")
        }
        Some("u.y.qq.com") => parsed.path() == "/cgi-bin/musicu.fcg",
        _ => false,
    };
    if parsed.scheme() != "https" || !allowed {
        return Err("QQ 请求地址不在允许范围内".into());
    }
    if body.len() > 2_000_000 {
        return Err("QQ 请求内容过大".into());
    }
    let cookies = saved_cookies(&session)?;
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("不支持的 QQ 请求方式".into()),
    };
    let is_post = method == reqwest::Method::POST;
    let body = if is_post && parsed.host_str() == Some("u.y.qq.com") {
        let mut payload: Value = serde_json::from_str(&body).map_err(|_| "QQ 请求内容不是 JSON")?;
        let comm = payload
            .get_mut("comm")
            .and_then(Value::as_object_mut)
            .ok_or("QQ 请求缺少 comm")?;
        let user_id = qq_uin(&cookies).ok_or("请先登录 QQ 音乐")?;
        let key = music_key(&cookies).ok_or("QQ 音乐登录凭据已失效")?;
        comm.insert("uin".into(), json!(user_id));
        comm.insert("authst".into(), json!(key));
        serde_json::to_string(&payload).map_err(|e| e.to_string())?
    } else {
        body
    };
    let mut request = client()?
        .request(method, parsed)
        .header(header::COOKIE, cookie_header(&cookies))
        .header(header::REFERER, "https://y.qq.com/portal/profile.html")
        .header(header::ORIGIN, "https://y.qq.com");
    if is_post {
        request = request
            .header(header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("QQ 网络请求失败：{e}"))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取 QQ 响应失败：{e}"))?;
    if text.len() > 4_000_000 {
        return Err("QQ 响应内容过大".into());
    }
    Ok(json!({"status": status, "body": text}))
}

#[cfg(test)]
mod tests {
    use super::{cookie_pairs, hash33, parse_qr_callback, qq_uin};
    use std::collections::HashMap;

    #[test]
    fn parses_qq_cookie_and_uin() {
        let mut cookies = HashMap::new();
        cookie_pairs("uin=o0012345; qm_keyst=key; Path=/", &mut cookies);
        assert_eq!(qq_uin(&cookies).as_deref(), Some("12345"));
        assert_eq!(hash33("abc", 5381), 193485963);
    }

    #[test]
    fn accepts_qq_connect_signature_callbacks_and_preserves_query() {
        for host in [
            "ssl.ptlogin2.graph.qq.com",
            "ptlogin2.graph.qq.com",
            "ssl.ptlogin2.qq.com",
            "ptlogin2.qq.com",
        ] {
            let input = format!("https://{host}/check_sig?pttype=1&ptsigx=test-only&uin=123");
            let parsed = parse_qr_callback(&input).unwrap();
            assert_eq!(parsed.as_str(), input);
        }
    }

    #[test]
    fn rejects_unsafe_callbacks_without_disclosing_login_tokens() {
        for input in [
            "ftp://ssl.ptlogin2.graph.qq.com/check_sig",
            "http://evil.example/check_sig",
            "https://ssl.ptlogin2.graph.qq.com.evil.example/check_sig",
            "https://evil.example/check_sig",
            "https://ssl.ptlogin2.graph.qq.com:444/check_sig",
            "https://user@ssl.ptlogin2.graph.qq.com/check_sig",
            "https://ssl.ptlogin2.graph.qq.com/other",
            "https://ssl.ptlogin2.graph.qq.com/check_sig#fragment",
        ] {
            let error =
                parse_qr_callback(&format!("{input}?ptsigx=secret-test-token")).unwrap_err();
            assert!(!error.contains("secret-test-token"));
        }
        assert!(parse_qr_callback("not a URL").is_err());
    }

    #[test]
    fn upgrades_legacy_callbacks_before_sending_login_credentials() {
        for (host, tls_host) in [
            ("ptlogin2.graph.qq.com", "ssl.ptlogin2.graph.qq.com"),
            ("ptlogin2.qq.com", "ssl.ptlogin2.qq.com"),
            ("ssl.ptlogin2.graph.qq.com", "ssl.ptlogin2.graph.qq.com"),
        ] {
            let input = format!("http://{host}/check_sig?ptsigx=test-only");
            let parsed = parse_qr_callback(&input).unwrap();
            assert_eq!(
                parsed.as_str(),
                format!("https://{tls_host}/check_sig?ptsigx=test-only")
            );
        }
        assert!(parse_qr_callback("http://ptlogin2.graph.qq.com:8080/check_sig").is_err());
    }
}
