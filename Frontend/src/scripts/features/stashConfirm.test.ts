// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  files: [] as Array<{ path: string; status: string }>,
}));

vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../ui/modals', () => ({
  closeModal: vi.fn(),
  hydrate: vi.fn(),
  openModal: vi.fn(),
}));
vi.mock('../state/state', () => ({
  state,
  statusClass: vi.fn((code: string) => `status-${code || 'none'}`),
  statusLabel: vi.fn((code: string) => `label-${code}`),
}));

/** Mounts the stash confirmation modal used by the feature wiring. */
function mountStashConfirmModal() {
  document.body.innerHTML = `
    <div id="stash-confirm-modal">
      <input id="stash-message" />
      <span id="stash-file-count"></span>
      <ul id="stash-file-list"></ul>
      <div id="stash-empty" hidden></div>
      <button id="stash-confirm-btn"></button>
    </div>
  `;
}

/** Installs a mocked Tauri runtime before module import. */
function installTauriMock() {
  (window as any).__TAURI__ = {
    core: {
      invoke: vi.fn(async () => null),
    },
    event: { listen: vi.fn() },
  };
}

/** Waits for queued promise work from feature initialization. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  mountStashConfirmModal();
  installTauriMock();
  state.files = [
    { path: 'a.txt', status: '??' },
    { path: 'b.txt', status: 'M' },
  ];
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('openStashConfirm', () => {
  it('passes override paths through to stash payload', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;

    const { openStashConfirm } = await import('./stashConfirm');
    openStashConfirm({ defaultMessage: 'Keep work', paths: ['a.txt'], includeUntracked: false });

    const countEl = document.getElementById('stash-file-count') as HTMLElement;
    const confirmBtn = document.getElementById('stash-confirm-btn') as HTMLButtonElement;

    expect(countEl.textContent).toBe('1 file');
    expect(confirmBtn.disabled).toBe(false);

    confirmBtn.click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('vcs_stash_push', {
      includeUntracked: false,
      message: 'Keep work',
      paths: ['a.txt'],
    });
  });

  it('sends default stash payload when no paths override exists', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;

    const { openStashConfirm } = await import('./stashConfirm');
    openStashConfirm();

    const countEl = document.getElementById('stash-file-count') as HTMLElement;
    const confirmBtn = document.getElementById('stash-confirm-btn') as HTMLButtonElement;

    expect(countEl.textContent).toBe('2 files');
    expect(confirmBtn.disabled).toBe(false);

    confirmBtn.click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('vcs_stash_push', {
      includeUntracked: true,
      message: 'WIP',
    });
  });

  it('calls onSuccess handler after stash is created', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;
    const onSuccess = vi.fn();

    const { openStashConfirm } = await import('./stashConfirm');
    openStashConfirm({ defaultMessage: 'Test', onSuccess });

    const confirmBtn = document.getElementById('stash-confirm-btn') as HTMLButtonElement;
    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(onSuccess).toHaveBeenCalledWith('Test');
  });

  it('handles stash failure gracefully', async () => {
    const invoke = vi.fn(async () => { throw new Error('stash failed'); });
    (window as any).__TAURI__.core.invoke = invoke;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { openStashConfirm } = await import('./stashConfirm');
    openStashConfirm();

    const confirmBtn = document.getElementById('stash-confirm-btn') as HTMLButtonElement;
    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Button should be re-enabled
    expect(confirmBtn.disabled).toBe(false);
    expect(confirmBtn.textContent).toBe('Stash');
  });
});

describe('wireStashConfirm', () => {
  it('wires modal only once', async () => {
    const { wireStashConfirm, openStashConfirm } = await import('./stashConfirm');
    const modal = document.getElementById('stash-confirm-modal') as any;
    wireStashConfirm();
    wireStashConfirm();
    expect(modal.__wired).toBe(true);
  });

  it('sets message and focuses input', async () => {
    const { wireStashConfirm } = await import('./stashConfirm');
    wireStashConfirm();
    const modal = document.getElementById('stash-confirm-modal') as any;
    modal.setMessage('Custom message');
    const input = document.getElementById('stash-message') as HTMLInputElement;
    expect(input.value).toBe('Custom message');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(input);
  });

  it('refreshes files and updates counts', async () => {
    const { wireStashConfirm } = await import('./stashConfirm');
    wireStashConfirm();
    const modal = document.getElementById('stash-confirm-modal') as any;
    modal.refreshFiles();
    const countEl = document.getElementById('stash-file-count') as HTMLElement;
    expect(countEl.textContent).toBe('2 files');
  });
});

describe('wireStashConfirm keyboard handlers', () => {
  it('triggers stash on Enter key in message input', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const { wireStashConfirm } = await import('./stashConfirm');
    wireStashConfirm();

    const msgInput = document.getElementById('stash-message') as HTMLInputElement;
    msgInput.value = 'test stash';
    msgInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(invoke).toHaveBeenCalledWith('vcs_stash_push', expect.objectContaining({ message: 'test stash' }));
  });
});

describe('app:status-updated event', () => {
  it('refreshes files list on status update', async () => {
    const { wireStashConfirm } = await import('./stashConfirm');
    wireStashConfirm();

    // Change the underlying files
    const { state } = await import('../state/state');
    state.files = [{ path: 'c.txt', status: 'A' }];

    window.dispatchEvent(new Event('app:status-updated'));

    const countEl = document.getElementById('stash-file-count') as HTMLElement;
    expect(countEl.textContent).toBe('1 file');
  });
});

describe('refreshFiles integration', () => {
  it('shows empty state when no files are available', async () => {
    const { wireStashConfirm } = await import('./stashConfirm');
    wireStashConfirm();
    const { state } = await import('../state/state');
    state.files = [];

    const modal = document.getElementById('stash-confirm-modal') as any;
    modal.refreshFiles();

    const emptyEl = document.getElementById('stash-empty') as HTMLElement;
    expect(emptyEl.hidden).toBe(false);
    const confirmBtn = document.getElementById('stash-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('shows single file count for one file', async () => {
    const { wireStashConfirm } = await import('./stashConfirm');
    wireStashConfirm();
    const { state } = await import('../state/state');
    state.files = [{ path: 'only.txt', status: 'M' }];

    const modal = document.getElementById('stash-confirm-modal') as any;
    modal.refreshFiles();

    const countEl = document.getElementById('stash-file-count') as HTMLElement;
    expect(countEl.textContent).toBe('1 file');
  });
});
