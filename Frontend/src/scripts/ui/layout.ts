// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qs, qsa, setText } from '../lib/dom';
import { prefs, savePrefs, state, hasRepo, hasChanges } from '../state/state';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { setAppearanceMode } from '../themes';

const workGrid = qs<HTMLElement>('.work');
const resizer  = qs<HTMLElement>('#resizer');
const SYSTEM_DARK_MQ = matchMedia('(prefers-color-scheme: dark)');
let systemSyncActive = false;
let systemSyncWired = false;

function ensureSystemSyncListener() {
    if (systemSyncWired) return;
    systemSyncWired = true;
    SYSTEM_DARK_MQ.addEventListener('change', () => {
        if (!systemSyncActive) return;
        const root = document.documentElement;
        const effective: 'light' | 'dark' = SYSTEM_DARK_MQ.matches ? 'dark' : 'light';
        root.setAttribute('data-theme', effective);
        prefs.theme = effective;
        setAppearanceMode('system');
    });
}

const tabs      = qsa<HTMLButtonElement>('.tab');
const commitBox = qs<HTMLElement>('#commit');
const diffHeadPath = qs<HTMLElement>('#diff-path');
let tabSwitchAnimTimer: number | null = null;

const repoTitleEl  = qs<HTMLElement>('#repo-title');
const repoBranchEl = qs<HTMLElement>('#repo-branch');
const aheadBehindEl = qs<HTMLElement>('#ahead-behind');

export function setTheme(theme: 'dark'|'light'|'system') {
    const root = document.documentElement;
    ensureSystemSyncListener();
    systemSyncActive = theme === 'system';
    const effective: 'light' | 'dark' = theme === 'system' ? (SYSTEM_DARK_MQ.matches ? 'dark' : 'light') : theme;
    root.setAttribute('data-theme', effective);

    // (optional) mirror into settings controls if present
    const auto = document.querySelector<HTMLInputElement>('#settings-modal #set-theme-auto');
    if (auto) auto.checked = theme === 'system';
    const sel = document.querySelector<HTMLSelectElement>('#settings-modal #set-theme');
    if (sel) sel.disabled = theme === 'system';
    setAppearanceMode(theme);
    // Track effective theme in-memory (native settings persist it)
    prefs.theme = effective;
    savePrefs();
}

export function toggleTheme() {
    const next = (prefs.theme === 'dark' ? 'light' : 'dark');
    // Persist to native settings when available, then apply to UI
    if (TAURI.has) {
        (async () => {
            try {
                const cur = await TAURI.invoke<any>('get_global_settings');
                if (cur && typeof cur === 'object') {
                    cur.general = { ...(cur.general || {}), theme: next };
                    await TAURI.invoke('set_global_settings', { cfg: cur });
                }
            } catch {}
            setTheme(next);
        })();
    } else {
        setTheme(next);
    }
}

