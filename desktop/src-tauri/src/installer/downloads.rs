use super::{catalog::Process, process};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

// SHA-256 values were reviewed from the official v2.0.2 release artifacts.
const X64: (&str, &str) = (
    "volta-2.0.2-linux.tar.gz",
    "6cec054c911fb925b629a09455775af6e95dc0f5694a4c28b63979ab9ef18037",
);
const ARM64: (&str, &str) = (
    "volta-2.0.2-linux-arm.tar.gz",
    "1eb92f8b711753aa576352b2e580b2f3fdadeab8664929ca1da3d0de65448517",
);

pub fn asset(architecture: &str) -> Result<(&'static str, &'static str), String> {
    match architecture {
        "x64" => Ok(X64),
        "arm64" => Ok(ARM64),
        _ => Err("Volta 暂不支持此架构".into()),
    }
}
fn spec(executable: &str, args: Vec<String>) -> Process {
    Process {
        executable: executable.into(),
        args,
    }
}

pub fn install_volta(log: &mut impl FnMut(String)) -> Result<(), String> {
    if !cfg!(target_os = "linux") {
        return Err("该安装包仅适用于 Linux".into());
    }
    let arch = crate::device::host_architecture().ok_or("无法识别本机架构")?;
    let (filename, expected_hash) = asset(&arch)?;
    let stage = std::env::temp_dir().join(format!(
        "siilvana-volta-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&stage, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let result = (|| {
        let archive = stage.join(filename);
        let archive_arg = archive.to_string_lossy().into_owned();
        let url = format!("https://github.com/volta-cli/volta/releases/download/v2.0.2/{filename}");
        log(format!("下载 Volta 2.0.2 ({arch})"));
        process::run(
            &spec(
                "curl",
                vec![
                    "--proto".into(),
                    "=https".into(),
                    "--proto-redir".into(),
                    "=https".into(),
                    "--tlsv1.2".into(),
                    "--fail".into(),
                    "--location".into(),
                    "--max-time".into(),
                    "600".into(),
                    "--output".into(),
                    archive_arg.clone(),
                    url,
                ],
            ),
            log,
        )?;
        let digest = process::capture(&spec("sha256sum", vec![archive_arg.clone()]))?;
        if digest.split_whitespace().next() != Some(expected_hash) {
            return Err("Volta 安装包校验失败，已停止执行。".into());
        }
        log("SHA-256 校验通过".into());
        let names = ["volta", "volta-shim", "volta-migrate"];
        process::run(
            &spec(
                "tar",
                vec![
                    "-xf".into(),
                    archive_arg,
                    "--no-same-owner".into(),
                    "-C".into(),
                    stage.to_string_lossy().into_owned(),
                    "volta".into(),
                    "volta-shim".into(),
                    "volta-migrate".into(),
                ],
            ),
            log,
        )?;
        let home = std::env::var_os("VOLTA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".volta")))
            .ok_or("无法定位用户目录")?;
        let bin = home.join("bin");
        fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        for name in names {
            let source = stage.join(name);
            if !source.is_file() || source.is_symlink() {
                return Err("安装包内容不符合预期".into());
            }
            fs::copy(&source, bin.join(name)).map_err(|e| e.to_string())?;
        }
        process::run(&spec("volta", vec!["setup".into()]), log)
    })();
    let _ = fs::remove_dir_all(stage);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_reviewed_architectures_and_hashes_are_accepted() {
        assert!(asset("x86").is_err());
        assert_ne!(asset("x64").unwrap(), asset("arm64").unwrap());
        for arch in ["x64", "arm64"] {
            let (name, hash) = asset(arch).unwrap();
            assert!(name.starts_with("volta-2.0.2-"));
            assert_eq!(hash.len(), 64);
            assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
