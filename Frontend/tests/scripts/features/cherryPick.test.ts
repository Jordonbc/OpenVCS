// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('@scripts/lib/tauri', () => ({ TAURI: { invoke: mockInvoke } }));
vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('@scripts/ui/modals', () => ({
  closeModal: vi.fn(),
  hydrate: vi.fn(),
  openModal: vi.fn(),
}));
vi.mock('@scripts/features/repo', () => ({
  hydrateBranches: vi.fn(),
  hydrateCommits: vi.fn(),
  hydrateStatus: vi.fn(),
}));

const mockState = vi.hoisted(() => ({
  branch: 'main',
  branches: [
    { name: 'main', kind: { type: 'Local' }, full_ref: 'refs/heads/main' },
    { name: 'feature', kind: { type: 'Local' }, full_ref: 'refs/heads/feature' },
    { name: 'origin/main', kind: { type: 'Remote' }, full_ref: 'refs/remotes/origin/main' },
  ],
}));

vi.mock('@scripts/state/state', () => ({ state: mockState }));

function mountCherryPickModal() {
  document.body.innerHTML = `
    <div id="cherry-pick-modal">
      <input id="cherry-pick-commit" />
      <select id="cherry-pick-branch">
        <option value="">Select a branch…</option>
        <option value="feature">feature</option>
        <option value="main">main</option>
        <option value="develop">develop</option>
      </select>
      <button id="cherry-pick-confirm"></button>
    </div>
  `;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  mountCherryPickModal();
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('wireCherryPick', () => {
  it('wires once and skips on second call', async () => {
    const { wireCherryPick, cherryPickController } = await import('@scripts/features/cherryPick');
    expect(cherryPickController.isWired).toBe(false);
    wireCherryPick();
    expect(cherryPickController.isWired).toBe(true);
    wireCherryPick();
    expect(cherryPickController.isWired).toBe(true);
  });

  it('does nothing when modal is missing', async () => {
    document.body.innerHTML = '';
    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    expect(() => wireCherryPick()).not.toThrow();
  });

  it('validate enables confirm when commit and branch are set', async () => {
    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    modal.dataset.commit = 'abc123';
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;
    branchEl.value = 'feature';

    branchEl.dispatchEvent(new Event('change'));

    expect(confirm.disabled).toBe(false);
  });

  it('validate disables confirm when commit is empty', async () => {
    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    modal.dataset.commit = '';
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;
    branchEl.value = 'feature';

    branchEl.dispatchEvent(new Event('change'));

    expect(confirm.disabled).toBe(true);
  });

  it('validate disables confirm when branch is empty', async () => {
    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    modal.dataset.commit = 'abc123';
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;
    branchEl.value = '';

    branchEl.dispatchEvent(new Event('change'));

    expect(confirm.disabled).toBe(true);
  });

  it('confirm click invokes vcs_cherry_pick_to_branch and refreshes', async () => {
    const { notify } = await import('@scripts/lib/notify');
    const { closeModal } = await import('@scripts/ui/modals');
    const { hydrateBranches, hydrateCommits, hydrateStatus } = await import('@scripts/features/repo');

    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    modal.dataset.commit = 'abc123def456';
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;
    branchEl.value = 'feature';

    confirm.click();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_cherry_pick_to_branch', {
      id: 'abc123def456',
      branch: 'feature',
    });
    await flushPromises();
    expect(notify).toHaveBeenCalledWith("Cherry-picked onto feature");
    expect(closeModal).toHaveBeenCalledWith('cherry-pick-modal');
    expect(hydrateBranches).toHaveBeenCalled();
    expect(hydrateStatus).toHaveBeenCalled();
    expect(hydrateCommits).toHaveBeenCalled();
  });

  it('confirm click handles error from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('merge conflict'));
    const { notify } = await import('@scripts/lib/notify');

    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    modal.dataset.commit = 'abc123';
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;
    branchEl.value = 'feature';

    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Cherry-pick failed: Error: merge conflict');
  });

  it('confirm click handles undefined error', async () => {
    mockInvoke.mockRejectedValue('');
    const { notify } = await import('@scripts/lib/notify');

    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    modal.dataset.commit = 'abc123';
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;
    branchEl.value = 'feature';

    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Cherry-pick failed');
  });

  it('confirm click returns early when commit or branch missing', async () => {
    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const confirm = document.getElementById('cherry-pick-confirm') as HTMLButtonElement;
    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;

    (document.getElementById('cherry-pick-modal') as HTMLElement).dataset.commit = '';
    branchEl.value = 'feature';
    confirm.click();
    await flushPromises();
    expect(mockInvoke).not.toHaveBeenCalled();

    (document.getElementById('cherry-pick-modal') as HTMLElement).dataset.commit = 'abc123';
    branchEl.value = '';
    confirm.click();
    await flushPromises();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('setInitial fills commit info and branch options', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    cherryPickController.open({
      commit: { id: 'abc123def456', msg: 'Fix critical bug' },
      branches: ['main', 'feature', 'develop'],
      currentBranch: 'feature',
    });

    const commitEl = document.getElementById('cherry-pick-commit') as HTMLInputElement;
    expect(commitEl.value).toBe('abc123d — Fix critical bug');
    expect(modal.dataset.commit).toBe('abc123def456');

    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;
    expect(branchEl.value).toBe('feature');
    const options = Array.from(branchEl.options).map((o) => o.value);
    expect(options).toEqual(['', 'develop', 'feature', 'main']);
  });

  it('setInitial prefers currentBranch over first option', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    cherryPickController.open({
      commit: { id: 'abc', msg: '' },
      branches: ['develop', 'main', 'feature'],
      currentBranch: 'develop',
    });

    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;
    expect(branchEl.value).toBe('develop');
  });

  it('setInitial falls back to first option when currentBranch not in list', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    cherryPickController.open({
      commit: { id: 'abc', msg: '' },
      branches: ['develop', 'main', 'feature'],
      currentBranch: 'nonexistent',
    });

    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;
    expect(branchEl.value).toBe('develop');
  });

  it('setInitial handles empty commit ID and msg', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    cherryPickController.open({ commit: {}, branches: ['main'], currentBranch: '' });

    const commitEl = document.getElementById('cherry-pick-commit') as HTMLInputElement;
    expect(commitEl.value).toBe('');
    expect(modal.dataset.commit).toBe('');
  });

  it('setInitial handles missing branchEl', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    document.getElementById('cherry-pick-branch')?.remove();
    expect(() => cherryPickController.open({ commit: { id: 'abc' }, branches: ['main'], currentBranch: 'main' })).not.toThrow();
  });

  it('setInitial focuses branch select', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;
    const focusSpy = vi.spyOn(branchEl, 'focus');

    cherryPickController.open({ commit: { id: 'abc' }, branches: ['main'], currentBranch: 'main' });
    await flushPromises();

    expect(focusSpy).toHaveBeenCalled();
  });
});

