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
  hydrateCommits: vi.fn(),
  hydrateStatus: vi.fn(),
}));

function mountSetUpstreamModal() {
  document.body.innerHTML = `
    <div id="set-upstream-modal">
      <input id="set-upstream-branch" />
      <select id="set-upstream-select">
        <option value="">Select a remote branch…</option>
        <option value="origin/main">origin/main</option>
        <option value="origin/feature">origin/feature</option>
        <option value="origin/develop">origin/develop</option>
        <option value="upstream/main">upstream/main</option>
        <option value="origin/other">origin/other</option>
        <option value="origin/a">origin/a</option>
        <option value="origin/m">origin/m</option>
        <option value="origin/z">origin/z</option>
      </select>
      <button id="set-upstream-confirm"></button>
    </div>
  `;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  mountSetUpstreamModal();
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('wireSetUpstream', () => {
  it('sets __wired and skips on second call', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    const modal = document.getElementById('set-upstream-modal') as any;
    expect(modal.__wired).toBeUndefined();
    wireSetUpstream();
    expect(modal.__wired).toBe(true);
    wireSetUpstream();
    expect(modal.__wired).toBe(true);
  });

  it('does nothing when modal is missing', async () => {
    document.body.innerHTML = '';
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    expect(() => wireSetUpstream()).not.toThrow();
  });

  it('validate disables confirm when both branch and upstream missing', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    modal.dataset.branch = '';
    selectEl.value = '';
    selectEl.dispatchEvent(new Event('change'));
    expect(confirm.disabled).toBe(true);
  });

  it('validate disables confirm when branch is set but upstream empty', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    modal.dataset.branch = 'main';
    selectEl.value = '';
    selectEl.dispatchEvent(new Event('change'));
    expect(confirm.disabled).toBe(true);
  });

  it('validate enables confirm when both branch and upstream are set', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    modal.dataset.branch = 'main';
    selectEl.value = 'origin/main';
    selectEl.dispatchEvent(new Event('change'));

    expect(confirm.disabled).toBe(false);
  });

  it('confirm click invokes vcs_set_upstream and refreshes', async () => {
    const { notify } = await import('@scripts/lib/notify');
    const { closeModal } = await import('@scripts/ui/modals');
    const { hydrateCommits, hydrateStatus } = await import('@scripts/features/repo');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    modal.dataset.branch = 'feature';
    selectEl.value = 'origin/feature';
    confirm.click();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_set_upstream', {
      branch: 'feature',
      upstream: 'origin/feature',
    });
    await flushPromises();
    expect(notify).toHaveBeenCalledWith("Tracking 'origin/feature'");
    expect(closeModal).toHaveBeenCalledWith('set-upstream-modal');
    expect(hydrateCommits).toHaveBeenCalled();
    expect(hydrateStatus).toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'app:branches-updated' }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'app:status-updated' }),
    );
  });

  it('confirm click returns early when branch or upstream missing', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    delete modal.dataset.branch;
    selectEl.value = 'origin/main';
    confirm.click();
    await flushPromises();
    expect(mockInvoke).not.toHaveBeenCalled();

    modal.dataset.branch = 'main';
    selectEl.value = '';
    confirm.click();
    await flushPromises();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('confirm click handles error from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('remote not found'));
    const { notify } = await import('@scripts/lib/notify');

    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    modal.dataset.branch = 'feature';
    selectEl.value = 'origin/feature';
    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Set upstream failed: Error: remote not found');
  });

  it('confirm click handles empty error', async () => {
    mockInvoke.mockRejectedValue('');
    const { notify } = await import('@scripts/lib/notify');

    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as HTMLElement;
    const confirm = modal.querySelector('#set-upstream-confirm') as HTMLButtonElement;
    const selectEl = modal.querySelector('#set-upstream-select') as HTMLSelectElement;

    modal.dataset.branch = 'feature';
    selectEl.value = 'origin/feature';
    confirm.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Set upstream failed');
  });
});

describe('setInitial', () => {
  it('prefers origin/<branch> when present', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;

    modal.setInitial('main', ['origin/other', 'origin/main', 'upstream/main']);

    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    expect(selectEl.value).toBe('origin/main');
  });

  it('falls back to branch-suffix match when origin/<branch> missing', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;

    modal.setInitial('main', ['origin/develop', 'upstream/main', 'origin/feature']);

    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    expect(selectEl.value).toBe('upstream/main');
  });

  it('falls back to first option when no matching suffix', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;

    modal.setInitial('main', ['origin/develop', 'origin/feature']);

    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    expect(selectEl.value).toBe('origin/develop');
  });

  it('handles empty upstreams list with empty preferred', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;

    modal.setInitial('main', []);

    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    expect(selectEl.value).toBe('');
  });

  it('sets branch input value', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;

    modal.setInitial('feature-x', ['origin/feature-x']);

    const branchEl = document.getElementById('set-upstream-branch') as HTMLInputElement;
    expect(branchEl.value).toBe('feature-x');
    const modalEl = document.getElementById('set-upstream-modal') as HTMLElement;
    expect(modalEl.dataset.branch).toBe('feature-x');
  });

  it('sorts upstreams alphabetically', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;

    modal.setInitial('main', ['origin/z', 'origin/a', 'origin/m']);

    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    const options = Array.from(selectEl.options).map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['origin/a', 'origin/m', 'origin/z']);
  });

  it('focuses select element', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    const modal = document.getElementById('set-upstream-modal') as any;
    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    const focusSpy = vi.spyOn(selectEl, 'focus');

    modal.setInitial('main', ['origin/main']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(focusSpy).toHaveBeenCalled();
  });

  it('handles missing branchEl gracefully', async () => {
    const { wireSetUpstream } = await import('@scripts/features/setUpstream');
    wireSetUpstream();
    document.getElementById('set-upstream-branch')?.remove();
    const modal = document.getElementById('set-upstream-modal') as any;
    expect(() => modal.setInitial('main', ['origin/main'])).not.toThrow();
  });
});

describe('openSetUpstream', () => {
  it('hydrates, wires, sets initial, and opens modal', async () => {
    const { hydrate, openModal } = await import('@scripts/ui/modals');

    const { openSetUpstream } = await import('@scripts/features/setUpstream');
    openSetUpstream('my-branch', ['origin/my-branch', 'origin/other']);

    expect(hydrate).toHaveBeenCalledWith('set-upstream-modal');
    expect(openModal).toHaveBeenCalledWith('set-upstream-modal');

    const branchEl = document.getElementById('set-upstream-branch') as HTMLInputElement;
    expect(branchEl.value).toBe('my-branch');

    const selectEl = document.getElementById('set-upstream-select') as HTMLSelectElement;
    expect(selectEl.value).toBe('origin/my-branch');
  });
});
