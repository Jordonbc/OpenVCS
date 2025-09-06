use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let git = std::process::Command::new("git")
    .args(["describe", "--tags", "--always", "--dirty=-modified"])
    .output()
    .ok()
    .and_then(|o| String::from_utf8(o.stdout).ok())
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| "dev".into());

    println!("cargo:rustc-env=GIT_DESCRIBE={}", git);

    build_frontend();
    tauri_build::build();
}

fn build_frontend() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let frontend_dir = manifest_dir.join("..").join("Frontend");

    // Run `npm run build` in Frontend/
    let status = Command::new("npm")
        .args(["run", "build"])
        .current_dir(&frontend_dir)
        .status()
        .expect("failed to spawn npm (is Node installed?)");

    if !status.success() {
        panic!("frontend build failed in {}", frontend_dir.display());
    }

    // Optional: tell Cargo to rerun if frontend sources change
    println!("cargo:rerun-if-changed={}", frontend_dir.join("index.html").display());
    println!("cargo:rerun-if-changed={}", frontend_dir.join("src").display());
    let assets = frontend_dir.join("assets");
    if assets.exists() {
        println!("cargo:rerun-if-changed={}", assets.display());
    }
}