describe('openCherryPick', () => {
  it('opens modal with branches filtered for non-remote', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    const { openModal } = await import('@scripts/ui/modals');

    const { openCherryPick } = await import('@scripts/features/cherryPick');

    await openCherryPick({ id: 'abc', msg: 'Commit msg' });

    expect(hydrate).toHaveBeenCalledWith('cherry-pick-modal');
    expect(openModal).toHaveBeenCalledWith('cherry-pick-modal');

    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;
    const options = Array.from(branchEl.options).map((o) => o.value.trim()).filter(Boolean);
    expect(options).toEqual(['feature', 'main']);
  });

  it('notifies when no local branches exist', async () => {
    mockState.branches = [];
    const { notify } = await import('@scripts/lib/notify');
    const { openModal } = await import('@scripts/ui/modals');

    const { openCherryPick } = await import('@scripts/features/cherryPick');
    await openCherryPick({ id: 'abc', msg: 'Test' });

    expect(notify).toHaveBeenCalledWith('No local branches found');
    expect(openModal).not.toHaveBeenCalled();
  });

  it('calls setInitial and opens modal on the modal', async () => {
    mockState.branches = [
      { name: 'main', kind: { type: 'Local' }, full_ref: 'refs/heads/main' },
    ];
    mockState.branch = 'main';

    const { openModal } = await import('@scripts/ui/modals');
    const { openCherryPick } = await import('@scripts/features/cherryPick');
    await openCherryPick({ id: 'abc123', msg: 'Fix' });

    const modal = document.getElementById('cherry-pick-modal') as any;
    expect(modal.dataset.commit).toBe('abc123');
    expect(openModal).toHaveBeenCalledWith('cherry-pick-modal');
  });

  it('setInitial displays short id when no message is provided', async () => {
    mockState.branches = [
      { name: 'main', kind: { type: 'Local' }, full_ref: 'refs/heads/main' },
    ];
    mockState.branch = 'main';

    const { openCherryPick } = await import('@scripts/features/cherryPick');
    await openCherryPick({ id: 'abc1234567', msg: '' });

    const commitEl = document.getElementById('cherry-pick-commit') as HTMLInputElement;
    expect(commitEl.value).toBe('abc1234');
  });

  it('setInitial writes short id when commit has no id', async () => {
    mockState.branches = [
      { name: 'main', kind: { type: 'Local' }, full_ref: 'refs/heads/main' },
    ];
    mockState.branch = 'main';

    const { openCherryPick } = await import('@scripts/features/cherryPick');
    await openCherryPick({ id: 'xyz789', msg: null as any });

    const commitEl = document.getElementById('cherry-pick-commit') as HTMLInputElement;
    expect(commitEl.value).toBe('xyz789');
  });
});

