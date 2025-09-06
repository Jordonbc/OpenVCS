import { qs, qsa, setText } from '../lib/dom';
import { prefs, savePrefs, state, hasRepo, hasChanges } from '../state/state';
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
    prefs.theme = theme === 'system'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    savePrefs();
}

export function toggleTheme() {
    setTheme(prefs.theme === 'dark' ? 'light' : 'dark');
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
    const repo = hasRepo();
    const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
    const pushBtn  = qs<HTMLButtonElement>('#push-btn');
    const branchBtn= qs<HTMLButtonElement>('#branch-switch');
    const summary  = qs<HTMLInputElement>('#commit-summary');
    const desc     = qs<HTMLTextAreaElement>('#commit-desc');
    const commit   = qs<HTMLButtonElement>('#commit-btn');

    if (fetchBtn) fetchBtn.disabled  = !repo;
    if (pushBtn)  pushBtn.disabled   = !repo;
    if (branchBtn)branchBtn.disabled = !repo;

    const summaryFilled = !!summary?.value.trim();
    if (summary) summary.disabled = !repo || !hasChanges();
    if (desc)    desc.disabled    = !repo;
    if (commit)  commit.disabled  = !repo || !hasChanges() || !summaryFilled;

    if (commitBox) commitBox.classList.toggle('disabled', !repo || !hasChanges());
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
