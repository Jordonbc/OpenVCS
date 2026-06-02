// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./list', () => ({ renderList: vi.fn() }));
vi.mock('../conflicts', () => ({ autoOpenFirstConflict: vi.fn() }));

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
    core: {
      invoke: async (cmd: string) => {
        if (cmd === 'list_conflict_statuses') return ['U', 'UU', 'UA', 'AU', 'UD', 'DU', 'AA', 'DD'];
        return invoke(cmd);
      },
    },
    event: { listen: vi.fn() },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
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
  it('uses one backend snapshot for all repo hydration calls', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          has_repo: true,
          revision: 'rev-1',
          repo_path: '/repo',
          branch: 'main',
          branch_label: 'main',
          branches: [{ name: 'main', full_ref: 'refs/heads/main', current: true, kind: { type: 'Local' } }],
          files: [{ path: 'keep.txt', status: 'M', staged: false, resolved_conflict: false, hunks: [] }],
          commits: [{ id: 'c1', msg: 'local', meta: '', author: 'A' }],
          stash: [{ selector: 'stash@{0}', msg: 'WIP', meta: '' }],
          ahead: 1,
          behind: 0,
          branch_on_remote: true,
          merge_in_progress: false,
          seen_conflicts: [],
          vcs_action_labels: { 'VCS.Push': 'Ship' },
          ahead_ids: ['c1'],
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    installTauriMock(invoke);

    const { hydrateBranches, hydrateStatus, hydrateCommits, hydrateStash, hydrateVcsActionLabels } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await Promise.allSettled([
      hydrateBranches(),
      hydrateStatus(),
      hydrateCommits(),
      hydrateStash(),
      hydrateVcsActionLabels(),
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(state.branch).toBe('main');
    expect(state.files).toHaveLength(1);
    expect(state.commits).toHaveLength(1);
    expect((state as any).stash).toHaveLength(1);
    expect(state.vcsActionLabels).toEqual({ 'VCS.Push': 'Ship' });
  });

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

  it('selects all current paths when defaultSelectAll is enabled', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') {
        return { files: [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'A' }] };
      }
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.defaultSelectAll = true;
    state.selectedFiles = new Set();

    await hydrateStatus();

    expect(state.selectionImplicitAll).toBe(true);
    expect(Array.from(state.selectedFiles).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('skips rerendering when the status signature is unchanged', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_status') return { files: [{ path: 'same.txt', status: 'M' }], ahead: 1, behind: 0 };
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });
    installTauriMock(invoke);

    const { hydrateStatus } = await import('./hydrate');
    const list = await import('./list');

    await hydrateStatus();
    await hydrateStatus();

    expect(vi.mocked(list.renderList)).toHaveBeenCalledTimes(1);
  });

  it('tolerates merge-context failures by clearing merge flags', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') return { files: [{ path: 'keep.txt', status: 'M' }] };
      if (cmd === 'vcs_merge_context') throw new Error('merge context failed');
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();

    expect(state.mergeInProgress).toBe(false);
    expect(Array.from(state.seenConflicts)).toEqual([]);
  });

  it('populates seenConflicts when merge is in progress with conflicted files', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') return { files: [
        { path: 'conflict.txt', status: 'U' },
        { path: 'clean.txt', status: 'M' },
      ] };
      if (cmd === 'vcs_merge_context') return { in_progress: true };
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();

    expect(state.mergeInProgress).toBe(true);
    expect(Array.from(state.seenConflicts)).toEqual(['conflict.txt']);
  });
});

