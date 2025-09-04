use std::path::{Path, PathBuf};

use chrono::DateTime;
use tauri::{Emitter, Manager, Runtime, State, Window};
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;
use crate::git::{BranchItem, CommitItem, FileEntry, Git, StatusPayload};

#[tauri::command]
pub fn about_info() -> utilities::AboutInfo {
  utilities::AboutInfo::gather()
}

#[tauri::command]
pub fn show_licenses() -> Result<(), String> {
  // open a bundled licenses file, or a window, or external URL
  Ok(())
}

#[tauri::command]
pub async fn browse_directory<R: Runtime>(
    window: Window<R>,
    purpose: Option<String>,
) -> Option<String> {
    let title = match purpose.as_deref() {
        Some("clone_dest") => "Choose destination folder",
        Some("add_repo")   => "Select an existing Git repository folder",
        _                  => "Select a folder",
    };
    utilities::browse_directory_async(window.app_handle().clone(), title).await
}

#[tauri::command]
pub async fn add_repo<R: Runtime>(window: Window<R>, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = Path::new(&path);

    let v = validate_add_path(path.clone());
    if !v.ok { return Err(v.reason.unwrap_or("Invalid path".into())); }

    match git2::Repository::open(&p) {
         Ok(_) => {}
         Err(e) => return Err(format!("Not a Git repository: {path} ({e})")),
    }

    // Persist as the active repo in state
    state.set_current_repo(p.to_path_buf());

    // Notify the UI
    let _ = window.app_handle().emit("repo:selected", &path);

    Ok(())
}

#[tauri::command]
pub fn validate_git_url(url: String) -> validate::Validation {
    validate::validate_git_url(url)
}

#[tauri::command]
pub fn validate_add_path(path: String) -> validate::Validation {
    validate::validate_add_path(path)
}


#[tauri::command]
pub fn validate_clone_input(url: String, dest: String) -> validate::Validation {
    validate::validate_clone_input(url, dest)
}

#[tauri::command]
pub fn current_repo_path(state: State<'_, AppState>) -> Option<String> {
    state.current_repo().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    state.recents().into_iter().map(|p| p.to_string_lossy().to_string()).collect()
}

/* ---------- helpers ---------- */
fn get_repo_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())
}

/* ---------- list_branches ---------- */
#[tauri::command]
pub fn list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    let root = get_repo_root(&state)?;
    let git = Git::open(&root).map_err(|e| e.to_string())?;

    let current = git.current_branch().map_err(|e| e.to_string())?;
    let locals  = git.local_branches().map_err(|e| e.to_string())?;

    let items = locals
        .into_iter()
        .map(|name| BranchItem {
            current: current.as_deref() == Some(name.as_str()),
            name,
        })
        .collect();

    Ok(items)
}

/* ---------- git_status ---------- */
#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> Result<StatusPayload, String> {
    let root = get_repo_root(&state)?;
    let repo = git2::Repository::discover(&root).map_err(|e| e.to_string())?;

    // Build file entries
    let mut sopts = git2::StatusOptions::new();
    sopts.include_untracked(true)
         .recurse_untracked_dirs(true)
         .renames_head_to_index(true);
    let statuses = repo.statuses(Some(&mut sopts)).map_err(|e| e.to_string())?;

    let mut files: Vec<FileEntry> = Vec::new();
    for e in statuses.iter() {
        let s = e.status();
        let path = e.path().unwrap_or("").to_string();

        let status = if s.contains(git2::Status::WT_NEW)      || s.contains(git2::Status::INDEX_NEW)      { "A" }
                     else if s.contains(git2::Status::WT_DELETED) || s.contains(git2::Status::INDEX_DELETED) { "D" }
                     else if s.is_wt_modified() || s.is_index_modified()                               { "M" }
                     else { "M" }; // fallback

        files.push(FileEntry { path, status: status.to_string(), hunks: vec![] });
    }

    // Ahead/behind
    let (ahead, behind) = ahead_behind(&repo).unwrap_or((0, 0));

    Ok(StatusPayload { files, ahead: ahead as u32, behind: behind as u32 })
}

