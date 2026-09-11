use super::catalog::{InstallationLocation, Request, Resolved};
use super::process;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub fn drive(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    (bytes.len() == 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && [b'\\', b'/'].contains(&bytes[2]))
    .then(|| format!("{}:\\", (bytes[0] as char).to_ascii_uppercase()))
}

pub fn assign(request: &Request, items: &mut [Resolved]) -> Result<(), String> {
    if request.installation_targets.is_empty() {
        return Ok(());
    }
    if request.platform != "windows" {
        return Err("逐款选择磁盘目前仅支持 Windows。".into());
    }
    if request
        .installation_targets
        .keys()
        .any(|id| !items.iter().any(|item| &item.tool.id == id))
    {
        return Err("安装位置包含未选择的工具。".into());
    }
    for index in 0..items.len() {
        let parent = items.iter().find(|item| {
            item.version
                .bundled_tools
                .iter()
                .any(|bundle| bundle.tool_id == items[index].tool.id)
        });
        let source = parent
            .map(|item| item.tool.id.as_str())
            .unwrap_or(&items[index].tool.id);
        let target = request
            .installation_targets
            .get(source)
            .and_then(|value| drive(value))
            .ok_or_else(|| format!("请为 {} 选择有效的本地磁盘。", items[index].tool.name))?;
        if let Some(explicit) = request.installation_targets.get(&items[index].tool.id) {
            if drive(explicit).as_deref() != Some(&target) {
                return Err(format!("{} 必须跟随主软件的磁盘。", items[index].tool.name));
            }
        }
        items[index].target_disk = Some(target);
    }
    Ok(())
}

pub fn directory(item: &Resolved) -> Option<PathBuf> {
    match item.recipe.as_ref()?.installation_location.as_ref()? {
        InstallationLocation::Directory { .. } => Some(
            PathBuf::from(item.target_disk.as_ref()?)
                .join("Siilvana/Apps")
                .join(&item.tool.id),
        ),
        InstallationLocation::Fixed => None,
    }
}
pub fn executable(item: &Resolved) -> Option<PathBuf> {
    match item.recipe.as_ref()?.installation_location.as_ref()? {
        InstallationLocation::Directory { executable } => Some(directory(item)?.join(executable)),
        InstallationLocation::Fixed => None,
    }
}

fn normalized(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .replace('/', "\\")
        .to_ascii_lowercase()
}
pub fn on_disk(path: &Path, disk: &str) -> bool {
    normalized(path).starts_with(&disk.to_ascii_lowercase())
}
pub fn verify_path(item: &Resolved, path: Option<&str>) -> Result<(), String> {
    let Some(disk) = &item.target_disk else {
        return Ok(());
    };
    let path = path.ok_or_else(|| format!("无法验证 {} 的真实安装位置。", item.tool.name))?;
    let real = std::fs::canonicalize(path)
        .map_err(|_| format!("无法解析 {} 的真实程序位置：{path}", item.tool.name))?;
    if !on_disk(&real, disk) {
        return Err(format!(
            "{} 实际位于 {}，与所选磁盘 {disk} 不符。请改选原盘或取消该软件；不会自动迁移。",
            item.tool.name,
            real.display()
        ));
    }
    Ok(())
}

/// Resolve manager shims to the runtime/package they actually execute.
pub fn actual_path(item: &Resolved) -> Option<String> {
    // Ask runtimes for their own executable/home; PATH entries can be forwarding shims.
    let runtime = match item.tool.id.as_str() {
        "node" => Some(super::catalog::Process {
            executable: "node".into(),
            args: vec!["-p".into(), "process.execPath".into()],
        }),
        "python" => Some(super::catalog::Process {
            executable: "python".into(),
            args: vec![
                "-I".into(),
                "-c".into(),
                "import sys; print(sys.executable)".into(),
            ],
        }),
        "jdk" => Some(super::catalog::Process {
            executable: "java".into(),
            args: vec!["-XshowSettings:properties".into(), "-version".into()],
        }),
        _ => None,
    };
    if let Some(runtime) = runtime {
        let result = process::capture(&runtime).ok()?;
        let path = if item.tool.id == "jdk" {
            PathBuf::from(
                result
                    .lines()
                    .find_map(|line| line.trim().strip_prefix("java.home ="))?
                    .trim(),
            )
            .join("bin/java.exe")
        } else {
            PathBuf::from(result.trim())
        };
        return path
            .is_absolute()
            .then(|| path.to_string_lossy().into_owned());
    }
    if item.tool.id == "maven" {
        return process::search_paths()
            .iter()
            .map(|path| path.join("mvn.cmd"))
            .find(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned());
    }
    let verify = process::verify(item);
    let launch = process::verification_path(&verify)?;
    let lower = launch.to_ascii_lowercase();
    if ["node", "npm", "pnpm"].contains(&item.tool.id.as_str()) && lower.contains("volta") {
        let result = process::capture(&super::catalog::Process {
            executable: "volta".into(),
            args: vec!["which".into(), item.tool.id.clone()],
        })
        .ok()?;
        let path = result.trim();
        return Path::new(path).is_absolute().then(|| path.to_owned());
    }
    // A VS Code JS launcher belongs to the sibling Code.exe application.
    if item.tool.id == "vscode" && lower.ends_with("resources\\app\\out\\cli.js") {
        return Path::new(&launch)
            .ancestors()
            .nth(4)
            .map(|root| root.join("Code.exe").to_string_lossy().into_owned());
    }
    Some(launch)
}