describe('ensureConflictStatusesLoaded', () => {
  it('dedupes in-flight list_conflict_statuses calls', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_conflict_statuses') {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return ['U', 'UU', 'UA', 'AU', 'UD', 'DU', 'AA', 'DD'];
      }
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { ensureConflictStatusesLoaded } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.conflictStatuses = new Set();

    await Promise.all([ensureConflictStatusesLoaded(), ensureConflictStatusesLoaded()]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(Array.from(state.conflictStatuses)).toEqual(['U', 'UU', 'UA', 'AU', 'UD', 'DU', 'AA', 'DD']);
  });

  it('handles non-array result from list_conflict_statuses', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_conflict_statuses') return null;
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { ensureConflictStatusesLoaded } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.conflictStatuses = new Set();

    await ensureConflictStatusesLoaded();
    expect(state.conflictStatuses.size).toBe(0);
  });

  it('tolerates list_conflict_statuses invoke error', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_conflict_statuses') throw new Error('fail');
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { ensureConflictStatusesLoaded } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.conflictStatuses = new Set(['EXISTING']);

    await ensureConflictStatusesLoaded();
    expect(state.conflictStatuses.size).toBe(1);
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

  it('handles detached HEAD without commit hash', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_list_branches') return [{ name: 'main', current: false }];
      if (cmd === 'vcs_head_status') return { detached: true };
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateBranches();
    expect(state.branchLabel).toBe('Detached HEAD');
  });

  it('handles failure gracefully', async () => {
    const invoke = vi.fn(async () => { throw new Error('No repository selected'); });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { hydrateBranches } = await import('./hydrate');
    const result = await hydrateBranches();
    expect(result).toBe(false);
  });

  it('handles falsy error in describeHydrationFailure', async () => {
    const invoke = vi.fn(async () => { throw null; });
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

  it('falls back to origin branch range and populates aheadIds', async () => {
    const invoke = vi.fn(async (cmd: string, args?: any) => {
      if (cmd === 'vcs_log' && args?.limit === 500) return [{ id: 'base', message: 'local' }];
      if (cmd === 'vcs_log' && args?.rev === 'HEAD..@{upstream}') throw new Error('no upstream');
      if (cmd === 'vcs_log' && args?.rev === 'HEAD..origin/main') return [{ id: 'incoming', message: 'remote' }];
      if (cmd === 'vcs_log' && args?.rev === '@{upstream}..HEAD') return [{ id: 'ahead-1' }, { id: 'ahead-2' }];
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateCommits } = await import('./hydrate');
    const list = await import('./list');
    const { state, prefs } = await import('../../state/state');
    (state as any).behind = 2;
    (state as any).ahead = 2;
    state.branch = 'main';
    prefs.tab = 'history';

    await hydrateCommits();

    expect(state.commits.map((entry: any) => entry.id)).toEqual(['incoming', 'base']);
    expect(Array.from((state as any).aheadIds).sort()).toEqual(['ahead-1', 'ahead-2']);
    expect(vi.mocked(list.renderList)).toHaveBeenCalled();
  });

  it('handles empty remote range result without incoming commits', async () => {
    const invoke = vi.fn(async (cmd: string, args?: any) => {
      if (cmd === 'vcs_log' && args?.limit === 500) return [{ id: 'base', message: 'local' }];
      if (cmd === 'vcs_log' && args?.rev === 'HEAD..@{upstream}') return [];
      if (cmd === 'vcs_log' && args?.rev === 'HEAD..origin/main') return [];
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');
    (state as any).behind = 2;
    state.branch = 'main';

    await hydrateCommits();
    expect(state.commits.length).toBe(1);
    expect(state.commits[0].id).toBe('base');
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

  it('rerenders the list when the stash tab is active', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_stash_list') return [{ id: 's1', message: 'WIP' }];
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateStash } = await import('./hydrate');
    const list = await import('./list');
    const { prefs } = await import('../../state/state');
    prefs.tab = 'stash';

    await hydrateStash();

    expect(vi.mocked(list.renderList)).toHaveBeenCalled();
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

  it('ignores malformed label pairs and always emits an update event', async () => {
    const invoke = vi.fn(async () => [['push', 'Push'], ['broken'], ['', 'Missing key'], ['pull', '  Pull  ']]);
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const eventSpy = vi.fn();
    window.addEventListener('app:vcs-action-labels-updated', eventSpy, { once: true });

    const { hydrateVcsActionLabels } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateVcsActionLabels();

    expect(state.vcsActionLabels).toEqual({ push: 'Push', pull: 'Pull' });
    expect(eventSpy).toHaveBeenCalledTimes(1);
  });

  it('handles null label values in pairs', async () => {
    const invoke = vi.fn(async () => [['key1', null], ['key2', 'value2']]);
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateVcsActionLabels } = await import('./hydrate');
    const { state } = await import('../../state/state');

    window.addEventListener('app:vcs-action-labels-updated', () => {}, { once: true });
    await hydrateVcsActionLabels();
    expect(state.vcsActionLabels).toEqual({ key2: 'value2' });
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
      if (cmd === 'list_conflict_statuses') return ['U', 'UU', 'UA', 'AU', 'UD', 'DU', 'AA', 'DD'];
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

describe('hydrateCommits aheadIds', () => {
  it('handles aheadIds query failure gracefully', async () => {
    let callCount = 0;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_log' && callCount++ === 0) return [{ id: 'base', message: 'local' }];
      if (cmd === 'vcs_log') throw new Error('ahead query failed');
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');
    (state as any).ahead = 2;

    await hydrateCommits();
    expect(Array.from((state as any).aheadIds)).toEqual([]);
  });

  it('handles null aheadList from vcs_log', async () => {
    const invoke = vi.fn(async (cmd: string, args?: any) => {
      if (cmd === 'vcs_log' && !args?.rev) return [{ id: 'base', message: 'local' }];
      if (cmd === 'vcs_log' && args?.rev === '@{upstream}..HEAD') return null;
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');
    (state as any).ahead = 2;

    await hydrateCommits();
    expect(Array.from((state as any).aheadIds)).toEqual([]);
  });
});

describe('hydrateBranches hasRepo', () => {
  it('retains hasRepo when branches exist', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_list_branches') return [{ name: 'main', current: true }];
      if (cmd === 'vcs_head_status') return { detached: false, branch: 'main' };
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.hasRepo = false;

    await hydrateBranches();
    expect(state.hasRepo).toBe(true);
  });

  it('returns false when branches list is empty', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_list_branches') return [];
      if (cmd === 'vcs_head_status') return { detached: false, branch: 'main' };
      return [];
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const result = await hydrateBranches();
    expect(result).toBe(false);
  });

  it('handles "No repository selected" error gracefully', async () => {
    const invoke = vi.fn().mockRejectedValue('No repository selected');
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const result = await hydrateBranches();
    expect(result).toBe(false);
  });

  it('handles "no longer available" error gracefully', async () => {
    const invoke = vi.fn().mockRejectedValue('active backend is no longer available');
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { hydrateBranches } = await import('./hydrate');
    const result = await hydrateBranches();
    expect(result).toBe(false);
  });
});

describe('hydrateSnapshot', () => {
  it('returns true when get_repo_snapshot returns valid data', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1',
          has_repo: true,
          repo_path: '/repo',
          branch: 'main',
          branch_label: 'main',
          branches: [],
          files: [],
          commits: [],
          stash: [],
          ahead: 0,
          behind: 0,
          branch_on_remote: true,
          merge_in_progress: false,
          seen_conflicts: [],
          conflict_statuses: [],
          vcs_action_labels: {},
          ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(true);
  });

  it('returns false when Tauri runtime unavailable', async () => {
    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(false);
  });

  it('returns false when result is null', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') return null;
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(false);
  });

  it('returns false when result is an array', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') return [];
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(false);
  });

  it('returns false when revision is not a string', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return { revision: 123, has_repo: true, branch: 'main', files: [], commits: [], stash: [] };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(false);
  });

  it('returns false when revision is empty', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return { revision: '', has_repo: true, branch: 'main', files: [], commits: [], stash: [] };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(false);
  });

  it('returns false when invoke throws', async () => {
    installTauriMock(async () => {
      throw new Error('network failure');
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const result = await hydrateSnapshot();
    expect(result).toBe(false);
  });

  it('prunes stale selection maps when defaultSelectAll is false', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r2',
          has_repo: true,
          repo_path: '/repo',
          branch: 'main',
          branch_label: 'main',
          branches: [],
          files: [{ path: 'keep.txt', status: 'M' }],
          commits: [],
          stash: [],
          ahead: 0,
          behind: 0,
          branch_on_remote: true,
          merge_in_progress: false,
          seen_conflicts: [],
          conflict_statuses: [],
          vcs_action_labels: {},
          ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.defaultSelectAll = false;
    state.selectedFiles = new Set(['keep.txt', 'gone.txt']);
    (state as any).selectedHunksByFile = { 'keep.txt': [0], 'gone.txt': [1] };
    (state as any).selectedLinesByFile = { 'keep.txt': { 0: [1, 2] }, 'gone.txt': { 0: [2] } };
    state.diffSelectedFiles = new Set(['keep.txt', 'gone.txt']);

    await hydrateSnapshot();

    expect(Array.from(state.selectedFiles)).toEqual(['keep.txt']);
    expect((state as any).selectedHunksByFile).toEqual({ 'keep.txt': [0] });
    expect((state as any).selectedLinesByFile).toEqual({ 'keep.txt': { 0: [1, 2] } });
    expect(Array.from(state.diffSelectedFiles)).toEqual(['keep.txt']);
  });

  it('forces fresh snapshot when force=true while snapshot is in-flight', async () => {
    let unblockFirstCall: () => void;
    const firstCallBlocker = new Promise<void>((resolve) => { unblockFirstCall = resolve; });
    let callCount = 0;
    const snapshotTemplate = {
      revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
      branches: [] as any[], files: [] as any[], commits: [] as any[], stash: [] as any[],
      ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
      seen_conflicts: [] as any[], conflict_statuses: [] as any[],
      vcs_action_labels: {} as Record<string, string>, ahead_ids: [] as any[],
    };
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        callCount++;
        if (callCount === 1) {
          await firstCallBlocker;
          return { ...snapshotTemplate, revision: 'r-slow' };
        }
        return { ...snapshotTemplate, revision: 'r-fast' };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');

    const firstCall = hydrateSnapshot();
    const forceCall = hydrateSnapshot(true);
    unblockFirstCall!();

    const [r1, r2] = await Promise.all([firstCall, forceCall]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(callCount).toBe(2);
  });

  it('handles non-array branches in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: null, files: [], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(Array.isArray(state.branches)).toBe(true);
    expect(state.branches).toEqual([]);
  });

  it('handles non-array files in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: 'not-array', commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(Array.isArray(state.files)).toBe(true);
    expect(state.files).toEqual([]);
  });

  it('handles non-array commits in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: 'not-array', stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(Array.isArray(state.commits)).toBe(true);
    expect(state.commits).toEqual([]);
  });

  it('handles non-array stash in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: [], stash: null,
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(Array.isArray((state as any).stash)).toBe(true);
    expect((state as any).stash).toEqual([]);
  });

  it('handles non-array seen_conflicts in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: null, conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(state.seenConflicts).toBeDefined();
    expect(state.seenConflicts.size).toBe(0);
  });

  it('handles non-array conflict_statuses in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: null, vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(state.conflictStatuses.size).toBe(0);
  });

  it('handles non-array ahead_ids in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: null,
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(Array.from((state as any).aheadIds)).toEqual([]);
  });

  it('handles empty files in snapshot with defaultSelectAll enabled', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.defaultSelectAll = true;
    state.selectedFiles = new Set(['stale.txt']);

    await hydrateSnapshot();

    expect(state.files).toEqual([]);
    expect(state.selectionImplicitAll).toBe(true);
    expect(state.selectedFiles.size).toBe(0);
  });

  it('handles files array with null entries in snapshot', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [null, { path: 'valid.txt', status: 'M' }], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: true, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(state.files).toHaveLength(2);
    expect(state.files[1]?.path).toBe('valid.txt');
  });

  it('handles snapshot with null branch and branch_label fields', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: true, repo_path: '/repo',
          branch: null, branch_label: null,
          branches: [], files: [], commits: [], stash: [],
          ahead: 5, behind: 3, branch_on_remote: false, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(state.branch).toBe('');
    expect(state.branchLabel).toBe('');
    expect((state as any).ahead).toBe(5);
    expect((state as any).behind).toBe(3);
  });

  it('handles snapshot with has_repo set to false', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'get_repo_snapshot') {
        return {
          revision: 'r1', has_repo: false, repo_path: '/repo', branch: 'main', branch_label: 'main',
          branches: [], files: [], commits: [], stash: [],
          ahead: 0, behind: 0, branch_on_remote: false, merge_in_progress: false,
          seen_conflicts: [], conflict_statuses: [], vcs_action_labels: {}, ahead_ids: [],
        };
      }
      return [];
    });

    const { hydrateSnapshot } = await import('./hydrate');
    const { state } = await import('../../state/state');
    await hydrateSnapshot();
    expect(state.hasRepo).toBe(false);
  });
});

