// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('@scripts/ui/modals', () => ({
  closeModal: vi.fn(),
  hydrate: vi.fn(),
  openModal: vi.fn(),
}));

function mountRenameBranchModal() {
  document.body.innerHTML = `
    <div id="rename-branch-modal">
      <input id="rename-branch-current" />
      <input id="rename-branch-name" />
      <button id="rename-branch-confirm"></button>
    </div>
  `;
}

function installTauriMock() {
  (window as any).__TAURI__ = {
    core: { invoke: vi.fn(async () => null) },
    event: { listen: vi.fn() },
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  mountRenameBranchModal();
  installTauriMock();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('wireRenameBranch', () => {
  it('wires once and skips on second call', async () => {
    const { wireRenameBranch, renameBranchController } = await import('@scripts/features/renameBranch');
    expect(renameBranchController.isWired).toBe(false);
    wireRenameBranch();
    expect(renameBranchController.isWired).toBe(true);
    wireRenameBranch();
    expect(renameBranchController.isWired).toBe(true);
  });

  it('does nothing when modal is missing', async () => {
    document.body.innerHTML = '';
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    expect(() => wireRenameBranch()).not.toThrow();
  });

  it('validate disables confirm when name is empty', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'main';
    nameEl.value = '';
    nameEl.dispatchEvent(new Event('input'));

    expect(confirm.disabled).toBe(true);
  });

  it('validate disables confirm when name is unchanged', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'main';
    nameEl.value = 'main';
    nameEl.dispatchEvent(new Event('input'));

    expect(confirm.disabled).toBe(true);
  });

  it('validate enables confirm when name is valid and different', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'main';
    nameEl.value = 'new-name';
    nameEl.dispatchEvent(new Event('input'));

    expect(confirm.disabled).toBe(false);
  });

  it('Enter key triggers confirm click', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;
    const clickSpy = vi.spyOn(confirm, 'click');

    nameEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('Enter key preventDefault on non-Enter keys', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const nameEl = document.getElementById('rename-branch-name') as HTMLInputElement;
    const event = new KeyboardEvent('keydown', { key: 'Tab' });
    const defaultPrevented = event.defaultPrevented;

    nameEl.dispatchEvent(event);
    expect(defaultPrevented).toBe(false);
  });

  it('confirm click invokes vcs_rename_branch and refreshes', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;
    const { notify } = await import('@scripts/lib/notify');
    const { closeModal } = await import('@scripts/ui/modals');

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'old-name';
    nameEl.value = 'new-name';
    confirm.click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('vcs_rename_branch', {
      old_name: 'old-name',
      new_name: 'new-name',
    });
    expect(notify).toHaveBeenCalledWith("Renamed 'old-name' → 'new-name'");
    expect(closeModal).toHaveBeenCalledWith('rename-branch-modal');
  });

  it('confirm click returns early when oldName or newName missing', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;

    // Missing oldName
    delete modal.dataset.oldBranch;
    confirm.click();
    await flushPromises();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('confirm click returns early when newName equals oldName', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'same';
    nameEl.value = 'same';
    confirm.click();
    await flushPromises();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('confirm click handles error from invoke', async () => {
    const invoke = vi.fn(async () => { throw new Error('permission denied'); });
    (window as any).__TAURI__.core.invoke = invoke;
    const { notify } = await import('@scripts/lib/notify');

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'old-name';
    nameEl.value = 'new-name';
    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Rename failed: Error: permission denied');
  });

  it('confirm click dispatches app:repo-selected event', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__.core.invoke = invoke;

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'old-name';
    nameEl.value = 'new-name';
    confirm.click();
    await flushPromises();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'app:repo-selected' }),
    );
  });
});

