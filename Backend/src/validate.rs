// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::Path;
use std::sync::LazyLock;

/// Regex pattern for scp-like VCS URLs.
static SCP_LIKE_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^[\w.-]+@[\w.-]+:[\w./-]+(?:\.git)?$").unwrap());

/// Regex pattern for Windows absolute paths.
static WIN_ABS_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^[A-Za-z]:[\\/]").unwrap());

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
    if s.starts_with('~')
        && let Some(home) = dirs::home_dir() {
            s = s.replacen('~', home.to_string_lossy().as_ref(), 1);
        }
    let p = Path::new(&s);
    (s.clone(), p.exists(), p.is_dir())
}

/// Returns whether a URL has a non-empty repository path segment.
///
/// # Parameters
/// - `u`: Candidate URL string.
/// - `scheme`: URL scheme prefix to strip.
///
/// # Returns
/// - `true` when the scheme is present and at least one path segment exists.
fn has_url_path_segment(u: &str, scheme: &str) -> bool {
    let rest = u
        .strip_prefix(scheme)
        .unwrap_or_default()
        .trim_end_matches('/');
    rest.split_once('/')
        .is_some_and(|(_, path)| !path.trim_matches('/').is_empty())
}

/// Heuristically checks whether a string looks like a VCS URL.
///
/// # Parameters
/// - `u`: Candidate URL string.
///
/// # Returns
/// - `true` when URL matches supported VCS URL forms.
/// - `false` otherwise.
fn is_probably_vcs_url(u: &str) -> bool {
    let u = u.trim();
    if u.is_empty() {
        return false;
    }

    // http(s)://.../repo[.git]
    if has_url_path_segment(u, "http://") || has_url_path_segment(u, "https://") {
        return true;
    }
    // ssh://user@host/.../repo[.git]
    if has_url_path_segment(u, "ssh://") {
        return true;
    }
    // scp-like: git@host:org/repo[.git]
    if SCP_LIKE_RE.is_match(u) {
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
    WIN_ABS_RE.is_match(s)
}

/// Validates whether a string looks like a supported VCS URL.
///
/// # Parameters
/// - `url`: Candidate URL string.
///
/// # Returns
/// - Validation result with `ok` and optional reason.
pub fn validate_vcs_url(url: String) -> Validation {
    if is_probably_vcs_url(&url) {
        Validation {
            ok: true,
            reason: None,
        }
    } else {
        Validation {
            ok: false,
            reason: Some(
                "Not a recognized VCS URL (http(s), ssh, or scp-like ending in .git)".into(),
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

    // Optional: require repository marker present
    let is_repo = Path::new(&norm).join(".git").exists();
    if !is_repo {
        return Validation {
            ok: false,
            reason: Some("Folder does not look like a repository (.git missing)".into()),
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
    if !is_probably_vcs_url(&url) {
        return Validation {
            ok: false,
            reason: Some("Invalid VCS URL".into()),
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
        if let Some(parent) = Path::new(&norm).parent()
            && !parent.exists() {
                return Validation {
                    ok: false,
                    reason: Some("Parent folder does not exist".into()),
                };
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
            reason: Some("Destination already contains a repository".into()),
        };
    }
    Validation {
        ok: true,
        reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::validate_vcs_url;

    #[test]
    /// Verifies common hosted HTTP clone URLs do not require `.git` suffixes.
    fn accepts_http_clone_urls_without_git_suffix() {
        assert!(validate_vcs_url("https://github.com/openvcs/openvcs".into()).ok);
        assert!(validate_vcs_url("https://github.com/openvcs/openvcs.git".into()).ok);
    }

    #[test]
    /// Verifies SSH clone URL forms do not require `.git` suffixes.
    fn accepts_ssh_clone_urls_without_git_suffix() {
        assert!(validate_vcs_url("ssh://git@example.com/openvcs/openvcs".into()).ok);
        assert!(validate_vcs_url("git@example.com:openvcs/openvcs".into()).ok);
    }

    #[test]
    /// Verifies host-only HTTP URLs are still rejected.
    fn rejects_urls_without_repository_path() {
        assert!(!validate_vcs_url("https://github.com".into()).ok);
    }
}
