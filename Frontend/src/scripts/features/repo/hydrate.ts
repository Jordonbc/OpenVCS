// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI, isTauriRuntimeAvailable } from '../../lib/tauri';
import { isConflictStatus, state, prefs } from '../../state/state';
import type { RepoSnapshotCache } from '../../types';
import { renderList } from './list';
import { autoOpenFirstConflict } from '../conflicts';

/**
 * Yields control long enough for the browser to paint pending UI updates.
 *
 * This keeps the webview responsive before expensive repo refresh work starts.
 *
 * @returns A promise that resolves on the next paint opportunity.
 */
export function yieldToPaint(): Promise<void> {
    return new Promise((resolve) => {
        if (document.visibilityState === 'visible') {
            window.requestAnimationFrame(() => resolve());
            return;
        }

        window.setTimeout(() => resolve(), 0);
    });
}

function normalizeFiles(files: any[]): any[] {
    return [...files].sort((a, b) => String(a?.path || '').localeCompare(String(b?.path || '')));
}

let snapshotInFlight: Promise<RepoSnapshotCache | null> | null = null;
let lastSnapshotRevision = '';

/** Applies a backend snapshot to frontend mirror state. */
function applyRepoSnapshot(snapshot: RepoSnapshotCache): void {
    if (!snapshot || snapshot.revision === lastSnapshotRevision) return;

    lastSnapshotRevision = snapshot.revision;
    state.repoSnapshotCache = snapshot;
    state.hasRepo = Boolean(snapshot.has_repo);
    state.branch = String(snapshot.branch || '');
    state.branchLabel = String(snapshot.branch_label || '');
    state.branches = Array.isArray(snapshot.branches) ? (snapshot.branches as any) : [];
    state.files = Array.isArray(snapshot.files) ? (snapshot.files as any) : [];
    state.commits = Array.isArray(snapshot.commits) ? (snapshot.commits as any) : [];
    (state as any).stash = Array.isArray(snapshot.stash) ? (snapshot.stash as any) : [];
    (state as any).ahead = Number(snapshot.ahead || 0);
    (state as any).behind = Number(snapshot.behind || 0);
    state.branchOnRemote = Boolean(snapshot.branch_on_remote);
    state.mergeInProgress = Boolean(snapshot.merge_in_progress);
    state.seenConflicts = new Set(Array.isArray(snapshot.seen_conflicts) ? snapshot.seen_conflicts : []);
    state.vcsActionLabels = { ...(snapshot.vcs_action_labels || {}) };
    (state as any).aheadIds = new Set(Array.isArray(snapshot.ahead_ids) ? snapshot.ahead_ids : []);

    const currentPaths = new Set<string>(state.files.map((f: any) => String(f?.path || '')));
    if (state.defaultSelectAll) {
        state.selectionImplicitAll = true;
        state.selectedFiles = new Set<string>(Array.from(currentPaths));
    } else {
        state.selectionImplicitAll = false;
        state.selectedFiles.forEach((p) => { if (!currentPaths.has(p)) state.selectedFiles.delete(p); });
    }
    pruneSelectionMaps(currentPaths);

    state.diffDirty = true;
    renderList();
    void autoOpenFirstConflict(state.files as any);
    window.dispatchEvent(new CustomEvent('app:branches-updated'));
    window.dispatchEvent(new CustomEvent('app:status-updated'));
    window.dispatchEvent(new CustomEvent('app:vcs-action-labels-updated'));
}

/** Fetches one snapshot from Rust, with in-flight dedupe. */
async function loadRepoSnapshot(): Promise<RepoSnapshotCache | null> {
    if (!isTauriRuntimeAvailable()) return null;
    if (snapshotInFlight) return snapshotInFlight;
    snapshotInFlight = (async () => {
        try {
            const result = await TAURI.invoke<unknown>('get_repo_snapshot');
            if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
            const snapshot = result as Partial<RepoSnapshotCache>;
            if (typeof snapshot.revision !== 'string' || !snapshot.revision) return null;
            return snapshot as RepoSnapshotCache;
        } catch {
            return null;
        }
    })().finally(() => {
        snapshotInFlight = null;
    });
    return snapshotInFlight;
}

/** Hydrates mirror state from Rust snapshot when available. */
async function hydrateFromSnapshot(): Promise<boolean> {
    const snapshot = await loadRepoSnapshot();
    if (!snapshot) return false;
    applyRepoSnapshot(snapshot);
    return true;
}

/** Loads one full repo snapshot from Rust and applies it when available. */
export async function hydrateSnapshot(): Promise<boolean> {
    return hydrateFromSnapshot();
}

