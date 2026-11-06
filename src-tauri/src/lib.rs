use keyring::Entry;
use reqwest::{header, redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager, State, Url, WebviewWindow};

mod qq;

const KEYRING_SERVICE: &str = "TuneNest";
const KEYRING_USER: &str = "deepseek-api-key";
const NETEASE_KEYRING_USER: &str = "netease-cookie";

#[derive(Default)]
struct NeteaseSession(Mutex<std::collections::HashMap<String, String>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseLoginState {
    has_music_u: bool,
    has_csrf: bool,
}

fn session_cookie_header(session: &NeteaseSession) -> Result<String, String> {
    let cookies = session.0.lock().map_err(|_| "网易云登录状态不可用")?;
    Ok(cookies
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; "))
}

fn store_cookie_header(session: &NeteaseSession, value: &str) -> Result<(), String> {
    let mut cookies = session.0.lock().map_err(|_| "网易云登录状态不可用")?;
    for part in value.split(';') {
        if let Some((name, value)) = part.trim().split_once('=') {
            if !name.is_empty() && !value.is_empty() {
                cookies.insert(name.to_owned(), value.to_owned());
            }
        }
    }
    Ok(())
}

fn response_cookie_header(headers: &header::HeaderMap) -> String {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .filter(|cookie| cookie.contains('='))
        .collect::<Vec<_>>()
        .join("; ")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    deepseek_api_key: String,
    #[serde(default = "default_ai_provider")]
    ai_provider: String,
    #[serde(default)]
    ai_keys: HashMap<String, String>,
    #[serde(default)]
    ai_key_configured: HashMap<String, bool>,
    #[serde(default = "default_enable_ai")]
    enable_ai: bool,
    #[serde(default = "default_batch_size")]
    batch_size: u32,
    #[serde(default = "default_request_delay")]
    request_delay: u32,
}

fn default_ai_provider() -> String {
    "xbot".into()
}

fn default_enable_ai() -> bool {
    true
}
fn default_batch_size() -> u32 {
    30
}
fn default_request_delay() -> u32 {
    500
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            deepseek_api_key: String::new(),
            ai_provider: default_ai_provider(),
            ai_keys: HashMap::new(),
            ai_key_configured: HashMap::new(),
            enable_ai: true,
            batch_size: 30,
            request_delay: 500,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    messages: Vec<ChatMessage>,
    // The frontend keeps the OpenAI-compatible spelling inside the IPC body.
    #[serde(alias = "max_tokens")]
    max_tokens: u32,
    temperature: Option<f32>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn ensure_main(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("此窗口不允许调用 TuneNest 应用功能".into());
    }
    let url = caller.url().map_err(|e| e.to_string())?;
    let is_app_origin = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || ((url.scheme() == "http" || url.scheme() == "https")
            && url.host_str() == Some("tauri.localhost"));
    #[cfg(debug_assertions)]
    let is_dev_origin = url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
        && url.port() == Some(1420);
    #[cfg(not(debug_assertions))]
    let is_dev_origin = false;
    if !is_app_origin && !is_dev_origin {
        return Err("当前页面不受信任".into());
    }
    Ok(())
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("无法访问系统钥匙串：{e}"))
}

fn ai_keyring_entry(provider: &str) -> Result<Entry, String> {
    match provider {
        "deepseek" => keyring_entry(),
        "xbot" | "zhipu" => Entry::new(KEYRING_SERVICE, &format!("{provider}-api-key"))
            .map_err(|e| format!("无法访问系统钥匙串：{e}")),
        _ => Err("不支持的 AI 渠道".into()),
    }
}

fn ai_key(provider: &str) -> Result<Option<String>, String> {
    match ai_keyring_entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("读取系统钥匙串失败：{e}")),
    }
}

fn netease_keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, NETEASE_KEYRING_USER)
        .map_err(|e| format!("无法访问系统钥匙串：{e}"))
}

fn read_settings_file(app: &AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = fs::read(path).map_err(|e| format!("读取设置失败：{e}"))?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("设置文件格式无效：{e}"))?;
    let mut settings: Settings =
        serde_json::from_value(value.clone()).map_err(|e| format!("设置文件格式无效：{e}"))?;
    // Existing installations retain their DeepSeek selection after upgrading.
    if value.get("aiProvider").is_none() && ai_key("deepseek")?.is_some() {
        settings.ai_provider = "deepseek".into();
    }
    Ok(settings)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建设置目录失败：{e}"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn get_settings(caller: WebviewWindow, app: AppHandle) -> Result<Settings, String> {
    ensure_main(&caller)?;
    let mut settings = read_settings_file(&app)?;
    settings.deepseek_api_key.clear();
    settings.ai_keys.clear();
    settings.ai_key_configured.clear();
    for provider in ["xbot", "deepseek", "zhipu"] {
        settings
            .ai_key_configured
            .insert(provider.into(), ai_key(provider)?.is_some());
    }
    Ok(settings)
}