fn default_directory(item: &Resolved) -> Result<PathBuf, String> {
    let variable = |name: &str| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .ok_or_else(|| format!("无法定位 {name}，不能确认默认安装磁盘。"))
    };
    match item.tool.id.as_str() {
        "node" if item.recipe.as_ref().is_some_and(|recipe| recipe.manager == "winget") => {
            Ok(variable("ProgramFiles")?.join("nodejs"))
        }
        "npm" if item.version.id == "npm-bundled" => {
            Ok(variable("ProgramFiles")?.join("nodejs"))
        }
        "node" | "npm" | "pnpm" => {
            if item.tool.id == "pnpm" && process::locate("volta").is_none() {
                if let Ok(prefix) = process::capture(&super::catalog::Process {
                    executable: "npm".into(),
                    args: vec!["prefix".into(), "--global".into()],
                }) {
                    let path = PathBuf::from(prefix.trim());
                    if path.is_absolute() {
                        return Ok(path);
                    }
                }
            }
            Ok(std::env::var_os("VOLTA_HOME")
                .map(PathBuf::from)
                .unwrap_or(variable("LOCALAPPDATA")?.join("Volta")))
        }
        "python" => Ok(variable("LOCALAPPDATA")?.join("Programs/Python")),
        "volta" | "jdk" | "maven" | "postgresql" | "docker" => variable("ProgramFiles"),
        _ => Err(format!(
            "{} 的安装方式尚不能验证目标磁盘，请取消该软件。",
            item.tool.name
        )),
    }
}

