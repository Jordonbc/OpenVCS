// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { closeModal, hydrate, openModal } from '../ui/modals';

/** Options that control the shared confirmation modal content. */
export interface ConfirmModalOptions {
  title?: string;
  message: string;
  hint?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

let pendingResolve: ((ok: boolean) => void) | null = null;

/** Returns the shared confirmation modal element if it exists. */
function getModal(): HTMLElement | null {
  return document.getElementById('confirm-modal');
}

/** Resolves and clears any pending confirmation promise. */
function resolvePending(ok: boolean) {
  if (!pendingResolve) return;
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve(ok);
}

/** Wires the shared confirmation modal once. */
export function wireConfirmModal() {
  const modal = getModal();
  if (!modal || (modal as HTMLElement & { __wired?: boolean }).__wired) return;
  (modal as HTMLElement & { __wired?: boolean }).__wired = true;

  const titleEl = modal.querySelector<HTMLElement>('#confirm-modal-title');
  const hintEl = modal.querySelector<HTMLElement>('#confirm-modal-hint');
  const messageEl = modal.querySelector<HTMLElement>('#confirm-modal-message');
  const cancelBtn = modal.querySelector<HTMLButtonElement>('#confirm-modal-cancel-btn');
  const confirmBtn = modal.querySelector<HTMLButtonElement>('#confirm-modal-confirm-btn');

  modal.addEventListener('modal:closed', () => {
    resolvePending(false);
  });

  confirmBtn?.addEventListener('click', () => {
    resolvePending(true);
    closeModal('confirm-modal');
  });

  (modal as HTMLElement & { setContent?: (opts: ConfirmModalOptions) => void }).setContent = (opts) => {
    const title = String(opts.title || 'Confirm action').trim() || 'Confirm action';
    const hint = String(opts.hint || 'This cannot be undone.').trim() || 'This cannot be undone.';
    const confirmLabel = String(opts.confirmLabel || 'Confirm').trim() || 'Confirm';
    const cancelLabel = String(opts.cancelLabel || 'Cancel').trim() || 'Cancel';
    const isDanger = !!opts.danger;

    if (titleEl) titleEl.textContent = title;
    if (hintEl) hintEl.textContent = hint;
    if (messageEl) messageEl.textContent = opts.message;
    if (cancelBtn) cancelBtn.textContent = cancelLabel;
    if (confirmBtn) {
      confirmBtn.textContent = confirmLabel;
      confirmBtn.classList.toggle('danger', isDanger);
      confirmBtn.classList.toggle('primary', !isDanger);
    }
    window.setTimeout(() => cancelBtn?.focus(), 0);
  };
}

/** Opens the shared confirmation modal and resolves with the user's choice. */
export function confirmWithModal(opts: ConfirmModalOptions): Promise<boolean> {
  hydrate('confirm-modal');
  wireConfirmModal();

  const modal = getModal() as (HTMLElement & { setContent?: (opts: ConfirmModalOptions) => void }) | null;
  modal?.setContent?.(opts);

  return new Promise<boolean>((resolve) => {
    const previousResolve = pendingResolve;
    pendingResolve = resolve;
    previousResolve?.(false);
    openModal('confirm-modal');
  });
}
