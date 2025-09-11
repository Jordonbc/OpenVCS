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
        default_backend?: 'git'|string;
        update_channel?: string;
        reopen_last_repos?: boolean;
        checks_on_launch?: boolean;
        telemetry?: boolean;
        crash_reports?: boolean;
    };
    git?: {
        backend?: 'system'|'libgit2'|string;
        default_branch?: string;
        prune_on_fetch?: boolean;
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
}

export interface RepoSettings {
    user_name?: string;
    user_email?: string;
    origin_url?: string;
}
