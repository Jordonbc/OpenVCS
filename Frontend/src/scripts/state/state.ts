// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/state/state.ts
import type { AppPrefs, Branch, CommitItem, FileStatus, GlobalSettings, RepoFileMeta, RepoSnapshotCache, StashItem } from '../types';

/** Default application preferences. */
export const defaultPrefs: AppPrefs = {
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    leftW: 0,
    tab: 'changes',
};

// In-memory-only UI prefs. Persisted preferences now live in native Rust config.
/** Current application preferences. */
export let prefs: AppPrefs = { ...defaultPrefs };

/** Latest global settings snapshot for synchronous frontend reads. */
export let globalSettings: GlobalSettings | null = null;

/** Stores latest global settings snapshot. */
export function setGlobalSettings(cfg: GlobalSettings | null) {
    globalSettings = cfg;
}

/**
 * Save preferences to storage.
 * @deprecated Web prefs are not persisted; native settings handle persistence
 */
export function savePrefs() {
    // no-op: web prefs are not persisted; native settings handle persistence
}

/** Metadata for diff view rendering. */
export type DiffMeta = {
    offset: number;
    rest: string[];
    starts: number[];
    changeCounts: number[];
    totalHunks: number;
};

/** References to DOM elements for a hunk. */
export type HunkNodeRefs = {
    hunkEls: HTMLElement[];
    hunkCheckboxes: HTMLInputElement[];
    lineCheckboxes: Record<number, HTMLInputElement>;
};

// ---------------------------------------------------------------------------
// Internal state slices.
//
// The exported `state` facade below is the single public surface consumed by
// feature modules and tests. The slices group the god-object fields by
// concern (repository data, selection/diff state, UI preferences) without
// changing the public shape.
// ---------------------------------------------------------------------------

/** Repository snapshot and branch metadata mirrored from the backend. */
const repoState = {
    /** Latest repository snapshot mirrored from Rust. */
    repoSnapshotCache: null as RepoSnapshotCache | null,
    hasRepo: false,                 // backend truth (set after open/clone/add)
    branch: '' as string,           // current branch name
    branches: [] as Branch[],       // list of branches
    files: [] as FileStatus[],      // working tree status
    commits: [] as CommitItem[],    // recent commits
    vcsActionLabels: {} as Record<string, string>, // resolved action labels from the active backend
    selectedCommit: null as CommitItem | null,
    stash: [] as StashItem[],       // stash entries
    ahead: 0 as number,             // commits ahead of upstream
    behind: 0 as number,            // commits behind upstream
    branchOnRemote: false as boolean, // current branch has a tracking reference on a remote
    currentUpstream: null as string | null, // resolved upstream ref for the current branch
    aheadIds: new Set<string>() as Set<string>, // IDs of commits ahead of upstream
};

/** Diff/selection state for the current file and the multi-file picker. */
const selectionState = {
    defaultSelectAll: true as boolean, // by default select all files/hunks until user toggles
    selectionImplicitAll: true as boolean, // true when select-all was auto-applied (no manual picks yet)
    diffDirty: true as boolean,
    selectedFiles: new Set<string>(),
    currentFile: '' as string,
    currentDiff: [] as string[],
    currentDiffBinary: false as boolean,
    currentFileMeta: null as RepoFileMeta | null,
    currentStash: '' as string,     // selector of selected stash
    selectedHunks: [] as number[],  // indices of selected hunks for current file
    selectedHunksByFile: {} as Record<string, number[]>,
    selectedLinesByFile: {} as Record<string, Record<number, number[]>>, // file -> hunkIdx -> line indices
    diffSelectedFiles: new Set<string>(), // files included in multi-file diff viewer
    currentDiffMeta: null as DiffMeta | null,
    currentDiffHunkNodes: new Map<number, HunkNodeRefs>(),
};

/** UI-only preferences and transient flags. */
const uiPrefs = {
    branchLabel: '' as string,      // display label (e.g. Detached (abc1234))
    mergeInProgress: false as boolean,
    conflictStatuses: new Set<string>() as Set<string>,
    seenConflicts: new Set<string>() as Set<string>,
};

/**
 * Global application state facade.
 * Single public surface: exposes the exact same fields as before by merging
 * the internal slices. Feature modules and tests keep reading `state.*`.
 */
export const state = {
    ...repoState,
    ...selectionState,
    ...uiPrefs,
};

/** True iff a repository is selected. Always boolean. */
export const hasRepo = (): boolean => Boolean(state.hasRepo);

/** True iff there are staged/unstaged changes. Always boolean. */
export const hasChanges = (): boolean =>
    Array.isArray(state.files) && state.files.length > 0;

/** True iff a VCS status code represents an unresolved merge conflict. */
export const isConflictStatus = (status: unknown): boolean => {
    const s = String(status || '').trim().toUpperCase();
    return state.conflictStatuses.has(s);
};

/**
 * Resolves a backend-provided VCS action label with a generic fallback.
 * @param actionKey - Stable namespaced action key such as `VCS.Push`.
 * @param fallback - Generic text to use when no label is available.
 * @returns The resolved user-facing label.
 */
export function resolveVcsActionLabel(actionKey: string, fallback: string): string {
    const key = String(actionKey || '').trim();
    if (!key) return fallback;
    const label = state.vcsActionLabels[key];
    return String(label || '').trim() || fallback;
}

/**
 * Shared display metadata (label + CSS class token) for file status codes.
 * Single source of truth for status labels and status-dot classes across
 * the changes list, history view, and stash confirmation.
 */
const STATUS_INFO: Record<string, { label: string; cls: string }> = {
    'A': { label: 'Added', cls: 'add' },
    '?': { label: 'Untracked', cls: 'untracked' },
    'R': { label: 'Renamed', cls: 'ren' },
    'C': { label: 'Copied', cls: 'cpy' },
    'T': { label: 'Type change', cls: 'type' },
    'S': { label: 'Submodule', cls: 'submodule' },
    'M': { label: 'Modified', cls: 'mod' },
    'D': { label: 'Deleted', cls: 'del' },
};

/**
 * Get display label for a file status code.
 * @param s - Status code character
 * @returns Human-readable status label
 */
export const statusLabel = (s: string) =>
    isConflictStatus(s) ? 'Conflicted' : (STATUS_INFO[s]?.label ?? 'Changed');

/**
 * Get CSS class token for a file status code.
 * @param s - Status code character
 * @returns CSS class suffix used by status badges
 */
export const statusClass = (s: string) =>
    isConflictStatus(s) ? 'conflict' : (STATUS_INFO[s]?.cls ?? 'mod');

/**
 * Friendly labels for stash-specific status codes layered on the shared map.
 */
const STASH_STATUS_LABELS: Record<string, string> = {
    '??': STATUS_INFO['?'].label,
    '!': 'Ignored',
    '!!': 'Ignored',
};

/**
 * Friendly status label for stash confirmation rows, adding stash-specific
 * codes on top of the shared status map.
 * @param code - Status code character
 * @returns Human-readable status label
 */
export const friendlyStatus = (code: string) => STASH_STATUS_LABELS[code] ?? statusLabel(code);

/**
 * Disables implicit select-all behavior.
 * @param clearImplicit - Whether to clear auto-filled file selections
 * @returns True when implicit selections were cleared
 */
export function disableDefaultSelectAll(clearImplicit = false): boolean {
    const hadImplicit = state.defaultSelectAll && state.selectionImplicitAll;
    if (clearImplicit && hadImplicit) {
        state.selectedFiles.clear();
    }
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;
    return Boolean(clearImplicit && hadImplicit);
}
