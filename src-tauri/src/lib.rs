mod vcs;
mod tauri_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");


    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![tauri_commands::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "linux")]
fn apply_linux_nvidia_workaround() {
    // Only apply if we're on Wayland + NVIDIA
    let is_wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);

    let is_nvidia = {
        // NVIDIA usually sets this env var when using GLVND
        if let Ok(v) = std::env::var("__GLX_VENDOR_LIBRARY_NAME") {
            v.eq_ignore_ascii_case("nvidia")
        } else if std::env::var("__NV_PRIME_RENDER_OFFLOAD").is_ok() {
            true
        } else {
            // Fallback: check for NVIDIA in /proc/driver/nvidia/version
            std::fs::read_to_string("/proc/driver/nvidia/version")
                .map(|s| s.contains("NVIDIA"))
                .unwrap_or(false)
        }
    };

    if is_wayland && is_nvidia {
        const KEY: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
        if std::env::var_os(KEY).is_none() {
            eprintln!("Applying NVIDIA Wayland workaround: {KEY}=1");
            std::env::set_var(KEY, "1");
        }
    }
}

// No-op on non-Linux targets so call sites are uniform.
#[cfg(not(target_os = "linux"))]
fn apply_linux_nvidia_workaround() {}
