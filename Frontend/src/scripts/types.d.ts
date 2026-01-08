export type Json = Record<string, any>;

export interface BranchKind {
    type?: 'Local' | 'Remote' | string;
    remote?: string;
}
export interface Branch {
    name: string;
    full_ref?: string;
    current?: boolean;
    kind?: BranchKind;
}

export interface FileStatus {
    path: string;
    old_path?: string;
    status: 'A'|'M'|'D'|string;
    staged?: boolean;
    resolved_conflict?: boolean;
    hunks?: string[];
}

export interface ConflictDetails {
    path: string;
    ours?: string | null;
    theirs?: string | null;
    base?: string | null;
    binary?: boolean;
    lfs_pointer?: boolean;
}

export interface CommitItem {
    id: string;
    msg?: string;
    meta?: string;
    author?: string;
    incoming?: boolean;
    remoteRef?: string;
}

export interface StashItem {
    selector: string; // e.g., "stash@{0}"
    msg?: string;
    meta?: string;    // date string
}

export interface AppPrefs {
    theme: 'dark' | 'light';
    leftW: number;   // px
    tab: 'changes' | 'history' | 'stash';
}

export interface GlobalSettings {
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
    lfs?: {
        enabled?: boolean;
        concurrency?: number;
        require_lock_before_edit?: boolean;
        background_fetch_on_checkout?: boolean;
    };
    performance?: {
        progressive_render?: boolean;
        gpu_accel?: boolean;
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

export interface ThemePayload {
    summary: ThemeSummary;
    styles?: string | null;
    markup?: {
        head?: string | null;
        body?: string | null;
    };
    scripts?: string[];
}

export interface RepoSettings {
    user_name?: string;
    user_email?: string;
    origin_url?: string;
    remotes?: Array<{ name: string; url: string }>;
}