export function setTab(tab: 'changes'|'history'|'stash') {
    const prevTab = prefs.tab;
    prefs.tab = tab; savePrefs();
    tabs.forEach((b) => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const hideCommit = (tab === 'history' || tab === 'stash');
    if (commitBox) commitBox.style.display = hideCommit ? 'none' : 'grid';
    if (diffHeadPath) setText(diffHeadPath,
        tab === 'history' ? 'Commit details'
      : tab === 'stash'   ? 'Stash details'
                          : 'Select a file to view changes');
    const historyActionsBtn = qs<HTMLButtonElement>('#history-actions-btn');
    if (historyActionsBtn && tab !== 'history') historyActionsBtn.hidden = true;
    if (prevTab === 'history' && tab !== 'history') {
        (state as any).selectedCommit = null;
    }
    if (tab === 'changes' && prevTab !== 'changes') {
        // Force file diff repaint when leaving history/stash so commit details
        // can't remain in the right pane.
        state.diffDirty = true;
    }
    if (workGrid) {
        if (tabSwitchAnimTimer !== null) {
            window.clearTimeout(tabSwitchAnimTimer);
            tabSwitchAnimTimer = null;
        }
        workGrid.classList.remove('is-tab-switching');
        // Force reflow so repeated switches replay the animation.
        void workGrid.offsetWidth;
        workGrid.classList.add('is-tab-switching');
        tabSwitchAnimTimer = window.setTimeout(() => {
            workGrid?.classList.remove('is-tab-switching');
            tabSwitchAnimTimer = null;
        }, 200);
    }
    window.dispatchEvent(new CustomEvent('app:tab-changed', { detail: tab }));
}

export function bindTabs(onChange: (t: 'changes'|'history'|'stash') => void) {
    tabs.forEach(btn => btn.addEventListener('click', () => onChange((btn.dataset.tab as any) ?? 'changes')));
}

export function initResizer() {
    if (!workGrid || !resizer) return;

    const MIN_LEFT = 320, MIN_RIGHT = 360, GUTTER = 6;

    const clampLeft = (px: number, cw: number) => Math.max(MIN_LEFT, Math.min(Math.max(MIN_LEFT, cw - MIN_RIGHT - GUTTER), px));
    const containerW = () => workGrid.getBoundingClientRect().width || window.innerWidth;

    const initialLeftPx = () => {
        const cw = containerW();
        const px = prefs.leftW && prefs.leftW > 0 ? prefs.leftW : Math.round(cw * 0.32);
        return clampLeft(px, cw);
    };

    const applyCols = (px: number) => workGrid.style.gridTemplateColumns = `${px}px ${GUTTER}px 1fr`;

    let leftPx = initialLeftPx();
    applyCols(leftPx);

    let dragging = false, x0 = 0, left0 = 0;

    const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        const cw = containerW();
        leftPx = clampLeft(left0 + ((e as MouseEvent).clientX - x0), cw);
        applyCols(leftPx);
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        prefs.leftW = leftPx; savePrefs();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
    };

    resizer.addEventListener('mousedown', (e) => {
        dragging = true; x0 = (e as MouseEvent).clientX; left0 = leftPx;
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('blur', onUp);
    });

    window.addEventListener('resize', () => {
        const stacked = window.matchMedia('(max-width: 980px)').matches;
        if (stacked) {
            workGrid.style.gridTemplateColumns = '';
            return;
        }
        const cw = containerW();
        leftPx = clampLeft(leftPx, cw);
        applyCols(leftPx);
    });
}

