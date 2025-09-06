import type { AppPrefs, Branch, CommitItem, FileStatus } from '../types';

const PREFS_KEY = 'ovcs.prefs.v1';

function safeParse<T>(s: string | null, fallback: T): T {
    try { return JSON.parse(s ?? '') as T; } catch { return fallback; }
}

export const defaultPrefs: AppPrefs = {
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    leftW: 0,
    tab: 'changes'
};

export let prefs: AppPrefs = { ...defaultPrefs, ...safeParse<AppPrefs>(localStorage.getItem(PREFS_KEY), {} as any) };
export function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }

export const state = {
    hasRepo: false,
    branch: '',
    branches: [] as Branch[],
    files: [] as FileStatus[],
    commits: [] as CommitItem[]
};

export const hasRepo = () => !!state.hasRepo && !!state.branch;
export const hasChanges = () => Array.isArray(state.files) && state.files.length > 0;

export const statusLabel = (s: string) => s === 'A' ? 'Added' : s === 'M' ? 'Modified' : s === 'D' ? 'Deleted' : 'Changed';
export const statusClass = (s: string) => s === 'A' ? 'add' : s === 'M' ? 'mod' : s === 'D' ? 'del' : 'mod';
