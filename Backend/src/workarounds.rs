#[cfg(target_os = "linux")]
pub fn apply_linux_nvidia_workaround() {
    fn set_env_if_missing(key: &str, value: &str, label: &str) {
        if std::env::var_os(key).is_none() {
            eprintln!("Applying {label}: {key}={value}");
            std::env::set_var(key, value);
        }
    }

    // AppImage: WebKitGTK sandbox often fails (missing bubblewrap or userns disabled),
    // which can manifest as a blank/white webview.
    let is_appimage = std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some();
    if is_appimage {
        set_env_if_missing(
            "WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS",
            "1",
            "AppImage WebKit sandbox workaround",
        );
    }

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
        set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1", "NVIDIA Wayland workaround");

        // Some driver/Wayland combinations still crash or render a white screen unless
        // accelerated compositing is disabled.
        set_env_if_missing("WEBKIT_DISABLE_COMPOSITING_MODE", "1", "NVIDIA Wayland workaround");
    }
}

#[cfg(not(target_os = "linux"))]
#[inline]
pub fn apply_linux_nvidia_workaround() {
    // no-op on non-Linux
}
