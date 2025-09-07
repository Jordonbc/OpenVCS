// src/state/state.ts
import type { AppPrefs, Branch, CommitItem, FileStatus } from '../types';

const PREFS_KEY = 'ovcs.prefs.v1';

function safeParse<T>(s: string | null, fallback: T): T {
    try { return JSON.parse(s ?? '') as T; } catch { return fallback; }
}

export const defaultPrefs: AppPrefs = {
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    leftW: 0,
    tab: 'changes',
};

export let prefs: AppPrefs = {
    ...defaultPrefs,
    ...safeParse<AppPrefs>(localStorage.getItem(PREFS_KEY), {} as any),
};
export function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export const state = {
    hasRepo: false,                 // backend truth (set after open/clone/add)
    branch: '' as string,           // current branch name
    branches: [] as Branch[],       // list of branches
    files: [] as FileStatus[],      // working tree status
    commits: [] as CommitItem[],    // recent commits
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
        s === 'M' ? 'Modified' :
            s === 'D' ? 'Deleted' : 'Changed';

export const statusClass = (s: string) =>
    s === 'A' ? 'add' :
        s === 'M' ? 'mod' :
            s === 'D' ? 'del' : 'mod';
