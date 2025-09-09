use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::{debug, error, info, warn};
use tauri::{async_runtime, Emitter, Manager, Runtime, State, Window};
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

use openvcs_core::{OnEvent, models::{BranchItem, StatusPayload, CommitItem}, Repo, BackendId, backend_id};
use openvcs_core::backend_descriptor::{get_backend, list_backends};
use openvcs_core::models::{VcsEvent};
use crate::settings::AppConfig;
use crate::repo_settings::RepoConfig;

#[derive(serde::Serialize)]
struct RepoSelectedPayload {
    path: String,
    backend: String,
}

// Bridge core events → UI messages
fn progress_bridge<R: Runtime>(app: tauri::AppHandle<R>) -> OnEvent {
    Arc::new(move |evt| {
        let msg = match evt {
            VcsEvent::Progress{ detail, .. } => detail,
            VcsEvent::RemoteMessage(s) => s,
            VcsEvent::Auth{ method, detail } => format!("auth[{method}]: {detail}"),
            VcsEvent::PushStatus{ refname, status } =>
                status.map(|s| format!("{refname} → {s}")).unwrap_or_else(|| format!("{refname} ok")),
            VcsEvent::Info(s) => s.to_string(),
            VcsEvent::Warning(s) | VcsEvent::Error(s) => s,
        };
        let _ = app.emit("git-progress", ProgressPayload { message: msg });
    })
}

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    message: String
}

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
pub async fn add_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id.unwrap_or_else(|| backend_id!("git-system"));
    add_repo_internal(window, state, path, be).await
}

pub async fn add_repo_internal<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: BackendId,
) -> Result<(), String> {
    info!("add_repo: requested path = {}, backend = {}", path, backend_id);

    if !Path::new(&path).exists() {
        let m = format!("Path does not exist: {}", path);
        error!("{m}");
        return Err(m);
    }

    let desc = get_backend(&backend_id).ok_or_else(|| {
        let m = format!("Backend not found: {backend_id}");
        error!("{m}");
        m
    })?;

    let handle = (desc.open)(Path::new(&path)).map_err(|e| {
        let m = format!("Failed to open repo with backend `{backend_id}`: {e}");
        error!("{m}");
        m
    })?;

    let repo = Arc::new(Repo::new(handle));
    state.set_current_repo(repo);

    // structured event
    let payload = RepoSelectedPayload {
        path: path.clone(),
        backend: backend_id.as_ref().to_owned(),
    };
    if let Err(e) = window.app_handle().emit("repo:selected", &payload) {
        warn!("add_repo: failed to emit repo:selected: {}", e);
    }

    info!("add_repo: repository opened and stored (backend = {})", backend_id);
    Ok(())
}

#[tauri::command]
pub async fn clone_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    url: String,
    dest: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    use std::fs;
    use std::path::PathBuf;

    let be = backend_id.unwrap_or_else(|| backend_id!("git-system"));
    let desc = get_backend(&be).ok_or_else(|| format!("Backend not found: {be}"))?;

    // Compute target path: <dest>/<repo-name>
    let folder = infer_repo_dir_from_url(&url);
    if folder.is_empty() {
        return Err("Cannot infer target directory from URL".into());
    }
    let target: PathBuf = Path::new(&dest).join(&folder);

    // Ensure parent exists
    fs::create_dir_all(&dest).map_err(|e| format!("Failed to create dest: {e}"))?;

    // Clone via the backend, with progress bridge
    let on = Some(progress_bridge(window.app_handle().clone()));
    info!("clone_repo: cloning via backend {} into {}", be, target.display());
    (desc.clone_repo)(&url, &target, on).map_err(|e| format!("Clone failed: {e}"))?;

    // Open the freshly cloned repo and set it current
    add_repo_internal(window, state, target.to_string_lossy().to_string(), be).await
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
    state
        .current_repo()
        .map(|repo| repo.inner().workdir().to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct RecentRepoDto { path: String, name: Option<String> }

#[tauri::command]
pub fn list_recent_repos(state: State<'_, AppState>) -> Vec<RecentRepoDto> {
    state
        .recents()
        .into_iter()
        .map(|p| {
            let name = p.file_name().and_then(|os| os.to_str()).map(|s| s.to_string());
            RecentRepoDto { path: p.to_string_lossy().to_string(), name }
        })
        .collect()
}

/* ---------- helpers ---------- */
fn get_repo_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .current_repo()
        .map(|repo| repo.inner().workdir().to_path_buf())
        .ok_or_else(|| "No repository selected".to_string())
}

