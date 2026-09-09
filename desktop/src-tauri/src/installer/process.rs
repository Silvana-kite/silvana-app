use super::catalog::{Process, Resolved};
use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

pub fn search_paths() -> Vec<PathBuf> {
    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut paths = vec![home.join(".volta/bin"), home.join(".local/bin")];
    if let Some(volta) = env::var_os("VOLTA_HOME") {
        paths.insert(0, PathBuf::from(volta).join("bin"));
    }
    #[cfg(windows)]
    {
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local);
            paths.extend([
                base.join("Volta/bin"),
                base.join("Microsoft/WinGet/Links"),
                base.join("Microsoft/WindowsApps"),
                base.join("Programs/Microsoft VS Code/bin"),
            ]);
        }
        if let Some(roaming) = env::var_os("APPDATA") {
            paths.push(PathBuf::from(roaming).join("npm"));
        }
        if let Some(programs) = env::var_os("ProgramFiles") {
            let base = PathBuf::from(programs);
            paths.extend([
                base.join("Volta"),
                base.join("nodejs"),
                base.join("Git/cmd"),
                base.join("Microsoft VS Code/bin"),
                base.join("Docker/Docker/resources/bin"),
                base.join("PostgreSQL/17/bin"),
            ]);
            for dir in [base.join("Eclipse Adoptium"), base.join("Java")] {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        paths.push(entry.path().join("bin"));
                    }
                }
            }
        }
        let reg = env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:/Windows"))
            .join("System32/reg.exe");
        for key in [
            "HKCU\\Environment",
            "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        ] {
            if let Ok(output) = quiet_command(&reg)
                .args(["query", key, "/v", "Path"])
                .output()
            {
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    if let Some((_, value)) = line
                        .split_once("REG_EXPAND_SZ")
                        .or_else(|| line.split_once("REG_SZ"))
                    {
                        paths.extend(env::split_paths(value.trim()).filter(|p| p.is_absolute()));
                    }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        paths.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
            ]
            .map(PathBuf::from),
        );
        for prefix in ["/opt/homebrew", "/usr/local"] {
            for keg in ["postgresql@17", "python@3.13", "openjdk@21", "openjdk@25"] {
                paths.push(PathBuf::from(prefix).join("opt").join(keg).join("bin"));
            }
        }
        for major in [21, 25] {
            paths.push(PathBuf::from(format!(
                "/Library/Java/JavaVirtualMachines/temurin-{major}.jdk/Contents/Home/bin"
            )));
        }
    }
    paths.extend(
        env::split_paths(&env::var_os("PATH").unwrap_or_default()).filter(|p| p.is_absolute()),
    );
    paths.retain(|p| p.is_absolute());
    paths.dedup();
    paths
}

