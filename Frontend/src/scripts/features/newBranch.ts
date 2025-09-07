// src/scripts/features/newBranch.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { state } from "../state/state";
import { closeModal } from "../ui/modals";

function populateBaseSelect(modal: HTMLElement) {
    const sel = modal.querySelector<HTMLSelectElement>("#new-branch-base");
    if (!sel) return;
    const branches = Array.isArray(state.branches) ? state.branches.slice() : [];
    // Order: current first, then other locals, then remotes
    const current = branches.filter(b => b.current);
    const locals  = branches.filter(b => !b.current && (b.kind?.type || '').toLowerCase() === 'local');
    const remotes = branches.filter(b => (b.kind?.type || '').toLowerCase() === 'remote');
    const all = [...current, ...locals, ...remotes];

    const curName = state.branch || current[0]?.name || '';
    sel.innerHTML = all.map(b => {
        const isRemote = (b.kind?.type || '').toLowerCase() === 'remote';
        const label = isRemote && b.kind?.remote ? `${b.kind.remote}/${b.name.split('/').pop() || b.name}` : b.name;
        const value = b.name; // backend expects the ref name we already use elsewhere
        const selected = value === curName ? ' selected' : '';
        return `<option value="${value}"${selected}>${label}</option>`;
    }).join("");
}

export function wireNewBranch() {
    const modal = document.getElementById('new-branch-modal') as HTMLElement | null;
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

    const nameInput  = modal.querySelector<HTMLInputElement>('#new-branch-name');
    const baseSelect = modal.querySelector<HTMLSelectElement>('#new-branch-base');
    const checkoutEl = modal.querySelector<HTMLInputElement>('#new-branch-checkout');
    const createBtn  = modal.querySelector<HTMLButtonElement>('#new-branch-create');

    populateBaseSelect(modal);
    // Refresh base list when repo/branches refresh
    window.addEventListener('app:repo-selected', () => populateBaseSelect(modal));

    function validate() {
        const ok = !!(nameInput?.value.trim());
        if (createBtn) createBtn.disabled = !ok;
    }
    nameInput?.addEventListener('input', validate);
    setTimeout(validate, 0);

    async function createBranch() {
        const name = nameInput?.value.trim() || '';
        const from = baseSelect?.value || state.branch || '';
        const checkout = !!checkoutEl?.checked;
        if (!name) return;
        try {
            if (TAURI.has) await TAURI.invoke('git_create_branch', { name, from, checkout });
            notify(`Created branch ${name}`);
            // Ask the rest of the app to refresh branch UI
            window.dispatchEvent(new CustomEvent('app:repo-selected'));
            closeModal('new-branch-modal');
        } catch {
            notify('Create branch failed');
        }
    }

    createBtn?.addEventListener('click', createBranch);
    nameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); createBranch(); }
    });
}

