import { qs, qsa, setText } from '../lib/dom';
import { prefs, savePrefs, state, hasRepo, hasChanges } from '../state/state';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';

const workGrid = qs<HTMLElement>('.work');
const resizer  = qs<HTMLElement>('#resizer');

const tabs      = qsa<HTMLButtonElement>('.tab');
const commitBox = qs<HTMLElement>('#commit');
const diffHeadPath = qs<HTMLElement>('#diff-path');

const repoTitleEl  = qs<HTMLElement>('#repo-title');
const repoBranchEl = qs<HTMLElement>('#repo-branch');

export function setTheme(theme: 'dark'|'light'|'system') {
    document.documentElement.setAttribute('data-theme', theme);
    // (optional) mirror into settings select if present
    const sel = document.querySelector<HTMLSelectElement>('#settings-modal #set-theme');
    if (sel) sel.value = theme;
    // Track effective theme in-memory (native settings persist it)
    prefs.theme = theme === 'system'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
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

export function setTab(tab: 'changes'|'history') {
    prefs.tab = tab; savePrefs();
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (commitBox) commitBox.style.display = tab === 'history' ? 'none' : 'grid';
    if (diffHeadPath) setText(diffHeadPath, tab === 'history' ? 'Commit details' : 'Select a file to view changes');
}

export function bindTabs(onChange: (t: 'changes'|'history') => void) {
    tabs.forEach(btn => btn.addEventListener('click', () => onChange((btn.dataset.tab as any) ?? 'changes')));
}

export function initResizer() {
    if (!workGrid || !resizer) return;

    const MIN_LEFT = 220, MIN_RIGHT = 360, GUTTER = 6;

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

    resizer.addEventListener('mousedown', (e) => {
        dragging = true; x0 = (e as MouseEvent).clientX; left0 = leftPx;
        document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const cw = containerW();
        leftPx = clampLeft(left0 + ((e as MouseEvent).clientX - x0), cw);
        applyCols(leftPx);
    });

    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        prefs.leftW = leftPx; savePrefs();
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
    const pushBtn  = qs<HTMLButtonElement>('#push-btn');
    const branchBtn= qs<HTMLButtonElement>('#branch-switch');
    const summary  = qs<HTMLInputElement>('#commit-summary');
    const desc     = qs<HTMLTextAreaElement>('#commit-desc');
    const commit   = qs<HTMLButtonElement>('#commit-btn');

    // Repo-scoped actions
    if (fetchBtn)  fetchBtn.disabled  = !repoOn;
    if (pushBtn)   pushBtn.disabled   = !repoOn;
    if (branchBtn) branchBtn.disabled = !repoOn;

    // Text inputs are ONLY enabled when there are active changes in an open repo
    if (summary) summary.disabled = !(repoOn && changesOn);
    if (desc)    desc.disabled    = !(repoOn && changesOn);

    // Commit button requires: repo + changes + non-empty summary + explicit selection (files or hunks)
    const summaryFilled = (summary?.value.trim().length ?? 0) > 0;
    // Require either selected hunks or selected files (commit UI selection)
    const hunksSelected = Object.keys((state as any).selectedHunksByFile || {})
        .some((k) => Array.isArray((state as any).selectedHunksByFile[k]) && (state as any).selectedHunksByFile[k].length > 0);
    const filesSelected = !!((state as any).selectedFiles && (state as any).selectedFiles.size > 0);
    if (commit)  commit.disabled  = !(repoOn && changesOn && summaryFilled && (hunksSelected || filesSelected));

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
    window.addEventListener('app:status-updated', refreshRepoActions);
    window.addEventListener('app:branches-updated', refreshRepoActions);

    // Summary typing should re-evaluate the commit button state
    qs<HTMLInputElement>('#commit-summary')?.addEventListener('input', refreshRepoActions);

    // First paint
    refreshRepoActions();
}

export function setRepoHeader(pathMaybe?: string) {
    if (repoTitleEl && pathMaybe) {
        const base = String(pathMaybe).replace(/[\\/]+$/, '').split(/[/\\]/).pop() || pathMaybe;
        setText(repoTitleEl, base);
    }
    if (repoBranchEl) setText(repoBranchEl, state.branch || 'No repo open');
}
export function resetRepoHeader() {
    if (repoTitleEl) setText(repoTitleEl, 'Click to open Repo');
    if (repoBranchEl) setText(repoBranchEl, 'No repo open');
}