export function refreshRepoActions() {
    const repoOn       = hasRepo();
    const changesOn    = hasChanges();

    const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
    const fetchCaret = qs<HTMLButtonElement>('#fetch-caret');
    const pushBtn  = qs<HTMLButtonElement>('#push-btn');
    const branchBtn= qs<HTMLButtonElement>('#branch-switch');
    const summary  = qs<HTMLInputElement>('#commit-summary');
    const desc     = qs<HTMLTextAreaElement>('#commit-desc');
    const commit   = qs<HTMLButtonElement>('#commit-btn');
    const undoLeftBtn = qs<HTMLButtonElement>('#undo-left-btn');
    const undoLeftWrap = document.getElementById('left-foot') as HTMLElement | null;

    // Repo-scoped actions
    if (fetchBtn)  fetchBtn.disabled  = !repoOn;
    if (fetchCaret) fetchCaret.disabled = !repoOn;
    if (pushBtn)   pushBtn.disabled   = !repoOn;
    if (branchBtn) branchBtn.disabled = !repoOn;

    // Push highlight + badge when there are unpushed commits
    const ahead = Number((state as any).ahead || 0);
    if (pushBtn) {
        pushBtn.classList.toggle('attention', repoOn && ahead > 0);
        const labelEl = pushBtn.querySelector<HTMLElement>('.btn-label');
        const label = repoOn && ahead > 0
            ? `Push (${ahead})`
            : 'Push';
        pushBtn.title = label;
        pushBtn.setAttribute('aria-label', label);
        if (labelEl) labelEl.textContent = label;
    }

    // Text inputs are ONLY enabled when there are active changes in an open repo
    if (summary) summary.disabled = !(repoOn && changesOn);
    if (desc)    desc.disabled    = !(repoOn && changesOn);

    // Commit button requires: repo + changes + non-empty summary + explicit selection (files, hunks, or per-line)
    const summaryFilled = (summary?.value.trim().length ?? 0) > 0;
    // Require either selected hunks, selected lines, or selected files (commit UI selection)
    const hunksSelected = Object.keys((state as any).selectedHunksByFile || {})
        .some((k) => Array.isArray((state as any).selectedHunksByFile[k]) && (state as any).selectedHunksByFile[k].length > 0);
    const linesSelected = Object.keys((state as any).selectedLinesByFile || {})
        .some((k) => !!(state as any).selectedLinesByFile[k] && Object.keys((state as any).selectedLinesByFile[k] || {}).length > 0);
    const filesSelected = !!((state as any).selectedFiles && (state as any).selectedFiles.size > 0);
    if (commit)  commit.disabled  = !(repoOn && changesOn && summaryFilled && (hunksSelected || linesSelected || filesSelected));

    // Left-panel undo visibility (under files list)
    const showUndo = repoOn && ahead > 0 && prefs.tab === 'changes';
    const stashMode = undoLeftWrap?.dataset.mode === 'stash';
    if (undoLeftWrap) undoLeftWrap.classList.toggle('show', stashMode || showUndo);
    if (undoLeftBtn) (undoLeftBtn as HTMLButtonElement).disabled = !showUndo;

    // Optional hygiene: if changes disappear, clear any stale text so the next enablement starts clean
    if (!changesOn) {
        if (summary && summary.value) summary.value = '';
        if (desc && desc.value) desc.value = '';
    }

    // Visual affordance for the whole box (hidden/disabled when no changes or on History tab)
    if (commitBox) {
        commitBox.classList.toggle('disabled', !(repoOn && changesOn && prefs.tab === 'changes'));
        // if you hide entirely on history tab, you already do that in setTab()
    }
}

export function bindLayoutActionState() {
    // Recompute on repo selection, status refresh, branch changes, and typing (when enabled)
    window.addEventListener('app:repo-selected', refreshRepoActions);
    window.addEventListener('app:status-updated', () => { refreshRepoActions(); renderAheadBehind(); });
    window.addEventListener('app:branches-updated', () => { setRepoHeader(); refreshRepoActions(); renderAheadBehind(); });

    // Summary typing should re-evaluate the commit button state
    qs<HTMLInputElement>('#commit-summary')?.addEventListener('input', refreshRepoActions);

    // First paint
    refreshRepoActions();
    renderAheadBehind();
}

export function setRepoHeader(pathMaybe?: string) {
    if (repoTitleEl && pathMaybe) {
        const base = String(pathMaybe).replace(/[\\/]+$/, '').split(/[/\\]/).pop() || pathMaybe;
        setText(repoTitleEl, base);
    }
    if (repoBranchEl) setText(repoBranchEl, state.branchLabel || state.branch || 'No repo open');
}
export function resetRepoHeader() {
    if (repoTitleEl) setText(repoTitleEl, 'Click to open Repo');
    if (repoBranchEl) setText(repoBranchEl, 'No repo open');
}

/** Update the small ahead/behind badge placed next to the History tab. */
function renderAheadBehind() {
    if (!aheadBehindEl) return;
    const a = Number((state as any).ahead || 0);
    const b = Number((state as any).behind || 0);
    const show = (hasRepo() && (a > 0 || b > 0));
    if (!show) {
        aheadBehindEl.textContent = '';
        aheadBehindEl.setAttribute('hidden', '');
        return;
    }
    aheadBehindEl.textContent = `${a > 0 ? `↑${a}` : ''}${a > 0 && b > 0 ? ' ' : ''}${b > 0 ? `↓${b}` : ''}`;
    aheadBehindEl.removeAttribute('hidden');
}
