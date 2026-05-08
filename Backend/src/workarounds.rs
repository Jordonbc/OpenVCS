// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::settings::Performance;

#[cfg(target_os = "linux")]
/// Applies a runtime workaround for NVIDIA + Wayland rendering issues.
///
/// # Returns
/// - `()`.
pub fn apply_linux_nvidia_workaround() {
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
            unsafe {
                // Safety: set once during process startup before app threads run.
                std::env::set_var(KEY, "1");
            }
        }
    }
}

#[cfg(target_os = "linux")]
/// Applies the stored GPU acceleration preference before the webview starts.
///
/// When disabled, this forces WebKitGTK into a software/compositing-off path.
/// When enabled, any previously injected disable flags are removed so the host
/// can use the default accelerated path.
///
/// # Parameters
/// - `performance`: Persisted performance settings.
///
/// # Returns
/// - `()`.
pub fn apply_gpu_acceleration_preference(performance: &Performance) {
    const COMPOSITING_KEY: &str = "WEBKIT_DISABLE_COMPOSITING_MODE";
    const WEBGL_KEY: &str = "WEBKIT_DISABLE_WEBGL";

    if performance.gpu_accel {
        eprintln!("Clearing GPU-disable env vars where present");
        unsafe {
            std::env::remove_var(COMPOSITING_KEY);
            std::env::remove_var(WEBGL_KEY);
        }
        return;
    }

    eprintln!("Applying GPU-disable env vars: {COMPOSITING_KEY}=1, {WEBGL_KEY}=1");
    unsafe {
        std::env::set_var(COMPOSITING_KEY, "1");
        std::env::set_var(WEBGL_KEY, "1");
    }
}

#[cfg(not(target_os = "linux"))]
#[inline]
/// No-op on non-Linux platforms.
///
/// # Returns
/// - `()`.
pub fn apply_linux_nvidia_workaround() {
    // no-op on non-Linux
}

#[cfg(not(target_os = "linux"))]
#[inline]
/// No-op on non-Linux platforms.
///
/// # Parameters
/// - `performance`: Persisted performance settings.
///
/// # Returns
/// - `()`.
pub fn apply_gpu_acceleration_preference(_performance: &Performance) {
    // no-op on non-Linux
}

#[cfg(target_os = "windows")]
/// Returns additional browser arguments for the main webview when GPU acceleration is disabled.
///
/// # Parameters
/// - `performance`: Persisted performance settings.
///
/// # Returns
/// - Browser argument string when GPU acceleration is disabled.
/// - `None` when no override is needed.
pub fn main_window_browser_args(performance: &Performance) -> Option<String> {
    if performance.gpu_accel {
        return None;
    }

    Some(
        "--disable-gpu --disable-gpu-compositing --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
            .to_string(),
    )
}

#[cfg(not(target_os = "windows"))]
#[inline]
/// No-op on non-Windows platforms.
///
/// # Parameters
/// - `performance`: Persisted performance settings.
///
/// # Returns
/// - `None`.
pub fn main_window_browser_args(_performance: &Performance) -> Option<String> {
    None
}