#[tauri::command]
fn save_settings(caller: WebviewWindow, app: AppHandle, settings: Settings) -> Result<(), String> {
    ensure_main(&caller)?;
    if !(5..=50).contains(&settings.batch_size) || !(200..=3000).contains(&settings.request_delay) {
        return Err("设置值超出允许范围".into());
    }
    ai_config(&settings.ai_provider)?;
    for (provider, key) in &settings.ai_keys {
        let entry = ai_keyring_entry(provider)?;
        if key.len() > 4096 {
            return Err("API Key 长度无效".into());
        }
        if key.trim().is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => (),
                Err(e) => return Err(format!("清除系统钥匙串密钥失败：{e}")),
            }
        } else {
            entry
                .set_password(key.trim())
                .map_err(|e| format!("保存到系统钥匙串失败：{e}"))?;
        }
    }
    let file_settings = Settings {
        deepseek_api_key: String::new(),
        ai_keys: HashMap::new(),
        ai_key_configured: HashMap::new(),
        ..settings
    };
    let bytes = serde_json::to_vec_pretty(&file_settings).map_err(|e| e.to_string())?;
    let path = settings_path(&app)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|e| format!("写入设置失败：{e}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("更新设置失败：{e}"))?;
    }
    fs::rename(&temp, &path).map_err(|e| format!("保存设置失败：{e}"))?;
    Ok(())
}

#[tauri::command]
fn store_netease_cookie(
    caller: WebviewWindow,
    session: State<'_, NeteaseSession>,
    cookie: String,
) -> Result<(), String> {
    ensure_main(&caller)?;
    if cookie.is_empty() || cookie.len() > 16_384 || !cookie.contains("MUSIC_U=") {
        return Err("网易云没有返回有效的登录凭据".into());
    }
    netease_keyring_entry()?
        .set_password(&cookie)
        .map_err(|e| format!("保存登录状态失败：{e}"))?;
    store_cookie_header(&session, &cookie)
}

