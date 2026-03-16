// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/stashConfirm.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { escapeHtml } from '../lib/dom';
import { state, statusClass, statusLabel } from '../state/state';
import { closeModal, hydrate, openModal } from '../ui/modals';

type StashSuccessHandler = (message: string | undefined) => void | Promise<void>;

let onSuccess: StashSuccessHandler | null = null;
let overridePaths: string[] | null = null;
let includeUntracked = true;

export interface OpenStashOptions {
    defaultMessage?: string;
    onSuccess?: StashSuccessHandler;
    paths?: string[];
    includeUntracked?: boolean;
}

function getModal(): HTMLElement | null {
    return document.getElementById('stash-confirm-modal');
}

function getFiles() {
    const files = Array.isArray(state.files) ? state.files : [];
    if (overridePaths && overridePaths.length) {
        return overridePaths.map((path) => {
            const match = files.find((f) => String(f?.path || '') === path);
            return {
                path,
                status: String(match?.status || ''),
            };
        });
    }
    return files.map((f) => ({
        path: String(f?.path || ''),
        status: String(f?.status || ''),
    }));
}

const friendlyStatus = (code: string) => {
    if (code === '??') return 'Untracked';
    if (code === '!' || code === '!!') return 'Ignored';
    if (code === 'R') return 'Renamed';
    if (code === 'C') return 'Copied';
    return statusLabel(code);
};

export function wireStashConfirm() {
    const modal = getModal();
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

    const messageInput = modal.querySelector<HTMLInputElement>('#stash-message');
    const countEl = modal.querySelector<HTMLSpanElement>('#stash-file-count');
    const listEl = modal.querySelector<HTMLUListElement>('#stash-file-list');
    const emptyEl = modal.querySelector<HTMLElement>('#stash-empty');
    const confirmBtn = modal.querySelector<HTMLButtonElement>('#stash-confirm-btn');

    const resetButton = () => {
        if (confirmBtn) {
            confirmBtn.disabled = getFiles().length === 0;
            confirmBtn.textContent = 'Stash';
        }
    };

    const refreshFiles = () => {
        const files = getFiles();
        if (countEl) {
            countEl.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
        }
        if (!listEl || !emptyEl) return;
        if (!files.length) {
            listEl.innerHTML = '';
            emptyEl.hidden = false;
            if (confirmBtn) confirmBtn.disabled = true;
            return;
        }
        emptyEl.hidden = true;
        listEl.innerHTML = files.map((f) => {
            const cls = f.status === '??' ? 'add' : statusClass(f.status);
            const label = friendlyStatus(f.status);
            return `<li><span class="status ${cls}" title="${escapeHtml(label)}">${escapeHtml(label)}</span><span class="path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span></li>`;
        }).join('');
        if (confirmBtn) confirmBtn.disabled = false;
    };

    const setMessage = (value: string) => {
        if (!messageInput) return;
        messageInput.value = value;
        setTimeout(() => messageInput?.focus(), 0);
    };

    async function runStash() {
        if (!confirmBtn || confirmBtn.disabled) return;
        const files = getFiles();
        if (!files.length) return;
        const message = messageInput?.value.trim() || undefined;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Stashing…';
        try {
            if (!TAURI.has) return;
            const payload: Record<string, unknown> = { message, includeUntracked };
            if (overridePaths && overridePaths.length) payload.paths = overridePaths;
            await TAURI.invoke('git_stash_push', payload);
            notify('Created stash');
            closeModal('stash-confirm-modal');
            if (typeof onSuccess === 'function') {
                await onSuccess(message);
            }
        } catch (e) {
            console.warn('git_stash_push failed', e);
            notify('Failed to create stash');
        } finally {
            resetButton();
        }
    }

    confirmBtn?.addEventListener('click', () => runStash());
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runStash();
        }
    });

    window.addEventListener('app:status-updated', () => refreshFiles());

    (modal as any).refreshFiles = refreshFiles;
    (modal as any).setMessage = setMessage;
    resetButton();
}

export function openStashConfirm(options?: OpenStashOptions) {
    onSuccess = options?.onSuccess ?? null;
    overridePaths = Array.isArray(options?.paths) && options?.paths.length ? options?.paths.slice() : null;
    includeUntracked = options?.includeUntracked ?? true;
    hydrate('stash-confirm-modal');
    wireStashConfirm();

    const modal = getModal() as any;
    if (modal?.setMessage) {
        modal.setMessage(options?.defaultMessage ?? 'WIP');
    }
    if (modal?.refreshFiles) {
        modal.refreshFiles();
    }
    openModal('stash-confirm-modal');
}
