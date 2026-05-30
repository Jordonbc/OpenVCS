// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfirmWithModal = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock('../features/confirmModal', () => ({
  confirmWithModal: mockConfirmWithModal,
}));

let originalConfirmDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalConfirmDescriptor = Object.getOwnPropertyDescriptor(window, 'confirm');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  mockConfirmWithModal.mockReset();
  mockConfirmWithModal.mockResolvedValue(true);
});

afterEach(() => {
  document.body.innerHTML = '';
  if (originalConfirmDescriptor) {
    Object.defineProperty(window, 'confirm', originalConfirmDescriptor);
    return;
  }
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'confirm');
});

describe('confirmBool', () => {
  it('uses in-app modal when modal root exists', async () => {
    document.body.innerHTML = '<div id="modals-root"></div>';
    mockConfirmWithModal.mockResolvedValue(true);

    const { confirmBool } = await import('./confirm');
    const result = await confirmBool('Discard changes?');

    expect(result).toBe(true);
    expect(mockConfirmWithModal).toHaveBeenCalledWith({
      title: 'Confirm action',
      message: 'Discard changes?',
      hint: 'Review carefully before confirming.',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      danger: true,
    });
  });

  it('returns false when in-app modal confirms false', async () => {
    document.body.innerHTML = '<div id="modals-root"></div>';
    mockConfirmWithModal.mockResolvedValue(false);

    const { confirmBool } = await import('./confirm');
    const result = await confirmBool('Cancel it');

    expect(result).toBe(false);
  });

  it('falls through to window.confirm when confirmWithModal rejects', async () => {
    document.body.innerHTML = '<div id="modals-root"></div>';
    mockConfirmWithModal.mockRejectedValue(new Error('modal error'));
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });

    const { confirmBool } = await import('./confirm');
    const result = await confirmBool('test');

    expect(result).toBe(true);
    expect(window.confirm).toHaveBeenCalledWith('test');
  });

  it('invokes window.confirm when no modal root', async () => {
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

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('Discard changes?')).resolves.toBe(true);
  });

  it('returns false when window.confirm is not a function', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: 'not-a-function' as any,
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('returns false when window.confirm throws', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: () => { throw new TypeError('Illegal invocation'); },
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces boolean true to true', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue(true),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces boolean false to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue(false),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces number zero to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue(0),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces non-zero number to true', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue(1),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces string true to true', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('true'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces string yes to true', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('yes'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces string ok to true', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('ok'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces string false to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('false'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces string no to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('no'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces string cancel to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('cancel'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces empty string to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue(''),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces whitespace string to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('   '),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces unrecognized string to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('unknown_value'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces object with approved key', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ approved: 'yes' }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces object with ok key', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ ok: true }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces object with value key', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ value: 1 }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces object with confirmed key to true', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ confirmed: true }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('coerces object with confirmed key to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ confirmed: false }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces object with result key', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ result: 'ok' }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('returns false for object with no matching keys', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue({ unrelated: 'data' }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('supports promise-based confirm returning object', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockResolvedValue({ confirmed: true }),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });

  it('supports promise-based confirm with async reject', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockRejectedValue(new Error('async fail')),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('coerces null/undefined via object path to false', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue(null),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(false);
  });

  it('returns true when window.confirm returns uppercase TRUE', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true, writable: true,
      value: vi.fn().mockReturnValue('TRUE'),
    });

    const { confirmBool } = await import('./confirm');
    await expect(confirmBool('test')).resolves.toBe(true);
  });
});
