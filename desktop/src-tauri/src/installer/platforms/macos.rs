use super::super::{catalog::Process, process::locate};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

// Terminal owns password entry; the application only receives package-manager output and exit status.
pub fn run_interactive(spec: &Process, log: &mut impl FnMut(String)) -> Result<(), String> {
    let dir = std::env::temp_dir().join(format!(
        "siilvana-install-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let script = dir.join("install.command");
    let output = dir.join("output.log");
    let exit = dir.join("exit-code");
    let executable = locate(&spec.executable).ok_or("未找到 Homebrew")?;
    let command = std::iter::once(executable.to_string_lossy().into_owned())
        .chain(spec.args.clone())
        .map(|a| quote(&a))
        .collect::<Vec<_>>()
        .join(" ");
    let body = format!("#!/bin/bash\ntrap 'status=$?; printf \"%s\" \"$status\" > {}' EXIT\n{} > >(tee -a {}) 2> >(tee -a {} >&2)\nexit $?\n",quote(&exit.to_string_lossy()),command,quote(&output.to_string_lossy()),quote(&output.to_string_lossy()));
    fs::write(&script, body).map_err(|e| e.to_string())?;
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let status = Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&script)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("无法打开系统终端完成授权".into());
    }
    log("请在系统终端完成安装授权。".into());
    let mut seen = 0;
    loop {
        if let Ok(text) = fs::read_to_string(&output) {
            for line in text.lines().skip(seen) {
                log(line.into());
            }
            seen = text.lines().count();
        }
        if let Ok(code) = fs::read_to_string(&exit) {
            let _ = fs::remove_dir_all(&dir);
            return if code.trim() == "0" {
                Ok(())
            } else {
                Err(format!("系统终端安装退出：{}", code.trim()))
            };
        }
        thread::sleep(Duration::from_millis(250));
    }
}
