use keyring::Entry;
use reqwest::{header, redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
    #[serde(default = "default_enable_ai")]
    enable_ai: bool,
    #[serde(default = "default_batch_size")]
    batch_size: u32,
    #[serde(default = "default_request_delay")]
    request_delay: u32,
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
            enable_ai: true,
            batch_size: 30,
            request_delay: 500,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
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
    serde_json::from_slice(&bytes).map_err(|e| format!("设置文件格式无效：{e}"))
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
    settings.deepseek_api_key = match keyring_entry()?.get_password() {
        Ok(key) => key,
        Err(keyring::Error::NoEntry) => String::new(),
        Err(e) => return Err(format!("读取系统钥匙串失败：{e}")),
    };
    Ok(settings)
}

#[tauri::command]
fn save_settings(caller: WebviewWindow, app: AppHandle, settings: Settings) -> Result<(), String> {
    ensure_main(&caller)?;
    if !(5..=50).contains(&settings.batch_size) || !(200..=3000).contains(&settings.request_delay) {
        return Err("设置值超出允许范围".into());
    }
    let entry = keyring_entry()?;
    if settings.deepseek_api_key.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(e) => return Err(format!("清除系统钥匙串密钥失败：{e}")),
        }
    } else {
        entry
            .set_password(settings.deepseek_api_key.trim())
            .map_err(|e| format!("保存到系统钥匙串失败：{e}"))?;
    }
    let file_settings = Settings {
        deepseek_api_key: String::new(),
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
async fn request_deepseek(
    caller: WebviewWindow,
    body: ChatRequest,
    api_key: Option<String>,
) -> Result<Value, String> {
    ensure_main(&caller)?;
    if body.model != "deepseek-chat"
        || body.messages.is_empty()
        || body.messages.len() > 100
        || body.max_tokens == 0
        || body.max_tokens > 8192
    {
        return Err("DeepSeek 请求参数无效".into());
    }
    let key = api_key
        .filter(|value| !value.trim().is_empty())
        .or_else(|| keyring_entry().ok()?.get_password().ok())
        .ok_or("请先在设置中填写 DeepSeek API Key")?;
    let payload = json!({ "model": body.model, "messages": body.messages, "max_tokens": body.max_tokens, "temperature": body.temperature });
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(key.trim())
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("DeepSeek 网络请求失败：{e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&text).unwrap_or_else(
        |_| json!({ "error": { "message": text.chars().take(300).collect::<String>() } }),
    );
    if !status.is_success() {
        return Err(format!(
            "DeepSeek 请求失败（{}）：{}",
            status.as_u16(),
            value["error"]["message"].as_str().unwrap_or("未知错误")
        ));
    }
    Ok(value)
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
            request_deepseek
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
