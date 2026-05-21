// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes required by repository hydration rendering. */
function mountRepoDom() {
  document.body.innerHTML = `
    <input id="filter" />
    <input id="select-all" type="checkbox" />
    <ul id="file-list"></ul>
    <span id="changes-count"></span>
    <div id="left-foot"></div>
    <div id="diff-path"></div>
    <div id="diff"></div>
    <button id="commit-btn"></button>
    <input id="commit-summary" />
  `;
}

/** Installs a mocked Tauri runtime before modules capture it at import time. */
function installTauriMock(invoke: (cmd: string) => Promise<unknown>) {
  (window as any).__TAURI__ = {
    core: { invoke },
    event: { listen: vi.fn() },
  };
}

beforeEach(() => {
  vi.resetModules();
  mountRepoDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('hydrateStatus selection reconciliation', () => {
  it('captures branch_on_remote and refreshes when only the remote-tracking flag changes', async () => {
    const statusResponses = [
      { files: [{ path: 'keep.txt', status: 'M' }], branch_on_remote: true },
      { files: [{ path: 'keep.txt', status: 'M' }], branch_on_remote: false },
    ];

    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') return statusResponses.shift() ?? statusResponses[statusResponses.length - 1];
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      if (cmd === 'vcs_diff_file') return ['diff --git a/keep.txt b/keep.txt', '@@ -1 +1 @@', '-old', '+new'];
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();
    expect(state.branchOnRemote).toBe(true);

    await hydrateStatus();
    expect(state.branchOnRemote).toBe(false);
  });

  it('prunes stale per-file selection maps when status changes', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') return { files: [{ path: 'keep.txt', status: 'M' }] };
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      if (cmd === 'vcs_diff_file') return ['diff --git a/keep.txt b/keep.txt', '@@ -1 +1 @@', '-old', '+new'];
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.defaultSelectAll = false;
    state.selectedFiles = new Set(['keep.txt', 'gone.txt']);
    state.selectedHunksByFile = { 'keep.txt': [0], 'gone.txt': [1] };
    state.selectedLinesByFile = { 'keep.txt': { 0: [1, 2] }, 'gone.txt': { 0: [2] } };
    state.diffSelectedFiles = new Set(['keep.txt', 'gone.txt']);

    await hydrateStatus();

    expect(Array.from(state.selectedFiles)).toEqual(['keep.txt']);
    expect(state.selectedHunksByFile).toEqual({ 'keep.txt': [0] });
    expect(state.selectedLinesByFile).toEqual({ 'keep.txt': { 0: [1, 2] } });
    expect(Array.from(state.diffSelectedFiles)).toEqual(['keep.txt']);
  });

  it('clears all selection maps when status hydration fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') throw new Error('boom');
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set(['gone.txt']);
    state.selectedHunks = [0];
    state.selectedHunksByFile = { 'gone.txt': [0] };
    state.selectedLinesByFile = { 'gone.txt': { 0: [1] } };
    state.diffSelectedFiles = new Set(['gone.txt']);

    await hydrateStatus();

    expect(state.selectedFiles.size).toBe(0);
    expect(state.selectedHunks).toEqual([]);
    expect(state.selectedHunksByFile).toEqual({});
    expect(state.selectedLinesByFile).toEqual({});
    expect(state.diffSelectedFiles.size).toBe(0);
  });
});

describe('yieldToPaint', () => {
  it('resolves via requestAnimationFrame when page is visible', async () => {
    const { yieldToPaint } = await import('./hydrate');
    const spy = vi.spyOn(window, 'requestAnimationFrame');
    // Document visibilityState is already 'visible' by default in jsdom
    await yieldToPaint();
    expect(spy).toHaveBeenCalled();
  });

  it('resolves via setTimeout when page is hidden', async () => {
    const originalDef = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { yieldToPaint } = await import('./hydrate');
    const spy = vi.spyOn(window, 'setTimeout');
    await yieldToPaint();
    expect(spy).toHaveBeenCalled();
    if (originalDef) Object.defineProperty(document, 'visibilityState', originalDef);
  });
});

