// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::{env, fs, path::PathBuf, process::Command};

/// Channel-specific metadata used for generated desktop bundles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ChannelConfig {
    /// Normalized channel slug used across build and runtime.
    slug: &'static str,
    /// Binary and bundle stem without spaces.
    main_binary_name: &'static str,
    /// Human-facing desktop product name.
    product_name: &'static str,
    /// Tauri bundle identifier.
    identifier: &'static str,
    /// Main window title.
    window_title: &'static str,
}

impl ChannelConfig {
    /// Resolves normalized channel metadata from an arbitrary environment value.
    ///
    /// # Parameters
    /// - `raw`: Raw environment value.
    ///
    /// # Returns
    /// - Stable metadata when the input is missing or unknown.
    /// - Beta or nightly metadata for recognized channel names.
    fn from_env_value(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "beta" => Self {
                slug: "beta",
                main_binary_name: "openvcs-beta",
                product_name: "OpenVCS Beta",
                identifier: "dev.jordon.openvcs.beta",
                window_title: "OpenVCS Beta",
            },
            "nightly" => Self {
                slug: "nightly",
                main_binary_name: "openvcs-nightly",
                product_name: "OpenVCS Nightly",
                identifier: "dev.jordon.openvcs.nightly",
                window_title: "OpenVCS Nightly",
            },
            _ => Self {
                slug: "stable",
                main_binary_name: "openvcs",
                product_name: "OpenVCS",
                identifier: "dev.jordon.openvcs",
                window_title: "OpenVCS",
            },
        }
    }
}

/// Returns whether the build is running for Flatpak packaging.
fn is_flatpak_build() -> bool {
    matches!(
        env::var("OPENVCS_FLATPAK").as_deref(),
        Ok("1") | Ok("true") | Ok("yes") | Ok("on")
    )
}

/// Returns whether the build is running under `cargo tauri dev`.
fn is_tauri_dev() -> bool {
    matches!(env::var("DEP_TAURI_DEV").as_deref(), Ok("true"))
}

/// Returns whether an environment variable is set to a truthy value.
fn is_truthy_env(key: &str) -> bool {
    matches!(
        env::var(key).as_deref(),
        Ok("1") | Ok("true") | Ok("yes") | Ok("on")
    )
}

/// Runs `git` with arguments and returns trimmed stdout on success.
fn run_git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Resolves the current branch name from CI environment or local Git.
fn git_branch() -> Option<String> {
    if let Ok(v) = env::var("GITHUB_REF_NAME") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return Some(v);
        }
    }
    if let Ok(v) = env::var("CI_COMMIT_REF_NAME") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return Some(v);
        }
    }

    let branch = run_git(&["branch", "--show-current"])
        .or_else(|| run_git(&["rev-parse", "--abbrev-ref", "HEAD"]))?;
    let branch = branch.trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}

/// Returns the current commit short hash.
fn git_short_hash() -> Option<String> {
    run_git(&["rev-parse", "--short=8", "HEAD"])
}

/// Returns whether the Git worktree has uncommitted changes.
fn git_is_dirty() -> Option<bool> {
    let s = run_git(&["status", "--porcelain"])?;
    Some(!s.trim().is_empty())
}

/// Sanitizes arbitrary text into a semver-safe build metadata identifier.
fn sanitize_semver_ident(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_was_dash = false;

    for c in s.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '-';
        let mapped = if ok { c } else { '-' };
        if mapped == '-' {
            if last_was_dash {
                continue;
            }
            last_was_dash = true;
        } else {
            last_was_dash = false;
        }
        out.push(mapped);
    }

    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "unknown".into()
    } else {
        out
    }
}

/// Ensures the generated built-in plugin resource directory exists.
fn ensure_generated_builtins_resource_dir(manifest_dir: &std::path::Path) {
    // Keep `bundle.resources` valid for plain `cargo build` runs even before
    // plugin bundles are generated.
    let generated = manifest_dir.join("../target/openvcs/built-in-plugins");
    if let Err(err) = fs::create_dir_all(&generated) {
        panic!(
            "failed to create generated built-in plugins resource dir {}: {}",
            generated.display(),
            err
        );
    }
}

/// Ensures the generated bundled Node runtime resource directory exists.
fn ensure_generated_node_runtime_resource_dir(manifest_dir: &std::path::Path) {
    let generated = manifest_dir.join("../target/openvcs/node-runtime");
    if let Err(err) = fs::create_dir_all(&generated) {
        panic!(
            "failed to create generated node runtime resource dir {}: {}",
            generated.display(),
            err
        );
    }
}

