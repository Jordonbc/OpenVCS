// src/scripts/features/branches.ts
import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';
import { openModal } from '../ui/modals';
import { openRenameBranch } from './renameBranch';
import { openSetUpstream } from './setUpstream';
import { confirmDeleteBranch } from './deleteBranchConfirm';
import { buildCtxMenu, CtxItem } from '../lib/menu';
import { renderList, hydrateCommits, hydrateStatus } from './repo';
import { setTab } from '../ui/layout';
import type { ConflictDetails, FileStatus } from '../types';
import { openConflictsSummary } from './conflicts';
import { runHook } from '../plugins';

type Branch = { name: string; full_ref?: string; current?: boolean; kind?: { type?: string; remote?: string } };

const branchBtn    = qs<HTMLButtonElement>('#branch-switch');
const branchName   = qs<HTMLElement>('#branch-name');
const branchPop    = qs<HTMLElement>('#branch-pop');
const branchFilter = qs<HTMLInputElement>('#branch-filter');
const branchList   = qs<HTMLElement>('#branch-list');
const repoBranchEl = qs<HTMLElement>('#repo-branch');

function syncBranchLabelsFromState() {
    const label = state.branchLabel || state.branch || '—';
    if (branchName) branchName.textContent = label;
    if (repoBranchEl) repoBranchEl.textContent = label;
    setBranchUIEnabled(!!state.branch);
}

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
        state.branchLabel = label;
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

    const localItems: Branch[] = [];
    const remoteItems: Branch[] = [];
    for (const branch of items) {
        const kindType = (branch.kind?.type || '').toLowerCase();
        const isRemote =
            kindType === 'remote' ||
            String(branch.full_ref || '').startsWith('refs/remotes/') ||
            (branch.name.includes('/') && !String(branch.full_ref || '').startsWith('refs/heads/'));

        if (isRemote) remoteItems.push(branch);
        else localItems.push(branch);
    }

    const renderItem = (b: Branch) => {
        const kindType = b.kind?.type || '';
        const remoteFromName = b.name.includes('/') ? b.name.split('/')[0] : '';
        const remote   = b.kind?.remote || remoteFromName || '';
        let kindLabel = '';
        if (kindType.toLowerCase() === 'local') kindLabel = '<span class="badge kind">Local</span>';
        else if (kindType.toLowerCase() === 'remote') kindLabel = `<span class="badge kind">Remote:${remote || 'remote'}</span>`;
        else if (remote) kindLabel = `<span class="badge kind">Remote:${remote || 'remote'}</span>`;
        return `
      <li role="option" data-branch="${b.name}" aria-selected="${b.current ? 'true' : 'false'}">
        <span class="label">
          <span class="branch-dot" aria-hidden="true" style="box-shadow:none;${b.current?'':'opacity:.5'}"></span>
          <span class="name" title="${b.name}">${b.name}</span>
        </span>
        ${b.current ? '<span class="badge">Current</span>' : kindLabel}
      </li>`;
    };

    const parts: string[] = [];
    parts.push(...localItems.map(renderItem));
    if (localItems.length && remoteItems.length) {
        parts.push(`<li class="pop-divider" role="separator" aria-label="Remote branches"><span>Remote branches</span></li>`);
    }
    parts.push(...remoteItems.map(renderItem));

    branchList.innerHTML = parts.join('');
}

/* ---------------- popover ---------------- */

