// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/conflicts.ts
import { TAURI } from '../lib/tauri';
import { confirmBool } from '../lib/confirm';
import { notify } from '../lib/notify';
import { hydrate, openModal, closeModal } from '../ui/modals';
import { hydrateStatus } from './repo';
import type { FileStatus, ConflictDetails, GlobalSettings } from '../types';
import { isConflictStatus } from '../state/state';
import { ModalController } from '../lib/modalController';

let currentConflict: { path: string; details: ConflictDetails } | null = null;
let autoOpenedConflictSignature = '';

const externalToolState = {
    loaded: false,
    enabled: false,
};

function setPreText(root: HTMLElement, selector: string, value?: string | null) {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.textContent = value ?? '';
}

/** Per-open state for the merge modal. */
export interface MergeModalState {
    file: FileStatus;
    details: ConflictDetails;
}

/** Owns the merge modal lifecycle: wires once, fills conflict content per open. */
export const mergeController = new ModalController<MergeModalState>('merge-modal', {
    wire: (modal) => {
        const applyBtn = modal.querySelector<HTMLButtonElement>('#merge-apply');
        applyBtn?.addEventListener('click', async () => {
            if (!currentConflict) { notify('No conflict selected.'); return; }
            const textarea = modal.querySelector<HTMLTextAreaElement>('#merge-result');
            const content = textarea?.value ?? '';
            const path = currentConflict.path;
            try {
                await TAURI.invoke('vcs_save_merge_result', { path, content });
                notify('Saved merge result');
                closeModal('merge-modal');
                await Promise.allSettled([hydrateStatus()]);
            } catch (err) {
                console.error(err);
                notify('Failed to save merge result');
            }
        });
    },
    apply: (state, modal) => {
        currentConflict = { path: state.file.path, details: state.details };

        const pathLabel = modal.querySelector<HTMLElement>('#merge-path');
        if (pathLabel) pathLabel.textContent = state.file.path || '(unknown file)';

        const base = state.details.base ?? '';
        const ours = state.details.ours ?? '';
        const theirs = state.details.theirs ?? '';
        setPreText(modal, '#merge-base', base);
        setPreText(modal, '#merge-ours', ours);
        setPreText(modal, '#merge-theirs', theirs);

        const textarea = modal.querySelector<HTMLTextAreaElement>('#merge-result');
        if (textarea) {
            textarea.value = ours || theirs || base || '';
        }
    },
});

/** Opens the merge modal for the given conflicted file. */
export async function openMergeModal(file: FileStatus, details: ConflictDetails): Promise<void> {
    mergeController.open({ file, details });
}