pub fn locate(name: &str) -> Option<PathBuf> {
    if name.contains(['/', '\\']) {
        return None;
    }
    let suffixes: &[&str] = if cfg!(windows) {
        &[".exe", ".com"]
    } else {
        &[""]
    };
    for path in search_paths() {
        for suffix in suffixes {
            let candidate = path.join(format!("{name}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn quiet_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

pub fn command(spec: &Process) -> Result<Command, String> {
    let executable = locate(&spec.executable);
    #[cfg(windows)]
    if executable.is_none() && ["npm", "pnpm", "code", "mvn"].contains(&spec.executable.as_str()) {
        if spec.executable == "mvn" {
            // Maven's reviewed Windows launcher is a batch file; only fixed verification arguments are accepted.
            let path = search_paths()
                .iter()
                .map(|p| p.join("mvn.cmd"))
                .find(|p| p.is_file())
                .ok_or("未找到 Maven")?;
            if spec.args != ["--version"] {
                return Err("不支持的 Maven 命令".into());
            }
            let system = env::var_os("SystemRoot")
                .map(PathBuf::from)
                .ok_or("无法定位 Windows")?;
            let mut cmd = quiet_command(&system.join("System32/cmd.exe"));
            use std::os::windows::process::CommandExt;
            if path.to_string_lossy().contains(['"', '%', '!', '\r', '\n']) {
                return Err("Maven 路径不可执行".into());
            }
            cmd.args(["/d", "/s", "/c"])
                .raw_arg(format!("\"\"{}\" --version\"", path.display()));
            return Ok(cmd);
        }
        for base in search_paths() {
            let script = match spec.executable.as_str() {
                "npm" => base.join("node_modules/npm/bin/npm-cli.js"),
                "pnpm" => base.join("node_modules/pnpm/bin/pnpm.cjs"),
                _ => base.join("../resources/app/out/cli.js"),
            };
            if script.is_file() {
                let node = if spec.executable == "code" {
                    Some(base.join("../Code.exe"))
                } else {
                    locate("node")
                }
                .ok_or("未找到 Node.js")?;
                let mut cmd = quiet_command(&node);
                cmd.arg(script).args(&spec.args);
                if spec.executable == "code" {
                    cmd.env("ELECTRON_RUN_AS_NODE", "1");
                }
                configure(&mut cmd)?;
                return Ok(cmd);
            }
        }
    }
    let mut command =
        quiet_command(&executable.ok_or_else(|| format!("未找到 {}", spec.executable))?);
    command.args(&spec.args);
    configure(&mut command)?;
    Ok(command)
}

fn configure(command: &mut Command) -> Result<(), String> {
    command.env("LC_ALL", "C");
    command.env(
        "PATH",
        env::join_paths(search_paths()).map_err(|e| e.to_string())?,
    );
    if let Some(home) = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        command.current_dir(home);
    }
    command.env("HOMEBREW_NO_AUTO_UPDATE", "1");
    Ok(())
}

pub fn verification_path(spec: &Process) -> Option<String> {
    let command = command(spec).ok()?;
    let script = command.get_args().find(|arg| {
        let path = Path::new(arg);
        path.is_absolute()
            && ["js", "cjs"].contains(&path.extension().and_then(|s| s.to_str()).unwrap_or(""))
    });
    Some(
        script
            .unwrap_or(command.get_program())
            .to_string_lossy()
            .into_owned(),
    )
}

pub fn capture(spec: &Process) -> Result<String, String> {
    let mut child = command(spec)?
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = mpsc::channel();
    for reader in [
        Box::new(stdout) as Box<dyn std::io::Read + Send>,
        Box::new(stderr),
    ] {
        let tx = tx.clone();
        thread::spawn(move || {
            use std::io::Read;
            let mut output = Vec::new();
            let _ = reader.take(65536).read_to_end(&mut output);
            let _ = tx.send(String::from_utf8_lossy(&output).into_owned());
        });
    }
    drop(tx);
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(20) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("工具检测超时".into());
        }
        thread::sleep(Duration::from_millis(40));
    };
    let output = rx.iter().collect::<Vec<_>>().join("\n");
    if status.success() {
        Ok(output)
    } else {
        Err(output)
    }
}

pub fn verify(item: &Resolved) -> Process {
    let mut process = item
        .recipe
        .as_ref()
        .map(|r| r.verify.clone())
        .unwrap_or(Process {
            executable: "npm".into(),
            args: vec!["--version".into()],
        });
    if item.tool.id == "python" && !cfg!(windows) {
        process.executable = "python3".into();
    }
    process
}

pub fn install(item: &Resolved) -> Result<Process, String> {
    let recipe = item.recipe.as_ref().ok_or("该工具由运行时提供")?;
    let mut args: Vec<String> = match recipe.manager.as_str() {
        "winget" => vec![
            "install",
            "--id",
            &recipe.package_id,
            "--exact",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
        "brew" => vec!["install".into(), recipe.package_id.clone()],
        "apt" => vec![
            "--disable-internal-agent",
            "/usr/bin/apt-get",
            "install",
            "-y",
            &recipe.package_id,
        ]
        .into_iter()
        .map(String::from)
        .collect(),
        "volta" => vec!["install".into(), recipe.package_id.clone()],
        "npm" => vec![
            "install".into(),
            "--global".into(),
            recipe.package_id.clone(),
        ],
        "official" => return Err("请通过官方入口安装 Volta 后重新检测。".into()),
        _ => return Err("执行器不支持该包管理器。".into()),
    };
    args.extend(recipe.arguments.clone().unwrap_or_default());
    Ok(Process {
        executable: if recipe.manager == "apt" {
            "pkexec".into()
        } else {
            recipe.manager.clone()
        },
        args,
    })
}

pub fn run(spec: &Process, log: &mut impl FnMut(String)) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if spec.executable == "brew" && spec.args.iter().any(|a| a == "--cask") {
        return super::platforms::macos::run_interactive(spec, log);
    }
    let mut child = command(spec)?
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    let readers = [
        Box::new(child.stdout.take().unwrap()) as Box<dyn std::io::Read + Send>,
        Box::new(child.stderr.take().unwrap()),
    ];
    for reader in readers {
        let tx = tx.clone();
        thread::spawn(move || {
            use std::io::Read;
            let mut reader = BufReader::new(reader);
            loop {
                let mut line = Vec::new();
                match reader.by_ref().take(4096).read_until(b'\n', &mut line) {
                    Ok(0) | Err(_) => break,
                    _ => {
                        if tx
                            .send(String::from_utf8_lossy(&line).trim().to_owned())
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });
    }
    drop(tx);
    for line in rx {
        log(line);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("安装进程退出：{}。请检查日志及系统授权。", status))
    }
}

#[cfg(test)]
mod tests {
    use super::super::catalog::{embedded, resolve, Request, Selection};
    use super::*;
    #[test]
    fn constructs_platform_commands_without_shell_text() {
        for (platform, executable) in [
            ("windows", "winget"),
            ("macos", "brew"),
            ("linux", "pkexec"),
        ] {
            let request = Request {
                platform: platform.into(),
                architecture: "x64".into(),
                selections: vec![Selection {
                    tool_id: "git".into(),
                    version_id: "git-stable".into(),
                    reason: None,
                }],
                catalog_revision: embedded().revision,
                fingerprint: String::new(),
            };
            let process = install(&resolve(&request).unwrap()[0]).unwrap();
            assert_eq!(process.executable, executable);
            assert!(!process.args.iter().any(|a| a == "-c" || a == "-Command"));
        }
    }
    #[test]
    fn never_searches_current_directory() {
        assert!(search_paths().iter().all(|p| p.is_absolute()));
        assert!(locate("../cmd").is_none());
    }
}
