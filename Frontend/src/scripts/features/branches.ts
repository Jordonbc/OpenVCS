// src/scripts/features/branches.ts
import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';
import { openModal } from '../ui/modals';
import { buildCtxMenu } from '../lib/menu';
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

        const head = await TAURI.invoke<{ detached: boolean; branch?: string; commit?: string }>('git_head_status');
        if (head?.branch) state.branch = head.branch;
        const short = (head?.commit || '').slice(0, 7);
        const label = head?.detached ? `Detached HEAD ${short ? '(' + short + ')' : ''}` : (state.branch || '—');
        if (branchName) branchName.textContent = label;
        if (repoBranchEl) repoBranchEl.textContent = label;

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

    // Context menu on branch list entries
    branchList?.addEventListener('contextmenu', async (ev) => {
        const e = ev as MouseEvent;
        const li = (e.target as HTMLElement).closest('li[data-branch]') as HTMLElement | null;
        if (!li) return;
        e.preventDefault();
        const name = li.dataset.branch || '';
        if (!name) return;
        await loadBranches();
        const x = e.clientX, y = e.clientY;
        const cur = state.branch || '';
        const b = (state.branches || []).find(br => br.name === name) as Branch | undefined;
        const kind = b?.kind?.type?.toLowerCase() || 'local';
        const wantForce = Boolean(e.shiftKey);
        const items: { label: string; action: () => void }[] = [];
        items.push({ label: 'Checkout', action: async () => {
            try { if (TAURI.has) await TAURI.invoke('git_checkout_branch', { name }); await loadBranches(); notify(`Switched to ${name}`); renderList(); }
            catch { notify('Checkout failed'); }
        }});
        items.push({ label: 'Merge into current…', action: async () => {
            if (name === cur) { notify('Cannot merge a branch into itself'); return; }
            const ok = window.confirm(`Merge '${name}' into '${cur}'?`);
            if (!ok) return;
            try { if (TAURI.has) await TAURI.invoke('git_merge_branch', { name }); notify(`Merged '${name}' into '${cur}'`); await Promise.allSettled([renderList(), loadBranches()]); }
            catch { notify('Merge failed'); }
        }});
        if (kind !== 'remote') {
            items.push({ label: '---', action: () => {} });
            items.push({ label: wantForce ? 'Force delete…' : 'Delete…', action: async () => {
                if (name === cur) { notify('Cannot delete the current branch'); return; }
                const ok = window.confirm(`${wantForce ? 'Force delete' : 'Delete'} local branch '${name}'? This cannot be undone.`);
                if (!ok) return;
                try {
                    if (TAURI.has) await TAURI.invoke('git_delete_branch', { name, force: wantForce });
                    notify(`${wantForce ? 'Force-deleted' : 'Deleted'} '${name}'`);
                    await loadBranches();
                } catch (e) {
                    const msg = String(e || '');
                    if (wantForce) { notify(`Force delete failed${msg ? `: ${msg}` : ''}`); return; }
                    // If not fully merged, offer force delete as a fallback
                    const ok2 = window.confirm(`Delete failed${msg ? `: ${msg}` : ''}.\n\nForce delete '${name}' anyway? This cannot be undone.`);
                    if (!ok2) { notify('Delete cancelled'); return; }
                    try {
                        if (TAURI.has) await TAURI.invoke('git_delete_branch', { name, force: true });
                        notify(`Force-deleted '${name}'`);
                        await loadBranches();
                    } catch { notify('Force delete failed'); }
                }
            }});
        }
        buildCtxMenu(items, x, y);
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