#[tauri::command]
pub async fn open_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id.unwrap_or_else(|| backend_id!("git-system"));
    add_repo_internal(window, state, path, be).await
}

fn infer_repo_dir_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    last.trim_end_matches(".git").to_string()
}

/* ---------- list_branches ---------- */
#[tauri::command]
pub fn git_list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    use openvcs_core::models::{BranchItem, BranchKind};
    use std::collections::HashSet;

    info!("list_branches: fetching unified branches via Vcs::branches()");

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    debug!("list_branches: workdir={}", vcs.workdir().display());

    // Ask backend for unified branches and current branch name
    let mut items = vcs
        .branches()
        .map_err(|e| {
            error!("list_branches: branches() failed: {e:?}");
            e.to_string()
        })?;

    let current_local = vcs
        .current_branch()
        .map_err(|e| {
            error!("list_branches: current_branch failed: {e:?}");
            e.to_string()
        })?;

    // Helper: infer kind from full_ref if backend returned Unknown
    fn infer_kind(full_ref: &str) -> BranchKind {
        if let Some(rest) = full_ref.strip_prefix("refs/heads/") {
            let _ = rest;
            BranchKind::Local
        } else if let Some(rest) = full_ref.strip_prefix("refs/remotes/") {
            if let Some((remote, _name)) = rest.split_once('/') {
                return BranchKind::Remote { remote: remote.to_string() };
            }
            BranchKind::Remote { remote: String::from("unknown") }
        } else {
            BranchKind::Unknown
        }
    }

    // Sanitize, infer kind where Unknown, and enforce a single "current"
    let current_name = current_local.as_deref();

    // Deduplicate by full_ref (stable identity)
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<BranchItem> = Vec::with_capacity(items.len());

    for mut it in items.drain(..) {
        // Trim + validate
        it.name = it.name.trim().to_string();
        it.full_ref = it.full_ref.trim().to_string();

        if it.name.is_empty() || it.full_ref.is_empty() {
            warn!("list_branches: dropping branch with empty name/full_ref: {:?}", it);
            continue;
        }

        // Infer kind if Unknown (keeps backend’s explicit Local/Remote as-is)
        if matches!(it.kind, BranchKind::Unknown) {
            it.kind = infer_kind(&it.full_ref);
        }

        // Reconcile "current": only locals can be current
        it.current = match (&it.kind, current_name) {
            (BranchKind::Local, Some(curr)) => it.name == *curr,
            _ => false,
        };

        // Dedup by full_ref (first wins)
        if !seen.insert(it.full_ref.clone()) {
            debug!("list_branches: dedup duplicate ref {}", it.full_ref);
            continue;
        }

        out.push(it);
    }

    // Sort: current → local → remote → unknown, then by name
    out.sort_by(|a, b| {
        let bucket = |x: &BranchItem| {
            if x.current {
                0
            } else {
                match x.kind {
                    BranchKind::Local => 1,
                    BranchKind::Remote { .. } => 2,
                    BranchKind::Unknown => 3,
                }
            }
        };
        bucket(a).cmp(&bucket(b)).then_with(|| a.name.cmp(&b.name))
    });

    debug!(
        "list_branches: current_local={:?}, returned={}",
        current_local,
        out.len()
    );

    Ok(out)
}

/* ---------- git_status ---------- */
#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> Result<StatusPayload, String> {
    info!("git_status: fetching repo status");

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    let payload = vcs.status_payload().map_err(|e| {
        error!("git_status: failed to compute status: {e}");
        e.to_string()
    })?;

    debug!(
        "git_status: files={}, ahead={}, behind={}",
        payload.files.len(),
        payload.ahead,
        payload.behind
    );

    Ok(payload)
}

