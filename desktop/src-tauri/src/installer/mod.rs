mod catalog;
mod downloads;
mod locations;
mod platforms;
mod process;
mod runner;

use catalog::{Request, Resolved};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    tool_id: String,
    name: String,
    version: String,
    installed_version: Option<String>,
    executable_path: Option<String>,
    status: String,
    message: String,
    #[serde(default)]
    target_disk: Option<String>,
    #[serde(default)]
    install_directory: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Blocker {
    message: String,
    url: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    sequence: u64,
    id: String,
    status: String,
    steps: Vec<Step>,
    blockers: Vec<Blocker>,
    logs: Vec<String>,
    fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request: Option<Request>,
}
#[derive(Default)]
struct Inner {
    session: Option<Session>,
    consent: bool,
    loaded: bool,
}
#[derive(Clone, Default)]
pub struct Installer {
    inner: Arc<Mutex<Inner>>,
    busy: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}
struct BusyGuard(Arc<AtomicBool>);
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Installer {
    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }
    fn acquire(&self) -> Result<BusyGuard, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "安装任务正在进行，请等待当前任务结束。")?;
        Ok(BusyGuard(self.busy.clone()))
    }
    fn load(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if !inner.loaded {
            inner.loaded = true;
            if let Ok(data) = std::fs::read(session_path(app)?) {
                if let Ok(mut session) = serde_json::from_slice::<Session>(&data) {
                    if ["running", "cancelling", "prepared"].contains(&session.status.as_str()) {
                        session.status = "interrupted".into();
                    }
                    inner.session = Some(session);
                }
            }
        }
        Ok(())
    }
    fn publish(
        &self,
        app: &tauri::AppHandle,
        channel: Option<&Channel<Session>>,
        session: &Session,
    ) -> Result<(), String> {
        let mut session = session.clone();
        {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            session.sequence = inner
                .session
                .as_ref()
                .filter(|s| s.id == session.id)
                .map_or(1, |s| s.sequence + 1);
            if self.cancel.load(Ordering::SeqCst) && session.status == "running" {
                session.status = "cancelling".into();
            }
            inner.session = Some(session.clone());
        }
        let saved = (|| {
            let path = session_path(app)?;
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let bytes = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
            std::fs::write(path, bytes).map_err(|e| e.to_string())
        })();
        if let Some(channel) = channel {
            let _ = channel.send(session.clone());
        }
        saved
    }
}
fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("installation/session.json"))
}

async fn check_host_and_space(
    app: &tauri::AppHandle,
    request: &Request,
    consent: bool,
    items: &[Resolved],
) -> Result<(), String> {
    if !consent {
        return Err("请先允许本机安装检查读取磁盘容量。".into());
    }
    let platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    if platform != request.platform
        || crate::device::host_architecture().as_deref() != Some(&request.architecture)
    {
        return Err("当前方案与本机系统或原生架构不同，仅支持导出脚本。".into());
    }
    #[cfg(target_os = "linux")]
    {
        let release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
        if !release.lines().any(|line| {
            (line.starts_with("ID=") || line.starts_with("ID_LIKE="))
                && (line.contains("debian") || line.contains("ubuntu"))
        }) {
            return Err("本机安装目前支持 Ubuntu / Debian。".into());
        }
    }
    let disks = crate::device::scan_disks(app.clone(), true).await?;
    if !request.installation_targets.is_empty() {
        let temporary = disks
            .iter()
            .find(|disk| disk.temporary_target)
            .and_then(|disk| locations::drive(&disk.id))
            .ok_or("无法验证临时缓存所在磁盘。")?;
        for (id, required) in locations::budgets(items, &temporary) {
            let disk = disks
                .iter()
                .find(|disk| locations::drive(&disk.id).as_deref() == Some(&id))
                .ok_or_else(|| format!("目标磁盘 {id} 已离线，请重新扫描并选择。"))?;
            if disk.available_bytes < required {
                return Err(format!(
                    "磁盘 {id} 空间不足，需要预留 {:.1} GiB（含软件、缓存及预留空间）。",
                    required as f64 / 1024_f64.powi(3)
                ));
            }
        }
        return Ok(());
    }
    let mb: u64 = items.iter().map(|i| i.tool.disk_mb).sum();
    let required = ((mb * 1024 * 1024) as f64 * 1.2).ceil() as u64 + 2 * 1024_u64.pow(3);
    let targets: Vec<_> = disks
        .iter()
        .filter(|disk| disk.installation_target)
        .collect();
    if targets.is_empty() || targets.iter().any(|d| d.available_bytes < required) {
        return Err("磁盘空间不足，安装预算包含 20% 缓存余量和 2 GiB 预留空间。".into());
    }
    Ok(())
}

