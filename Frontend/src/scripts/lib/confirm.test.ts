// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmBool } from './confirm';

let originalConfirmDescriptor: PropertyDescriptor | undefined;

/** Snapshots the current global confirm descriptor before each test. */
beforeEach(() => {
  originalConfirmDescriptor = Object.getOwnPropertyDescriptor(window, 'confirm');
});

/** Restores the original global confirm implementation after each test. */
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  if (originalConfirmDescriptor) {
    Object.defineProperty(window, 'confirm', originalConfirmDescriptor);
    return;
  }
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'confirm');
});

describe('confirmBool', () => {
  it('uses the in-app modal when the modal root exists', async () => {
    document.body.innerHTML = '<div id="modals-root"></div>';

    const pending = confirmBool('Discard changes?');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn') as HTMLButtonElement | null;

    expect(document.getElementById('confirm-modal')?.getAttribute('aria-hidden')).toBe('false');
    expect(confirmBtn?.textContent).toBe('Confirm');
    confirmBtn?.click();

    await expect(pending).resolves.toBe(true);
  });

  it('invokes window.confirm with the window receiver', async () => {
    document.body.innerHTML = '';
    const confirmSpy = vi.fn(function (this: Window, message: string) {
      expect(this).toBe(window);
      expect(message).toBe('Discard changes?');
      return true;
    });

    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: confirmSpy,
    });

    await expect(confirmBool('Discard changes?')).resolves.toBe(true);
  });

  it('supports promise-based confirm implementations', async () => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue({ confirmed: true }),
    });

    await expect(confirmBool('Discard changes?')).resolves.toBe(true);
  });

  it('returns false when confirm throws', async () => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: () => {
        throw new TypeError('Illegal invocation');
      },
    });

    await expect(confirmBool('Discard changes?')).resolves.toBe(false);
  });

  it('coerces numeric confirm results', async () => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(0),
    });

    await expect(confirmBool('Discard changes?')).resolves.toBe(false);
  });

  it('coerces object confirm results via result field', async () => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({ result: 'ok' }),
    });

    await expect(confirmBool('Discard changes?')).resolves.toBe(true);
  });
});
