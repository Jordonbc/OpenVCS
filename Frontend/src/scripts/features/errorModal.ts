// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/errorModal.ts
import { ModalController } from '../lib/modalController';

/** Per-open state for the error dialog modal. */
export interface ErrorModalState {
  title: string;
  message: string;
}

/** Owns the error modal lifecycle: wires once, fills the message per open. */
export const errorModalController = new ModalController<ErrorModalState>('error-modal', {
  wire: () => {
    // Dismiss buttons (OK button + backdrop close via data-close) already work
    // through the shared click handler in modals.ts. No additional wiring needed.
  },
  apply: (state, modal) => {
    const titleEl = modal.querySelector('#error-modal-title');
    const msgEl = modal.querySelector('#error-modal-message');

    if (titleEl) titleEl.textContent = String(state.title || 'Error').trim() || 'Error';
    if (msgEl) msgEl.textContent = String(state.message || '').trim();
  },
});

/**
 * Opens an error dialog modal with the given title and message.
 *
 * @param title - Short headline shown in the modal header.
 * @param message - Error details displayed in the body.
 */
export function showError(title: string, message: string): void {
  errorModalController.open({ title, message });
}
