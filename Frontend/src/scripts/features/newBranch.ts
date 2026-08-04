// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/newBranch.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { state } from "../state/state";
import { closeModal } from "../ui/modals";
import { runHook } from "../plugins";
import { ModalController } from "../lib/modalController";

function fixBranchName(raw: string): string {
    // Keep the user's input intact; only trim for creation.
    // Whitespace and control characters are rejected by validation.
    return (raw || '').trim();
}

function validateBranchName(name: string): string | null {
    // VCS-neutral refname validation (frontend-side guardrail). No VCS-specific
    // characters are restricted here, so the same rules apply across version
    // control systems; VCS-specific constraints stay with the plugins.
    if (!name.trim()) return 'Branch name cannot be empty';
    if (/\s/.test(name) || /[\0-\x1f\x7f]/.test(name)) return 'Branch name cannot contain whitespace or control characters';
    if (name.startsWith('-')) return 'Branch name cannot start with "-"';
    if (name.length > 255) return 'Branch name cannot exceed 255 characters';
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

    sel.replaceChildren();
    for (const b of all) {
        const isRemote = (b.kind?.type || '').toLowerCase() === 'remote';
        const label = isRemote && b.kind?.remote ? `${b.kind.remote}/${b.name.split('/').pop() || b.name}` : b.name;
        const value = b.name; // backend expects the ref name we already use elsewhere

        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        opt.selected = value === curName;
        sel.appendChild(opt);
    }
}

/** Applies the default checkout choice to the create-branch form. */
function loadCheckoutDefault(modal: HTMLElement) {
    const checkoutEl = modal.querySelector<HTMLInputElement>('#new-branch-checkout');
    if (!checkoutEl) return;
    checkoutEl.checked = true;
}

/** Owns the new-branch modal lifecycle: wires event handlers once. */
export const newBranchController = new ModalController<void>("new-branch-modal", {
    wire: (modal) => {

    const nameInput  = modal.querySelector<HTMLInputElement>('#new-branch-name');
    const nameHint   = modal.querySelector<HTMLElement>('#new-branch-name-hint');
    const baseSelect = modal.querySelector<HTMLSelectElement>('#new-branch-base');
    const checkoutEl = modal.querySelector<HTMLInputElement>('#new-branch-checkout');
    const createBtn  = modal.querySelector<HTMLButtonElement>('#new-branch-create');

    populateBaseSelect(modal);
    void loadCheckoutDefault(modal);
    modal.addEventListener('modal:opened', () => { void loadCheckoutDefault(modal); });
    // Refresh base list when repo/branches refresh
    window.addEventListener('app:repo-selected', () => populateBaseSelect(modal));

    function validate() {
        const raw = nameInput?.value || '';
        const hasAny = raw.length > 0;
        const fixed = fixBranchName(raw);
        const err = validateBranchName(raw);
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
        const raw = nameInput?.value || '';
        const name = fixBranchName(raw);
        const from = baseSelect?.value || state.branch || '';
        const checkout = !!checkoutEl?.checked;
        const err = validateBranchName(raw);
        if (err) { validate(); return; }
        try {
            const hookData = { name, from, checkout, branch: state.branch };
            const preCreate = await runHook('preBranchCreate', hookData);
            if (preCreate.cancelled) {
                notify(preCreate.reason || 'Create branch cancelled');
                return;
            }
            if (checkout) {
                const preSwitch = await runHook('preSwitchBranch', { from: state.branch, to: name });
                if (preSwitch.cancelled) {
                    notify(preSwitch.reason || 'Create branch cancelled');
                    return;
                }
            }
            await TAURI.invoke('vcs_create_branch', { name, from, checkout });
            await runHook('onBranchCreate', hookData);
            if (checkout) {
                await runHook('onSwitchBranch', { from: state.branch, to: name });
            }
            notify(`Created branch ${name}`);
            // Ask the rest of the app to refresh branch UI
            window.dispatchEvent(new CustomEvent('app:repo-selected'));
            closeModal('new-branch-modal');
            await runHook('postBranchCreate', hookData);
            if (checkout) {
                await runHook('postSwitchBranch', { from: state.branch, to: name });
            }
        } catch {
            notify('Create branch failed');
        }
    }

    createBtn?.addEventListener('click', createBranch);
    nameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); createBranch(); }
    });
    },
});

/** Wires the new-branch modal once. No-op after the first call. */
export function wireNewBranch(): void {
    newBranchController.initOnce();
}
