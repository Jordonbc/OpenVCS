use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::{debug, error, info, warn};
use tauri::{async_runtime, Emitter, Manager, Runtime, State, Window};
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

use openvcs_core::{OnEvent, models::{BranchItem, StatusPayload, CommitItem, StashItem}, Repo, BackendId, backend_id};
use serde::Serialize;
use openvcs_core::backend_descriptor::{get_backend, list_backends};
use openvcs_core::models::{VcsEvent};
use crate::settings::{AppConfig, Lfs};
use crate::repo_settings::RepoConfig;
use tauri_plugin_updater::UpdaterExt;

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

fn current_repo_or_err(state: &State<'_, AppState>) -> Result<Arc<Repo>, String> {
    state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())
        .map(|repo| Arc::clone(&repo))
}

async fn run_repo_task<T, F>(label: &'static str, repo: Arc<Repo>, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Arc<Repo>) -> Result<T, String> + Send + 'static,
{
    async_runtime::spawn_blocking(move || task(repo))
        .await
        .map_err(|e| format!("{label} task failed: {e}"))?
}

fn lfs_config(state: &State<'_, AppState>) -> Lfs {
    state.with_config(|cfg| cfg.lfs.clone())
}

struct LfsEnvGuard {
    originals: Vec<(&'static str, Option<String>)>,
}

impl LfsEnvGuard {
    fn capture(key: &'static str) -> Option<String> {
        std::env::var(key).ok()
    }

    fn set(key: &'static str, value: Option<String>, originals: &mut Vec<(&'static str, Option<String>)>) {
        originals.push((key, Self::capture(key)));
        match value {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    fn apply(cfg: &Lfs) -> Self {
        let mut originals = Vec::new();

        // Concurrency controls parallel transfers; always set when enabled.
        Self::set(
            "GIT_LFS_CONCURRENCY",
            Some(cfg.concurrency.clamp(1, 16).to_string()),
            &mut originals,
        );

        // Require lock → respect read-only enforcement so accidental edits are blocked.
        let lock_env = if cfg.require_lock_before_edit { Some("1".to_string()) } else { None };
        Self::set("GIT_LFS_SET_LOCKED_FILES_READONLY", lock_env, &mut originals);

        // Background fetch flag toggles smudge behaviour. When disabled, skip smudge to avoid slow checkouts.
        let skip_smudge = if cfg.background_fetch_on_checkout { None } else { Some("1".to_string()) };
        Self::set("GIT_LFS_SKIP_SMUDGE", skip_smudge, &mut originals);

        Self { originals }
    }
}

impl Drop for LfsEnvGuard {
    fn drop(&mut self) {
        for (key, val) in self.originals.drain(..).rev() {
            if let Some(v) = val {
                std::env::set_var(key, v);
            } else {
                std::env::remove_var(key);
            }
        }
    }
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
    let open_path = path.clone();
    let handle = async_runtime::spawn_blocking(move || (desc.open)(Path::new(&open_path)))
        .await
        .map_err(|e| format!("add_repo task failed: {e}"))?
        .map_err(|e| {
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

    let clone_url = url.clone();
    let clone_target = target.clone();
    let be_label = be.as_ref().to_string();
    let app_handle = window.app_handle().clone();
    async_runtime::spawn_blocking(move || {
        let on = Some(progress_bridge(app_handle));
        info!("clone_repo: cloning via backend {} into {}", be_label, clone_target.display());
        (desc.clone_repo)(&clone_url, &clone_target, on)
    })
    .await
    .map_err(|e| format!("clone_repo task failed: {e}"))?
    .map_err(|e| format!("Clone failed: {e}"))?;

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
pub async fn git_list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    use openvcs_core::models::{BranchItem, BranchKind};
    use std::collections::HashSet;

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_list_branches", repo, move |repo| {
        info!("list_branches: fetching unified branches via Vcs::branches()");
        let vcs = repo.inner();
        debug!("list_branches: workdir={}", vcs.workdir().display());

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

        let current_name = current_local.as_deref();
        let mut seen: HashSet<String> = HashSet::new();
        let mut out: Vec<BranchItem> = Vec::with_capacity(items.len());

        for mut it in items.drain(..) {
            it.name = it.name.trim().to_string();
            it.full_ref = it.full_ref.trim().to_string();

            if it.name.is_empty() || it.full_ref.is_empty() {
                warn!("list_branches: dropping branch with empty name/full_ref: {:?}", it);
                continue;
            }

            if matches!(it.kind, BranchKind::Unknown) {
                it.kind = infer_kind(&it.full_ref);
            }

            it.current = match (&it.kind, current_name) {
                (BranchKind::Local, Some(curr)) => it.name == *curr,
                _ => false,
            };

            if !seen.insert(it.full_ref.clone()) {
                debug!("list_branches: dedup duplicate ref {}", it.full_ref);
                continue;
            }

            out.push(it);
        }

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
    }).await
}

/* ---------- git_status ---------- */
#[tauri::command]
pub async fn git_status(state: State<'_, AppState>) -> Result<StatusPayload, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_status", repo, move |repo| {
        info!("git_status: fetching repo status");
        let payload = repo.inner().status_payload().map_err(|e| {
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
    })
    .await
}

/* ---------- git_log ---------- */
#[tauri::command]
pub async fn git_log(
    state: State<'_, AppState>,
    limit: Option<usize>,
    rev: Option<String>,
) -> Result<Vec<CommitItem>, String> {
    use openvcs_core::models::LogQuery;

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_log", repo, move |repo| {
        let q = LogQuery {
            rev,
            path: None,
            since_utc: None,
            until_utc: None,
            author_contains: None,
            skip: 0,
            limit: (limit.unwrap_or(100)).min(1000) as u32,
            topo_order: true,
            include_merges: true,
        };

        repo.inner().log_commits(&q).map_err(|e| e.to_string())
    })
    .await
}

/* ---------- stash ---------- */
#[tauri::command]
pub async fn git_stash_list(state: State<'_, AppState>) -> Result<Vec<StashItem>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_stash_list", repo, move |repo| {
        match repo.inner().stash_list() {
            Ok(items) => {
                info!("git_stash_list: count={}", items.len());
                for item in &items {
                    info!(
                        "git_stash_list: selector='{}' msg='{}' meta='{}'",
                        item.selector,
                        item.msg,
                        item.meta
                    );
                }
                Ok(items)
            }
            Err(e) => {
                error!("git_stash_list: failed: {}", e);
                Err(e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_stash_push(
    state: State<'_, AppState>,
    message: Option<String>,
    include_untracked: Option<bool>,
    paths: Option<Vec<String>>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let msg = message.unwrap_or_else(|| "WIP".to_string());
    let iu = include_untracked.unwrap_or(true);
    let pathbufs: Vec<std::path::PathBuf> = paths.unwrap_or_default().into_iter().map(|s| s.into()).collect();
    run_repo_task("git_stash_push", repo, move |repo| {
        repo.inner().stash_push(&msg, iu, &pathbufs).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash_apply(state: State<'_, AppState>, selector: Option<String>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_apply", repo, move |repo| {
        repo.inner().stash_apply(selector.as_str()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash_pop(state: State<'_, AppState>, selector: Option<String>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_pop", repo, move |repo| {
        repo.inner().stash_pop(selector.as_str()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash_drop(state: State<'_, AppState>, selector: Option<String>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_drop", repo, move |repo| {
        info!("git_stash_drop: selector='{}'", selector);
        match repo.inner().stash_drop(selector.as_str()) {
            Ok(()) => {
                info!("git_stash_drop: success selector='{}'", selector);
                Ok(())
            }
            Err(e) => {
                error!("git_stash_drop: failed selector='{}': {}", selector, e);
                Err(e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_stash_show(state: State<'_, AppState>, selector: Option<String>) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_show", repo, move |repo| {
        repo.inner().stash_show(selector.as_str()).map_err(|e| e.to_string())
    })
    .await
}

/* ---------- git_head_status ---------- */
#[derive(Serialize)]
pub struct HeadStatus {
    pub detached: bool,
    pub branch: Option<String>,
    pub commit: Option<String>,
}

#[tauri::command]
pub async fn git_head_status(state: State<'_, AppState>) -> Result<HeadStatus, String> {
    use openvcs_core::models::LogQuery;

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_head_status", repo, move |repo| {
        let branch = repo.inner().current_branch().map_err(|e| e.to_string())?;
        let q = LogQuery { rev: Some("HEAD".into()), limit: 1, ..Default::default() };
        let head = repo.inner().log_commits(&q).map_err(|e| e.to_string())?;
        let commit = head.get(0).map(|c| c.id.clone());

        Ok(HeadStatus { detached: branch.is_none(), branch, commit })
    })
    .await
}

/* ---------- optional: branch ops used by your JS ---------- */
#[tauri::command]
pub async fn git_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let branch = name.trim();
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }

    info!("git_checkout_branch: attempting to checkout '{branch}'");

    let repo = current_repo_or_err(&state)?;
    let branch = branch.to_string();
    run_repo_task("git_checkout_branch", repo, move |repo| {
        repo.inner().checkout_branch(&branch).map_err(|e| {
            error!("git_checkout_branch: failed to checkout '{}': {e}", branch);
            e.to_string()
        })?;

        info!("git_checkout_branch: successfully checked out '{}'", branch);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_delete_branch(state: State<'_, AppState>, name: String, force: Option<bool>) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() { return Err("Branch name cannot be empty".to_string()); }
    let repo = current_repo_or_err(&state)?;
    let force = force.unwrap_or(false);
    let branch = name.to_string();
    run_repo_task("git_delete_branch", repo, move |repo| {
        repo.inner().delete_branch(&branch, force).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_rename_branch(state: State<'_, AppState>, old_name: String, new_name: String) -> Result<(), String> {
    let old = old_name.trim();
    let newn = new_name.trim();
    if old.is_empty() || newn.is_empty() { return Err("Branch name cannot be empty".into()); }
    if old == newn { return Ok(()); }
    let repo = current_repo_or_err(&state)?;
    let old = old.to_string();
    let newn = newn.to_string();
    run_repo_task("git_rename_branch", repo, move |repo| {
        repo.inner().rename_branch(&old, &newn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_merge_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() { return Err("Branch name cannot be empty".to_string()); }
    let repo = current_repo_or_err(&state)?;
    let branch = name.to_string();
    run_repo_task("git_merge_branch", repo, move |repo| {
        repo.inner().merge_into_current(&branch).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    name: String,
    from: Option<String>,
    checkout: Option<bool>,
) -> Result<(), String> {
    info!(
        "git_create_branch: requested branch '{}', from={:?}, checkout={:?}",
        name, from, checkout
    );

    let repo = current_repo_or_err(&state)?;
    let checkout_flag = checkout.unwrap_or(false);
    let branch_name = name.clone();
    let from_branch = from.map(|s| s.to_string());
    run_repo_task("git_create_branch", repo, move |repo| {
        let vcs = repo.inner();

        if let Some(from) = from_branch.as_ref() {
            match vcs.checkout_branch(from) {
                Ok(_) => info!("git_create_branch: successfully checked out base branch '{from}'"),
                Err(e) => {
                    error!(
                        "git_create_branch: failed to checkout base branch '{from}': {e}"
                    );
                    return Err(format!("base branch not found or cannot checkout: {e}"));
                }
            }
        }

        vcs.create_branch(&branch_name, checkout_flag)
            .map_err(|e| {
                error!("git_create_branch: failed to create branch '{branch_name}': {e}");
                e.to_string()
            })?;

        info!("git_create_branch: successfully created branch '{branch_name}'");
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_diff_file(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    use std::path::PathBuf;

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_diff_file", repo, move |repo| {
        repo.inner()
            .diff_file(&PathBuf::from(path))
            .map_err(|e| e.to_string())
    })
    .await
}

/* ---------- git_diff_commit ---------- */
#[tauri::command]
pub async fn git_diff_commit(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_diff_commit", repo, move |repo| {
        repo.inner().diff_commit(&id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_discard_paths(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    use std::path::PathBuf;
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_discard_paths", repo, move |repo| {
        let pb: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        repo.inner().discard_paths(&pb).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_discard_patch(state: State<'_, AppState>, patch: String) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_discard_patch", repo, move |repo| {
        repo.inner().apply_reverse_patch(&patch).map_err(|e| e.to_string())
    })
    .await
}

#[derive(serde::Serialize)]
pub struct RepoSummary {
    path: String,
    current_branch: String,
    branches: Vec<BranchItem>,
}

#[tauri::command]
pub async fn get_repo_summary(state: State<'_, AppState>) -> Result<RepoSummary, String> {
    let repo = current_repo_or_err(&state)?;
    let (path, current) = run_repo_task("get_repo_summary", repo, move |repo| {
        let vcs = repo.inner();
        let path = vcs.workdir().to_string_lossy().to_string();
        let current = vcs
            .current_branch()
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "HEAD".into());
        Ok::<_, String>((path, current))
    })
    .await?;

    let normalized = git_list_branches(state).await?;

    Ok(RepoSummary {
        path,
        current_branch: current,
        branches: normalized,
    })
}

#[tauri::command]
pub async fn git_current_branch(state: State<'_, AppState>) -> Result<String, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_current_branch", repo, move |repo| {
        repo.inner()
            .current_branch()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Detached HEAD".to_string())
    })
    .await
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
pub async fn git_fetch<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("git_fetch", repo, move |repo| {
        info!("git_fetch called");
        let on = Some(progress_bridge(app));
        let current = repo
            .inner()
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
        repo.inner().fetch("origin", &current, on).map_err(|e| {
            error!("Fetch failed for branch '{current}': {e}");
            e.to_string()
        })?;

        info!("Fetch completed successfully for branch '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload { message: format!("Fetch complete ({current})") }
    );
    Ok(())
}

#[tauri::command]
pub async fn git_fetch_all<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_fetch_all", repo, move |repo| {
        info!("git_fetch_all called");
        let on = Some(progress_bridge(app));
        let remotes = repo.inner().list_remotes().map_err(|e| {
            error!("Failed to list remotes: {e}");
            e.to_string()
        })?;

        for (r, _url) in remotes.into_iter() {
            info!("Fetching all refs from remote '{r}'");
            if let Err(e) = repo.inner().fetch(&r, "", on.clone()) {
                error!("Fetch failed for remote '{r}': {e}");
                return Err(e.to_string());
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_pull<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("git_pull", repo, move |repo| {
        info!("git_pull called");
        let on = Some(progress_bridge(app));
        let current = repo
            .inner()
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
        repo.inner().pull_ff_only("origin", &current, on).map_err(|e| {
            error!("Pull (ff-only) failed for branch '{current}': {e}");
            e.to_string()
        })?;

        info!("Pull (ff-only) completed successfully for branch '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload { message: format!("Pull complete ({current})") }
    );
    Ok(())
}

#[tauri::command]
pub async fn git_lfs_fetch_all(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_fetch_all called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_fetch_all", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_fetch().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_pull(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_pull called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_pull", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_pull().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_prune(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_prune called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_prune", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_prune().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_track_paths(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    info!("git_lfs_track_paths called (count={})", paths.len());
    if paths.is_empty() {
        return Ok(());
    }

    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_track_paths", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        let list: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        repo.inner().lfs_track(&list).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("git_push", repo, move |repo| {
        info!("git_push called");
        let on = Some(progress_bridge(app));

        let current = repo
            .inner()
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

        repo
            .inner()
            .push("origin", &refspec, on)
            .map_err(|e| {
                error!("Push failed for branch '{current}': {e}");
                e.to_string()
            })?;

        info!("Push completed successfully for '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload { message: format!("Push complete ({current})") }
    );

    Ok(())
}

/* ---------- undo (soft reset) ---------- */
#[tauri::command]
pub async fn git_undo_since_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("git_undo_since_push called");

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_undo_since_push", repo, move |repo| {
        let status = repo.inner().status_payload().map_err(|e| e.to_string())?;
        if status.ahead == 0 {
            return Err("Nothing to undo (no unpushed commits)".into());
        }
        let on = progress_bridge(app);
        on(VcsEvent::Info("Undoing unpushed commits (soft reset)…"));
        match repo.inner().reset_soft_to("@{upstream}") {
            Ok(_) => Ok(()),
            Err(_e) => {
                let cur = repo
                    .inner()
                    .current_branch()
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Detached HEAD; cannot resolve upstream".to_string())?;
                let remote_short = format!("origin/{}", cur);
                repo.inner().reset_soft_to(&remote_short).map_err(|e| e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_undo_to_commit<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    info!("git_undo_to_commit called for {id}");

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_undo_to_commit", repo, move |repo| {
        let mut ahead_list: Vec<CommitItem> = Vec::new();
        {
            let mut q = openvcs_core::models::LogQuery::head(1000);
            q.rev = Some("@{upstream}..HEAD".to_string());
            match repo.inner().log_commits(&q) {
                Ok(list) => ahead_list = list,
                Err(_) => {
                    if let Some(cur) = repo.inner().current_branch().map_err(|e| e.to_string())? {
                        let mut q2 = openvcs_core::models::LogQuery::head(1000);
                        q2.rev = Some(format!("origin/{}..HEAD", cur));
                        if let Ok(list) = repo.inner().log_commits(&q2) {
                            ahead_list = list;
                        }
                    }
                }
            }
        }

        let target = id.trim();
        if !ahead_list.is_empty() {
            let target_in_ahead = ahead_list.iter().any(|c| c.id.starts_with(target));
            if !target_in_ahead {
                return Err("Selected commit is not ahead of upstream".into());
            }
        }

        let on = progress_bridge(app);
        on(VcsEvent::Info("Undoing to selected commit (soft reset)…"));
        let rev = format!("{}^", target);
        repo.inner().reset_soft_to(&rev).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
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
pub async fn set_backend_cmd(state: State<'_, AppState>, backend_id: BackendId) -> Result<(), String> {
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

        let open_path = path.clone();
        let backend_label = backend_id.as_ref().to_string();
        let handle = async_runtime::spawn_blocking(move || (desc.open)(Path::new(&open_path)))
            .await
            .map_err(|e| format!("set_backend_cmd task failed: {e}"))?
            .map_err(|e| {
                error!(
                    "set_backend_cmd: failed to reopen repo '{}' with backend `{}`: {}",
                    path.display(),
                    backend_label,
                    e
                );
                format!("Failed to reopen repo with `{backend_label}`: {e}")
            })?;

        let new_repo = Arc::new(Repo::new(handle));
        state.set_current_repo(new_repo);
        info!(
            "set_backend_cmd: repo reopened with backend `{}` (path={})",
            backend_label,
            path.display()
        );
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
pub async fn get_repo_settings(state: State<'_, AppState>) -> Result<RepoConfig, String> {
    let mut cfg = state.repo_config();
    // If a repo is open, enrich settings from actual Git config
    if let Some(repo) = state.current_repo() {
        let (identity, origin) = run_repo_task("get_repo_settings", repo, move |repo| {
            let identity = match repo.inner().get_identity() {
                Ok(Some((name, email))) => Some((name, email)),
                Ok(None) => None,
                Err(e) => {
                    warn!("get_repo_settings: get_identity failed: {e}");
                    None
                }
            };

            let origin = match repo.inner().list_remotes() {
                Ok(list) => list.into_iter().find(|(n, _)| n == "origin").map(|(_, url)| url),
                Err(e) => {
                    warn!("get_repo_settings: list_remotes failed: {e}");
                    None
                }
            };

            Ok::<_, String>((identity, origin))
        })
        .await?;

        if let Some((name, email)) = identity {
            cfg.user_name = Some(name);
            cfg.user_email = Some(email);
        }
        if let Some(url) = origin {
            cfg.origin_url = Some(url);
        }
    }

    Ok(cfg)
}

#[tauri::command]
pub async fn set_repo_settings(
    state: State<'_, AppState>,
    cfg: RepoConfig,
) -> Result<(), String> {
    let cfg_clone = cfg.clone();
    state.set_repo_config(RepoConfig { ..cfg.clone() })?;

    if let Some(repo) = state.current_repo() {
        run_repo_task("set_repo_settings", repo, move |repo| {
            if let (Some(name), Some(email)) = (cfg_clone.user_name.as_deref(), cfg_clone.user_email.as_deref()) {
                repo.inner().set_identity_local(name, email).map_err(|e| e.to_string())?;
            }
            if let Some(url) = cfg_clone.origin_url.as_deref() {
                if !url.trim().is_empty() {
                    repo.inner().ensure_remote("origin", url).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
        .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn updater_install_now<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let app = window.app_handle();
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let app2 = app.clone();
            update
                .download_and_install(
                    |received, total| {
                        let payload = serde_json::json!({ "kind": "progress", "received": received, "total": total });
                        let _ = app2.emit("update:progress", payload);
                    },
                    || {
                        let _ = app2.emit("update:progress", serde_json::json!({ "kind": "downloaded" }));
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Ok(()),
    }
}
