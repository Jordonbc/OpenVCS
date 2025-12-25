use std::{env, fs, path::PathBuf, process::Command};

fn is_flatpak_build() -> bool {
    matches!(
        env::var("OPENVCS_FLATPAK").as_deref(),
        Ok("1") | Ok("true") | Ok("yes") | Ok("on")
    )
}

fn is_tauri_dev() -> bool {
    matches!(env::var("DEP_TAURI_DEV").as_deref(), Ok("true"))
}

fn main() {
    // Base config path (in the Backend crate)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let base = manifest_dir.join("tauri.conf.json");

    let data = fs::read_to_string(&base).expect("read tauri.conf.json");
    let mut json: serde_json::Value = serde_json::from_str(&data).expect("parse tauri.conf.json");

    // Compute channel based on environment; default to stable
    let chan = env::var("OPENVCS_UPDATE_CHANNEL").unwrap_or_else(|_| "stable".into());

    // Locations
    let stable = serde_json::Value::String(
        "https://github.com/Jordonbc/OpenVCS/releases/latest/download/latest.json".into(),
    );
    let nightly = serde_json::Value::String(
        "https://github.com/Jordonbc/OpenVCS/releases/download/openvcs-nightly/latest.json".into(),
    );

    // Navigate: plugins.updater.endpoints
    if let Some(plugins) = json.get_mut("plugins") {
        if let Some(updater) = plugins.get_mut("updater") {
            let endpoints = match chan.as_str() {
                // Nightly: check nightly first, then stable
                "nightly" | "beta" => serde_json::Value::Array(vec![nightly.clone(), stable.clone()]),
                // Stable: stable only
                _ => serde_json::Value::Array(vec![stable.clone()]),
            };
            updater["endpoints"] = endpoints;
        }
    }

    // The app should only ever point at a dev server when running `cargo tauri dev`.
    // In all other cases (including `cargo build`, `cargo run`, `cargo tauri build`, Flatpak, CI),
    // we must ship/load the prebuilt frontend assets from `frontendDist`.
    let strip_dev_server = !is_tauri_dev() || is_flatpak_build();

    // Non-dev builds should never point at the dev server.
    // We build the frontend ahead of time and ship it as production assets.
    if strip_dev_server {
        if let Some(build) = json.get_mut("build") {
            if let Some(build_obj) = build.as_object_mut() {
                build_obj.remove("devUrl");
                build_obj.remove("beforeDevCommand");
            }
        }
    }

    // Flatpak apps update via Flatpak, not the in-app updater.
    if is_flatpak_build() {
        if let Some(plugins) = json.get_mut("plugins") {
            if let Some(updater) = plugins.get_mut("updater") {
                updater["active"] = serde_json::Value::Bool(false);
            }
        }
        if let Some(bundle) = json.get_mut("bundle") {
            bundle["createUpdaterArtifacts"] = serde_json::Value::Bool(false);
        }
    }

    // Provide the generated config via inline JSON env var (must be single-line)
    let inline = serde_json::to_string(&json).unwrap();
    println!("cargo:rustc-env=TAURI_CONFIG={}", inline);

    // Also persist a copy alongside OUT_DIR for debugging (non-fatal if it fails)
    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_path = PathBuf::from(out_dir).join("tauri.generated.conf.json");
        let _ = fs::write(&out_path, serde_json::to_string_pretty(&json).unwrap());
    }

    // Re-run if the base config changes
    println!("cargo:rerun-if-changed={}", base.display());

    // Export a GIT_DESCRIBE string for About dialog and diagnostics
    let describe = Command::new("git")
        .args(["describe", "--always", "--dirty", "--tags"])
        .output()
        .ok()
        .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).trim().to_string()) } else { None })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".into());
    println!("cargo:rustc-env=GIT_DESCRIBE={}", describe);

    // Proceed with tauri build steps
    tauri_build::build();
}