/* ---------- git_log ---------- */
#[tauri::command]
pub fn git_log(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<CommitItem>, String> {
    use openvcs_core::models::LogQuery;

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    let q = LogQuery {
        rev: None,
        path: None,
        since_utc: None,
        until_utc: None,
        author_contains: None,
        skip: 0,
        limit: (limit.unwrap_or(100)).min(1000) as u32,
        topo_order: true,
        include_merges: true,
    };

    vcs.log_commits(&q).map_err(|e| e.to_string())
}

/* ---------- optional: branch ops used by your JS ---------- */
#[tauri::command]
pub fn git_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let branch = name.trim();
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }

    info!("git_checkout_branch: attempting to checkout '{branch}'");

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    vcs.checkout_branch(branch).map_err(|e| {
        error!("git_checkout_branch: failed to checkout '{branch}': {e}");
        e.to_string()
    })?;

    info!("git_checkout_branch: successfully checked out '{branch}'");
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(
    state: State<'_, AppState>,
    name: String,
    from: Option<String>,
    checkout: Option<bool>,
) -> Result<(), String> {
    info!(
        "git_create_branch: requested branch '{}', from={:?}, checkout={:?}",
        name, from, checkout
    );

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    // If a base branch is provided, check it out first.
    if let Some(from) = from {
        match vcs.checkout_branch(&from) {
            Ok(_) => info!("git_create_branch: successfully checked out base branch '{from}'"),
            Err(e) => {
                error!(
                    "git_create_branch: failed to checkout base branch '{from}': {e}"
                );
                return Err(format!("base branch not found or cannot checkout: {e}"));
            }
        }
    }

    vcs.create_branch(&name, checkout.unwrap_or(false))
        .map_err(|e| {
            error!("git_create_branch: failed to create branch '{name}': {e}");
            e.to_string()
        })?;

    info!("git_create_branch: successfully created branch '{name}'");
    Ok(())
}

#[tauri::command]
pub fn git_diff_file(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    use std::path::PathBuf;

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    // Allow either absolute or repo-relative; backend handles stripping
    vcs.diff_file(&PathBuf::from(path)).map_err(|e| e.to_string())
}

/* ---------- git_diff_commit ---------- */
#[tauri::command]
pub fn git_diff_commit(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();
    vcs.diff_commit(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_discard_paths(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    use std::path::PathBuf;
    let repo = state.current_repo().ok_or_else(|| "No repository selected".to_string())?;
    let pb: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    repo.inner().discard_paths(&pb).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_discard_patch(state: State<'_, AppState>, patch: String) -> Result<(), String> {
    let repo = state.current_repo().ok_or_else(|| "No repository selected".to_string())?;
    repo.inner().apply_reverse_patch(&patch).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct RepoSummary {
    path: String,
    current_branch: String,
    branches: Vec<BranchItem>,
}

#[tauri::command]
pub fn get_repo_summary(state: State<'_, AppState>) -> Result<RepoSummary, String> {
    let repo = state.current_repo().ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    let path = vcs.workdir().to_string_lossy().to_string();

    let branches = vcs.branches().map_err(|e| e.to_string())?;
    let current = vcs.current_branch().map_err(|e| e.to_string())?
        .unwrap_or_else(|| "HEAD".into());

    // Reuse your existing normalization by calling the tauri command directly:
    let normalized = git_list_branches(state)?;

    Ok(RepoSummary {
        path,
        current_branch: current,
        branches: normalized,
    })
}

#[tauri::command]
pub fn git_current_branch(state: State<'_, AppState>) -> Result<String, String> {
    let repo = state.current_repo().ok_or_else(|| "No repository selected".to_string())?;
    repo.inner()
        .current_branch()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Detached HEAD".to_string())
}


#[tauri::command]
pub async fn commit_changes<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
) -> Result<String, String> {
    info!("commit_changes called (summary: \"{}\")", summary);

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone(); // move into blocking task
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging changes…"));
        info!("Staging changes for commit");

        // Resolve identity: prefer VCS-reported (repo-local, then global), then env, then final fallback
        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) { (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)), _ => None }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));
        info!("Using identity: {} <{}>", name, email);

        on(VcsEvent::Info("Writing commit…"));
        let oid = repo
            .inner()
            .commit(&message, &name, &email, &[])
            .map_err(|e| {
                error!("Commit failed: {e}");
                e.to_string()
            })?;
        info!("Commit created successfully: {oid}");

        on(VcsEvent::Info("Commit created."));
        Ok(oid)
    })
        .await
        .map_err(|e| {
            error!("commit_changes task join error: {e}");
            format!("commit task failed: {e}")
        })?
}

#[tauri::command]
pub async fn commit_selected<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    files: Vec<String>,
) -> Result<String, String> {
    info!("commit_selected called ({} file(s))", files.len());

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging selected files…"));

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) { (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)), _ => None }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));

        let paths: Vec<std::path::PathBuf> = files.into_iter().map(|s| std::path::PathBuf::from(s)).collect();

        on(VcsEvent::Info("Writing commit…"));
        let oid = repo
            .inner()
            .commit(&message, &name, &email, &paths)
            .map_err(|e| {
                error!("Commit (selected) failed: {e}");
                e.to_string()
            })?;
        Ok(oid)
    })
        .await
        .map_err(|e| format!("commit_selected task failed: {e}"))?
}

