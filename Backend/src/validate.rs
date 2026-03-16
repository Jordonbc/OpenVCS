// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::Path;

#[derive(serde::Serialize)]
pub struct Validation {
    pub ok: bool,
    pub reason: Option<String>,
}

// Expand ~ to home; leave other paths untouched.
// Returns (normalized_path_string, exists, is_dir)
/// Normalizes and probes a filesystem path for existence/dir status.
///
/// # Parameters
/// - `input`: Raw user path input.
///
/// # Returns
/// - Tuple of normalized path, exists flag, and is-dir flag.
fn normalize_and_probe(input: &str) -> (String, bool, bool) {
    let mut s = input.trim().to_string();
    if s.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            s = s.replacen('~', home.to_string_lossy().as_ref(), 1);
        }
    }
    let p = Path::new(&s);
    (s.clone(), p.exists(), p.is_dir())
}

/// Heuristically checks whether a string looks like a Git URL.
///
/// # Parameters
/// - `u`: Candidate URL string.
///
/// # Returns
/// - `true` when URL matches supported Git URL forms.
/// - `false` otherwise.
fn is_probably_git_url(u: &str) -> bool {
    let u = u.trim();
    if u.is_empty() {
        return false;
    }

    // http(s)://.../*.git
    if (u.starts_with("http://") || u.starts_with("https://")) && u.ends_with(".git") {
        return true;
    }
    // ssh://user@host/.../*.git
    if u.starts_with("ssh://") && u.ends_with(".git") {
        return true;
    }
    // scp-like: git@host:org/repo.git
    let scp_like = regex::Regex::new(r"^[\w.-]+@[\w.-]+:[\w./-]+\.git$").unwrap();
    if scp_like.is_match(u) {
        return true;
    }
    false
}

/// Checks whether a string looks like an absolute filesystem path.
///
/// # Parameters
/// - `s`: Candidate path string.
///
/// # Returns
/// - `true` when path format looks absolute.
/// - `false` otherwise.
fn looks_like_path(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    // POSIX absolute or ~
    if s.starts_with('/') || s.starts_with('~') {
        return true;
    }
    // Windows drive letter absolute, e.g. C:\...
    let win_abs = regex::Regex::new(r"^[A-Za-z]:[\\/]").unwrap();
    win_abs.is_match(s)
}

/// Validates whether a string looks like a supported Git URL.
///
/// # Parameters
/// - `url`: Candidate URL string.
///
/// # Returns
/// - Validation result with `ok` and optional reason.
pub fn validate_git_url(url: String) -> Validation {
    if is_probably_git_url(&url) {
        Validation {
            ok: true,
            reason: None,
        }
    } else {
        Validation {
            ok: false,
            reason: Some(
                "Not a recognized Git URL (http(s), ssh, or scp-like ending in .git)".into(),
            ),
        }
    }
}

/// Validates a repository path for add/open operations.
///
/// # Parameters
/// - `path`: Candidate absolute repository path.
///
/// # Returns
/// - Validation result with `ok` and optional reason.
pub fn validate_add_path(path: String) -> Validation {
    if !looks_like_path(&path) {
        return Validation {
            ok: false,
            reason: Some("Enter an absolute path".into()),
        };
    }
    let (norm, exists, is_dir) = normalize_and_probe(&path);
    if !exists {
        return Validation {
            ok: false,
            reason: Some(format!("Path does not exist: {norm}")),
        };
    }
    if !is_dir {
        return Validation {
            ok: false,
            reason: Some(format!("Not a directory: {norm}")),
        };
    }

    // Optional: require .git folder present
    let is_repo = Path::new(&norm).join(".git").exists();
    if !is_repo {
        return Validation {
            ok: false,
            reason: Some("Folder does not look like a Git repository (.git missing)".into()),
        };
    }

    Validation {
        ok: true,
        reason: None,
    }
}

/// Validates clone URL and destination inputs.
///
/// # Parameters
/// - `url`: Source repository URL.
/// - `dest`: Destination path.
///
/// # Returns
/// - Validation result with `ok` and optional reason.
pub fn validate_clone_input(url: String, dest: String) -> Validation {
    if !is_probably_git_url(&url) {
        return Validation {
            ok: false,
            reason: Some("Invalid Git URL".into()),
        };
    }
    if !looks_like_path(&dest) {
        return Validation {
            ok: false,
            reason: Some("Destination must be an absolute path".into()),
        };
    }
    let (norm, exists, is_dir) = normalize_and_probe(&dest);
    if !exists {
        // Allow non-existent parent? Keep strict: require parent exists.
        if let Some(parent) = Path::new(&norm).parent() {
            if !parent.exists() {
                return Validation {
                    ok: false,
                    reason: Some("Parent folder does not exist".into()),
                };
            }
        }
        return Validation {
            ok: true,
            reason: None,
        }; // Okay to create at clone time
    }
    if !is_dir {
        return Validation {
            ok: false,
            reason: Some("Destination is not a directory".into()),
        };
    }
    // If directory exists, ensure it's empty-ish (no .git)
    if Path::new(&norm).join(".git").exists() {
        return Validation {
            ok: false,
            reason: Some("Destination already contains a Git repo".into()),
        };
    }
    Validation {
        ok: true,
        reason: None,
    }
}
