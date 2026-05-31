// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::{HashMap, HashSet};

use log::{debug, warn};
use serde::Serialize;
use tauri::State;

use crate::core::models::{BranchItem, BranchKind, CommitItem, FileEntry, LogQuery, StashItem};
use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

/// Conflict-status classifications recognized by backend snapshot logic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConflictStatus {
    Unmerged,
    BothAdded,
    BothDeleted,
    AddedByUs,
    AddedByThem,
    DeletedByUs,
    DeletedByThem,
    BothModified,
}

impl ConflictStatus {
    /// Returns all recognized conflict-status variants.
    const fn all() -> [Self; 8] {
        [
            Self::Unmerged,
            Self::BothModified,
            Self::AddedByUs,
            Self::AddedByThem,
            Self::DeletedByUs,
            Self::DeletedByThem,
            Self::BothAdded,
            Self::BothDeleted,
        ]
    }

    /// Returns porcelain code for this conflict status.
    const fn code(self) -> &'static str {
        match self {
            Self::Unmerged => "U",
            Self::BothAdded => "AA",
            Self::BothDeleted => "DD",
            Self::AddedByUs => "UA",
            Self::AddedByThem => "AU",
            Self::DeletedByUs => "UD",
            Self::DeletedByThem => "DU",
            Self::BothModified => "UU",
        }
    }

    /// Parses a porcelain status code into a conflict status.
    fn parse(status: &str) -> Option<Self> {
        let s = status.trim().to_uppercase();
        match s.as_str() {
            "U" => Some(Self::Unmerged),
            "AA" => Some(Self::BothAdded),
            "DD" => Some(Self::BothDeleted),
            "UA" => Some(Self::AddedByUs),
            "AU" => Some(Self::AddedByThem),
            "UD" => Some(Self::DeletedByUs),
            "DU" => Some(Self::DeletedByThem),
            "UU" => Some(Self::BothModified),
            _ => None,
        }
    }
}

/// Full repository snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct RepoSnapshot {
    /// True when a repository is open.
    pub has_repo: bool,
    /// Absolute repository path.
    pub repo_path: String,
    /// Current branch name when attached.
    pub branch: String,
    /// UI label for the current branch / detached HEAD.
    pub branch_label: String,
    /// Normalized branch list.
    pub branches: Vec<BranchItem>,
    /// Working tree status entries.
    pub files: Vec<FileEntry>,
    /// Combined commit history list.
    pub commits: Vec<SnapshotCommitItem>,
    /// Stash entries.
    pub stash: Vec<StashItem>,
    /// Commits ahead of upstream.
    pub ahead: u32,
    /// Commits behind upstream.
    pub behind: u32,
    /// Whether current branch tracks a remote.
    pub branch_on_remote: bool,
    /// Whether merge state is active.
    pub merge_in_progress: bool,
    /// Paths still conflicted during merge.
    pub seen_conflicts: Vec<String>,
    /// Status codes currently classified as conflicts.
    pub conflict_statuses: Vec<String>,
    /// Active backend action labels.
    pub vcs_action_labels: HashMap<String, String>,
    /// Commit ids that are ahead of upstream.
    pub ahead_ids: Vec<String>,
    /// Snapshot revision token.
    pub revision: String,
}

/// Commit payload used by repository snapshots.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotCommitItem {
    /// Commit hash or identifier.
    pub id: String,
    /// Commit message.
    pub msg: String,
    /// Commit metadata.
    pub meta: String,
    /// Commit author.
    pub author: String,
    /// True when commit is coming from upstream/remote range.
    #[serde(default)]
    pub incoming: bool,
    /// Optional source ref for incoming commits.
    #[serde(default, rename = "remoteRef", skip_serializing_if = "Option::is_none")]
    pub remote_ref: Option<String>,
}

struct SnapshotRevisionParts<'a> {
    repo_path: &'a str,
    branch_label: &'a str,
    head_commit: Option<&'a str>,
    file_count: usize,
    commit_count: usize,
    ahead: u32,
    behind: u32,
    stash_count: usize,
    merge_in_progress: bool,
    branch_on_remote: bool,
}