#[tauri::command]
pub async fn commit_patch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    patch: String,
) -> Result<String, String> {
    info!("commit_patch called (patch size: {} bytes)", patch.len());
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() { summary.clone() } else { format!("{summary}\n\n{description}") };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging selected hunks…"));

        repo.inner().stage_patch(&patch).map_err(|e| {
            error!("stage_patch failed: {e}");
            e.to_string()
        })?;

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) { (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)), _ => None }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));

        on(VcsEvent::Info("Committing staged hunks…"));
        let oid = repo.inner().commit_index(&message, &name, &email).map_err(|e| {
            error!("commit_index failed: {e}");
            e.to_string()
        })?;
        Ok(oid)
    })
    .await
    .map_err(|e| format!("commit_patch task failed: {e}"))?
}

#[tauri::command]
pub async fn commit_patch_and_files<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    patch: String,
    files: Vec<String>,
) -> Result<String, String> {
    use std::path::PathBuf;

    info!("commit_patch_and_files called (patch bytes={}, files={})", patch.len(), files.len());
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() { summary.clone() } else { format!("{summary}\n\n{description}") };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging selected hunks…"));

        if !patch.trim().is_empty() {
            repo.inner().stage_patch(&patch).map_err(|e| {
                error!("stage_patch failed: {e}");
                e.to_string()
            })?;
        }

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) { (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)), _ => None }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));

        on(VcsEvent::Info("Writing commit…"));
        let oid = if files.is_empty() {
            repo.inner().commit_index(&message, &name, &email).map_err(|e| e.to_string())?
        } else {
            let paths: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();
            repo.inner().commit(&message, &name, &email, &paths).map_err(|e| e.to_string())?
        };
        on(VcsEvent::Info("Commit complete"));
        Ok(oid)
    })
    .await
    .map_err(|e| format!("commit_patch_and_files task failed: {e}"))?
}
#[tauri::command]
pub fn git_fetch<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    info!("git_fetch called");

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    let app = window.app_handle().clone();
    let on = Some(progress_bridge(app));

    let current = vcs
        .current_branch()
        .map_err(|e| {
            error!("Failed to get current branch: {e}");
            e.to_string()
        })?
        .ok_or_else(|| {
            warn!("Detached HEAD detected, cannot determine upstream branch");
            "Detached HEAD; cannot determine upstream".to_string()
        })?;

    info!("Fetching branch '{current}' from origin");

    vcs.fetch("origin", &current, on).map_err(|e| {
        error!("Fetch failed for branch '{current}': {e}");
        e.to_string()
    })?;

    info!("Fetch completed successfully for branch '{current}'");
    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload { message: format!("Fetch complete ({current})") }
    );
    Ok(())
}

#[tauri::command]
pub fn git_pull<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    info!("git_pull called");

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = repo.inner();

    let app = window.app_handle().clone();
    let on = Some(progress_bridge(app));

    let current = vcs
        .current_branch()
        .map_err(|e| {
            error!("Failed to get current branch: {e}");
            e.to_string()
        })?
        .ok_or_else(|| {
            warn!("Detached HEAD detected, cannot determine upstream branch for pull");
            "Detached HEAD; cannot determine upstream".to_string()
        })?;

    info!("Fast-forward pulling branch '{current}' from origin");

    vcs.pull_ff_only("origin", &current, on).map_err(|e| {
        error!("Pull (ff-only) failed for branch '{current}': {e}");
        e.to_string()
    })?;

    info!("Pull (ff-only) completed successfully for branch '{current}'");
    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload { message: format!("Pull complete ({current})") }
    );
    Ok(())
}

#[tauri::command]
pub async fn git_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("git_push called");

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?
        .clone();

    let app_for_worker = window.app_handle().clone();
    let app_for_final  = window.app_handle().clone();

    async_runtime::spawn_blocking(move || -> Result<(), String> {
        let on = Some(progress_bridge(app_for_worker));

        let current = repo.inner()
            .current_branch()
            .map_err(|e| {
                error!("Failed to determine current branch: {e}");
                e.to_string()
            })?
            .ok_or_else(|| {
                warn!("Detached HEAD, cannot push");
                "detached HEAD".to_string()
            })?;

        let refspec = format!("refs/heads/{0}:refs/heads/{0}", current);
        info!("Pushing branch '{current}' with refspec '{refspec}'");

        repo.inner()
            .push("origin", &refspec, on)
            .map_err(|e| {
                error!("Push failed for branch '{current}': {e}");
                e.to_string()
            })
    })
        .await
        .map_err(|e| {
            error!("Join error in git_push task: {e}");
            e.to_string()
        })??;

    let _ = app_for_final.emit(
        "git-progress",
        ProgressPayload { message: "Push complete".into() }
    );

    info!("Push completed successfully.");
    Ok(())
}