/** Owns the conflicts-summary modal lifecycle: wires once, renders files per open. */
export const conflictsSummaryController = new ModalController<FileStatus[]>('conflicts-summary-modal', {
    wire: (modal) => {
        const abortBtn = modal.querySelector<HTMLButtonElement>('#conflicts-abort');
        const contBtn = modal.querySelector<HTMLButtonElement>('#conflicts-continue');

        abortBtn?.addEventListener('click', async () => {
            const ok = await confirmBool('Abort the merge? This will discard merge progress.');
            if (!ok) return;
            try {
                await TAURI.invoke('vcs_merge_abort');
                notify('Merge aborted');
                closeModal('conflicts-summary-modal');
                await hydrateStatus();
            } catch (e) {
                notify(`Abort failed: ${String(e || '')}`);
            }
        });

        contBtn?.addEventListener('click', async () => {
            try {
                await TAURI.invoke('vcs_merge_continue');
                notify('Merge committed');
                closeModal('conflicts-summary-modal');
                await hydrateStatus();
            } catch (e) {
                notify(`Commit merge failed: ${String(e || '')}`);
            }
        });
    },
    apply: async (files, modal) => {
        const listEl = modal.querySelector<HTMLElement>('#conflicts-summary-list');
        const countEl = modal.querySelector<HTMLElement>('#conflicts-summary-count');
        const subEl = modal.querySelector<HTMLElement>('#conflicts-summary-subtitle');
        const abortBtn = modal.querySelector<HTMLButtonElement>('#conflicts-abort');
        const contBtn = modal.querySelector<HTMLButtonElement>('#conflicts-continue');

        const conflicted = (Array.isArray(files) ? files : [])
            .filter((f) => isConflictStatus(f?.status) && !!f?.path);

        const ctx = await TAURI.invoke<{ in_progress: boolean }>('vcs_merge_context').catch(() => ({ in_progress: false }));
        const inMerge = !!ctx?.in_progress;

        if (subEl) subEl.textContent = inMerge ? 'Resolve conflicts before committing the merge' : 'Resolve conflicts in your working tree';
        if (countEl) countEl.textContent = `${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'}`;

        if (abortBtn) abortBtn.hidden = !inMerge;
        if (contBtn) contBtn.hidden = !inMerge;

        const canUseExternal = await hasExternalMergeTool().catch(() => false);

        if (listEl) {
            listEl.innerHTML = '';
            for (const f of conflicted) {
                const row = document.createElement('div');
                row.className = 'row';
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.gap = '12px';
                row.style.padding = '10px 8px';

                const left = document.createElement('div');
                const name = document.createElement('div');
                name.textContent = f.path;
                name.style.fontWeight = '600';
                name.style.wordBreak = 'break-all';
                const meta = document.createElement('div');
                meta.textContent = 'Conflicted';
                meta.style.opacity = '0.75';
                meta.style.fontSize = '12px';
                left.appendChild(name);
                left.appendChild(meta);

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.gap = '8px';

                const resolveBtn = document.createElement('button');
                resolveBtn.className = 'btn';
                resolveBtn.textContent = 'Resolve…';
                resolveBtn.addEventListener('click', async () => {
                    try {
                        const details = await TAURI.invoke<ConflictDetails>('vcs_conflict_details', { path: f.path });
                        await openMergeModal(f, details);
                    } catch (e) {
                        notify(`Failed to open conflict: ${String(e || '')}`);
                    }
                });

                const toolBtn = document.createElement('button');
                toolBtn.className = 'btn';
                toolBtn.textContent = 'Open tool';
                toolBtn.disabled = !canUseExternal;
                toolBtn.addEventListener('click', async () => {
                    try {
                        if (!canUseExternal) {
                            notify('No custom merge tool configured');
                            return;
                        }
                        await launchExternalMergeTool(f.path);
                    } catch (e) {
                        notify(`Failed to open tool: ${String(e || '')}`);
                    }
                });

                actions.appendChild(resolveBtn);
                actions.appendChild(toolBtn);

                row.appendChild(left);
                row.appendChild(actions);
                listEl.appendChild(row);
            }
        }
    },
});

/** Opens the conflicts-summary modal listing the given conflicted files. */
export async function openConflictsSummary(files: FileStatus[]): Promise<void> {
    hydrate('conflicts-summary-modal');
    conflictsSummaryController.initOnce();
    await conflictsSummaryController.applyState(files);
    openModal('conflicts-summary-modal');
}

export async function autoOpenFirstConflict(files: FileStatus[]): Promise<void> {
    if (!Array.isArray(files) || files.length === 0) return;

    const conflictedPaths = files
        .filter((f) => isConflictStatus(f?.status) && !!f?.path)
        .map((f) => String(f.path))
        .sort();
    const conflicted = conflictedPaths[0];
    if (!conflicted) {
        autoOpenedConflictSignature = '';
        return;
    }
    const signature = conflictedPaths.join('\n');

    if (signature === autoOpenedConflictSignature) return;

    const modal = document.getElementById('merge-modal') as HTMLElement | null;
    if (modal && modal.getAttribute('aria-hidden') === 'false') return;

    try {
        autoOpenedConflictSignature = signature;
        await openConflictsSummary(files);
    } catch (err) {
        console.error(err);
    }
}

async function ensureExternalMergeConfig() {
    if (externalToolState.loaded) return;
    try {
        const cfg = await TAURI.invoke<GlobalSettings>('get_global_settings');
        const tool = cfg?.diff?.external_merge;
        externalToolState.enabled = !!(tool && tool.enabled && (tool.path || '').trim().length > 0);
    } catch (err) {
        console.error('Failed to load merge tool config', err);
        externalToolState.enabled = false;
    } finally {
        externalToolState.loaded = true;
    }
}

export async function hasExternalMergeTool(): Promise<boolean> {
    await ensureExternalMergeConfig();
    return externalToolState.enabled;
}

export async function launchExternalMergeTool(path: string): Promise<void> {
    if (!(await hasExternalMergeTool())) {
        notify('No custom merge tool configured');
        return;
    }
    try {
        await TAURI.invoke('vcs_launch_merge_tool', { path });
        notify('Opened custom merge tool');
    } catch (err) {
        console.error(err);
        notify('Failed to open merge tool');
    }
}