fn ahead_behind(repo: &git2::Repository) -> Result<(usize, usize), git2::Error> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok((0, 0)),
        Err(e) => return Err(e),
    };

    if !head.is_branch() {
        return Ok((0, 0));
    }

    let head_name = head.shorthand().unwrap_or_default();
    let local_ref = format!("refs/heads/{head_name}");
    let upstream  = format!("refs/remotes/origin/{head_name}");

    let local = repo.find_reference(&local_ref)?.target().ok_or_else(|| git2::Error::from_str("no local target"))?;
    let up    = match repo.find_reference(&upstream) {
        Ok(r) => match r.target() { Some(t) => t, None => return Ok((0, 0)) },
        Err(_) => return Ok((0, 0)),
    };

    repo.graph_ahead_behind(local, up)
}

/* ---------- git_log ---------- */
#[tauri::command]
pub fn git_log(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<CommitItem>, String> {
    let root = get_repo_root(&state)?;
    let repo = git2::Repository::discover(&root).map_err(|e| e.to_string())?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).ok();

    let cap = limit.unwrap_or(100);
    let mut out = Vec::with_capacity(cap);

    for oid in revwalk.take(cap) {
        let oid = oid.map_err(|e| e.to_string())?;
        let c = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let id = format!("{oid}");
        let msg = c.summary().unwrap_or("(no message)").to_string();

        let secs = c.time().seconds();
        let meta = DateTime::from_timestamp(secs, 0)
            .map(|dt| dt.with_timezone(&chrono::Local).format("%H:%M - %d-%m-%Y").to_string())
            .unwrap_or_default();

        let author = {
            let a = c.author();
            format!("{} <{}>", a.name().unwrap_or(""), a.email().unwrap_or(""))
        };

        out.push(CommitItem { id, msg, meta, author });
    }

    Ok(out)
}


/* ---------- optional: branch ops used by your JS ---------- */
#[tauri::command]
pub fn git_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let root = get_repo_root(&state)?;
    let git = Git::open(&root).map_err(|e| e.to_string())?;
    git.checkout_branch(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_create_branch(state: State<'_, AppState>, name: String, from: Option<String>, checkout: Option<bool>) -> Result<(), String> {
    let root = get_repo_root(&state)?;
    let repo = git2::Repository::discover(&root).map_err(|e| e.to_string())?;

    // If `from` provided, resolve and set HEAD temporarily
    if let Some(from) = from {
        let (obj, reference) = repo.revparse_ext(&format!("refs/heads/{from}"))
            .map_err(|_| "base branch not found".to_string())?;
        repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;
        if let Some(r) = reference {
            repo.set_head(r.name().unwrap()).map_err(|e| e.to_string())?;
        }
    }

    let git = Git::open(&root).map_err(|e| e.to_string())?;
    git.create_branch(&name, checkout.unwrap_or(false)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_diff_file(state: tauri::State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    let root = get_repo_root(&state)?;
    let repo = git2::Repository::discover(&root).map_err(|e| e.to_string())?;

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(&path)
        .recurse_untracked_dirs(true)
        .include_untracked(true)
        .show_untracked_content(true);

    let diff = repo
        .diff_index_to_workdir(None, Some(&mut opts))
        .map_err(|e| e.to_string())?;

    let mut lines: Vec<String> = Vec::new();

    diff.print(git2::DiffFormat::Patch, |_, _, l| {
        match l.origin() {
            '+' | '-' | ' ' => {
                let mut s = String::from_utf8_lossy(l.content()).into_owned();
                if s.ends_with('\n') { s.pop(); }              // trim trailing newline
                lines.push(format!("{}{}", l.origin(), s));
            }
            // Skip headers and other metadata: 'F' (file), 'H' (hunk), 'B' (binary), etc.
            _ => {}
        }
        true
    }).map_err(|e| e.to_string())?;

    Ok(lines)
}
