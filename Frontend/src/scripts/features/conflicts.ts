// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { hydrate, openModal, closeModal } from '../ui/modals';
import { hydrateStatus } from './repo';
import type { FileStatus, ConflictDetails, GlobalSettings } from '../types';

let mergeModalWired = false;
let currentConflict: { path: string; details: ConflictDetails } | null = null;
let summaryModalWired = false;
let autoOpenedPaths: Set<string> = new Set();

const externalToolState = {
    loaded: false,
    enabled: false,
};

async function ensureMergeModal() {
    hydrate('merge-modal');
    if (mergeModalWired) return;
    const modal = document.getElementById('merge-modal') as HTMLElement | null;
    if (!modal) return;

    const applyBtn = modal.querySelector<HTMLButtonElement>('#merge-apply');
    applyBtn?.addEventListener('click', async () => {
        if (!TAURI.has) { notify('Saving merges requires the desktop app.'); return; }
        if (!currentConflict) { notify('No conflict selected.'); return; }
        const textarea = modal.querySelector<HTMLTextAreaElement>('#merge-result');
        const content = textarea?.value ?? '';
        const path = currentConflict.path;
        try {
            await TAURI.invoke('git_save_merge_result', { path, content });
            notify('Saved merge result');
            closeModal('merge-modal');
            await Promise.allSettled([hydrateStatus()]);
        } catch (err) {
            console.error(err);
            notify('Failed to save merge result');
        }
    });

    mergeModalWired = true;
}

function setPreText(root: HTMLElement, selector: string, value?: string | null) {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.textContent = value ?? '';
}

export async function openMergeModal(file: FileStatus, details: ConflictDetails) {
    await ensureMergeModal();
    const modal = document.getElementById('merge-modal') as HTMLElement | null;
    if (!modal) return;

    currentConflict = { path: file.path, details };

    const pathLabel = modal.querySelector<HTMLElement>('#merge-path');
    if (pathLabel) pathLabel.textContent = file.path || '(unknown file)';

    const base = details.base ?? '';
    const ours = details.ours ?? '';
    const theirs = details.theirs ?? '';
    setPreText(modal, '#merge-base', base);
    setPreText(modal, '#merge-ours', ours);
    setPreText(modal, '#merge-theirs', theirs);

    const textarea = modal.querySelector<HTMLTextAreaElement>('#merge-result');
    if (textarea) {
        textarea.value = ours || theirs || base || '';
    }

    openModal('merge-modal');
}

async function ensureSummaryModal() {
    hydrate('conflicts-summary-modal');
    if (summaryModalWired) return;
    const modal = document.getElementById('conflicts-summary-modal') as HTMLElement | null;
    if (!modal) return;

    const abortBtn = modal.querySelector<HTMLButtonElement>('#conflicts-abort');
    const contBtn = modal.querySelector<HTMLButtonElement>('#conflicts-continue');

    abortBtn?.addEventListener('click', async () => {
        if (!TAURI.has) return;
        const ok = window.confirm('Abort the merge? This will discard merge progress.');
        if (!ok) return;
        try {
            await TAURI.invoke('git_merge_abort');
            notify('Merge aborted');
            closeModal('conflicts-summary-modal');
            await hydrateStatus();
        } catch (e) {
            notify(`Abort failed: ${String(e || '')}`);
        }
    });

    contBtn?.addEventListener('click', async () => {
        if (!TAURI.has) return;
        try {
            await TAURI.invoke('git_merge_continue');
            notify('Merge committed');
            closeModal('conflicts-summary-modal');
            await hydrateStatus();
        } catch (e) {
            notify(`Commit merge failed: ${String(e || '')}`);
        }
    });

    summaryModalWired = true;
}

export async function openConflictsSummary(files: FileStatus[]): Promise<void> {
    if (!TAURI.has) return;
    await ensureSummaryModal();
    const modal = document.getElementById('conflicts-summary-modal') as HTMLElement | null;
    if (!modal) return;

    const listEl = modal.querySelector<HTMLElement>('#conflicts-summary-list');
    const countEl = modal.querySelector<HTMLElement>('#conflicts-summary-count');
    const subEl = modal.querySelector<HTMLElement>('#conflicts-summary-subtitle');
    const abortBtn = modal.querySelector<HTMLButtonElement>('#conflicts-abort');
    const contBtn = modal.querySelector<HTMLButtonElement>('#conflicts-continue');

    const conflicted = (Array.isArray(files) ? files : [])
        .filter((f) => String(f?.status || '').toUpperCase() === 'U' && !!f?.path);

    const ctx = await TAURI.invoke<{ in_progress: boolean }>('git_merge_context').catch(() => ({ in_progress: false }));
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
                    const details = await TAURI.invoke<ConflictDetails>('git_conflict_details', { path: f.path });
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

    openModal('conflicts-summary-modal');
}

export async function autoOpenFirstConflict(files: FileStatus[]): Promise<void> {
    if (!TAURI.has) return;
    if (!Array.isArray(files) || files.length === 0) return;

    const conflicted = files.find((f) => String(f?.status || '').toUpperCase() === 'U' && !!f?.path);
    if (!conflicted?.path) {
        autoOpenedPaths = new Set();
        return;
    }

    if (autoOpenedPaths.has(conflicted.path)) return;

    const modal = document.getElementById('merge-modal') as HTMLElement | null;
    if (modal && modal.getAttribute('aria-hidden') === 'false') return;

    try {
        autoOpenedPaths.add(conflicted.path);
        await openConflictsSummary(files);
    } catch (err) {
        console.error(err);
    }
}

async function ensureExternalMergeConfig() {
    if (externalToolState.loaded || !TAURI.has) return;
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
    if (!TAURI.has) return false;
    await ensureExternalMergeConfig();
    return externalToolState.enabled;
}

export async function launchExternalMergeTool(path: string): Promise<void> {
    if (!TAURI.has) { notify('Launching merge tools requires the desktop app.'); return; }
    if (!(await hasExternalMergeTool())) {
        notify('No custom merge tool configured');
        return;
    }
    try {
        await TAURI.invoke('git_launch_merge_tool', { path });
        notify('Opened custom merge tool');
    } catch (err) {
        console.error(err);
        notify('Failed to open merge tool');
    }
}
