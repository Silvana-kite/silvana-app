use std::sync::{LazyLock, Mutex};
use std::collections::HashMap;
static DOWNLOAD_TARGETS: LazyLock<Mutex<HashMap<std::path::PathBuf, std::path::PathBuf>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static EXPECTED_HASHES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
use serde::{Deserialize, Serialize};
use tauri::{webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder}, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl};

const BROWSER: &str = "official-browser-remote";

#[derive(Clone, Serialize)]
struct BrowserEvent { kind: String, value: String }
fn notify(app: &tauri::AppHandle, kind: &str, value: impl Into<String>) {
    let app = app.clone();
    let event = BrowserEvent { kind: kind.into(), value: value.into() };
    // Creation/navigation callbacks may hold the webview registry lock. Never
    // synchronously enumerate/emit to webviews from inside those callbacks.
    tauri::async_runtime::spawn(async move {
        let _ = app.emit_to(tauri::EventTarget::webview("main"), "official-browser", event);
    });
}
fn authorize(caller: &Webview) -> Result<(), String> {
    if caller.label() != "main" { return Err("Remote pages cannot control the application".into()); }
    let url = caller.url().map_err(|e| e.to_string())?;
    let trusted = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions) && caller.config().build.dev_url.as_ref().is_some_and(|dev| url.origin() == dev.origin()));
    if trusted { Ok(()) } else { Err("Untrusted browser controller".into()) }
}
fn https(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid website URL".to_string())?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("Only HTTPS websites are supported".into());
    }
    let catalog: serde_json::Value = serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/catalog.json"))).map_err(|_| "Invalid official hosts")?;
    if !catalog["officialHosts"].as_array().is_some_and(|hosts| hosts.iter().any(|host| host.as_str() == url.host_str())) { return Err("此域名未登记为官方来源".into()); }
    Ok(url)
}
#[derive(Deserialize)]
pub struct Bounds { x: f64, y: f64, width: f64, height: f64 }
impl Bounds {
    fn validate(&self, caller: &Webview) -> Result<(), String> {
        let window = caller.window();
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        if [self.x, self.y, self.width, self.height].iter().any(|v| !v.is_finite()) || self.x < 0. || self.y < 0. || self.width < 1. || self.height < 1.
            || self.x + self.width > size.width as f64 / scale + 2. || self.y + self.height > size.height as f64 / scale + 2. {
            return Err("Invalid browser viewport".into());
        }
        Ok(())
    }
    fn apply(&self, view: &Webview) -> Result<(), String> {
        view.set_position(LogicalPosition::new(self.x, self.y)).map_err(|e| e.to_string())?;
        view.set_size(LogicalSize::new(self.width, self.height)).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn browser_open(caller: Webview, url: String, bounds: Bounds, expected_sha256: Option<String>) -> Result<(), String> {
    authorize(&caller)?; bounds.validate(&caller)?;
    let url = https(&url)?;
    if let Some(hash) = expected_sha256 { if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) { return Err("无效摘要".into()); } EXPECTED_HASHES.lock().map_err(|_| "摘要锁不可用")?.insert(url.to_string(), hash); }
    let app = caller.app_handle().clone();
    if let Some(view) = app.get_webview(BROWSER) {
        bounds.apply(&view)?;
        view.show().map_err(|e| e.to_string())?;
        return view.navigate(url).map_err(|e| e.to_string());
    }
    let navigation_app = app.clone(); let load_app = app.clone(); let title_app = app.clone(); let popup_app = app.clone();
    // Share the configured WebView2 environment (profile/proxy/browser flags).
    // The remote view still has a distinct label and receives no IPC capability.
    let mut config = app.config().app.windows.iter().find(|w| w.label == caller.window().label()).cloned().unwrap_or_default();
    config.label = BROWSER.into();
    config.url = WebviewUrl::External(url);
    let builder = WebviewBuilder::from_config(&config)
        .on_navigation(move |url| {
            let allowed = https(url.as_str()).is_ok();
            if allowed { notify(&navigation_app, "url", url.as_str()); }
            else { notify(&navigation_app, "error", "该链接无法在应用内打开：仅支持 HTTPS 网页"); }
            allowed
        })
        .on_page_load(move |_, payload| notify(&load_app, if matches!(payload.event(), PageLoadEvent::Started) { "loading" } else { "loaded" }, payload.url().as_str()))
        .on_document_title_changed(move |_, title| notify(&title_app, "title", title))
        .on_new_window(move |url, _| {
            if https(url.as_str()).is_ok() {
                let app = popup_app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(view) = app.get_webview(BROWSER) { let _ = view.navigate(url); }
                });
            } else { notify(&popup_app, "error", "此链接不是 HTTPS 网页"); }
            NewWindowResponse::Deny
        })
        .on_download(|view, event| match event {
            DownloadEvent::Requested { url, destination } => {
                if https(url.as_str()).is_err() { return false; }
                let suggested = destination.file_name().and_then(|s| s.to_str()).unwrap_or("download");
                if let Some(path) = rfd::FileDialog::new().set_title("保存官方下载文件").set_file_name(suggested).save_file() {
                    if path.exists() { notify(view.app_handle(), "error", "目标文件已存在，请选择新文件名"); return false; }
                    let temporary = path.with_file_name(format!("{}.siilvana-download", path.file_name().unwrap_or_default().to_string_lossy()));
                    if temporary.exists() { notify(view.app_handle(), "error", "下载暂存文件已存在，请选择新文件名"); return false; }
                    if let Ok(mut targets) = DOWNLOAD_TARGETS.lock() { targets.insert(temporary.clone(), path); } else { return false; }
                    *destination = temporary;
                    notify(view.app_handle(), "download", format!("正在下载：{}", destination.file_name().unwrap_or_default().to_string_lossy()));
                    true
                } else { notify(view.app_handle(), "download", "已取消下载"); false }
            }
            DownloadEvent::Finished { url, path, success, .. } => {
                if success {
                    if let Some(path) = path { let expected = EXPECTED_HASHES.lock().ok().and_then(|mut hashes| hashes.remove(url.as_str())); let app = view.app_handle().clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let checked = crate::download_check::verify_file(&path, expected.as_deref());
                            match checked { Ok(status) => {
                                let target = DOWNLOAD_TARGETS.lock().ok().and_then(|mut targets| targets.remove(&path));
                                if let Some(target) = target { if target.exists() || std::fs::rename(&path, &target).is_err() { notify(&app, "error", "校验完成，但无法保存到目标；暂存文件已保留"); } else { notify(&app, "download", format!("下载完成 · {status}")); } }
                                else { notify(&app, "error", "无法确认下载目标，暂存文件已保留"); }
                            }, Err(error) => {
                                let quarantine = path.with_extension("siilvana-quarantine");
                                if !quarantine.exists() && std::fs::rename(&path, &quarantine).is_ok() { notify(&app, "error", format!("{error}；文件已隔离")); }
                                else { notify(&app, "error", format!("{error}；隔离未完成，请勿打开文件")); }
                            } }
                        });
                    }
                } else { notify(view.app_handle(), "download", "下载失败，请重试"); }
                true
            }
            _ => false,
        });
    caller.window().add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.width, bounds.height)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_resize(caller: Webview, bounds: Bounds) -> Result<(), String> {
    authorize(&caller)?; bounds.validate(&caller)?;
    if let Some(view) = caller.app_handle().get_webview(BROWSER) { bounds.apply(&view)?; }
    Ok(())
}
#[tauri::command]
pub async fn browser_hide(caller: Webview) -> Result<(), String> {
    authorize(&caller)?;
    // Keep in-progress downloads alive when returning to tool selection.
    if let Some(view) = caller.app_handle().get_webview(BROWSER) { view.hide().map_err(|e| e.to_string())?; }
    Ok(())
}
#[tauri::command]
pub async fn browser_action(caller: Webview, action: String) -> Result<(), String> {
    authorize(&caller)?;
    let script = match action.as_str() { "back" => "window.history.back()", "forward" => "window.history.forward()", "reload" => "window.location.reload()", _ => return Err("Unknown browser action".into()) };
    let view = caller.app_handle().get_webview(BROWSER).ok_or("Browser is not open")?;
    view.eval(script).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_https_and_rejects_executable_or_credential_urls() {
        assert!(https("https://nodejs.org/download/release/v12.22.12/").is_ok());
        for value in ["javascript:alert(1)", "file:///C:/Windows", "http://example.com", "https://user:secret@example.com"] { assert!(https(value).is_err()); }
    }
}