describe('hydrateBranches', () => {
  it('returns false when Tauri runtime unavailable', async () => {
    // No __TAURI__ set
    const { hydrateBranches } = await import('./hydrate');
    const result = await hydrateBranches();
    expect(result).toBe(false);
  });

  it('fetches branches and updates state', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_list_branches') return [{ name: 'main', current: true }, { name: 'develop', current: false }];
      if (cmd === 'vcs_head_status') return { detached: false, branch: 'main' };
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const { state } = await import('../../state/state');

    const result = await hydrateBranches();
    expect(result).toBe(true);
    expect(state.branch).toBe('main');
    expect(state.branches).toHaveLength(2);
  });

  it('handles detached HEAD', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_list_branches') return [{ name: 'main', current: false }];
      if (cmd === 'vcs_head_status') return { detached: true, commit: 'abc1234def' };
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateBranches();
    expect(state.branchLabel).toContain('Detached HEAD');
    expect(state.branchLabel).toContain('abc1234');
  });

  it('handles failure gracefully', async () => {
    const invoke = vi.fn(async () => { throw new Error('No repository selected'); });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { hydrateBranches } = await import('./hydrate');
    const result = await hydrateBranches();
    expect(result).toBe(false);
  });
});

describe('hydrateCommits', () => {
  it('fetches and merges commits with incoming', async () => {
    const invoke = vi.fn(async (cmd: string, args?: any) => {
      if (cmd === 'vcs_log' && args?.limit === 500) {
        return [{ id: 'c1', message: 'local' }, { id: 'c2', message: 'local2' }];
      }
      if (cmd === 'vcs_log' && args?.rev === 'HEAD..@{upstream}') {
        return [{ id: 'c3', message: 'incoming' }];
      }
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');

    (state as any).behind = 5;
    await hydrateCommits();
    expect(state.commits).toBeDefined();
    expect(state.commits.length).toBeGreaterThanOrEqual(1);
  });

  it('handles no behind commits', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_log') return [{ id: 'c1', message: 'only local' }];
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');

    (state as any).behind = 0;
    await hydrateCommits();
    expect(state.commits.length).toBe(1);
  });

  it('handles fetch failure gracefully', async () => {
    const invoke = vi.fn(async () => { throw new Error('fail'); });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { hydrateCommits } = await import('./hydrate');
    await hydrateCommits();
    const { state } = await import('../../state/state');
    expect(state.commits).toEqual([]);
  });
});

describe('hydrateStash', () => {
  it('fetches and stores stash list', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_stash_list') return [{ id: 's1', message: 'WIP' }];
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateStash } = await import('./hydrate');
    await hydrateStash();
    const { state } = await import('../../state/state');
    expect((state as any).stash).toEqual([{ id: 's1', message: 'WIP' }]);
  });

  it('handles failure gracefully', async () => {
    const invoke = vi.fn(async () => { throw new Error('fail'); });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { hydrateStash } = await import('./hydrate');
    await hydrateStash();
    const { state } = await import('../../state/state');
    expect((state as any).stash).toEqual([]);
  });
});

describe('hydrateVcsActionLabels', () => {
  it('resolves action labels from backend', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'current_vcs_action_labels') return [['push', 'Push'], ['pull', 'Pull']];
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateVcsActionLabels } = await import('./hydrate');
    await hydrateVcsActionLabels();
    const { state } = await import('../../state/state');
    expect(state.vcsActionLabels).toEqual({ push: 'Push', pull: 'Pull' });
  });

  it('handles failure by setting empty labels', async () => {
    const invoke = vi.fn(async () => { throw new Error('fail'); });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateVcsActionLabels } = await import('./hydrate');
    await hydrateVcsActionLabels();
    const { state } = await import('../../state/state');
    expect(state.vcsActionLabels).toEqual({});
  });
});

describe('pruneSelectionMaps', () => {
  it('removes entries for paths not in current set', async () => {
    const { state } = await import('../../state/state');
    state.selectedHunksByFile = { 'keep.txt': [0], 'gone.txt': [1] } as any;
    state.selectedLinesByFile = { 'keep.txt': { 0: [1] }, 'gone.txt': { 0: [2] } } as any;
    state.diffSelectedFiles = new Set(['keep.txt', 'gone.txt']);

    // Re-run hydrateStatus to trigger pruneSelectionMaps via the code path
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_status') return { files: [{ path: 'keep.txt', status: 'M' }] };
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    state.defaultSelectAll = false;
    state.selectedFiles = new Set(['keep.txt', 'gone.txt']);

    const { hydrateStatus } = await import('./hydrate');
    await hydrateStatus();

    expect(state.selectedHunksByFile).toEqual({ 'keep.txt': [0] });
    expect(state.selectedLinesByFile).toEqual({ 'keep.txt': { 0: [1] } });
    expect(Array.from(state.diffSelectedFiles)).toEqual(['keep.txt']);
  });
});