fn inspect(items: &[Resolved]) -> (Vec<Step>, Vec<Blocker>) {
    let mut steps = Vec::new();
    let mut blockers = Vec::new();
    for item in items {
        let verify = process::verify(item);
        let existing_path = if item.target_disk.is_some() {
            locations::actual_path(item)
        } else {
            process::verification_path(&verify)
        };
        let targeted = locations::executable(item).filter(|path| path.is_file());
        let executable_path = existing_path.clone().or_else(|| {
            targeted
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
        });
        let standard_output = process::capture(&verify).ok();
        let unresolved_launcher = standard_output.is_some() && existing_path.is_none();
        let output = standard_output.or_else(|| {
            targeted
                .as_ref()
                .and_then(|path| process::capture_at(item, path).ok())
        });
        if item.target_disk.is_some() {
            if unresolved_launcher {
                blockers.push(Blocker {
                    message: format!(
                        "无法确认 {} 启动代理背后的真实位置。请检查现有安装。",
                        item.tool.name
                    ),
                    url: None,
                });
            }
            if let Err(message) = locations::preflight(item, executable_path.as_deref()) {
                blockers.push(Blocker { message, url: None });
            }
        }
        let version = output
            .as_deref()
            .and_then(catalog::parse_version)
            .map(|v| v.to_string());
        let bundled_satisfied = item.version.bundled_tools.iter().all(|bundle| {
            items
                .iter()
                .find(|other| other.tool.id == bundle.tool_id)
                .is_some_and(|other| {
                    process::capture(&process::verify(other))
                        .ok()
                        .is_some_and(|text| {
                            catalog::satisfies(&text, &other.version.accepted_range)
                        })
                })
        });
        let satisfied = bundled_satisfied
            && version
                .as_ref()
                .is_some_and(|v| catalog::satisfies(v, &item.version.accepted_range));
        steps.push(Step {
            tool_id: item.tool.id.clone(),
            name: item.tool.name.clone(),
            version: match item.version.version.as_str() {
                "system" => "系统源稳定版".into(),
                "stable" => "稳定版".into(),
                value => value.into(),
            },
            installed_version: version,
            executable_path,
            target_disk: item.target_disk.clone(),
            install_directory: locations::directory(item)
                .map(|path| path.to_string_lossy().into_owned()),
            status: if satisfied { "skipped" } else { "pending" }.into(),
            message: if satisfied {
                "已有版本符合要求"
            } else {
                ""
            }
            .into(),
        });
        if satisfied {
            continue;
        }
        if let Some(recipe) = &item.recipe {
            let (manager, url) = match recipe.manager.as_str() {
                "winget" => (
                    "winget",
                    "https://learn.microsoft.com/windows/package-manager/winget/",
                ),
                "brew" => ("brew", "https://brew.sh/"),
                "apt" => (
                    "pkexec",
                    "https://help.ubuntu.com/community/InstallingSoftware",
                ),
                "official" => {
                    for executable in ["curl", "tar", "sha256sum"] {
                        if process::locate(executable).is_none() {
                            blockers.push(Blocker {
                                message: format!("缺少下载校验组件 {executable}"),
                                url: Some(
                                    "https://help.ubuntu.com/community/InstallingSoftware".into(),
                                ),
                            });
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            if process::locate(manager).is_none()
                && !blockers.iter().any(|b| b.url.as_deref() == Some(url))
            {
                blockers.push(Blocker {
                    message: format!("缺少 {manager}，完成官方安装后重新检测。"),
                    url: Some(url.into()),
                });
            }
            if recipe.manager == "apt" {
                let policy = process::capture(&catalog::Process {
                    executable: "apt-cache".into(),
                    args: vec!["policy".into(), recipe.package_id.clone()],
                })
                .unwrap_or_default();
                let candidate = policy
                    .lines()
                    .find_map(|l| l.trim().strip_prefix("Candidate:"))
                    .unwrap_or("")
                    .trim();
                if candidate.is_empty()
                    || candidate == "(none)"
                    || !catalog::satisfies(
                        catalog::apt_version(candidate),
                        &item.version.accepted_range,
                    )
                {
                    blockers.push(Blocker {
                        message: format!(
                            "{} 的系统软件源尚无符合要求的版本（{}）。",
                            item.tool.name, item.version.accepted_range
                        ),
                        url: Some(if item.tool.id == "vscode" {
                            "https://code.visualstudio.com/docs/setup/linux".into()
                        } else {
                            item.tool.homepage.clone()
                        }),
                    });
                } else if let Some(step) = steps.last_mut() {
                    step.version = format!("{} (系统源)", candidate);
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    if items
        .iter()
        .any(|i| i.recipe.as_ref().is_some_and(|r| r.manager == "brew"))
        && process::capture(&catalog::Process {
            executable: "xcode-select".into(),
            args: vec!["-p".into()],
        })
        .is_err()
    {
        blockers.push(Blocker {
            message: "缺少 Xcode 命令行工具。".into(),
            url: Some("https://developer.apple.com/xcode/resources/".into()),
        });
    }
    (steps, blockers)
}

#[tauri::command]
pub async fn prepare_install(
    app: tauri::AppHandle,
    state: State<'_, Installer>,
    request: Request,
    consent: bool,
) -> Result<Session, String> {
    let _guard = state.acquire()?;
    let items = catalog::resolve(&request)?;
    check_host_and_space(&app, &request, consent, &items).await?;
    let (steps, blockers) = tauri::async_runtime::spawn_blocking(move || inspect(&items))
        .await
        .map_err(|e| e.to_string())?;
    let session = Session {
        sequence: 0,
        id: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
            .to_string(),
        status: "prepared".into(),
        steps,
        blockers,
        logs: Vec::new(),
        fingerprint: request.fingerprint.clone(),
        request: Some(request),
    };
    {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.loaded = true;
        inner.consent = consent;
    }
    state.publish(&app, None, &session)?;
    Ok(session)
}

#[tauri::command]
pub async fn get_install_session(
    app: tauri::AppHandle,
    state: State<'_, Installer>,
) -> Result<Option<Session>, String> {
    state.load(&app)?;
    Ok(state
        .inner
        .lock()
        .map_err(|e| e.to_string())?
        .session
        .clone())
}

async fn start(
    app: tauri::AppHandle,
    state: &Installer,
    session_id: String,
    channel: Channel<Session>,
    retry: bool,
) -> Result<Session, String> {
    let guard = state.acquire()?;
    let (mut session, consent) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        (
            inner.session.clone().ok_or("请先检查安装方案")?,
            inner.consent,
        )
    };
    if session.id != session_id
        || (!retry && session.status != "prepared")
        || (retry && !["failed", "cancelled", "interrupted"].contains(&session.status.as_str()))
    {
        return Err("安装方案已失效，请重新检测。".into());
    }
    let request = session.request.as_ref().ok_or("缺少安装方案，请重新检测")?;
    let items = catalog::resolve(request)?;
    check_host_and_space(&app, request, consent, &items).await?;
    let inspect_items = items.clone();
    let (steps, blockers) = tauri::async_runtime::spawn_blocking(move || inspect(&inspect_items))
        .await
        .map_err(|e| e.to_string())?;
    session.steps = steps;
    session.blockers = blockers;
    if !session.blockers.is_empty() {
        session.status = "prepared".into();
        state.publish(&app, None, &session)?;
        return Ok(session);
    }
    session.status = "running".into();
    session.logs.clear();
    state.cancel.store(false, Ordering::SeqCst);
    state.publish(&app, None, &session)?;
    let response = session.clone();
    let installer = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        execute(&app, &installer, &channel, &mut session, &items);
    });
    Ok(response)
}

struct NativeBackend;
impl runner::Backend for NativeBackend {
    fn install(&mut self, item: &Resolved, log: &mut dyn FnMut(String)) -> Result<(), String> {
        if item.target_disk.is_some() {
            locations::preflight(item, locations::actual_path(item).as_deref())?;
        }
        if item.recipe.is_none() {
            return Ok(());
        }
        if item.tool.id == "volta"
            && item
                .recipe
                .as_ref()
                .is_some_and(|r| r.manager == "official" && r.package_id == "volta-unix")
        {
            return downloads::install_volta(&mut |line| log(line));
        }
        process::run(&process::install(item)?, &mut |line| log(line))
    }
    fn verify(&mut self, item: &Resolved) -> Result<(String, Option<String>), String> {
        let verify = process::verify(item);
        let targeted = locations::executable(item).filter(|path| path.is_file());
        let (output, path) = if let Some(path) = targeted {
            (
                process::capture_at(item, &path)?,
                Some(path.to_string_lossy().into_owned()),
            )
        } else {
            (
                process::capture(&verify)?,
                if item.target_disk.is_some() {
                    locations::actual_path(item)
                } else {
                    process::verification_path(&verify)
                },
            )
        };
        locations::verify_path(item, path.as_deref())?;
        let version = catalog::parse_version(&output)
            .ok_or("无法读取安装后的版本")?
            .to_string();
        Ok((version, path))
    }
}

fn execute(
    app: &tauri::AppHandle,
    installer: &Installer,
    channel: &Channel<Session>,
    session: &mut Session,
    items: &[Resolved],
) {
    if let Err(error) = runner::run(
        session,
        items,
        &installer.cancel,
        &mut NativeBackend,
        &mut |value| installer.publish(app, Some(channel), value),
    ) {
        session.status = "failed".into();
        session.logs.push(format!("无法保存安装状态：{error}"));
        let _ = installer.publish(app, Some(channel), session);
    }
}
#[tauri::command]
pub async fn start_install(
    app: tauri::AppHandle,
    state: State<'_, Installer>,
    session_id: String,
    on_event: Channel<Session>,
) -> Result<Session, String> {
    start(app, &state, session_id, on_event, false).await
}
#[tauri::command]
pub async fn retry_install(
    app: tauri::AppHandle,
    state: State<'_, Installer>,
    session_id: String,
    on_event: Channel<Session>,
) -> Result<Session, String> {
    start(app, &state, session_id, on_event, true).await
}
#[tauri::command]
pub async fn cancel_install(
    app: tauri::AppHandle,
    state: State<'_, Installer>,
    session_id: String,
) -> Result<Session, String> {
    let _ = app;
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    let session = inner.session.as_mut().ok_or("没有安装任务")?;
    if session.id != session_id || !["running", "cancelling"].contains(&session.status.as_str()) {
        return Err("没有正在运行的安装任务".into());
    }
    state.cancel.store(true, Ordering::SeqCst);
    session.status = "cancelling".into();
    session.sequence += 1;
    Ok(session.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_one_operation_can_run() {
        let installer = Installer::default();
        let guard = installer.acquire().unwrap();
        assert!(installer.acquire().is_err());
        drop(guard);
        assert!(installer.acquire().is_ok());
    }
}
