use serde::Serialize;
use std::path::{Path, PathBuf};
use sysinfo::{CpuRefreshKind, Disks, System};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    platform: Option<String>,
    architecture: Option<String>,
    cpu_name: Option<String>,
    os_name: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub(crate) id: String,
    label: String,
    total_bytes: u64,
    pub(crate) available_bytes: u64,
    pub(crate) installation_target: bool,
    system_target: bool,
    pub(crate) temporary_target: bool,
}

#[cfg(any(test, not(windows)))]
fn architecture_name(value: &str) -> Option<String> {
    match value.to_ascii_lowercase().as_str() {
        "x86_64" | "amd64" | "x64" => Some("x64".into()),
        "aarch64" | "arm64" => Some("arm64".into()),
        _ => None,
    }
}

pub(crate) fn host_architecture() -> Option<String> {
    #[cfg(windows)]
    {
        use windows::Win32::System::{
            SystemInformation::{
                IMAGE_FILE_MACHINE, IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_ARM64,
            },
            Threading::{GetCurrentProcess, IsWow64Process2},
        };
        let mut process_machine = IMAGE_FILE_MACHINE::default();
        let mut native_machine = IMAGE_FILE_MACHINE::default();
        // The native machine remains accurate when this process runs under emulation.
        unsafe {
            IsWow64Process2(
                GetCurrentProcess(),
                &mut process_machine,
                Some(&mut native_machine),
            )
            .ok()?;
        }
        return match native_machine {
            IMAGE_FILE_MACHINE_AMD64 => Some("x64".into()),
            IMAGE_FILE_MACHINE_ARM64 => Some("arm64".into()),
            _ => None,
        };
    }
    #[cfg(target_os = "macos")]
    {
        let mut translated: libc::c_int = 0;
        let mut length = std::mem::size_of_val(&translated);
        // Rosetta presents x86_64 through hw.machine; query the translation flag first.
        let result = unsafe {
            libc::sysctlbyname(
                c"sysctl.proc_translated".as_ptr(),
                &mut translated as *mut _ as *mut libc::c_void,
                &mut length,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == 0 && translated == 1 {
            return Some("arm64".into());
        }
        return architecture_name(&System::cpu_arch());
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    architecture_name(&System::cpu_arch())
}

#[tauri::command]
pub async fn device_info() -> Result<DeviceInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut system = System::new();
        system.refresh_cpu_specifics(CpuRefreshKind::nothing());
        DeviceInfo {
            platform: match std::env::consts::OS {
                "windows" => Some("windows".into()),
                "macos" => Some("macos".into()),
                "linux" => Some("linux".into()),
                _ => None,
            },
            architecture: host_architecture(),
            os_name: System::long_os_version(),
            cpu_name: system
                .cpus()
                .first()
                .map(|cpu| cpu.brand().trim().to_owned())
                .filter(|name| !name.is_empty()),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

fn mount_contains(path: &Path, mount: &Path) -> bool {
    #[cfg(windows)]
    {
        Path::new(&path.to_string_lossy().to_lowercase())
            .starts_with(Path::new(&mount.to_string_lossy().to_lowercase()))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(mount)
    }
}

pub fn inspect_disks(
    consent: bool,
    system_path: PathBuf,
    user_path: PathBuf,
) -> Result<Vec<DiskInfo>, String> {
    if !consent {
        return Err("请先允许查询磁盘容量。".into());
    }
    let disks = Disks::new_with_refreshed_list();
    let mut result: Vec<DiskInfo> = Vec::new();
    for disk in &disks {
        let id = disk.mount_point().to_string_lossy().to_string();
        if disk.total_space() == 0 || disk.available_space() > disk.total_space() {
            return Err(format!("磁盘 {id} 容量读取失败，请重新检测。"));
        }
        result.push(DiskInfo {
            label: format!("{} ({})", disk.name().to_string_lossy(), id),
            id,
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
            installation_target: false,
            system_target: false,
            temporary_target: false,
        });
    }
    let mut result = classify_disks(result, &system_path, &user_path)?;
    if cfg!(windows) {
        let temporary = std::fs::canonicalize(std::env::temp_dir())
            .map_err(|_| "无法定位临时文件所在磁盘。")?;
        let temporary = temporary
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .to_owned();
        let disk = result
            .iter_mut()
            .filter(|disk| mount_contains(Path::new(&temporary), Path::new(&disk.id)))
            .max_by_key(|disk| disk.id.len())
            .ok_or("无法定位临时文件所在磁盘。")?;
        disk.temporary_target = true;
    }
    Ok(result)
}

fn classify_disks(
    mut disks: Vec<DiskInfo>,
    system_path: &Path,
    user_path: &Path,
) -> Result<Vec<DiskInfo>, String> {
    disks.sort_by_key(|disk| disk.id.to_lowercase());
    disks.dedup_by(|a, b| {
        if cfg!(windows) {
            a.id.eq_ignore_ascii_case(&b.id)
        } else {
            a.id == b.id
        }
    });
    for path in [system_path, user_path] {
        // Enumerate all volumes, but only the longest matching mounts constrain installation.
        let disk = disks
            .iter_mut()
            .filter(|disk| mount_contains(path, Path::new(&disk.id)))
            .max_by_key(|disk| Path::new(&disk.id).components().count())
            .ok_or("无法定位系统或用户目录所在磁盘。")?;
        disk.installation_target = true;
        if path == system_path {
            disk.system_target = true;
        }
    }
    Ok(disks)
}

#[tauri::command]
pub async fn scan_disks(app: tauri::AppHandle, consent: bool) -> Result<Vec<DiskInfo>, String> {
    if !consent {
        return Err("请先允许查询磁盘容量。".into());
    }
    let user_path = app.path().home_dir().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let user_path = {
        let data_path = PathBuf::from("/System/Volumes/Data")
            .join(user_path.strip_prefix("/").unwrap_or(&user_path));
        if data_path.exists() {
            data_path
        } else {
            user_path
        }
    };
    #[cfg(windows)]
    let system_path = PathBuf::from(std::env::var_os("SystemRoot").ok_or("无法定位系统目录。")?);
    // macOS system installations and package-manager data live on the writable data volume.
    #[cfg(target_os = "macos")]
    let system_path = if Path::new("/System/Volumes/Data").exists() {
        PathBuf::from("/System/Volumes/Data")
    } else {
        PathBuf::from("/")
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let system_path = PathBuf::from("/usr");
    tauri::async_runtime::spawn_blocking(move || inspect_disks(consent, system_path, user_path))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_host_architecture() {
        assert_eq!(architecture_name("aarch64").as_deref(), Some("arm64"));
        assert_eq!(architecture_name("AMD64").as_deref(), Some("x64"));
        assert_eq!(architecture_name("i686"), None);
    }
    #[test]
    fn refuses_without_consent() {
        assert!(inspect_disks(false, PathBuf::new(), PathBuf::new()).is_err());
    }
    #[test]
    fn mount_matching_respects_path_components() {
        assert!(mount_contains(Path::new("/usr/local"), Path::new("/usr")));
        assert!(!mount_contains(Path::new("/usr2"), Path::new("/usr")));
    }
    #[test]
    #[ignore = "Reads real local disk capacity; run explicitly after consent"]
    fn live_disk_capacity() {
        let path = std::env::current_dir().unwrap();
        let disks = inspect_disks(true, path.clone(), path).unwrap();
        assert!(!disks.is_empty());
        for disk in Disks::new_with_refreshed_list().iter() {
            assert!(
                disks
                    .iter()
                    .any(|item| Path::new(&item.id) == disk.mount_point()),
                "Missing mounted disk: {:?}",
                disk.mount_point()
            );
        }
        assert!(disks[0].total_bytes > 0);
        println!("{disks:?}");
        #[cfg(windows)]
        {
            let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap());
            let user = PathBuf::from(std::env::var_os("USERPROFILE").unwrap());
            let volumes = inspect_disks(true, system, user).unwrap();
            assert!(!volumes.is_empty());
            println!("All local volumes: {volumes:?}");
            assert!(host_architecture().is_some());
        }
    }

    #[test]
    fn includes_data_and_external_volumes_without_marking_them_as_install_targets() {
        let disks = ["/backup", "/", "/home", "/data", "/data"].map(|id| DiskInfo {
            id: id.into(),
            label: id.into(),
            total_bytes: 100,
            available_bytes: 1,
            installation_target: false,
            system_target: false,
            temporary_target: false,
        });
        let result =
            classify_disks(disks.into(), Path::new("/usr"), Path::new("/home/person")).unwrap();
        assert_eq!(result.len(), 4);
        let targets: Vec<_> = result
            .iter()
            .filter(|disk| disk.installation_target)
            .map(|disk| disk.id.as_str())
            .collect();
        assert_eq!(targets, vec!["/", "/home"]);
        assert!(result
            .iter()
            .any(|disk| disk.id == "/backup" && !disk.installation_target));
    }
}
