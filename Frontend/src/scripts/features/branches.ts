import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';
import { renderList } from './repo';

const branchBtn    = qs<HTMLButtonElement>('#branch-switch');
const branchName   = qs<HTMLElement>('#branch-name');
const branchPop    = qs<HTMLElement>('#branch-pop');
const branchFilter = qs<HTMLInputElement>('#branch-filter');
const branchList   = qs<HTMLElement>('#branch-list');
const repoBranchEl = qs<HTMLElement>('#repo-branch');

function renderBranches() {
    if (!branchList) return;
    const q = branchFilter?.value.trim().toLowerCase() || '';
    const items = (state.branches || []).filter(b => !q || b.name.toLowerCase().includes(q));
    branchList.innerHTML = items.map(b => {
        const kindType = b.kind?.type || '';
        const remote    = b.kind?.remote || '';
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

function openBranchPopover() {
    if (!branchBtn || !branchPop) return;
    renderBranches();
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

export function bindBranchUI() {
    branchBtn?.addEventListener('click', (e) => {
        if (branchPop?.hidden) openBranchPopover(); else closeBranchPopover();
        e.stopPropagation();
    });
    document.addEventListener('click', (e) => {
        if (!branchPop || branchPop.hidden) return;
        if (!branchPop.contains(e.target as Node) && e.target !== branchBtn) closeBranchPopover();
    });
    window.addEventListener('resize', closeBranchPopover);
    branchFilter?.addEventListener('input', renderBranches);

    branchList?.addEventListener('click', async (e) => {
        const li = (e.target as HTMLElement).closest('li[data-branch]') as HTMLElement | null;
        if (!li) return;
        const name = li.dataset.branch!;
        try {
            if (TAURI.has) await TAURI.invoke('git_checkout_branch', { name });
            state.branches.forEach(b => (b.current = (b.name === name)));
            state.branch = name;
            if (branchName) branchName.textContent = name;
            if (repoBranchEl) repoBranchEl.textContent = name;
            renderBranches();
            closeBranchPopover();
            notify(`Switched to ${name}`);
            // Diff/list refresh done at higher layer
            renderList();
        } catch { notify('Checkout failed'); }
    });

    qs<HTMLButtonElement>('#branch-new')?.addEventListener('click', async () => {
        const base = (state.branches.find(b => b.current) || { name: '' }).name || '';
        const name = prompt(`New branch name (from ${base})`) || '';
        if (!name) return;
        try {
            if (TAURI.has) await TAURI.invoke('git_create_branch', { name, from: base, checkout: true });
            state.branches.forEach(b => (b.current = false));
            state.branches.unshift({ name, current: true });
            state.branch = name;
            if (branchName) branchName.textContent = name;
            if (repoBranchEl) repoBranchEl.textContent = name;
            renderBranches();
            closeBranchPopover();
            notify(`Created branch ${name}`);
        } catch { notify('Create branch failed'); }
    });
}