#[tauri::command]
pub fn list_backends_cmd() -> Vec<(String, String)> {
    info!("list_backends_cmd called");

    let backends: Vec<(String, String)> = list_backends()
        .map(|b| (b.id.as_ref().to_string(), b.name.to_string()))
        .collect();

    info!("Found {} registered backends", backends.len());
    for (id, name) in &backends {
        info!("  - {} ({})", id, name);
    }

    backends
}

#[tauri::command]
pub fn set_backend_cmd(state: State<'_, AppState>, backend_id: BackendId) -> Result<(), String> {
    info!("set_backend_cmd: requested backend = {}", backend_id);

    let desc = match get_backend(&backend_id) {
        Some(d) => d,
        None => {
            warn!("set_backend_cmd: unknown backend `{}`", backend_id);
            return Err(format!("Unknown backend: {backend_id}"));
        }
    };

    // If a repo is open, reopen it with the new backend and swap it into state.
    if let Some(repo) = state.current_repo() {
        let path = repo.inner().workdir().to_path_buf();
        info!(
            "set_backend_cmd: reopening current repo with backend {} → {}",
            repo.id(),
            backend_id
        );

        match (desc.open)(Path::new(&path)) {
            Ok(handle) => {
                let new_repo = Arc::new(Repo::new(handle));
                state.set_current_repo(new_repo);
                info!(
                    "set_backend_cmd: repo reopened with backend `{}` (path={})",
                    backend_id,
                    path.display()
                );
            }
            Err(e) => {
                error!(
                    "set_backend_cmd: failed to reopen repo '{}' with backend `{}`: {}",
                    path.display(),
                    backend_id,
                    e
                );
                return Err(format!("Failed to reopen repo with `{backend_id}`: {e}"));
            }
        }
    } else {
        // No repo open; nothing to reopen. Succeed silently.
        info!("set_backend_cmd: no repo open; will use `{}` when opening a repo", backend_id);
    }

    Ok(())
}

#[tauri::command]
pub fn get_global_settings(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config())
}

#[tauri::command]
pub fn set_global_settings(
    state: State<'_, AppState>,
    cfg: AppConfig,
) -> Result<(), String> {
    state.set_config(cfg)
}

#[tauri::command]
pub fn get_repo_settings(state: State<'_, AppState>) -> Result<RepoConfig, String> {
    let mut cfg = state.repo_config();
    // If a repo is open, enrich settings from actual Git config
    if let Some(repo) = state.current_repo() {
        let vcs = repo.inner();
        // identity (repository-local)
        match vcs.get_identity() {
            Ok(Some((name, email))) => {
                cfg.user_name = Some(name);
                cfg.user_email = Some(email);
            }
            Ok(None) => { /* leave as-is */ }
            Err(e) => {
                warn!("get_repo_settings: get_identity failed: {e}");
            }
        }

        // remotes: capture 'origin' URL if present
        match vcs.list_remotes() {
            Ok(list) => {
                if let Some((_, url)) = list.into_iter().find(|(n, _)| n == "origin") {
                    cfg.origin_url = Some(url);
                }
            }
            Err(e) => warn!("get_repo_settings: list_remotes failed: {e}"),
        }
    }

    Ok(cfg)
}

#[tauri::command]
pub fn set_repo_settings(
    state: State<'_, AppState>,
    cfg: RepoConfig,
) -> Result<(), String> {
    // Persist repo-specific cache (none currently persisted beyond identity/remote)
    state.set_repo_config(RepoConfig { ..cfg.clone() })?;

    // Apply to Git if a repo is open
    if let Some(repo) = state.current_repo() {
        let vcs = repo.inner();
        // Identity: set when both present
        if let (Some(name), Some(email)) = (cfg.user_name.as_deref(), cfg.user_email.as_deref()) {
            vcs.set_identity_local(name, email).map_err(|e| e.to_string())?;
        }
        // Origin remote URL
        if let Some(url) = cfg.origin_url.as_deref() {
            if !url.trim().is_empty() {
                vcs.ensure_remote("origin", url).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