describe('setInitial', () => {
  it('sets old branch name and fills inputs', async () => {
    const { renameBranchController } = await import('@scripts/features/renameBranch');
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const currentEl = document.getElementById('rename-branch-current') as HTMLInputElement;
    const nameEl = document.getElementById('rename-branch-name') as HTMLInputElement;

    renameBranchController.open({ oldName: 'feature-branch' });

    expect(modal.dataset.oldBranch).toBe('feature-branch');
    expect(currentEl.value).toBe('feature-branch');
    expect(nameEl.value).toBe('feature-branch');
  });

  it('focuses and selects name input', async () => {
    const { renameBranchController } = await import('@scripts/features/renameBranch');
    const nameEl = document.getElementById('rename-branch-name') as HTMLInputElement;
    const focusSpy = vi.spyOn(nameEl, 'focus');
    const selectSpy = vi.spyOn(nameEl, 'select');

    renameBranchController.open({ oldName: 'feature-branch' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(focusSpy).toHaveBeenCalled();
    expect(selectSpy).toHaveBeenCalled();
  });
});

describe('wireRenameBranch - validation edge cases', () => {
  it('validate handles missing oldBranch dataset', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    delete modal.dataset.oldBranch;
    nameEl.value = 'new-name';
    nameEl.dispatchEvent(new Event('input'));

    expect(confirm.disabled).toBe(false);
  });

  it('validate handles missing confirm button', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    document.getElementById('rename-branch-confirm')?.remove();
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'main';
    nameEl.value = 'new-name';
    expect(() => nameEl.dispatchEvent(new Event('input'))).not.toThrow();
  });

  it('validate with empty oldBranch and newName same as empty', async () => {
    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = '';
    nameEl.value = '';
    nameEl.dispatchEvent(new Event('input'));

    expect(confirm.disabled).toBe(true);
  });

  it('handles falsy error string in catch block', async () => {
    const invoke = vi.fn(async () => { throw ''; });
    (window as any).__TAURI__.core.invoke = invoke;
    const { notify } = await import('@scripts/lib/notify');

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'old-name';
    nameEl.value = 'new-name';
    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Rename failed');
  });

  it('handles null error in catch block', async () => {
    const invoke = vi.fn(async () => { throw null; });
    (window as any).__TAURI__.core.invoke = invoke;
    const { notify } = await import('@scripts/lib/notify');

    const { wireRenameBranch } = await import('@scripts/features/renameBranch');
    wireRenameBranch();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    const confirm = modal.querySelector('#rename-branch-confirm') as HTMLButtonElement;
    const nameEl = modal.querySelector('#rename-branch-name') as HTMLInputElement;

    modal.dataset.oldBranch = 'old-name';
    nameEl.value = 'new-name';
    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Rename failed');
  });
});

describe('setInitial edge cases', () => {
  it('handles missing currentEl', async () => {
    const { renameBranchController } = await import('@scripts/features/renameBranch');
    document.getElementById('rename-branch-current')?.remove();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    expect(() => renameBranchController.open({ oldName: 'feature-branch' })).not.toThrow();
    expect(modal.dataset.oldBranch).toBe('feature-branch');
  });

  it('handles missing nameEl', async () => {
    const { renameBranchController } = await import('@scripts/features/renameBranch');
    document.getElementById('rename-branch-name')?.remove();
    const modal = document.getElementById('rename-branch-modal') as HTMLElement;
    expect(() => renameBranchController.open({ oldName: 'feature-branch' })).not.toThrow();
    expect(modal.dataset.oldBranch).toBe('feature-branch');
  });
});

describe('openRenameBranch', () => {
  it('hydrates, wires, sets initial, and opens modal', async () => {
    const { hydrate, openModal } = await import('@scripts/ui/modals');

    const { openRenameBranch } = await import('@scripts/features/renameBranch');
    openRenameBranch('my-branch');

    const modal = document.getElementById('rename-branch-modal') as any;
    expect(hydrate).toHaveBeenCalledWith('rename-branch-modal');
    expect(modal.dataset.oldBranch).toBe('my-branch');
    expect(openModal).toHaveBeenCalledWith('rename-branch-modal');
  });
});
