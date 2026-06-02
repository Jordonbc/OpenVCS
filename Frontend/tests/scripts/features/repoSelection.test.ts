// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));

const mockState: any = { branch: '', branches: [] };

vi.mock('@scripts/state/state', () => ({
  state: mockState,
}));

beforeEach(() => {
  vi.resetModules();
  mockInvoke.mockReset();
  mockNotify.mockReset();
  mockState.branch = '';
  mockState.branches = [];
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('refreshRepoSummary', () => {
  it('updates state and DOM on success', async () => {
    document.body.innerHTML = '<span id="repo-branch"></span>';
    mockInvoke.mockResolvedValue({
      path: '/repo',
      current_branch: 'main',
      branches: [{ name: 'main' }, { name: 'dev' }],
    });

    const { refreshRepoSummary } = await import('@scripts/features/repoSelection');
    await refreshRepoSummary();

    expect(mockState.branch).toBe('main');
    expect(mockState.branches).toEqual([{ name: 'main' }, { name: 'dev' }]);
    expect(document.getElementById('repo-branch')!.textContent).toBe('main');
  });

  it('dispatches app:repo-selected event', async () => {
    mockInvoke.mockResolvedValue({
      path: '/repo',
      current_branch: 'main',
      branches: [],
    });

    const handler = vi.fn();
    window.addEventListener('app:repo-selected', handler);

    const { refreshRepoSummary } = await import('@scripts/features/repoSelection');
    await refreshRepoSummary();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ path: '/repo' });
  });

  it('shows — when no branch is set', async () => {
    document.body.innerHTML = '<span id="repo-branch"></span>';
    mockInvoke.mockResolvedValue({
      path: '/repo',
      current_branch: '',
      branches: [],
    });

    const { refreshRepoSummary } = await import('@scripts/features/repoSelection');
    await refreshRepoSummary();

    expect(document.getElementById('repo-branch')!.textContent).toBe('—');
  });

  it('handles invite failure and calls notify', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { refreshRepoSummary } = await import('@scripts/features/repoSelection');
    await refreshRepoSummary();

    expect(mockNotify).toHaveBeenCalledWith('Failed to refresh repo summary');
  });

  it('handles missing repo-branch element gracefully', async () => {
    mockInvoke.mockResolvedValue({
      path: '/repo',
      current_branch: 'main',
      branches: [],
    });

    const { refreshRepoSummary } = await import('@scripts/features/repoSelection');
    await expect(refreshRepoSummary()).resolves.toBeUndefined();
  });

  it('handles non-array branches', async () => {
    mockInvoke.mockResolvedValue({
      path: '/repo',
      current_branch: 'main',
      branches: null,
    });

    const { refreshRepoSummary } = await import('@scripts/features/repoSelection');
    await refreshRepoSummary();

    expect(mockState.branches).toEqual([]);
  });
});