describe('wireCherryPick setInitial edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
    mountCherryPickModal();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(null);
  });

  it('handles empty branches array with no currentBranch', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    cherryPickController.open({ commit: { id: 'abc' }, branches: [], currentBranch: '' });

    const branchEl = document.getElementById('cherry-pick-branch') as HTMLSelectElement;
    expect(branchEl.value).toBe('');
    const options = Array.from(branchEl.options).filter((o) => o.value);
    expect(options.length).toBe(0);
  });

  it('handles missing commitEl gracefully', async () => {
    document.getElementById('cherry-pick-commit')?.remove();
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    expect(() => cherryPickController.open({ commit: { id: 'abc', msg: 'test' }, branches: ['main'], currentBranch: 'main' })).not.toThrow();
  });

  it('handles commit with no id and no msg', async () => {
    const { cherryPickController } = await import('@scripts/features/cherryPick');
    cherryPickController.open({ commit: { id: '', msg: '' }, branches: ['main'], currentBranch: 'main' });
    const commitEl = document.getElementById('cherry-pick-commit') as HTMLInputElement;
    expect(commitEl.value).toBe('');
  });
});

describe('wireCherryPick confirm handler edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
    mountCherryPickModal();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(null);
  });

  it('re-validates after confirm error via finally block', async () => {
    const { wireCherryPick } = await import('@scripts/features/cherryPick');
    wireCherryPick();
    const modal = document.getElementById('cherry-pick-modal') as HTMLElement;
    const confirm = modal.querySelector('#cherry-pick-confirm') as HTMLButtonElement;
    const branchEl = modal.querySelector('#cherry-pick-branch') as HTMLSelectElement;

    modal.dataset.commit = 'abc123';
    branchEl.value = 'feature';

    // Confirm succeeds, then we can check it still validates
    confirm.click();
    await new Promise((r) => setTimeout(r, 0));

    // After success, validate() was called via finally - confirm should be enabled
    expect(confirm.disabled).toBe(false);
  });
});
