// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/stashConfirm.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { escapeHtml } from '../lib/dom';
import { state, statusClass, statusLabel } from '../state/state';
import { closeModal } from '../ui/modals';
import { ModalController } from '../lib/modalController';

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

/** Renders the pending file list and count into the modal. */
function refreshFiles(modal: HTMLElement): void {
  const countEl = modal.querySelector<HTMLSpanElement>('#stash-file-count');
  const listEl = modal.querySelector<HTMLUListElement>('#stash-file-list');
  const emptyEl = modal.querySelector<HTMLElement>('#stash-empty');
  const confirmBtn = modal.querySelector<HTMLButtonElement>('#stash-confirm-btn');
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
}

/** Sets the stash message input and focuses it. */
function setMessage(modal: HTMLElement, value: string): void {
  const messageInput = modal.querySelector<HTMLInputElement>('#stash-message');
  if (!messageInput) return;
  messageInput.value = value;
  setTimeout(() => messageInput?.focus(), 0);
}

/** Runs the stash push using the current modal state. */
async function runStash(modal: HTMLElement): Promise<void> {
  const confirmBtn = modal.querySelector<HTMLButtonElement>('#stash-confirm-btn');
  const messageInput = modal.querySelector<HTMLInputElement>('#stash-message');
  if (!confirmBtn || confirmBtn.disabled) return;
  const files = getFiles();
  if (!files.length) return;
  const message = messageInput?.value.trim() || undefined;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Stashing…';
  try {
    const payload: Record<string, unknown> = { message, includeUntracked };
    if (overridePaths && overridePaths.length) payload.paths = overridePaths;
    await TAURI.invoke('vcs_stash_push', payload);
    notify('Created stash');
    closeModal('stash-confirm-modal');
    if (typeof onSuccess === 'function') {
      await onSuccess(message);
    }
  } catch (e) {
    console.warn('vcs_stash_push failed', e);
    notify('Failed to create stash');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = getFiles().length === 0;
      confirmBtn.textContent = 'Stash';
    }
  }
}

/** Owns the stash-confirm modal lifecycle: wires once, applies options per open. */
export const stashController = new ModalController<OpenStashOptions>('stash-confirm-modal', {
  wire: (modal) => {
    const messageInput = modal.querySelector<HTMLInputElement>('#stash-message');
    const confirmBtn = modal.querySelector<HTMLButtonElement>('#stash-confirm-btn');

    confirmBtn?.addEventListener('click', () => void runStash(modal));
    messageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void runStash(modal);
      }
    });

    window.addEventListener('app:status-updated', () => refreshFiles(modal));
    if (confirmBtn) {
      confirmBtn.disabled = getFiles().length === 0;
      confirmBtn.textContent = 'Stash';
    }
  },
  apply: (options, modal) => {
    onSuccess = options.onSuccess ?? null;
    overridePaths = Array.isArray(options.paths) && options.paths.length ? options.paths.slice() : null;
    includeUntracked = options.includeUntracked ?? true;
    setMessage(modal, options.defaultMessage ?? 'WIP');
    refreshFiles(modal);
  },
});

/** Wires the stash-confirm modal once. No-op after the first call. */
export function wireStashConfirm(): void {
  stashController.initOnce();
}

/** Opens the stash-confirm modal with the given options. */
export function openStashConfirm(options?: OpenStashOptions): void {
  stashController.open(options ?? {});
}
