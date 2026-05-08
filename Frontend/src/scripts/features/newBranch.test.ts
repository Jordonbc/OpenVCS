// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../ui/modals', () => ({ closeModal: vi.fn() }));
vi.mock('../plugins', () => ({ runHook: vi.fn(async () => ({ cancelled: false })) }));
vi.mock('../state/state', () => ({ state: { branch: 'main', branches: [] } }));

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts the create-branch modal used by the feature wiring. */
function mountNewBranchModal() {
  document.body.innerHTML = `
    <div id="new-branch-modal" aria-hidden="true">
      <input id="new-branch-name" />
      <div id="new-branch-name-hint" hidden></div>
      <select id="new-branch-base"></select>
      <input id="new-branch-checkout" type="checkbox" checked />
      <button id="new-branch-create"></button>
    </div>
  `;
}

/** Installs a mocked Tauri runtime before modules capture it at import time. */
function installTauriMock() {
  (window as any).__TAURI__ = {
    core: {
      invoke: vi.fn(async () => {
        return null;
      }),
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
  mountNewBranchModal();
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('wireNewBranch', () => {
  it('defaults the checkout checkbox to enabled', async () => {
    installTauriMock();

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await flushPromises();

    const checkout = document.getElementById('new-branch-checkout') as HTMLInputElement;
    expect(checkout.checked).toBe(true);
  });

  it('passes the checkout choice to branch creation', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await flushPromises();

    const name = document.getElementById('new-branch-name') as HTMLInputElement;
    const checkout = document.getElementById('new-branch-checkout') as HTMLInputElement;
    const create = document.getElementById('new-branch-create') as HTMLButtonElement;

    name.value = 'feature/test';
    name.dispatchEvent(new Event('input'));
    await flushPromises();
    checkout.checked = false;
    create.disabled = false;
    create.click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('vcs_create_branch', { name: 'feature/test', from: 'main', checkout: false });
  });
});
