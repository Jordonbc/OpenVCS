// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI, isTauriRuntimeAvailable } from '../../lib/tauri';
import { state, prefs } from '../../state/state';
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

function buildStatusSignature(input: {
    files: any[];
    ahead: number;
    behind: number;
    mergeInProgress: boolean;
    seenConflicts: Set<string>;
}): string {
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
        mergeInProgress: !!input.mergeInProgress,
        conflicts,
    });
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
                    if (String(f?.status || '').toUpperCase() === 'U' && f?.path) {
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
        const nextSignature = buildStatusSignature({
            files: nextFiles,
            ahead: nextAhead,
            behind: nextBehind,
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
        (state as any).ahead = nextAhead;
        (state as any).behind = nextBehind;
        renderList();
        void autoOpenFirstConflict(state.files as any);
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    } catch (e) {
        console.warn(describeHydrationFailure('hydrateStatus', e), e);
        state.files = [];
        state.mergeInProgress = false;
        state.seenConflicts = new Set<string>();
        state.selectedFiles.clear();
        state.selectionImplicitAll = false;
        lastStatusSignature = '';
        renderList();
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    }
}

/**
 * Loads commit history for the history pane.
 *
 * Passing `limit: 0` asks the backend for the full history.
 */
export async function hydrateCommits(): Promise<void> {
    try {
        await yieldToPaint();
        const list = await TAURI.invoke<any[]>('vcs_log', { limit: 0 });
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
 * Loads the resolved action-label map for the active backend.
 */
export async function hydrateVcsActionLabels(): Promise<void> {
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
    }
}
