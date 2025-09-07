export type Json = Record<string, any>;

export interface BranchKind {
    type?: 'Local' | 'Remote' | string;
    remote?: string;
}
export interface Branch {
    name: string;
    current?: boolean;
    kind?: BranchKind;
}

export interface FileStatus {
    path: string;
    status: 'A'|'M'|'D'|string;
    hunks?: string[];
}

export interface CommitItem {
    id: string;
    msg?: string;
    meta?: string;
    author?: string;
}

export interface AppPrefs {
    theme: 'dark' | 'light';
    leftW: number;   // px
    tab: 'changes' | 'history';
}

export interface GlobalSettings {
    general?: {
        theme?: 'system'|'dark'|'light';
        language?: string;
        update_channel?: string;
        reopen_last_repos?: boolean;
        checks_on_launch?: boolean;
        telemetry?: boolean;
        crash_reports?: boolean;
    };
    git?: {
        backend?: 'git-system'|'libgit2'|string;
        default_branch?: string;
        auto_fetch?: boolean;
        auto_fetch_minutes?: number;
        prune_on_fetch?: boolean;
        watcher_debounce_ms?: number;
        large_repo_threshold_mb?: number;
        allow_hooks?: string;
        respect_core_autocrlf?: boolean;
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
        bandwidth_kbps?: number;
        require_lock_before_edit?: boolean;
        background_fetch_on_checkout?: boolean;
    };
    performance?: {
        graph_node_cap?: number;
        progressive_render?: boolean;
        gpu_accel?: boolean;
        index_warm_on_open?: boolean;
        background_index_on_battery?: boolean;
    };
    ux?: {
        ui_scale?: number;
        font_mono?: string;
        vim_nav?: boolean;
        color_blind_mode?: string;
    };
}

export interface RepoSettings {
    user_name?: string;
    user_email?: string;
    origin_url?: string;
}