async function openBranchPopover() {
    if (!branchBtn || !branchPop) return;

    await loadBranches();
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
    async function checkoutBranch(name: string, options: { closePopover?: boolean } = {}) {
        const hookData = { from: state.branch, to: name };
        const pre = await runHook('preSwitchBranch', hookData);
        if (pre.cancelled) {
            notify(pre.reason || 'Checkout cancelled');
            return;
        }
        try {
            if (TAURI.has) await TAURI.invoke('git_checkout_branch', { name });
            await runHook('onSwitchBranch', hookData);
            await loadBranches(); // resync from backend instead of manual toggles
            if (options.closePopover) closeBranchPopover();
            notify(`Switched to ${name}`);
            await renderList();         // higher-level refresh
            await runHook('postSwitchBranch', hookData);
        } catch {
            notify('Checkout failed');
        }
    }

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
        const items: CtxItem[] = [];
        items.push({ label: 'Checkout', action: async () => {
            await checkoutBranch(name);
        }});
        items.push({ label: 'Merge into current…', action: async () => {
            if (name === cur) { notify('Cannot merge a branch into itself'); return; }
            const ok = window.confirm(`Merge '${name}' into '${cur}'?`);
            if (!ok) return;
            try {
                if (TAURI.has) await TAURI.invoke('git_merge_branch', { name });
                notify(`Merged branch '${name}' into '${cur}'`);
                await Promise.allSettled([renderList(), loadBranches()]);
            } catch (e) {
                const msg = String(e || '');
                const looksLikeConflict =
                    /CONFLICT/i.test(msg) ||
                    /Automatic merge failed/i.test(msg) ||
                    /fix conflicts and then commit/i.test(msg);

                if (looksLikeConflict) {
                    notify('Merge conflict detected');
                    await hydrateStatus();
                    setTab('changes');
                    await openConflictsSummary((state.files || []) as FileStatus[]);
                    return;
                }

                notify(`Merge failed${msg ? `: ${msg}` : ''}`);
            }
        }});
        if (kind !== 'remote') {
            items.push({ label: '---' });
            items.push({ label: 'Set upstream…', action: async () => {
                await loadBranches();
                const remoteBranches = (state.branches || [])
                    .filter((br: any) => (br?.kind?.type || '').toLowerCase() === 'remote')
                    .map((br: any) => String(br?.name || '').trim())
                    .filter((s: string) => !!s);

                if (remoteBranches.length === 0) {
                    notify('No remote branches found (fetch first)');
                    return;
                }

                openSetUpstream(name, remoteBranches);
            }});
            items.push({ label: 'Rename…', action: () => openRenameBranch(name) });
            items.push({ label: wantForce ? 'Force delete…' : 'Delete…', action: async () => {
                if (name === cur) { notify('Cannot delete the current branch'); return; }
                const ok = await confirmDeleteBranch({ name, force: wantForce });
                if (!ok) { notify('Delete cancelled'); return; }
                try {
                    const hookData = { name, force: wantForce, branch: state.branch };
                    const pre = await runHook('preBranchDelete', hookData);
                    if (pre.cancelled) {
                        notify(pre.reason || 'Delete cancelled');
                        return;
                    }
                    if (TAURI.has) await TAURI.invoke('git_delete_branch', { name, force: wantForce });
                    await runHook('onBranchDelete', hookData);
                    notify(`${wantForce ? 'Force-deleted' : 'Deleted'} '${name}'`);
                    await loadBranches();
                    await runHook('postBranchDelete', hookData);
                } catch (e) {
                    const msg = String(e || '');
                    if (wantForce) { notify(`Force delete failed${msg ? `: ${msg}` : ''}`); return; }
                    // If not fully merged, offer force delete as a fallback
                    const ok2 = await confirmDeleteBranch({
                        name,
                        force: true,
                        message: `Delete failed${msg ? `: ${msg}` : ''}. You can force delete to remove it anyway.`,
                        hint: "Force delete cannot be undone.",
                    });
                    if (!ok2) { notify('Delete cancelled'); return; }
                    try {
                        const hookData = { name, force: true, branch: state.branch };
                        const pre = await runHook('preBranchDelete', hookData);
                        if (pre.cancelled) {
                            notify(pre.reason || 'Delete cancelled');
                            return;
                        }
                        if (TAURI.has) await TAURI.invoke('git_delete_branch', { name, force: true });
                        await runHook('onBranchDelete', hookData);
                        notify(`Force-deleted '${name}'`);
                        await loadBranches();
                        await runHook('postBranchDelete', hookData);
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
        await checkoutBranch(name, { closePopover: true });
    });

    // Create branch (open modal)
    qs<HTMLButtonElement>('#branch-new')?.addEventListener('click', () => {
        closeBranchPopover();
        openModal('new-branch-modal');
        const modal = document.getElementById('new-branch-modal') as HTMLElement | null;
        const nameInput = modal?.querySelector<HTMLInputElement>('#new-branch-name') || null;
        if (nameInput) {
            nameInput.value = '';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(() => nameInput.focus(), 0);
        }
    });

    // React when a repo is selected somewhere else (add/clone/open)
    window.addEventListener('app:repo-selected', () => void loadBranches());
    window.addEventListener('app:branches-updated', syncBranchLabelsFromState);

    // Initial state
    syncBranchLabelsFromState();
}
