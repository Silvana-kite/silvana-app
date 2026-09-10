use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../../packages/catalog/src/index.ts");
    println!("cargo:rerun-if-changed=../../packages/catalog/src/software.ts");
    println!("cargo:rerun-if-changed=../../packages/catalog/src/scenes.ts");
    println!("cargo:rerun-if-changed=../../packages/catalog/native-catalog.signed.json");
    println!("cargo:rerun-if-changed=../../packages/catalog/native-catalog.public-key");
    println!("cargo:rerun-if-changed=../../tools/catalog/native-manifest.mjs");
    let manifest = Command::new("node")
        .arg("../../tools/catalog/native-manifest.mjs")
        .output()
        .expect("Node 24 is required to build the native catalog");
    assert!(
        manifest.status.success(),
        "Native catalog build failed: {}",
        String::from_utf8_lossy(&manifest.stderr)
    );
    std::fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("catalog.json"),
        manifest.stdout,
    )
    .expect("Cannot write native catalog");
    for name in ["native-catalog.signed.json", "native-catalog.public-key"] {
        std::fs::copy(format!("../../packages/catalog/{name}"), PathBuf::from(env::var("OUT_DIR").unwrap()).join(name)).expect("Signed native catalog missing; run tools/catalog/sign-native.mjs");
    }
    println!("cargo:rerun-if-changed=app-icon.svg");
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing manifest directory"));
    let icon = manifest_dir.join("icons/icon.ico");
    if !icon.exists() {
        let pnpm = if cfg!(windows) { "pnpm.cmd" } else { "pnpm" };
        let status = Command::new(pnpm)
            .current_dir(manifest_dir.parent().expect("missing desktop directory"))
            .args([
                "exec",
                "tauri",
                "icon",
                "src-tauri/app-icon.svg",
                "--output",
                "src-tauri/icons",
            ])
            .status()
            .expect("failed to run the SVG icon generator; install workspace dependencies first");
        assert!(status.success(), "SVG icon generation failed");
    }
    tauri_build::build()
}
