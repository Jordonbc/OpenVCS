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
}