#[tauri::command]
async fn get_netease_csrf(
    caller: WebviewWindow,
    session: State<'_, NeteaseSession>,
) -> Result<String, String> {
    ensure_main(&caller)?;
    if session
        .0
        .lock()
        .map_err(|_| "网易云登录状态不可用")?
        .is_empty()
    {
        if let Ok(cookie) = netease_keyring_entry().and_then(|entry| {
            entry
                .get_password()
                .map_err(|e| format!("读取登录状态失败：{e}"))
        }) {
            store_cookie_header(&session, &cookie)?;
        }
    }
    Ok(session
        .0
        .lock()
        .map_err(|_| "网易云登录状态不可用")?
        .get("__csrf")
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
fn get_netease_login_state(
    caller: WebviewWindow,
    session: State<'_, NeteaseSession>,
) -> Result<NeteaseLoginState, String> {
    ensure_main(&caller)?;
    if session
        .0
        .lock()
        .map_err(|_| "网易云登录状态不可用")?
        .is_empty()
    {
        if let Ok(cookie) = netease_keyring_entry().and_then(|entry| {
            entry
                .get_password()
                .map_err(|e| format!("读取登录状态失败：{e}"))
        }) {
            store_cookie_header(&session, &cookie)?;
        }
    }
    let cookies = session.0.lock().map_err(|_| "网易云登录状态不可用")?;
    Ok(NeteaseLoginState {
        has_music_u: cookies.contains_key("MUSIC_U"),
        has_csrf: cookies.contains_key("__csrf"),
    })
}

#[tauri::command]
async fn fetch_netease(
    caller: WebviewWindow,
    session: State<'_, NeteaseSession>,
    url: String,
    method: String,
    body: String,
    headers: std::collections::HashMap<String, String>,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    let parsed = Url::parse(&url).map_err(|_| "网易云请求地址无效".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("music.163.com")
        || !(parsed.path().starts_with("/api/") || parsed.path().starts_with("/weapi/"))
    {
        return Err("请求地址不在网易云 API 允许范围内".into());
    }
    if body.len() > 2_000_000 {
        return Err("请求内容过大".into());
    }
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("不支持的请求方式".into()),
    };
    let cookie_header = session_cookie_header(&session)?;
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let is_post = method == reqwest::Method::POST;
    let mut request = client
        .request(method, parsed)
        .header(header::COOKIE, cookie_header)
        .header(header::REFERER, "https://music.163.com/")
        .header(header::ORIGIN, "https://music.163.com");
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("content-type") {
            request = request.header(header::CONTENT_TYPE, value);
        }
    }
    if is_post {
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("网易云网络请求失败：{e}"))?;
    let status = response.status().as_u16();
    // WebView2 doesn't own the reqwest cookie jar. In particular, the QR login
    // success response may deliver MUSIC_U in Set-Cookie rather than in JSON.
    let response_cookies = response_cookie_header(response.headers());
    if response_cookies
        .split(';')
        .any(|cookie| cookie.trim().starts_with("MUSIC_U="))
    {
        store_cookie_header(&session, &response_cookies)?;
        netease_keyring_entry()?
            .set_password(&response_cookies)
            .map_err(|e| format!("保存网易云登录状态失败：{e}"))?;
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取网易云响应失败：{e}"))?;
    if text.len() > 4_000_000 {
        return Err("网易云响应过大".into());
    }
    Ok(json!({ "status": status, "body": text }))
}

#[tauri::command]
async fn request_ai(
    caller: WebviewWindow,
    provider: String,
    body: ChatRequest,
    api_key: Option<String>,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    let key = match api_key {
        Some(key) => key,
        None => ai_key(&provider)?.unwrap_or_default(),
    };
    if key.trim().is_empty() || key.len() > 4096 {
        return Err("请先配置当前 AI 渠道的 API Key".into());
    }
    perform_ai_request(&provider, &body, &key).await
}

async fn perform_ai_request(
    provider: &str,
    body: &ChatRequest,
    key: &str,
) -> Result<Value, String> {
    let (endpoint, _) = ai_config(provider)?;
    let payload = ai_payload(provider, body)?;
    if serde_json::to_vec(&payload)
        .map_err(|_| "AI 请求编码失败")?
        .len()
        > 256_000
    {
        return Err("AI 请求内容过大".into());
    }
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(endpoint)
        .bearer_auth(key.trim())
        .json(&payload)
        .send()
        .await
        .map_err(|_| "AI 网络请求失败，请检查网络或稍后重试".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "AI 请求失败（{}），请检查当前渠道的密钥、余额和模型可用性",
            status.as_u16()
        ));
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取 AI 响应失败")? {
        if bytes.len() + chunk.len() > 1_000_000 {
            return Err("AI 响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "AI 返回了无效的 JSON")?;
    // Only return model output and usage; upstream diagnostic data stays out of the WebView.
    Ok(json!({ "choices": value["choices"], "usage": value["usage"] }))
}

fn ai_config(provider: &str) -> Result<(&'static str, &'static str), String> {
    match provider {
        "xbot" => Ok((
            "https://newadm.xbotai.cc/v1/chat/completions",
            "gpt-5.6-luna",
        )),
        "deepseek" => Ok((
            "https://api.deepseek.com/chat/completions",
            "deepseek-flash",
        )),
        "zhipu" => Ok((
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            "glm-4-flash-250414",
        )),
        _ => Err("不支持的 AI 渠道".into()),
    }
}

#[tauri::command]
fn open_ai_console(caller: WebviewWindow, provider: String) -> Result<(), String> {
    ensure_main(&caller)?;
    let url = match provider.as_str() {
        "xbot" => "https://newadm.xbotai.cc/sign-up",
        "deepseek" => "https://platform.deepseek.com/api_keys",
        "zhipu" => "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
        _ => return Err("不支持的 AI 渠道".into()),
    };
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "无法打开默认浏览器")?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|_| "无法打开默认浏览器")?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map_err(|_| "无法打开默认浏览器")?;
    Ok(())
}

fn ai_payload(provider: &str, body: &ChatRequest) -> Result<Value, String> {
    let (_, model) = ai_config(provider)?;
    if body.messages.is_empty()
        || body.messages.len() > 100
        || !(1..=8192).contains(&body.max_tokens)
    {
        return Err("AI 请求参数无效".into());
    }
    if body
        .messages
        .iter()
        .any(|m| !matches!(m.role.as_str(), "system" | "user" | "assistant"))
    {
        return Err("AI 消息角色无效".into());
    }
    let mut payload = json!({ "model": model, "messages": body.messages, "stream": false });
    if provider == "xbot" {
        payload["max_completion_tokens"] = json!(body.max_tokens);
        payload["reasoning_effort"] = json!("none");
    } else {
        payload["max_tokens"] = json!(body.max_tokens);
        payload["temperature"] = json!(body.temperature.unwrap_or(0.0));
        payload["thinking"] = json!({ "type": "disabled" });
    }
    Ok(payload)
}

pub fn run() {
    let mut context = tauri::generate_context!();
    let webview_data_dir = std::env::var("TUNENEST_WEBVIEW_DIR")
        .map(PathBuf::from)
        .or_else(|_| {
            std::env::var("LOCALAPPDATA").map(|path| PathBuf::from(path).join("TuneNestProfile"))
        });
    if let Ok(local_data_dir) = webview_data_dir {
        context.config_mut().app.app_directories_override =
            Some(tauri::utils::config::AppDirectoriesOverride::Directories(
                tauri::utils::config::AppDirectoryOverrides {
                    local_data: Some(local_data_dir),
                    ..Default::default()
                },
            ));
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            store_netease_cookie,
            get_netease_csrf,
            get_netease_login_state,
            fetch_netease,
            qq::start_qq_qr_login,
            qq::poll_qq_qr_login,
            qq::get_qq_session_state,
            qq::fetch_qq,
            open_ai_console,
            request_ai
        ])
        .manage(NeteaseSession::default())
        .manage(qq::QqSession::default())
        .run(context)
        .expect("TuneNest 启动失败");
}

