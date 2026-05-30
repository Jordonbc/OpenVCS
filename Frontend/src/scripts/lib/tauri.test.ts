// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Clears any mocked Tauri runtime before each import. */
beforeEach(() => {
  vi.resetModules();
  delete (window as any).__TAURI__;
});

/** Restores the DOM and mocks after each test. */
afterEach(() => {
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

/** Imports tauri module after runtime stubbing is configured. */
async function loadTauriModule() {
  return import('./tauri');
}

describe('isTauriRuntimeAvailable', () => {
  it('returns false without runtime', async () => {
    const { isTauriRuntimeAvailable } = await loadTauriModule();

    expect(isTauriRuntimeAvailable()).toBe(false);
  });
});

describe('TAURI.invoke', () => {
  it('rejects without runtime', async () => {
    const { TAURI } = await loadTauriModule();

    await expect(TAURI.invoke('test-command')).rejects.toThrow('Failed to initialize Tauri runtime.');
  });
});

describe('TAURI.listen', () => {
  it('rejects without runtime', async () => {
    const { TAURI } = await loadTauriModule();

    await expect(TAURI.listen('test-event', vi.fn())).rejects.toThrow('Failed to initialize Tauri runtime.');
  });
});

describe('assertDesktopRuntime', () => {
  it('throws without runtime', async () => {
    const { assertDesktopRuntime } = await loadTauriModule();

    expect(() => assertDesktopRuntime()).toThrow('Failed to initialize Tauri runtime.');
  });

  it('throws when only core is available but event is missing', async () => {
    (window as any).__TAURI__ = { core: { invoke: vi.fn() } };
    const { assertDesktopRuntime } = await loadTauriModule();
    expect(() => assertDesktopRuntime()).toThrow('Failed to initialize Tauri runtime.');
  });

  it('throws when only event is available but core is missing', async () => {
    (window as any).__TAURI__ = { event: { listen: vi.fn() } };
    const { assertDesktopRuntime } = await loadTauriModule();
    expect(() => assertDesktopRuntime()).toThrow('Failed to initialize Tauri runtime.');
  });

  it('does not throw when full runtime is available', async () => {
    (window as any).__TAURI__ = { core: { invoke: vi.fn() }, event: { listen: vi.fn() } };
    const { assertDesktopRuntime } = await loadTauriModule();
    expect(() => assertDesktopRuntime()).not.toThrow();
  });
});
