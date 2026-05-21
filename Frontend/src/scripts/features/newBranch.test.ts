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

  it('shows normalized branch name when spaces collapse to dashes', async () => {
    installTauriMock();

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await flushPromises();

    const name = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    const create = document.getElementById('new-branch-create') as HTMLButtonElement;

    name.value = '  feature  branch  ';
    name.dispatchEvent(new Event('input'));
    await flushPromises();

    expect(hint.hidden).toBe(false);
    expect(hint.classList.contains('error')).toBe(false);
    expect(hint.textContent).toContain('Will be created as');
    expect(hint.querySelector('code')?.textContent).toBe('feature-branch');
    expect(create.disabled).toBe(false);
  });

  it('rejects branch names with invalid characters', async () => {
    installTauriMock();

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await flushPromises();

    const name = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    const create = document.getElementById('new-branch-create') as HTMLButtonElement;

    name.value = 'bad~branch';
    name.dispatchEvent(new Event('input'));
    await flushPromises();

    expect(hint.hidden).toBe(false);
    expect(hint.classList.contains('error')).toBe(true);
    expect(hint.textContent).toBe('Branch name contains invalid characters');
    expect(create.disabled).toBe(true);
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

describe('wireNewBranch - additional', () => {
  it('reflects normalized names in the hint during validation', async () => {
    function installTauriMockLocal() {
      (window as any).__TAURI__ = {
        core: { invoke: vi.fn(async () => null) },
        event: { listen: vi.fn() },
      };
    }
    installTauriMockLocal();

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await new Promise((r) => setTimeout(r, 0));

    const name = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    const create = document.getElementById('new-branch-create') as HTMLButtonElement;

    // Whitespace-heavy name triggers normalization hint
    name.value = '  my  branch  ';
    name.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('Will be created as');

    // Empty after trim - shows error
    name.value = '   ';
    name.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.hidden).toBe(false);
    expect(hint.classList.contains('error')).toBe(true);
    expect(create.disabled).toBe(true);

    // Valid name hides hint
    name.value = 'valid-branch';
    name.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.hidden).toBe(true);
    expect(create.disabled).toBe(false);
  });

  it('handles modal:opened event', async () => {
    function installTauriMockLocal() {
      (window as any).__TAURI__ = {
        core: { invoke: vi.fn(async () => null) },
        event: { listen: vi.fn() },
      };
    }
    installTauriMockLocal();

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();

    const modal = document.getElementById('new-branch-modal') as HTMLElement;
    modal.dispatchEvent(new Event('modal:opened'));
    await new Promise((r) => setTimeout(r, 0));

    const checkout = document.getElementById('new-branch-checkout') as HTMLInputElement;
    expect(checkout.checked).toBe(true);
  });

  it('creates branch on Enter key in name input', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();

    const name = document.getElementById('new-branch-name') as HTMLInputElement;
    const create = document.getElementById('new-branch-create') as HTMLButtonElement;

    name.value = 'my-branch';
    name.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));

    create.disabled = false;
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(invoke).toHaveBeenCalledWith('vcs_create_branch', expect.objectContaining({ name: 'my-branch' }));
  });
});

// ---------------------------------------------------------------------------
// validateBranchName - edge cases
// ---------------------------------------------------------------------------

describe('validateBranchName', () => {
  it('rejects names with control characters', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'bad\x00branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('cannot contain spaces or control characters');
  });

  it('rejects names with tilde', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'bad~branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('invalid characters');
  });

  it('rejects names starting with /', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = '/branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('start or end with /');
  });

  it('rejects names ending with /', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'branch/';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('start or end with /');
  });

  it('rejects names with ..', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'bad..branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('..');
  });

  it('rejects names with @{', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'bad@{branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('@{');
  });

  it('rejects names with //', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'bad//branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('//');
  });

  it('rejects names ending with .', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'branch.';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('end with "."');
  });

  it('rejects names ending with .lock', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'branch.lock';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('.lock');
  });

  it('rejects names with /./', async () => {
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const hint = document.getElementById('new-branch-name-hint') as HTMLElement;
    nameInput.value = 'bad/./path';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hint.textContent).toContain('invalid segments');
  });
});

// ---------------------------------------------------------------------------
// createBranch - error handling
// ---------------------------------------------------------------------------

describe('createBranch error handling', () => {
  it('handles create branch failure', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async () => { throw new Error('create failed'); }) },
      event: { listen: vi.fn() },
    };
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await new Promise((r) => setTimeout(r, 0));

    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const createBtn = document.getElementById('new-branch-create') as HTMLButtonElement;
    nameInput.value = 'my-branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    createBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const { notify } = await import('../lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Create branch failed');
  });
});

// ---------------------------------------------------------------------------
// createBranch - hook cancellation
// ---------------------------------------------------------------------------

describe('createBranch hook cancellation', () => {
  it('cancels when preBranchCreate hook returns cancelled', async () => {
    const { runHook } = await import('../plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: true, reason: 'Cancelled by hook' });

    (window as any).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn() },
    };
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await new Promise((r) => setTimeout(r, 0));

    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const createBtn = document.getElementById('new-branch-create') as HTMLButtonElement;
    nameInput.value = 'my-branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    createBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const { notify } = await import('../lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Cancelled by hook');
  });

  it('cancels when preSwitchBranch hook returns cancelled', async () => {
    const { runHook } = await import('../plugins');
    vi.mocked(runHook)
      .mockResolvedValueOnce({ cancelled: false })  // preBranchCreate
      .mockResolvedValueOnce({ cancelled: true, reason: 'Switch blocked' });  // preSwitchBranch

    (window as any).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn() },
    };
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();
    await new Promise((r) => setTimeout(r, 0));

    const nameInput = document.getElementById('new-branch-name') as HTMLInputElement;
    const checkout = document.getElementById('new-branch-checkout') as HTMLInputElement;
    const createBtn = document.getElementById('new-branch-create') as HTMLButtonElement;
    checkout.checked = true;
    nameInput.value = 'my-branch';
    nameInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    createBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const { notify } = await import('../lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Switch blocked');
  });
});

// ---------------------------------------------------------------------------
// populateBaseSelect with branches
// ---------------------------------------------------------------------------

describe('populateBaseSelect', () => {
  it('populates base select with branches from state', async () => {
    // Set up state with branches before import
    const stateModule = await import('../state/state');
    (stateModule.state as any).branch = 'main';
    (stateModule.state as any).branches = [
      { name: 'main', current: true, kind: { type: 'local' } },
      { name: 'develop', current: false, kind: { type: 'local' } },
      { name: 'origin/main', current: false, kind: { type: 'remote', remote: 'origin' } },
    ];

    installTauriMock();
    const { wireNewBranch } = await import('./newBranch');
    wireNewBranch();

    const select = document.getElementById('new-branch-base') as HTMLSelectElement;
    expect(select.options.length).toBe(3);
    // Current branch first
    expect(select.options[0].textContent).toBe('main');
    expect(select.options[0].selected).toBe(true);
    // Remote should show origin/name
    expect(select.options[2].textContent).toBe('origin/main');
  });
});
