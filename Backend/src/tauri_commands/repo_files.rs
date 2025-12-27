use std::collections::HashSet;
use std::path::{Component, PathBuf};

use log::info;
use tauri::{Manager, Runtime, State, Window};
use tauri_plugin_opener::OpenerExt;

use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

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
pub async fn git_add_to_gitignore_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    info!("git_add_to_gitignore_paths called (count={})", paths.len());
    if paths.is_empty() {
        return Ok(());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_add_to_gitignore_paths", repo, move |repo| {
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
