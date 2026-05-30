// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::collections::HashSet;
use std::path::{Component, PathBuf};

use log::info;
use serde::Serialize;
use tauri::{Manager, Runtime, State, Window};
use tauri_plugin_opener::OpenerExt;

use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

/// Metadata describing a repository file's encoding and line endings.
#[derive(Debug, Clone, Serialize)]
pub struct RepoFileMeta {
    /// Best-effort encoding label.
    pub encoding: String,
    /// Best-effort line-ending label.
    pub line_ending: String,
    /// Whether the file contains a byte-order mark.
    pub bom: bool,
    /// Whether the file is treated as binary.
    pub binary: bool,
}

/// Validates a repo-relative path and blocks absolute/parent traversal paths.
///
/// # Parameters
/// - `input`: Raw path input.
///
/// # Returns
/// - `Ok(PathBuf)` normalized relative path.
/// - `Err(String)` when invalid.
fn safe_relative_path(input: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(input);
    if candidate.as_os_str().is_empty() {
        return Err("Path is empty".into());
    }

    for c in candidate.components() {
        match c {
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err("Path must be repo-relative".into());
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }

    Ok(candidate)
}

/// Normalizes a `.gitignore` entry from a repo-relative path.
///
/// # Parameters
/// - `path`: Raw path input.
///
/// # Returns
/// - `Ok(String)` normalized gitignore entry.
/// - `Err(String)` when invalid.
fn normalize_gitignore_entry(path: &str) -> Result<String, String> {
    let rel = safe_relative_path(path)?;
    let mut s = rel.to_string_lossy().replace('\\', "/");
    if s.starts_with("./") {
        s = s.trim_start_matches("./").to_string();
    }
    if s.contains('\n') || s.contains('\r') {
        return Err("Invalid path".into());
    }
    if !s.starts_with('/') {
        s.insert(0, '/');
    }
    Ok(s)
}

#[tauri::command]
/// Adds repository-relative paths to `.gitignore` if not already present.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `paths`: Repository-relative paths to ignore.
///
/// # Returns
/// - `Ok(())` when update succeeds.
/// - `Err(String)` when validation or file IO fails.
pub async fn vcs_add_to_gitignore_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    info!("vcs_add_to_gitignore_paths called (count={})", paths.len());
    if paths.is_empty() {
        return Ok(());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_add_to_gitignore_paths", repo, move |repo| {
        let workdir = repo.inner().workdir();
        let gitignore_path = workdir.join(".gitignore");

        let existing = std::fs::read_to_string(&gitignore_path).unwrap_or_default();
        let line_ending = if existing.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };

        let mut existing_lines: HashSet<String> = existing
            .lines()
            .map(|l| l.trim_end_matches('\r').to_string())
            .collect();

        let mut to_add: Vec<String> = Vec::new();
        for p in paths {
            let entry = normalize_gitignore_entry(&p)?;
            if existing_lines.insert(entry.clone()) {
                to_add.push(entry);
            }
        }

        if to_add.is_empty() {
            return Ok(());
        }

        let mut out = existing;
        if !out.is_empty() && !out.ends_with('\n') && !out.ends_with("\r\n") {
            out.push_str(line_ending);
        }
        for entry in to_add {
            out.push_str(&entry);
            out.push_str(line_ending);
        }

        std::fs::write(&gitignore_path, out)
            .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
        Ok(())
    })
    .await
}

#[tauri::command]
/// Opens a repository file with the host system opener.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `state`: Shared application state.
/// - `path`: Repository-relative path to open.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` when no repo is selected, path is invalid, or open fails.
pub fn open_repo_file<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    info!("open_repo_file called");
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;

    let rel = safe_relative_path(&path)?;
    let abs = repo.inner().workdir().join(rel);
    if !abs.exists() {
        return Err(format!("Path does not exist: {}", abs.display()));
    }

    window
        .app_handle()
        .opener()
        .open_path(abs.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open file: {e}"))
}

/// Decodes repository file bytes with UTF-16 heuristics fallback.
///
/// # Parameters
/// - `bytes`: Raw file bytes.
///
/// # Returns
/// - Best-effort decoded text.
fn decode_repo_text(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.len().is_multiple_of(2) && bytes.contains(&0) {
        let (endianness, start) = if bytes.starts_with(&[0xFF, 0xFE]) {
            ("le", 2usize)
        } else if bytes.starts_with(&[0xFE, 0xFF]) {
            ("be", 2usize)
        } else {
            let even_zeros = bytes.iter().step_by(2).filter(|b| **b == 0).count();
            let odd_zeros = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
            if odd_zeros > even_zeros {
                ("le", 0usize)
            } else if even_zeros > odd_zeros {
                ("be", 0usize)
            } else {
                return String::from_utf8_lossy(bytes).to_string();
            }
        };

        let mut u16s = Vec::with_capacity((bytes.len() - start) / 2);
        let mut i = start;
        while i + 1 < bytes.len() {
            let a = bytes[i];
            let b = bytes[i + 1];
            let u = if endianness == "le" {
                u16::from_le_bytes([a, b])
            } else {
                u16::from_be_bytes([a, b])
            };
            u16s.push(u);
            i += 2;
        }
        let mut out = String::new();
        for ch in std::char::decode_utf16(u16s) {
            match ch {
                Ok(c) => out.push(c),
                Err(_) => return String::from_utf8_lossy(bytes).to_string(),
            }
        }
        return out;
    }
    String::from_utf8_lossy(bytes).to_string()
}

