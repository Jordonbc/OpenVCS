// src/state/state.ts
import type { AppPrefs, Branch, CommitItem, FileStatus, StashItem } from '../types';

export const defaultPrefs: AppPrefs = {
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    leftW: 0,
    tab: 'changes',
};

// In-memory-only UI prefs. Persisted preferences now live in native Rust config.
export let prefs: AppPrefs = { ...defaultPrefs };
export function savePrefs() {
    // no-op: web prefs are not persisted; native settings handle persistence
}

export const state = {
    hasRepo: false,                 // backend truth (set after open/clone/add)
    branch: '' as string,           // current branch name
    branchLabel: '' as string,      // display label (e.g. Detached HEAD (abc1234))
    branches: [] as Branch[],       // list of branches
    files: [] as FileStatus[],      // working tree status
    commits: [] as CommitItem[],    // recent commits
    selectedCommit: null as CommitItem | null,
    stash: [] as StashItem[],       // stash entries
    ahead: 0 as number,             // commits ahead of upstream
    behind: 0 as number,            // commits behind upstream
    aheadIds: new Set<string>() as Set<string>, // IDs of commits ahead of upstream
    mergeInProgress: false as boolean,
    seenConflicts: new Set<string>() as Set<string>,
    defaultSelectAll: true as boolean, // by default select all files/hunks until user toggles
    selectionImplicitAll: true as boolean, // true when select-all was auto-applied (no manual picks yet)
    diffDirty: true as boolean,
    // Selection state
    selectedFiles: new Set<string>(),
    currentFile: '' as string,
    currentDiff: [] as string[],
    currentDiffBinary: false as boolean,
    currentStash: '' as string,     // selector of selected stash
    selectedHunks: [] as number[],  // indices of selected hunks for current file
    selectedHunksByFile: {} as Record<string, number[]>,
    selectedLinesByFile: {} as Record<string, Record<number, number[]>>, // file -> hunkIdx -> line indices
    diffSelectedFiles: new Set<string>(), // files included in multi-file diff viewer
    // Optional: track the current repo path if you want to show it anywhere
    // repoPath: '' as string,
};

/** True iff a repo is selected AND we know the current branch. Always boolean. */
export const hasRepo = (): boolean => Boolean(state.hasRepo && state.branch);

/** True iff there are staged/unstaged changes. Always boolean. */
export const hasChanges = (): boolean =>
    Array.isArray(state.files) && state.files.length > 0;

export const statusLabel = (s: string) =>
    s === 'A' ? 'Added' :
        s === '?' ? 'Untracked' :
            s === 'R' ? 'Renamed' :
                s === 'C' ? 'Copied' :
                    s === 'T' ? 'Type change' :
                        s === 'U' ? 'Conflicted' :
        s === 'M' ? 'Modified' :
            s === 'D' ? 'Deleted' : 'Changed';

export const statusClass = (s: string) =>
    s === 'A' ? 'add' :
        s === '?' ? 'untracked' :
            s === 'R' ? 'ren' :
                s === 'C' ? 'cpy' :
                    s === 'T' ? 'type' :
                        s === 'U' ? 'conflict' :
                            s === 'M' ? 'mod' :
                                s === 'D' ? 'del' : 'mod';

// Disable the implicit "select all" mode. When clearImplicit is true, drop the
// auto-filled selection set so later logic only sees explicit user picks.
export function disableDefaultSelectAll(clearImplicit = false): boolean {
    const hadImplicit = state.defaultSelectAll && state.selectionImplicitAll;
    if (clearImplicit && hadImplicit) {
        state.selectedFiles.clear();
    }
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;
    return Boolean(clearImplicit && hadImplicit);
}