describe('buildStatusSignature field fallbacks', () => {
  it('handles files with missing status, staged, and binary fields', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') {
        return {
          files: [
            { path: 'minimal.txt' },
            { path: 'binary-true.txt', binary: true },
            { path: 'binary-false.txt', binary: false },
          ],
        };
      }
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();
    expect(state.files).toHaveLength(3);
  });

  it('handles files with null path and non-boolean binary in signature', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') {
        return {
          files: [
            { status: 'A' },
            { path: 'str-binary.txt', binary: 'yes' },
            { path: 'renamed.txt', old_path: 'orig.txt', status: 'R' },
          ],
        };
      }
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();
    expect(state.files).toHaveLength(3);
  });

  it('handles files array with null entry in status signature', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') {
        return {
          files: [null, { path: 'good.txt', status: 'M' }],
        };
      }
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();
    expect(state.files).toHaveLength(2);
    expect(state.files[1]?.path).toBe('good.txt');
  });
});

describe('hydrateStatus edge cases', () => {
  it('handles non-array files from vcs_status', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') return { files: null };
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStatus();
    expect(state.files).toEqual([]);
  });
});

describe('hydrateCommits edge cases', () => {
  it('handles non-array list from vcs_log', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_log') return null;
      return [];
    });

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');
    (state as any).behind = 0;

    await hydrateCommits();
    expect(state.commits).toEqual([]);
  });

  it('handles null entries, duplicates, and empty ids in merge loop', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_log') {
        return [
          { id: 'c1', message: 'first' },
          null,
          { id: '', message: 'no id' },
          { id: 'c2', message: 'second' },
          { id: 'c1', message: 'duplicate' },
        ];
      }
      return [];
    });

    const { hydrateCommits } = await import('./hydrate');
    const { state } = await import('../../state/state');
    (state as any).behind = 0;

    await hydrateCommits();
    expect(state.commits.map((c: any) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('hydrateStash edge cases', () => {
  it('handles non-array list from vcs_stash_list', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_stash_list') return null;
      return [];
    });

    const { hydrateStash } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateStash();
    expect((state as any).stash).toEqual([]);
  });
});

describe('hydrateVcsActionLabels edge cases', () => {
  it('handles null labels from current_vcs_action_labels', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'current_vcs_action_labels') return null;
      return [];
    });

    const { hydrateVcsActionLabels } = await import('./hydrate');
    const { state } = await import('../../state/state');

    await hydrateVcsActionLabels();
    expect(state.vcsActionLabels).toEqual({});
  });
});