fn probe_directory(path: &Path, disk: &str) -> Result<(), String> {
    let ancestor = path
        .ancestors()
        .find(|part| part.exists())
        .ok_or("目标磁盘不可用")?;
    let real = std::fs::canonicalize(ancestor).map_err(|error| error.to_string())?;
    if !on_disk(&real, disk) {
        return Err("安装目录被重定向到其他磁盘。".into());
    }
    std::fs::create_dir_all(path)
        .map_err(|error| format!("无法创建安装目录 {}：{error}", path.display()))?;
    let real = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !on_disk(&real, disk) {
        return Err("安装目录被重定向到其他磁盘。".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let probe = path.join(format!(
        ".siilvana-write-check-{}-{stamp}",
        std::process::id()
    ));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| format!("安装目录不可写 {}：{error}", path.display()))?;
    drop(file);
    std::fs::remove_file(probe).map_err(|error| error.to_string())
}

pub fn preflight(item: &Resolved, installed: Option<&str>) -> Result<(), String> {
    let Some(disk) = &item.target_disk else {
        return Ok(());
    };
    if let Some(path) = installed {
        verify_path(item, Some(path))?;
    }
    if let Some(path) = directory(item) {
        probe_directory(&path, disk)?;
    } else if installed.is_none() {
        let default = default_directory(item)?;
        // Resolve the closest existing ancestor so a junction cannot bypass the disk choice.
        let ancestor = default
            .ancestors()
            .find(|path| path.exists())
            .ok_or("无法确认默认安装目录")?;
        let real = std::fs::canonicalize(ancestor).map_err(|error| error.to_string())?;
        if !on_disk(&real, disk) {
            return Err(format!("{} 不支持自定义安装目录，默认位置为 {}，不能安装到 {disk}。请改选默认盘或取消该软件。", item.tool.name, default.display()));
        }
    }
    Ok(())
}

pub fn budgets(items: &[Resolved], temporary_disk: &str) -> BTreeMap<String, u64> {
    let mut sizes = BTreeMap::new();
    for item in items {
        if let Some(disk) = &item.target_disk {
            *sizes.entry(disk.clone()).or_insert(0) += item.tool.disk_mb * 1024 * 1024;
        }
    }
    let reserve = 2 * 1024_u64.pow(3);
    for bytes in sizes.values_mut() {
        *bytes = (*bytes as f64 * 1.2).ceil() as u64 + reserve;
    }
    *sizes.entry(temporary_disk.into()).or_insert(reserve) += items
        .iter()
        .map(|item| item.tool.disk_mb * 1024 * 1024)
        .sum::<u64>();
    sizes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_drive_roots() {
        assert_eq!(drive("d:/").as_deref(), Some("D:\\"));
        for value in [
            "D:",
            "D:\\Apps",
            "\\\\server\\share",
            "D:\\..\\C:\\",
            "D:\\;cmd",
            "é:\\",
        ] {
            assert!(drive(value).is_none(), "{value}");
        }
    }
    #[test]
    fn compares_complete_disk_prefixes() {
        assert!(on_disk(Path::new("\\\\?\\D:\\Apps\\git.exe"), "D:\\"));
        assert!(!on_disk(Path::new("E:\\Apps\\git.exe"), "D:\\"));
        assert!(!on_disk(Path::new("D:relative.exe"), "D:\\"));
    }
    fn request(ids: &[&str]) -> Request {
        let catalog = super::super::catalog::embedded();
        Request {
            platform: "windows".into(),
            architecture: "x64".into(),
            catalog_revision: catalog.revision,
            fingerprint: "locations-test".into(),
            installation_targets: Default::default(),
            selections: ids
                .iter()
                .map(|id| super::super::catalog::Selection {
                    tool_id: (*id).into(),
                    version_id: catalog
                        .tools
                        .iter()
                        .find(|tool| tool.id == *id)
                        .unwrap()
                        .versions
                        .iter()
                        .find(|version| version.recommended)
                        .unwrap()
                        .id
                        .clone(),
                    reason: None,
                })
                .collect(),
        }
    }
    #[test]
    fn binds_bundled_components_and_rejects_missing_or_unknown_destinations() {
        let mut request = request(&["node"]);
        request.installation_targets = [
            ("node".into(), "D:\\".into()),
        ]
        .into();
        let resolved = super::super::catalog::resolve(&request).unwrap();
        assert_eq!(
            resolved
                .iter()
                .find(|item| item.tool.id == "npm")
                .unwrap()
                .target_disk
                .as_deref(),
            Some("D:\\")
        );
        request
            .installation_targets
            .insert("npm".into(), "E:\\".into());
        assert!(super::super::catalog::resolve(&request).is_err());
        request.installation_targets.insert("npm".into(), "D:\\".into());
        request.installation_targets.remove("node");
        assert!(super::super::catalog::resolve(&request).is_err());
        request
            .installation_targets
            .insert("unselected".into(), "C:\\".into());
        assert!(super::super::catalog::resolve(&request).is_err());
    }
    #[test]
    fn command_and_capacity_follow_independent_targets() {
        let mut request = request(&["git", "vscode"]);
        request.installation_targets = [
            ("git".into(), "D:\\".into()),
            ("vscode".into(), "E:\\".into()),
        ]
        .into();
        let items = super::super::catalog::resolve(&request).unwrap();
        let command = process::install(&items[0]).unwrap();
        let index = command
            .args
            .iter()
            .position(|arg| arg == "--location")
            .unwrap();
        assert!(
            normalized(Path::new(&command.args[index + 1])).ends_with("d:\\siilvana\\apps\\git")
        );
        let sizes = budgets(&items, "C:\\");
        assert_eq!(sizes.len(), 3);
        assert_eq!(sizes["C:\\"], 2 * 1024_u64.pow(3) + 1000 * 1024 * 1024);
        assert_eq!(
            sizes["D:\\"],
            (350.0_f64 * 1024.0 * 1024.0 * 1.2).ceil() as u64 + 2 * 1024_u64.pow(3)
        );
        request
            .installation_targets
            .insert("vscode".into(), "D:\\".into());
        let items = super::super::catalog::resolve(&request).unwrap();
        assert_eq!(
            budgets(&items, "D:\\")["D:\\"],
            (1000.0_f64 * 1024.0 * 1024.0 * 1.2).ceil() as u64
                + 2 * 1024_u64.pow(3)
                + 1000 * 1024 * 1024
        );
    }
    #[test]
    fn missing_or_wrong_real_location_never_passes() {
        let mut items = super::super::catalog::resolve(&request(&["git"])).unwrap();
        let actual = std::env::current_exe().unwrap();
        let actual_text = actual.to_string_lossy();
        items[0].target_disk = Some(
            if on_disk(&actual, "Z:\\") {
                "Y:\\"
            } else {
                "Z:\\"
            }
            .into(),
        );
        assert!(verify_path(&items[0], Some(&actual_text)).is_err());
        assert!(verify_path(&items[0], None).is_err());
        assert!(preflight(&items[0], Some(&actual_text)).is_err());
    }
}