function buildStatusSignature(input: {
    files: any[];
    ahead: number;
    behind: number;
    branchOnRemote: boolean;
    mergeInProgress: boolean;
    seenConflicts: Set<string>;
}): string {
    // Include branch tracking state so Publish/Push labels refresh when upstream presence changes.
    const files = normalizeFiles(input.files).map((f) => ({
        path: String(f?.path || ''),
        oldPath: String((f as any)?.old_path || ''),
        status: String((f as any)?.status || '').toUpperCase(),
        staged: !!(f as any)?.staged,
        resolvedConflict: !!(f as any)?.resolved_conflict,
    }));
    const conflicts = Array.from(input.seenConflicts).sort();
    return JSON.stringify({
        files,
        ahead: Number(input.ahead || 0),
        behind: Number(input.behind || 0),
        branchOnRemote: !!input.branchOnRemote,
        mergeInProgress: !!input.mergeInProgress,
        conflicts,
    });
}

/** Removes per-file selection cache entries that no longer match status paths. */
function pruneSelectionMaps(currentPaths: Set<string>): void {
    for (const path of Object.keys((state as any).selectedHunksByFile || {})) {
        if (!currentPaths.has(path)) delete (state as any).selectedHunksByFile[path];
    }
    for (const path of Object.keys((state as any).selectedLinesByFile || {})) {
        if (!currentPaths.has(path)) delete (state as any).selectedLinesByFile[path];
    }
    for (const path of Array.from(state.diffSelectedFiles || [])) {
        if (!currentPaths.has(path)) state.diffSelectedFiles.delete(path);
    }
}

/** Clears all in-memory diff and commit selection state after status failure. */
function clearSelectionState(): void {
    state.selectedFiles.clear();
    state.selectedHunks = [];
    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.diffSelectedFiles.clear();
}

let lastStatusSignature = '';

/** Returns a richer log message for common repository hydration failures. */
function describeHydrationFailure(operation: string, error: unknown): string {
    const message = String(error || '').trim();
    if (message === 'No repository selected') {
        return `${operation} skipped: no repository selected; check whether a VCS backend is available and whether a repository was reopened successfully`;
    }
    if (message.includes('no longer available')) {
        return `${operation} failed: active backend is no longer available; reopen the repository or re-enable the backend plugin`;
    }
    return `${operation} failed ${message}`.trim();
}

export async function hydrateBranches(): Promise<boolean> {
    if (!isTauriRuntimeAvailable()) return false;
    if (await hydrateFromSnapshot()) return Boolean(state.hasRepo);
    try {
        await yieldToPaint();
        const list = await TAURI.invoke<any[]>('vcs_list_branches');
        const head = await TAURI.invoke<{ detached: boolean; branch?: string; commit?: string }>('vcs_head_status').catch(() => ({ detached: false } as any));
        const has = Array.isArray(list) && list.length > 0;
        state.hasRepo = state.hasRepo || has;
        if (has) {
            state.branches = list as any;
            state.branch = (head as any)?.branch || (list.find((b: any) => b.current)?.name) || state.branch || 'main';
            const detached = Boolean((head as any)?.detached);
            const short = String((head as any)?.commit || '').slice(0, 7);
            state.branchLabel = detached
                ? `Detached HEAD ${short ? '(' + short + ')' : ''}`.trim()
                : (state.branch || '—');
            window.dispatchEvent(new CustomEvent('app:branches-updated'));
            return true;
        }
        return false;
    } catch (e) {
        console.warn(describeHydrationFailure('hydrateBranches', e), e);
        return false;
    }
}

export async function hydrateStatus() {
    if (await hydrateFromSnapshot()) return;
    try {
        await yieldToPaint();
        const result = await TAURI.invoke<{ files: any[]; ahead?: number; behind?: number }>('vcs_status');
        const nextFiles = Array.isArray(result?.files) ? (result.files as any) : [];
        let nextMergeInProgress = false;
        let nextSeenConflicts = new Set<string>();
        // Track merge context for UI hints (e.g., resolved-conflict checkmarks)
        try {
            const ctx = await TAURI.invoke<{ in_progress: boolean }>('vcs_merge_context');
            nextMergeInProgress = !!ctx?.in_progress;
            if (nextMergeInProgress) {
                nextSeenConflicts = new Set<string>();
                nextFiles.forEach((f: any) => {
                    if (isConflictStatus(f?.status) && f?.path) {
                        nextSeenConflicts.add(String(f.path));
                    }
                });
            }
        } catch {
            nextMergeInProgress = false;
            nextSeenConflicts = new Set<string>();
        }
        const nextAhead = Number((result as any)?.ahead || 0);
        const nextBehind = Number((result as any)?.behind || 0);
        const nextBranchOnRemote = Boolean((result as any)?.branch_on_remote || false);
        const nextSignature = buildStatusSignature({
            files: nextFiles,
            ahead: nextAhead,
            behind: nextBehind,
            branchOnRemote: nextBranchOnRemote,
            mergeInProgress: nextMergeInProgress,
            seenConflicts: nextSeenConflicts,
        });
        if (nextSignature === lastStatusSignature) return;
        lastStatusSignature = nextSignature;
        state.diffDirty = true;

        state.hasRepo = true;
        state.files = nextFiles;
        state.mergeInProgress = nextMergeInProgress;
        state.seenConflicts = nextSeenConflicts;

        const currentPaths = new Set<string>(nextFiles.map((f: any) => String(f?.path || '')));
        if (state.defaultSelectAll) {
            state.selectionImplicitAll = true;
            state.selectedFiles = new Set<string>(Array.from(currentPaths));
        } else {
            state.selectionImplicitAll = false;
            state.selectedFiles.forEach((p) => { if (!currentPaths.has(p)) state.selectedFiles.delete(p); });
        }
        pruneSelectionMaps(currentPaths);
        (state as any).ahead = nextAhead;
        (state as any).behind = nextBehind;
        state.branchOnRemote = nextBranchOnRemote;
        renderList();
        void autoOpenFirstConflict(state.files as any);
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    } catch (e) {
        console.warn(describeHydrationFailure('hydrateStatus', e), e);
        state.files = [];
        state.mergeInProgress = false;
        state.seenConflicts = new Set<string>();
        clearSelectionState();
        state.selectionImplicitAll = false;
        lastStatusSignature = '';
        renderList();
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    }
}

