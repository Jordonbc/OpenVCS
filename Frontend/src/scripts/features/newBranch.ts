// src/scripts/features/newBranch.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { state } from "../state/state";
import { closeModal } from "../ui/modals";

function fixBranchName(raw: string): string {
    // Keep the user's input intact; only normalize for creation.
    // Currently: trim and replace whitespace runs with dashes.
    return (raw || '').trim().replace(/\s+/g, '-');
}

function validateBranchName(name: string): string | null {
    // Minimal Git-ish refname validation (frontend-side guardrail).
    if (!name) return 'Branch name cannot be empty';
    if (/[\0-\x20\x7f]/.test(name)) return 'Branch name cannot contain spaces or control characters';
    if (/[~^:?*\[\\]/.test(name)) return 'Branch name contains invalid characters';
    if (name.startsWith('/') || name.endsWith('/')) return 'Branch name cannot start or end with /';
    if (name.includes('..')) return 'Branch name cannot contain ".."';
    if (name.includes('@{')) return 'Branch name cannot contain "@{"';
    if (name.includes('//')) return 'Branch name cannot contain "//"';
    if (name.endsWith('.')) return 'Branch name cannot end with "."';
    if (name.endsWith('.lock')) return 'Branch name cannot end with ".lock"';
    if (name.includes('/.') || name.includes('.//') || name.includes('\\')) return 'Branch name contains invalid segments';
    return null;
}

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
    const nameHint   = modal.querySelector<HTMLElement>('#new-branch-name-hint');
    const baseSelect = modal.querySelector<HTMLSelectElement>('#new-branch-base');
    const checkoutEl = modal.querySelector<HTMLInputElement>('#new-branch-checkout');
    const createBtn  = modal.querySelector<HTMLButtonElement>('#new-branch-create');

    populateBaseSelect(modal);
    // Refresh base list when repo/branches refresh
    window.addEventListener('app:repo-selected', () => populateBaseSelect(modal));

    function validate() {
        const raw = nameInput?.value || '';
        const hasAny = raw.length > 0;
        const fixed = fixBranchName(raw);
        const err = validateBranchName(fixed);
        const rawTrim = raw.trim();

        if (nameHint) {
            if (!hasAny) {
                nameHint.hidden = true;
                nameHint.textContent = '';
                nameHint.classList.remove('error');
            } else if (hasAny && !rawTrim) {
                nameHint.hidden = false;
                nameHint.classList.add('error');
                nameHint.textContent = 'Branch name cannot be empty';
            } else if (err) {
                nameHint.hidden = false;
                nameHint.classList.add('error');
                nameHint.textContent = err;
            } else if (fixed !== rawTrim || raw !== rawTrim) {
                nameHint.hidden = false;
                nameHint.classList.remove('error');
                nameHint.innerHTML = `Will be created as <code>${fixed}</code>`;
            } else {
                nameHint.hidden = true;
                nameHint.textContent = '';
                nameHint.classList.remove('error');
            }
        }

        const ok = !err && !!fixed;
        if (createBtn) createBtn.disabled = !ok;
    }
    nameInput?.addEventListener('input', validate);
    setTimeout(validate, 0);

    async function createBranch() {
        const name = fixBranchName(nameInput?.value || '');
        const from = baseSelect?.value || state.branch || '';
        const checkout = !!checkoutEl?.checked;
        const err = validateBranchName(name);
        if (err) { validate(); return; }
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
