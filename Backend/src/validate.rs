// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::Path;
use std::sync::LazyLock;

static WIN_ABS_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^[A-Za-z]:[\\/]").expect("hardcoded Windows path regex is valid")
});

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
        && let Some(home) = dirs::home_dir()
    {
        s = s.replacen('~', home.to_string_lossy().as_ref(), 1);
    }
    let p = Path::new(&s);
    (s.clone(), p.exists(), p.is_dir())
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
/// VCS plugins validate URLs via the protocol. This just checks non-empty so the
/// frontend doesn't send obviously blank input to the plugin.
///
/// # Parameters
/// - `url`: Candidate URL string.
///
/// # Returns
/// - Validation result with `ok` and optional reason.
pub fn validate_vcs_url(url: String) -> Validation {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Validation {
            ok: false,
            reason: Some("Enter a repository URL".into()),
        };
    }
    // Let the selected VCS plugin validate the URL format.
    Validation {
        ok: true,
        reason: None,
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
    // Path is a directory; let the selected VCS backend determine
    // whether it contains a valid repository.
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
    // URL non-empty check only — format validation is delegated to the VCS plugin.
    if url.trim().is_empty() {
        return Validation {
            ok: false,
            reason: Some("Enter a repository URL".into()),
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
            && !parent.exists()
        {
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
    // If directory exists, warn when it's non-empty
    if let Ok(mut rd) = std::fs::read_dir(Path::new(&norm)) {
        if rd.next().is_none() {
            // Empty directory — OK, clone will populate it
        } else {
            // Non-empty — still OK; let the backend decide if it can clone here
        }
    }
    Validation {
        ok: true,
        reason: None,
    }
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/validate.rs");
}
