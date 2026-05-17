// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use super::*;
use crate::settings::Performance;
use std::{env, ffi::OsString, sync::{Mutex, OnceLock}};

static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct EnvSnapshot {
    entries: Vec<(&'static str, Option<OsString>)>,
}

impl EnvSnapshot {
    fn capture(keys: &[&'static str]) -> Self {
        let entries = keys
            .iter()
            .map(|key| (*key, env::var_os(key)))
            .collect();
        Self { entries }
    }
}

impl Drop for EnvSnapshot {
    fn drop(&mut self) {
        for (key, value) in self.entries.drain(..).rev() {
            unsafe {
                match value {
                    Some(value) => env::set_var(key, value),
                    None => env::remove_var(key),
                }
            }
        }
    }
}

fn with_env_lock<T>(f: impl FnOnce() -> T) -> T {
    let lock = ENV_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().expect("lock env mutation");
    f()
}

#[cfg(target_os = "linux")]
#[test]
/// Confirms GPU-disable env vars are set when acceleration is off.
fn gpu_acceleration_preference_sets_disable_flags() {
    with_env_lock(|| {
        let guard = EnvSnapshot::capture(&["WEBKIT_DISABLE_COMPOSITING_MODE", "WEBKIT_DISABLE_WEBGL"]);
        unsafe {
            env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
            env::remove_var("WEBKIT_DISABLE_WEBGL");
        }

        apply_gpu_acceleration_preference(&Performance {
            progressive_render: true,
            gpu_accel: false,
            animations: true,
        });

        assert_eq!(env::var("WEBKIT_DISABLE_COMPOSITING_MODE").ok().as_deref(), Some("1"));
        assert_eq!(env::var("WEBKIT_DISABLE_WEBGL").ok().as_deref(), Some("1"));
        drop(guard);
    });
}

#[cfg(target_os = "linux")]
#[test]
/// Confirms GPU-disable env vars are removed when acceleration is on.
fn gpu_acceleration_preference_clears_disable_flags() {
    with_env_lock(|| {
        let guard = EnvSnapshot::capture(&["WEBKIT_DISABLE_COMPOSITING_MODE", "WEBKIT_DISABLE_WEBGL"]);
        unsafe {
            env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            env::set_var("WEBKIT_DISABLE_WEBGL", "1");
        }

        apply_gpu_acceleration_preference(&Performance {
            progressive_render: true,
            gpu_accel: true,
            animations: true,
        });

        assert!(env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none());
        assert!(env::var_os("WEBKIT_DISABLE_WEBGL").is_none());
        drop(guard);
    });
}

#[cfg(target_os = "linux")]
#[test]
/// Confirms NVIDIA Wayland workaround enables dmabuf fallback when needed.
fn linux_nvidia_workaround_sets_dmabuf_disable_flag() {
    with_env_lock(|| {
        let guard = EnvSnapshot::capture(&[
            "XDG_SESSION_TYPE",
            "__GLX_VENDOR_LIBRARY_NAME",
            "__NV_PRIME_RENDER_OFFLOAD",
            "WEBKIT_DISABLE_DMABUF_RENDERER",
        ]);
        unsafe {
            env::set_var("XDG_SESSION_TYPE", "wayland");
            env::set_var("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
            env::remove_var("__NV_PRIME_RENDER_OFFLOAD");
            env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        }

        apply_linux_nvidia_workaround();

        assert_eq!(env::var("WEBKIT_DISABLE_DMABUF_RENDERER").ok().as_deref(), Some("1"));
        drop(guard);
    });
}
