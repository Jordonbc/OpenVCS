// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { hydrate, openModal } from '../ui/modals';

let wired = false;

/** Returns the error modal element if present. */
function getModal(): HTMLElement | null {
  return document.getElementById('error-modal');
}

/** Wires the error modal event handlers once. */
function wireErrorModal() {
  if (wired) return;
  const modal = getModal();
  if (!modal) return;
  wired = true;

  // Dismiss buttons (OK button + backdrop close via data-close) already work
  // through the shared click handler in modals.ts. No additional wiring needed.
}

/**
 * Opens an error dialog modal with the given title and message.
 *
 * @param title - Short headline shown in the modal header.
 * @param message - Error details displayed in the body.
 */
export function showError(title: string, message: string): void {
  hydrate('error-modal');
  wireErrorModal();

  const modal = getModal();
  if (!modal) return;

  const titleEl = modal.querySelector('#error-modal-title');
  const msgEl = modal.querySelector('#error-modal-message');

  if (titleEl) titleEl.textContent = String(title || 'Error').trim() || 'Error';
  if (msgEl) msgEl.textContent = String(message || '').trim();

  openModal('error-modal');
}