/// Builds the snapshot revision token used by the frontend cache gate.
///
/// # Returns
/// - Stable revision token for cache invalidation.
fn build_repo_snapshot_revision(parts: &SnapshotRevisionParts<'_>) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        parts.repo_path,
        parts.branch_label,
        parts.head_commit.unwrap_or_default(),
        parts.file_count,
        parts.commit_count,
        parts.ahead,
        parts.behind,
        parts.stash_count,
        parts.merge_in_progress,
        parts.branch_on_remote,
    )
}

fn infer_kind(full_ref: &str) -> BranchKind {
    if full_ref.starts_with("refs/heads/") {
        BranchKind::Local
    } else if let Some(rest) = full_ref.strip_prefix("refs/remotes/") {
        if let Some((remote, _name)) = rest.split_once('/') {
            BranchKind::Remote {
                remote: remote.to_string(),
            }
        } else {
            BranchKind::Remote {
                remote: String::from("unknown"),
            }
        }
    } else {
        BranchKind::Unknown
    }
}

fn normalize_branches(mut items: Vec<BranchItem>, current_local: Option<&str>) -> Vec<BranchItem> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<BranchItem> = Vec::with_capacity(items.len());

    for mut it in items.drain(..) {
        it.name = it.name.trim().to_string();
        it.full_ref = it.full_ref.trim().to_string();

        if it.name.is_empty() || it.full_ref.is_empty() {
            continue;
        }

        if matches!(it.kind, BranchKind::Unknown) {
            it.kind = infer_kind(&it.full_ref);
        }

        it.current =
            matches!((&it.kind, current_local), (BranchKind::Local, Some(curr)) if it.name == curr);

        if !seen.insert(it.full_ref.clone()) {
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

    out
}

fn short_commit_label(commit: Option<&str>) -> String {
    let short = commit.unwrap_or("").trim();
    if short.is_empty() {
        String::new()
    } else {
        short.chars().take(7).collect::<String>()
    }
}

fn branch_label(branch: Option<&str>, commit: Option<&str>) -> (String, String) {
    let branch = branch.unwrap_or("").trim();
    let short = short_commit_label(commit);
    if branch.is_empty() {
        let label = if short.is_empty() {
            String::from("Detached HEAD")
        } else {
            format!("Detached HEAD ({short})")
        };
        (String::new(), label)
    } else {
        (branch.to_string(), branch.to_string())
    }
}

fn commit_items(items: Vec<CommitItem>) -> Vec<SnapshotCommitItem> {
    items
        .into_iter()
        .map(|item| SnapshotCommitItem {
            id: item.id,
            msg: item.msg,
            meta: item.meta,
            author: item.author,
            incoming: false,
            remote_ref: None,
        })
        .collect()
}

fn dedupe_commits(items: Vec<SnapshotCommitItem>) -> Vec<SnapshotCommitItem> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(items.len());

    for item in items {
        if item.id.is_empty() || !seen.insert(item.id.clone()) {
            continue;
        }
        out.push(item);
    }

    out
}

fn load_incoming_commits(
    vcs: &dyn crate::core::Vcs,
    current_branch: &str,
) -> Result<Vec<SnapshotCommitItem>, String> {
    let mut refs_to_try: Vec<(String, String)> =
        vec![("@{upstream}".to_string(), String::from("@{upstream}"))];
    if !current_branch.trim().is_empty() {
        refs_to_try.push((
            format!("origin/{current_branch}"),
            format!("origin/{current_branch}"),
        ));
    }

    for (refspec, remote_ref) in refs_to_try {
        let query = LogQuery {
            rev: Some(format!("HEAD..{refspec}")),
            limit: Some(500),
            topo_order: true,
            include_merges: true,
            ..Default::default()
        };

        match vcs.log_commits(&query) {
            Ok(commits) if !commits.is_empty() => {
                return Ok(commits
                    .into_iter()
                    .map(|item| SnapshotCommitItem {
                        id: item.id,
                        msg: item.msg,
                        meta: item.meta,
                        author: item.author,
                        incoming: true,
                        remote_ref: Some(remote_ref.clone()),
                    })
                    .collect());
            }
            Ok(_) => continue,
            Err(err) => {
                debug!("snapshot: incoming commits range {refspec} failed: {err}");
                continue;
            }
        }
    }

    Ok(Vec::new())
}

