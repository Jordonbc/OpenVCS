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
});