/// Detects the dominant line-ending style in decoded file contents.
///
/// # Parameters
/// - `text`: Decoded file content.
///
/// # Returns
/// - Human-readable line-ending label.
fn detect_line_ending(text: &str) -> String {
    if text.is_empty() {
        return "None".into();
    }

    let without_crlf = text.replace("\r\n", "");
    let has_crlf = without_crlf.len() != text.len();
    let has_cr = without_crlf.contains('\r');
    let has_lf = without_crlf.contains('\n');

    match (has_crlf, has_cr, has_lf) {
        (true, false, false) => "CRLF".into(),
        (false, false, true) => "LF".into(),
        (false, true, false) => "CR".into(),
        (false, false, false) => "None".into(),
        _ => "Mixed".into(),
    }
}

/// Inspects raw bytes and returns best-effort file metadata.
///
/// # Parameters
/// - `bytes`: Raw file bytes.
///
/// # Returns
/// - File metadata used by the frontend header.
fn inspect_repo_file_meta(bytes: &[u8]) -> RepoFileMeta {
    let bom_utf8 = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let bom_utf16le = bytes.starts_with(&[0xFF, 0xFE]);
    let bom_utf16be = bytes.starts_with(&[0xFE, 0xFF]);
    let has_bom = bom_utf8 || bom_utf16le || bom_utf16be;

    if bytes.is_empty() {
        return RepoFileMeta {
            encoding: "UTF-8".into(),
            line_ending: "None".into(),
            bom: false,
            binary: false,
        };
    }

    if bom_utf16le {
        let text = decode_repo_text(bytes);
        return RepoFileMeta {
            encoding: "UTF-16LE".into(),
            line_ending: detect_line_ending(&text),
            bom: true,
            binary: false,
        };
    }

    if bom_utf16be {
        let text = decode_repo_text(bytes);
        return RepoFileMeta {
            encoding: "UTF-16BE".into(),
            line_ending: detect_line_ending(&text),
            bom: true,
            binary: false,
        };
    }

    if bytes.contains(&0) {
        let even_zeros = bytes.iter().step_by(2).filter(|b| **b == 0).count();
        let odd_zeros = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
        if odd_zeros > even_zeros {
            let text = decode_repo_text(bytes);
            return RepoFileMeta {
                encoding: "UTF-16LE".into(),
                line_ending: detect_line_ending(&text),
                bom: has_bom,
                binary: false,
            };
        }
        if even_zeros > odd_zeros {
            let text = decode_repo_text(bytes);
            return RepoFileMeta {
                encoding: "UTF-16BE".into(),
                line_ending: detect_line_ending(&text),
                bom: has_bom,
                binary: false,
            };
        }

        return RepoFileMeta {
            encoding: "Binary".into(),
            line_ending: "Binary".into(),
            bom: false,
            binary: true,
        };
    }

    let text = decode_repo_text(bytes);
    let encoding = if bytes.is_ascii() {
        "ASCII"
    } else if std::str::from_utf8(bytes).is_ok() {
        "UTF-8"
    } else {
        "Binary"
    };

    if encoding == "Binary" {
        return RepoFileMeta {
            encoding: encoding.into(),
            line_ending: "Binary".into(),
            bom: false,
            binary: true,
        };
    }

    RepoFileMeta {
        encoding: encoding.into(),
        line_ending: detect_line_ending(&text),
        bom: has_bom,
        binary: false,
    }
}

#[tauri::command]
/// Reads a repository file as text, with UTF-16 fallback decoding.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative file path.
///
/// # Returns
/// - `Ok(String)` decoded text content.
/// - `Err(String)` when no repo is selected, path is invalid, or read fails.
pub fn read_repo_file_text(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let rel = safe_relative_path(&path)?;
    let abs = repo.inner().workdir().join(rel);
    if !abs.exists() {
        return Err(format!("Path does not exist: {}", abs.display()));
    }
    let bytes = std::fs::read(&abs).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(decode_repo_text(&bytes))
}

#[tauri::command]
/// Reads repository file metadata, including encoding and line endings.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative file path.
///
/// # Returns
/// - `Ok(RepoFileMeta)` when the file can be read.
/// - `Err(String)` when no repo is selected, path is invalid, or read fails.
pub fn read_repo_file_meta(
    state: State<'_, AppState>,
    path: String,
) -> Result<RepoFileMeta, String> {
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let rel = safe_relative_path(&path)?;
    let abs = repo.inner().workdir().join(rel);
    if !abs.exists() {
        return Err(format!("Path does not exist: {}", abs.display()));
    }
    let bytes = std::fs::read(&abs).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(inspect_repo_file_meta(&bytes))
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/repo_files.rs");
}
