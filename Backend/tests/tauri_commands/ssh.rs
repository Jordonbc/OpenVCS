// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    clear_test_home_dir, is_executable, known_hosts_path, resolve_command, resolve_ssh_askpass,
    set_test_home_dir, ssh_dir_path, ssh_key_candidates_in_dir,
};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tempfile::tempdir;

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env lock")
}

struct EnvGuard {
    home: Option<OsString>,
    path: Option<OsString>,
    askpass: Option<OsString>,
}

impl EnvGuard {
    fn capture() -> Self {
        Self {
            home: env::var_os("HOME"),
            path: env::var_os("PATH"),
            askpass: env::var_os("SSH_ASKPASS"),
        }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        unsafe {
            match &self.home {
                Some(value) => env::set_var("HOME", value),
                None => env::remove_var("HOME"),
            }
            match &self.path {
                Some(value) => env::set_var("PATH", value),
                None => env::remove_var("PATH"),
            }
            match &self.askpass {
                Some(value) => env::set_var("SSH_ASKPASS", value),
                None => env::remove_var("SSH_ASKPASS"),
            }
        }
    }
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).expect("metadata").permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).expect("chmod");
    }
}

#[test]
fn resolves_known_hosts_and_ssh_dir_from_home() {
    let _lock = env_lock();
    let home = tempdir().expect("tempdir");
    set_test_home_dir(home.path().to_path_buf());

    let dir = ssh_dir_path().expect("ssh dir");
    let known_hosts = known_hosts_path().expect("known hosts");
    assert_eq!(dir, home.path().join(".ssh"));
    assert_eq!(known_hosts, home.path().join(".ssh").join("known_hosts"));

    clear_test_home_dir();
}

#[test]
fn detects_executable_files_and_resolves_from_path() {
    let _lock = env_lock();
    let _guard = EnvGuard::capture();
    let dir = tempdir().expect("tempdir");
    let exe = dir.path().join("tool");
    fs::write(&exe, "#!/bin/sh\nexit 0\n").expect("write file");
    make_executable(&exe);

    unsafe { env::set_var("PATH", dir.path()) };
    assert!(is_executable(&exe));
    assert_eq!(resolve_command(Path::new("tool")), Some(exe));
}

#[test]
fn resolves_ssh_askpass_from_environment() {
    let _lock = env_lock();
    let _guard = EnvGuard::capture();
    let dir = tempdir().expect("tempdir");
    let askpass = dir.path().join("askpass");
    fs::write(&askpass, "#!/bin/sh\nexit 0\n").expect("write askpass");
    make_executable(&askpass);

    unsafe {
        env::set_var("PATH", dir.path());
        env::set_var("SSH_ASKPASS", "askpass");
    };
    assert_eq!(resolve_ssh_askpass(), Some(askpass));
}

#[test]
fn lists_private_key_candidates_from_ssh_dir() {
    let _lock = env_lock();
    let _guard = EnvGuard::capture();
    let ssh_dir = tempdir().expect("tempdir");

    for name in [
        "id_rsa",
        "id_ed25519",
        "id_ed25519.pub",
        "known_hosts",
        "config",
        "custom.key",
        "notes.txt",
    ] {
        fs::write(ssh_dir.path().join(name), "x").expect("write file");
    }

    let keys = ssh_key_candidates_in_dir(ssh_dir.path()).expect("list candidates");
    let names: Vec<_> = keys.into_iter().map(|k| k.name).collect();
    assert_eq!(names, vec!["custom.key", "id_ed25519", "id_rsa"]);
}