/**
 * Loads commit history for the history pane.
 *
 * Uses a bounded initial history window so large repositories do not block startup.
 */
export async function hydrateCommits(): Promise<void> {
    if (await hydrateFromSnapshot()) return;
    try {
        await yieldToPaint();
        const list = await TAURI.invoke<any[]>('vcs_log', { limit: 500 });
        state.hasRepo = true;
        const baseCommits = Array.isArray(list) ? (list as any) : [];
        const behindCount = Number((state as any).behind || 0);
        let incoming: any[] = [];
        if (behindCount > 0) {
            const limit = Math.min(Math.max(behindCount, 50), 500);
            const branch = (state.branch || '').trim();
            const ranges: { range: string; ref: string }[] = [
                { range: 'HEAD..@{upstream}', ref: '@{upstream}' },
            ];
            if (branch) {
                ranges.push({ range: `HEAD..origin/${branch}`, ref: `origin/${branch}` });
            }
            for (const { range, ref } of ranges) {
                try {
                    const remoteList = await TAURI.invoke<any[]>('vcs_log', { limit, rev: range });
                    if (Array.isArray(remoteList) && remoteList.length > 0) {
                        incoming = remoteList.map((c: any) => ({ ...c, incoming: true, remoteRef: ref }));
                        break;
                    }
                } catch (err) {
                    console.warn('hydrateCommits remote range failed', range, err);
                }
            }
        }
        const seen = new Set<string>();
        const merged: any[] = [];
        [...incoming, ...baseCommits].forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const id = String(entry.id || '');
            if (!id || seen.has(id)) return;
            seen.add(id);
            merged.push(entry);
        });
        state.commits = merged;
        const aheadCount = Number((state as any).ahead || 0);
        if (aheadCount > 0) {
            try {
                const aheadList = await TAURI.invoke<any[]>('vcs_log', { limit: 1000, rev: '@{upstream}..HEAD' });
                const ids = new Set<string>();
                (aheadList || []).forEach((c: any) => { if (c?.id) ids.add(String(c.id)); });
                (state as any).aheadIds = ids;
            } catch {
                (state as any).aheadIds = new Set<string>();
            }
        } else {
            (state as any).aheadIds = new Set<string>();
        }
        if (prefs.tab === 'history') renderList();
    } catch (e) {
        console.warn(describeHydrationFailure('hydrateCommits', e), e);
        state.commits = [];
    }
}

export async function hydrateStash(): Promise<void> {
    if (await hydrateFromSnapshot()) return;
    try {
        await yieldToPaint();
        const list = await TAURI.invoke<any[]>('vcs_stash_list');
        (state as any).stash = Array.isArray(list) ? (list as any) : [];
        if (prefs.tab === 'stash') renderList();
    } catch (e) {
        console.warn(describeHydrationFailure('hydrateStash', e), e);
        (state as any).stash = [];
    }
}

/**
 * Loads the resolved action-label map for the active backend and notifies the UI.
 */
export async function hydrateVcsActionLabels(): Promise<void> {
    if (await hydrateFromSnapshot()) return;
    try {
        const labels = await TAURI.invoke<Array<[string, string]>>('current_vcs_action_labels');
        const resolved: Record<string, string> = {};
        for (const pair of labels || []) {
            if (!Array.isArray(pair) || pair.length < 2) continue;
            const key = String(pair[0] || '').trim();
            const label = String(pair[1] || '').trim();
            if (!key || !label) continue;
            resolved[key] = label;
        }
        state.vcsActionLabels = resolved;
    } catch {
        state.vcsActionLabels = {};
    } finally {
        window.dispatchEvent(new CustomEvent('app:vcs-action-labels-updated'));
    }
}
