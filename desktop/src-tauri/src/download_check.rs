use sha2::{Digest, Sha256};
use std::{io::Read, path::Path, process::Command};

pub fn verify_file(path: &Path, expected: Option<&str>) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "无法读取下载文件")?;
    let mut digest = Sha256::new(); let mut buffer = [0u8; 65536];
    loop { let read = file.read(&mut buffer).map_err(|_| "无法校验下载文件")?; if read == 0 { break; } digest.update(&buffer[..read]); }
    let checksum = format!("{:x}", digest.finalize());
    if expected.is_some_and(|value| !value.eq_ignore_ascii_case(&checksum)) { return Err("官方 SHA-256 不匹配，请勿使用此文件".into()); }
    let mut command;
    if cfg!(windows) {
        let program_files = std::env::var_os("ProgramFiles").ok_or("系统安全扫描不可用")?;
        let scanner = Path::new(&program_files).join("Windows Defender/MpCmdRun.exe");
        command = Command::new(scanner); command.args(["-Scan", "-ScanType", "3", "-DisableRemediation", "-File"]).arg(path);
    } else { command = Command::new("clamscan"); command.arg("--no-summary").arg(path); }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    match command.output() {
        Ok(output) if output.status.success() => Ok(if expected.is_some() { "官方摘要一致；本地扫描未发现威胁" } else { "本地扫描未发现威胁；未提供官方摘要，真实性未验证" }.into()),
        Ok(output) if !cfg!(windows) && output.status.code() == Some(1) => Err("安全扫描发现威胁，请勿使用此文件".into()),
        Ok(output) if cfg!(windows) && output.status.code() == Some(2) => Err("安全扫描发现威胁或扫描失败，请勿使用此文件".into()),
        _ => Ok(if expected.is_some() { "官方摘要一致；安全扫描不可用" } else { "未验证：官方摘要与本地安全扫描不可用" }.into()),
    }
}
