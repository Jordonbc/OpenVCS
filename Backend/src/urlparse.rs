// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared remote-URL parsing helpers used by Tauri command modules.

/// Parsed components of a remote URL.
pub(crate) struct RemoteUrlParts<'a> {
    /// Host segment, when the URL carries one.
    pub host: Option<&'a str>,
    /// Owner/user segment (first non-empty path component).
    pub owner: Option<&'a str>,
    /// Repository name (last non-empty path component, `.git` suffix removed).
    pub name: Option<&'a str>,
}

/// Parses a remote URL into host/owner/name components.
///
/// Supports scp-like (`git@host:owner/repo`), `ssh://`, `https://`, and
/// `http://` forms, plus generic `scheme://` fallbacks. Semantics mirror the
/// former per-module parsers exactly so accepted formats are unchanged.
///
/// # Parameters
/// - `url`: Remote URL to parse.
///
/// # Returns
/// - Parsed [`RemoteUrlParts`]; all fields may be `None` when unparseable.
pub(crate) fn parse_remote_url(url: &str) -> RemoteUrlParts<'_> {
    let u = url.trim();
    let mut parts = RemoteUrlParts {
        host: None,
        owner: None,
        name: None,
    };
    if u.is_empty() {
        return parts;
    }

    // scp-like `user@host:path` forms.
    if let Some(at) = u.find('@') {
        let rest = &u[at + 1..];
        if let Some((host, _path)) = rest.split_once(':') {
            let host = host.trim();
            if !host.is_empty() {
                parts.host = Some(host);
            }
        }
    }

    // ssh://[user@]host/path
    if parts.host.is_none()
        && let Some(rest) = u.strip_prefix("ssh://")
    {
        let rest = rest.trim_start_matches('/');
        let after_user = rest.split('@').nth(1).unwrap_or(rest);
        let host = after_user.split('/').next().unwrap_or("").trim();
        if !host.is_empty() {
            parts.host = Some(host);
        }
    }

    // https://host/path and http://host/path
    if parts.host.is_none()
        && let Some(rest) = u
            .strip_prefix("https://")
            .or_else(|| u.strip_prefix("http://"))
    {
        let host = rest.split('/').next().unwrap_or("").trim();
        if !host.is_empty() {
            parts.host = Some(host);
        }
    }

    // Owner/name resolution. Scheme-bearing URLs use the path after the host;
    // everything else falls back to the segment after the first colon
    // (scp-like and generic `scheme://` forms).
    let path = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .map(|rest| rest.split_once('/').map(|x| x.1).unwrap_or(""));
    let seg: Vec<&str> = if let Some(path) = path {
        path.split('/').filter(|s| !s.is_empty()).collect()
    } else if let Some(rest) = u.split_once(':').map(|x| x.1) {
        rest.split('/').filter(|s| !s.is_empty()).collect()
    } else {
        Vec::new()
    };
    parts.owner = seg.first().copied();
    parts.name = seg
        .last()
        .copied()
        .map(|s| s.strip_suffix(".git").unwrap_or(s));

    parts
}

/// Extracts the host segment from a remote URL.
///
/// # Parameters
/// - `url`: Remote URL.
///
/// # Returns
/// - `Some(String)` host when parsed; `None` otherwise.
pub(crate) fn host_from_remote_url(url: &str) -> Option<String> {
    parse_remote_url(url).host.map(str::to_string)
}

/// Extracts the repository owner/user segment from a remote URL.
///
/// # Parameters
/// - `url`: Remote URL.
///
/// # Returns
/// - `Some(String)` owner segment; `None` when not parseable.
pub(crate) fn repo_username_from_origin(url: &str) -> Option<String> {
    parse_remote_url(url).owner.map(str::to_string)
}

/// Extracts the repository name segment from a remote URL.
///
/// # Parameters
/// - `url`: Remote URL.
///
/// # Returns
/// - `Some(String)` repository name; `None` when not parseable.
pub(crate) fn repo_name_from_origin(url: &str) -> Option<String> {
    parse_remote_url(url).name.map(str::to_string)
}

/// Infers a target folder name from a repository URL.
///
/// # Parameters
/// - `url`: Source repository URL.
///
/// # Returns
/// - Inferred repository directory name.
pub(crate) fn infer_repo_dir_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    last.trim_end_matches(".git").to_string()
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/urlparse.rs");
}
