// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { confirmWithModal } from '../features/confirmModal';

/**
 * Attempts to coerce arbitrary confirm-return payloads into a boolean.
 *
 * @param value - Value returned by a confirm implementation.
 * @returns A normalized confirmation decision.
 */
function coerceConfirmResult(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'true' || normalized === 'yes' || normalized === 'ok') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === 'cancel') return false;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidates = ['approved', 'ok', 'value', 'confirmed', 'result'];
    for (const key of candidates) {
      if (key in record) return coerceConfirmResult(record[key]);
    }
  }
  return false;
}

/**
 * Shows a confirmation prompt and returns a normalized boolean result.
 *
 * Prefers the shared in-app confirmation modal when the modal host is mounted,
 * then falls back to browser `window.confirm` for runtimes that do not render
 * the main modal shell.
 *
 * @param message - Prompt text shown to the user.
 * @returns `true` when the user confirms; otherwise `false`.
 */
export async function confirmBool(message: string): Promise<boolean> {
  const modalRoot = document.getElementById('modals-root');
  if (modalRoot) {
    try {
      return await confirmWithModal({
        title: 'Confirm action',
        message,
        hint: 'Review carefully before confirming.',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        danger: true,
      });
    } catch {
      // Fall through to browser confirm when modal rendering is unavailable.
    }
  }

  const confirmFn = (window as any).confirm;
  if (typeof confirmFn !== 'function') return false;

  try {
    const maybe = Reflect.apply(confirmFn, window, [message]) as unknown;
    if (maybe && typeof (maybe as PromiseLike<unknown>).then === 'function') {
      const resolved = await (maybe as PromiseLike<unknown>);
      return coerceConfirmResult(resolved);
    }
    return coerceConfirmResult(maybe);
  } catch {
    return false;
  }
}
