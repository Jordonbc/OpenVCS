// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
/** Represents a generic JSON-like object map. */
export type Json = Record<string, any>;

/** Represents branch kind metadata reported by the backend. */
export interface BranchKind {
    type?: 'Local' | 'Remote' | string;
    remote?: string;
}
/** Represents a Git branch entry used in branch pickers. */
export interface Branch {
    name: string;
    full_ref?: string;
    current?: boolean;
    kind?: BranchKind;
}

/** Represents a file status row in the Changes view. */
export interface FileStatus {
    path: string;
    old_path?: string;
    status: 'A'|'M'|'D'|'S'|string;
    staged?: boolean;
    resolved_conflict?: boolean;
    hunks?: string[];
}

/** Represents merge conflict payload data for a file. */
export interface ConflictDetails {
    path: string;
    ours?: string | null;
    theirs?: string | null;
    base?: string | null;
    binary?: boolean;
}

/** Represents the encoding and line-ending metadata for a repository file. */
export interface RepoFileMeta {
    encoding: string;
    line_ending: string;
    bom: boolean;
    binary: boolean;
}

/** Represents a commit list item for History. */
export interface CommitItem {
    id: string;
    msg?: string;
    meta?: string;
    author?: string;
    incoming?: boolean;
    remoteRef?: string;
}

/** Represents a stash list item for the Stash tab. */
export interface StashItem {
    selector: string; // e.g., "stash@{0}"
    msg?: string;
    meta?: string;    // date string
}

/** Represents persisted local UI preferences. */
export interface AppPrefs {
    theme: 'dark' | 'light';
    leftW: number;   // px
    tab: 'changes' | 'history' | 'stash';
}

/** Represents global settings loaded from the backend. */
export interface GlobalSettings {
    plugin?: string[];
    general?: {
        theme?: 'system'|'dark'|'light';
        theme_pack?: string;
        language?: string;
        default_backend?: 'git'|string;
        update_channel?: string;
        reopen_last_repos?: boolean;
        checks_on_launch?: boolean;
        telemetry?: boolean;
        crash_reports?: boolean;
    };
    commit?: {
        commit_message_template_enabled?: boolean;
        restrict_commit_summary?: boolean;
        commit_templates?: {
            commit_message_template_create?: string;
            commit_message_template_update?: string;
            commit_message_template_delete?: string;
        };
    };
    git?: {
        backend?: string;
        default_branch?: string;
        ssh_binary?: 'auto'|'host'|'bundled'|'custom'|string;
        ssh_path?: string;
        prune_on_fetch?: boolean;
        fetch_on_focus?: boolean;
        allow_hooks?: string;
        respect_core_autocrlf?: boolean;
        merge_commit_message_template?: string;
    };
    diff?: {
        tab_width?: number;
        ignore_whitespace?: string;
        max_file_size_mb?: number;
        intraline?: boolean;
        show_binary_placeholders?: boolean;
        external_diff?: { enabled:boolean; path:string; args:string };
        external_merge?: { enabled:boolean; path:string; args:string };
        binary_exts?: string[];
    };
    performance?: {
        progressive_render?: boolean;
        gpu_accel?: boolean;
        animations?: boolean;
    };
    ux?: {
        ui_scale?: number;
        font_mono?: string;
        vim_nav?: boolean;
        color_blind_mode?: string;
        recents_limit?: number;
    };
    logging?: {
        level?: 'trace'|'debug'|'info'|'warn'|'error'|string;
        live_viewer?: boolean;
        retain_archives?: number;
    };
    plugins?: {
        disabled?: string[];
        enabled?: string[];
    };
}

/** Represents theme metadata shown in settings. */
export interface ThemeSummary {
    id: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    appearance?: 'light' | 'dark' | 'both' | string;
    paired_with?: string;
    source?: 'built-in' | 'user' | string;
    plugin_id?: string;
}

/** Represents the full theme package payload. */
export interface ThemePayload {
    summary: ThemeSummary;
    styles?: string | null;
    markup?: {
        head?: string | null;
        body?: string | null;
    } | null;
    scripts?: string[];
}

/** Represents repository-local identity and remote settings. */
export interface RepoSettings {
    user_name?: string;
    user_email?: string;
    origin_url?: string;
    remotes?: Array<{ name: string; url: string }>;
}

/** Represents a backend-owned repository snapshot used by the frontend cache. */
export interface RepoSnapshotCache {
    has_repo: boolean;
    repo_path: string;
    branch: string;
    branch_label: string;
    branches: Branch[];
    files: FileStatus[];
    commits: CommitItem[];
    stash: StashItem[];
    ahead: number;
    behind: number;
    branch_on_remote: boolean;
    merge_in_progress: boolean;
    seen_conflicts: string[];
    conflict_statuses?: string[];
    vcs_action_labels: Record<string, string>;
    ahead_ids: string[];
    revision: string;
}