#[cfg(test)]
mod tests {
    use super::response_cookie_header;
    use reqwest::header::{HeaderMap, HeaderValue, SET_COOKIE};

    #[test]
    fn ai_ipc_payload_matches_frontend_request() {
        use super::*;
        let fixture: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/ai-ipc-request.json")).unwrap();
        let body: ChatRequest = serde_json::from_value(fixture["body"].clone())
            .expect("frontend IPC body must deserialize");
        assert_eq!(body.max_tokens, 256);
        assert_eq!(body.messages.len(), 1);
        for provider in fixture["providers"].as_array().unwrap() {
            let provider = provider.as_str().unwrap();
            let payload = ai_payload(provider, &body).unwrap();
            let token_field = if provider == "xbot" {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
            assert_eq!(payload[token_field], 256);
        }
        let mut camel_case = fixture["body"].clone();
        camel_case.as_object_mut().unwrap().remove("max_tokens");
        camel_case["maxTokens"] = json!(256);
        assert_eq!(
            serde_json::from_value::<ChatRequest>(camel_case.clone())
                .unwrap()
                .max_tokens,
            256
        );
        camel_case.as_object_mut().unwrap().remove("maxTokens");
        assert!(serde_json::from_value::<ChatRequest>(camel_case).is_err());
    }

    #[test]
    fn ai_routes_and_token_limits_are_scoped() {
        use super::*;
        let body = ChatRequest {
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "OK".into(),
            }],
            max_tokens: 256,
            temperature: None,
        };
        assert!(ai_config("https://example.com").is_err());
        let xbot = ai_payload("xbot", &body).unwrap();
        assert_eq!(xbot["model"], "gpt-5.6-luna");
        assert_eq!(xbot["max_completion_tokens"], 256);
        assert!(xbot.get("max_tokens").is_none());
        for provider in ["deepseek", "zhipu"] {
            let payload = ai_payload(provider, &body).unwrap();
            assert_eq!(payload["max_tokens"], 256);
            assert_eq!(payload["thinking"]["type"], "disabled");
            assert!(payload.get("max_completion_tokens").is_none());
        }
        let invalid = ChatRequest {
            max_tokens: 8193,
            ..body
        };
        assert!(ai_payload("xbot", &invalid).is_err());
    }

    #[test]
    #[ignore = "Requires explicitly provided test credentials; makes paid network calls"]
    fn live_ai_provider() {
        use super::*;
        let provider = std::env::var("TUNENEST_TEST_PROVIDER").expect("provider required");
        let key = std::env::var("TUNENEST_TEST_KEY").unwrap_or_else(|_| {
            let path =
                std::env::var("TUNENEST_TEST_CREDENTIAL_FILE").expect("credential file required");
            let credentials: Value =
                serde_json::from_slice(&std::fs::read(path).expect("read credentials"))
                    .expect("credentials JSON");
            credentials[&provider]
                .as_str()
                .expect("provider key required")
                .to_owned()
        });
        let body = ChatRequest {
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "Reply with OK only.".into(),
            }],
            max_tokens: 256,
            temperature: None,
        };
        let data = tauri::async_runtime::block_on(perform_ai_request(&provider, &body, &key))
            .expect("AI request failed");
        let content = data["choices"][0]["message"]["content"]
            .as_str()
            .expect("Missing content")
            .trim();
        assert!(
            matches!(content, "OK" | "OK." | "OK!"),
            "Model did not follow test instruction"
        );
        println!("{provider}: native Rust request returned OK");
    }

    #[test]
    fn extracts_cookie_pairs_without_set_cookie_attributes() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("MUSIC_U=music-token; Path=/; HttpOnly"),
        );
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("__csrf=csrf-token; Path=/"),
        );
        assert_eq!(
            response_cookie_header(&headers),
            "MUSIC_U=music-token; __csrf=csrf-token"
        );
    }
}
