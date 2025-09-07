// src/scripts/features/branches.ts
import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';
import { openModal } from '../ui/modals';
import { renderList } from './repo';

type Branch = { name: string; current?: boolean; kind?: { type?: string; remote?: string } };

const branchBtn    = qs<HTMLButtonElement>('#branch-switch');
const branchName   = qs<HTMLElement>('#branch-name');
const branchPop    = qs<HTMLElement>('#branch-pop');
const branchFilter = qs<HTMLInputElement>('#branch-filter');
const branchList   = qs<HTMLElement>('#branch-list');
const repoBranchEl = qs<HTMLElement>('#repo-branch');

/* ---------------- data load ---------------- */

async function loadBranches() {
    if (!TAURI.has) return;
    try {
        const branches = await TAURI.invoke<Branch[]>('git_list_branches');
        state.branches = Array.isArray(branches) ? branches : [];

        const cur = await TAURI.invoke<string>('git_current_branch').catch(() => state.branch || '');
        state.branch = cur || state.branch || '';

        if (branchName) branchName.textContent = state.branch || '—';
        if (repoBranchEl) repoBranchEl.textContent = state.branch || '—';

        renderBranches();
        setBranchUIEnabled(!!state.branch);
    } catch {
        state.branches = [];
        renderBranches();
        setBranchUIEnabled(false);
    }
}

/* ---------------- render ---------------- */

function renderBranches() {
    if (!branchList) return;
    const q = branchFilter?.value.trim().toLowerCase() || '';
    const items = (state.branches || []).filter(b => !q || b.name.toLowerCase().includes(q));
    branchList.innerHTML = items.map(b => {
        const kindType = b.kind?.type || '';
        const remote   = b.kind?.remote || '';
        let kindLabel = '';
        if (kindType.toLowerCase() === 'local') kindLabel = '<span class="badge kind">Local</span>';
        else if (kindType.toLowerCase() === 'remote') kindLabel = `<span class="badge kind">Remote:${remote || 'remote'}</span>`;
        return `
      <li role="option" data-branch="${b.name}" aria-selected="${b.current ? 'true' : 'false'}">
        <span class="label">
          <span class="branch-dot" aria-hidden="true" style="box-shadow:none;${b.current?'':'opacity:.5'}"></span>
          <span class="name" title="${b.name}">${b.name}</span>
        </span>
        ${b.current ? '<span class="badge">Current</span>' : kindLabel}
      </li>`;
    }).join('');
}

/* ---------------- popover ---------------- */

async function openBranchPopover() {
    if (!branchBtn || !branchPop) return;
    await loadBranches(); // ensure we have fresh data
    const r = branchBtn.getBoundingClientRect();
    branchPop.style.left = `${r.left}px`;
    branchPop.style.top  = `${r.bottom + 6}px`;
    branchPop.hidden = false;
    branchBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => branchFilter?.focus(), 0);
}

function closeBranchPopover() {
    if (!branchPop || !branchBtn || !branchFilter) return;
    branchPop.hidden = true;
    branchBtn.setAttribute('aria-expanded', 'false');
    branchFilter.value = '';
}

/* ---------------- enable/disable ---------------- */

function setBranchUIEnabled(on: boolean) {
    if (!branchBtn) return;
    branchBtn.disabled = !on;
    branchBtn.setAttribute('aria-disabled', on ? 'false' : 'true');
}

/* ---------------- public bind ---------------- */

export function bindBranchUI() {
    branchBtn?.addEventListener('click', (e) => {
        if (branchPop?.hidden) void openBranchPopover(); else closeBranchPopover();
        e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
        if (!branchPop || branchPop.hidden) return;
        if (!branchPop.contains(e.target as Node) && e.target !== branchBtn) closeBranchPopover();
    });

    window.addEventListener('resize', closeBranchPopover);
    branchFilter?.addEventListener('input', renderBranches);

    // Switch branch
    branchList?.addEventListener('click', async (e) => {
        const li = (e.target as HTMLElement).closest('li[data-branch]') as HTMLElement | null;
        if (!li) return;
        const name = li.dataset.branch!;
        try {
            if (TAURI.has) await TAURI.invoke('git_checkout_branch', { name });
            await loadBranches(); // resync from backend instead of manual toggles
            closeBranchPopover();
            notify(`Switched to ${name}`);
            renderList();         // higher-level refresh
        } catch {
            notify('Checkout failed');
        }
    });

    // Create branch (open modal)
    qs<HTMLButtonElement>('#branch-new')?.addEventListener('click', () => {
        closeBranchPopover();
        openModal('new-branch-modal');
    });

    // React when a repo is selected somewhere else (add/clone/open)
    window.addEventListener('app:repo-selected', () => void loadBranches());

    // Initial state
    setBranchUIEnabled(!!state.branch);
}