/// Generates Tauri build config and exports build-time metadata env vars.
fn main() {
    // Base config path (in the Backend crate)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let base = manifest_dir.join("tauri.conf.json");

    let data = fs::read_to_string(&base).expect("read tauri.conf.json");
    let mut json: serde_json::Value = serde_json::from_str(&data).expect("parse tauri.conf.json");

    // Compute channel based on environment; default to stable.
    let channel = ChannelConfig::from_env_value(
        &env::var("OPENVCS_UPDATE_CHANNEL").unwrap_or_else(|_| "stable".into()),
    );

    // Repository URL (can be overridden via env var for forks)
    let repo =
        env::var("OPENVCS_REPO").unwrap_or_else(|_| "https://github.com/Jordonbc/OpenVCS".into());

    // Build update URLs from repository
    let stable =
        serde_json::Value::String(format!("{}/releases/latest/download/latest.json", repo));
    let beta = serde_json::Value::String(format!(
        "{}/releases/download/openvcs-beta/latest.json",
        repo
    ));
    let nightly = serde_json::Value::String(format!(
        "{}/releases/download/openvcs-nightly/latest.json",
        repo
    ));

    // Navigate: plugins.updater.endpoints
    if let Some(plugins) = json.get_mut("plugins") {
        if let Some(updater) = plugins.get_mut("updater") {
            let endpoints = match channel.slug {
                // Beta: check beta first, then stable
                "beta" => serde_json::Value::Array(vec![beta.clone(), stable.clone()]),
                // Nightly: check nightly first, then stable
                "nightly" => serde_json::Value::Array(vec![nightly.clone(), stable.clone()]),
                // Stable: stable only
                _ => serde_json::Value::Array(vec![stable.clone()]),
            };
            updater["endpoints"] = endpoints;
        }
    }

    json["mainBinaryName"] = serde_json::Value::String(channel.main_binary_name.into());
    json["productName"] = serde_json::Value::String(channel.product_name.into());
    json["identifier"] = serde_json::Value::String(channel.identifier.into());
    if let Some(app) = json.get_mut("app") {
        if let Some(windows) = app
            .get_mut("windows")
            .and_then(|value| value.as_array_mut())
        {
            if let Some(main_window) = windows.first_mut() {
                main_window["title"] = serde_json::Value::String(channel.window_title.into());
            }
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
    println!("cargo:rustc-env=OPENVCS_APP_CHANNEL={}", channel.slug);

    // Also persist a copy alongside OUT_DIR for debugging (non-fatal if it fails)
    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_path = PathBuf::from(out_dir).join("tauri.generated.conf.json");
        let _ = fs::write(&out_path, serde_json::to_string_pretty(&json).unwrap());
    }

    // Re-run if the base config changes
    println!("cargo:rerun-if-changed={}", base.display());
    println!("cargo:rerun-if-env-changed=OPENVCS_UPDATE_CHANNEL");
    println!("cargo:rerun-if-env-changed=OPENVCS_FLATPAK");
    println!("cargo:rerun-if-env-changed=OPENVCS_OFFICIAL_RELEASE");
    println!("cargo:rerun-if-env-changed=OPENVCS_REPO");

    // Export a GIT_DESCRIBE string for About dialog and diagnostics
    let describe = Command::new("git")
        .args(["describe", "--always", "--dirty", "--tags"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".into());
    println!("cargo:rustc-env=GIT_DESCRIBE={}", describe);

    // Dev builds (local/nightly) should show git branch+hash (+dirty) as version metadata.
    // Official production builds should show the real package version.
    //
    // Rules:
    // - `OPENVCS_OFFICIAL_RELEASE=1` forces "official" behavior.
    // - Otherwise, we consider it official only when HEAD is exactly tagged with the package version and the tree is clean.
    let pkg_version = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into());

    // Ask cargo to re-run this build script when git ref changes in common cases.
    // Note: this can't perfectly track all working tree changes, but will refresh on most branch/commit operations.
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/index");
    println!("cargo:rerun-if-changed=.git/packed-refs");
    println!("cargo:rerun-if-changed=src");

    if let Ok(head) = fs::read_to_string(".git/HEAD") {
        if let Some(rest) = head.trim().strip_prefix("ref: ") {
            let ref_path = format!(".git/{rest}");
            println!("cargo:rerun-if-changed={ref_path}");
        }
    }

    let branch = git_branch().unwrap_or_else(|| "unknown".into());
    let hash = git_short_hash().unwrap_or_else(|| "nogit".into());
    let dirty = git_is_dirty().unwrap_or(false);

    let build_id = format!("{}@{}{}", branch, hash, if dirty { "-dirty" } else { "" });

    let exact_tag = run_git(&["describe", "--tags", "--exact-match"]);
    let expected_v = format!("v{pkg_version}");
    let head_is_version_tag = exact_tag
        .as_deref()
        .is_some_and(|t| t == pkg_version.as_str() || t == expected_v.as_str());

    let official = is_truthy_env("OPENVCS_OFFICIAL_RELEASE") || (head_is_version_tag && !dirty);

    let version = if official {
        pkg_version.clone()
    } else {
        let branch_ident = sanitize_semver_ident(&branch);
        let channel_suffix = match channel.slug {
            "beta" => "-beta",
            "nightly" => "-nightly",
            _ => "",
        };
        let suffix = format!(
            "+git.{}{}{}",
            branch_ident,
            hash,
            if dirty { ".dirty" } else { "" }
        );
        format!("{}{}{}", pkg_version, channel_suffix, suffix)
    };

    println!("cargo:rustc-env=OPENVCS_VERSION={}", version);
    println!("cargo:rustc-env=OPENVCS_BUILD={}", build_id);

    ensure_generated_builtins_resource_dir(&manifest_dir);
    ensure_generated_node_runtime_resource_dir(&manifest_dir);

    // Proceed with tauri build steps
    tauri_build::build();
}