fn load_ahead_ids(vcs: &dyn crate::core::Vcs) -> Vec<String> {
    let query = LogQuery {
        rev: Some("@{upstream}..HEAD".to_string()),
        limit: Some(1000),
        topo_order: true,
        include_merges: true,
        ..Default::default()
    };

    match vcs.log_commits(&query) {
        Ok(commits) => commits.into_iter().map(|item| item.id).collect(),
        Err(err) => {
            debug!("snapshot: ahead ids query failed: {err}");
            Vec::new()
        }
    }
}

/// Returns one authoritative snapshot of current repository state.
#[tauri::command]
pub async fn get_repo_snapshot(state: State<'_, AppState>) -> Result<RepoSnapshot, String> {
    let repo = current_repo_or_err(&state)?;

    run_repo_task("get_repo_snapshot", repo, move |repo| {
        let vcs = repo.inner();
        let repo_path = vcs.workdir().to_string_lossy().to_string();
        let current_branch = vcs.current_branch().map_err(|e| e.to_string())?;
        let head_query = LogQuery {
            rev: Some("HEAD".into()),
            limit: Some(1),
            topo_order: true,
            include_merges: true,
            ..Default::default()
        };
        let head = vcs.log_commits(&head_query).map_err(|e| e.to_string())?;
        let head_commit = head.first().map(|item| item.id.clone());

        let branches = normalize_branches(
            vcs.branches().map_err(|e| e.to_string())?,
            current_branch.as_deref(),
        );
        let (branch, branch_label) =
            branch_label(current_branch.as_deref(), head_commit.as_deref());
        let status = vcs.status_payload().map_err(|e| e.to_string())?;
        let merge_in_progress = vcs.merge_in_progress().unwrap_or(false);
        let seen_conflicts = if merge_in_progress {
            status
                .files
                .iter()
                .filter(|file| is_conflict_status(&file.status))
                .map(|file| file.path.clone())
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        let base_commits = commit_items(
            vcs.log_commits(&LogQuery {
                limit: Some(500),
                topo_order: true,
                include_merges: true,
                ..Default::default()
            })
            .map_err(|e| e.to_string())?,
        );

        let incoming_commits = if status.behind > 0 {
            load_incoming_commits(vcs, &branch).unwrap_or_default()
        } else {
            Vec::new()
        };

        let mut commits = Vec::with_capacity(base_commits.len() + incoming_commits.len());
        commits.extend(incoming_commits);
        commits.extend(base_commits);
        commits = dedupe_commits(commits);

        let ahead_ids = if status.ahead > 0 {
            load_ahead_ids(vcs)
        } else {
            Vec::new()
        };

        let vcs_action_labels =
            crate::plugin_vcs_backends::plugin_vcs_backend_descriptor(&repo.id())
                .map(|descriptor| {
                    descriptor
                        .action_labels
                        .into_iter()
                        .collect::<HashMap<_, _>>()
                })
                .unwrap_or_else(|err| {
                    warn!("snapshot: failed to load action labels: {err}");
                    HashMap::new()
                });

        let stash = match vcs.stash_list() {
            Ok(items) => items,
            Err(err) => {
                warn!("snapshot: failed to load stash entries: {err}");
                Vec::new()
            }
        };
        let conflict_statuses = list_conflict_statuses();
        let revision = build_repo_snapshot_revision(&SnapshotRevisionParts {
            repo_path: &repo_path,
            branch_label: &branch_label,
            head_commit: head_commit.as_deref(),
            file_count: status.files.len(),
            commit_count: commits.len(),
            ahead: status.ahead,
            behind: status.behind,
            stash_count: stash.len(),
            merge_in_progress,
            branch_on_remote: status.branch_on_remote,
        });

        Ok(RepoSnapshot {
            has_repo: true,
            repo_path,
            branch,
            branch_label,
            branches,
            files: status.files,
            commits,
            stash,
            ahead: status.ahead,
            behind: status.behind,
            branch_on_remote: status.branch_on_remote,
            merge_in_progress,
            seen_conflicts,
            conflict_statuses,
            vcs_action_labels,
            ahead_ids,
            revision,
        })
    })
    .await
}

fn is_conflict_status(status: &str) -> bool {
    ConflictStatus::parse(status).is_some()
}

/// Returns conflict-status codes recognized by the backend.
#[tauri::command]
pub fn list_conflict_statuses() -> Vec<String> {
    ConflictStatus::all()
        .iter()
        .map(|status| status.code().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/snapshot.rs");
}
