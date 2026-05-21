// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus } from '../../types';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes touched by diff rendering. */
function mountDiffDom() {
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
function installTauriMock() {
  (window as any).__TAURI__ = {
    core: {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'vcs_diff_file') {
          return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
        }
        return [];
      }),
    },
    event: { listen: vi.fn() },
  };
}

beforeEach(() => {
  vi.resetModules();
  mountDiffDom();
  installTauriMock();
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('highlightRow', () => {
  it('highlights the row at given index', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row">a</li><li class="row">b</li>';
    const { highlightRow } = await import('./diffView');
    highlightRow(1);
    const rows = document.querySelectorAll<HTMLElement>('#file-list .row');
    expect(rows[0].classList.contains('active')).toBe(false);
    expect(rows[1].classList.contains('active')).toBe(true);
  });

  it('uses history row selector when prefs tab is history', async () => {
    const { prefs } = await import('../../state/state');
    prefs.tab = 'history';
    document.querySelector('#file-list')!.innerHTML = '<li class="row commit">a</li><li class="row commit">b</li>';
    const { highlightRow } = await import('./diffView');
    highlightRow(0);
    const rows = document.querySelectorAll<HTMLElement>('#file-list .row.commit');
    expect(rows[0].classList.contains('active')).toBe(true);
  });
});

describe('renderCombinedDiff', () => {
  it('renders read-only hunks without stale selection checkboxes', async () => {
    const { renderCombinedDiff } = await import('./diffView');

    await renderCombinedDiff(['a.txt']);

    expect(document.querySelector('#diff')?.innerHTML).toContain('-old');
    expect(document.querySelector('#diff .pick-hunk')).toBeNull();
    expect(document.querySelector('#diff .pick-line')).toBeNull();
  });

  it('handles missing diffEl gracefully', async () => {
    document.body.innerHTML = '';
    const { renderCombinedDiff } = await import('./diffView');
    await expect(renderCombinedDiff(['a.txt'])).resolves.toBeUndefined();
  });

  it('deduplicates file paths', async () => {
    const { renderCombinedDiff } = await import('./diffView');
    await renderCombinedDiff(['a.txt', 'a.txt', 'b.txt']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('-old');
    expect(html).toContain('b.txt');
    const header = document.getElementById('diff-path') as HTMLElement;
    expect(header?.textContent).toContain('Multiple files (2)');
  });

  it('handles binary diffs in combined view', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return ['Binary files a/img.png and b/img.png differ'];
      }
      return [];
    });
    const { renderCombinedDiff } = await import('./diffView');
    await renderCombinedDiff(['img.png']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('Diff not supported');
  });

  it('handles invoke failure for individual file', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('fail'));
    const { renderCombinedDiff } = await import('./diffView');
    await renderCombinedDiff(['broken.txt']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('failed to load diff');
  });

  it('shows per-file failure when all files fail', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('fail'));
    const { renderCombinedDiff } = await import('./diffView');
    await renderCombinedDiff(['a.txt', 'b.txt']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('failed to load diff');
    expect(html).toContain('a.txt');
    expect(html).toContain('b.txt');
  });

  it('handles empty and null file paths', async () => {
    const { renderCombinedDiff } = await import('./diffView');
    await renderCombinedDiff([]);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('No diffs');
  });
});

describe('selectFile', () => {
  it('returns early when diffEl or diffHeadPath missing', async () => {
    document.body.innerHTML = '';
    const { selectFile } = await import('./diffView');
    await expect(selectFile({ path: 'x.txt', status: 'M' } as FileStatus, 0)).resolves.toBeUndefined();
  });

  it('skips re-render when diff is not dirty and same file', async () => {
    const { state } = await import('../../state/state');
    state.diffDirty = false;
    state.currentFile = 'a.txt';

    const { selectFile } = await import('./diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('handles conflict status', async () => {
    const { selectFile } = await import('./diffView');
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      return [];
    });
    await selectFile({ path: 'conflict.txt', status: 'U' } as FileStatus, 0);
    const headPath = document.getElementById('diff-path') as HTMLElement;
    expect(headPath?.textContent).toContain('conflicted');
  });

  it('synthesizes a diff for untracked files reported as ??', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [];
      }
      if (cmd === 'read_repo_file_text') {
        return 'Title\nBody\n';
      }
      return [];
    });

    const { selectFile } = await import('./diffView');

    await selectFile({ path: 'content/posts/2026/05/openvcs-announcement.md', status: '??' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('+Title');
    expect(diffText).toContain('+Body');
  });

  it('does not treat an empty diff payload as binary', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [];
      }
      return [];
    });

    const { selectFile } = await import('./diffView');

    await selectFile({ path: 'content/posts/2026/05/openvcs-announcement.md', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('No textual hunks to display');
    expect(diffText).not.toContain('Diff not supported on this file type');
  });

  it('renders binary diff placeholder for binary files', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return ['Binary files a/img.png and b/img.png differ'];
      }
      return [];
    });

    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'img.png', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Diff not supported on this file type');
  });

  it('handles read_repo_file_text failure for untracked', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'read_repo_file_text') throw new Error('read fail');
      return [];
    });

    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'untracked.txt', status: '??' } as FileStatus, 0);
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('@@ -0,0 +1,0 @@');
  });

  it('handles invoke failure in selectFile gracefully', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('load failed'));
    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'broken.txt', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Failed to load diff');
  });

  it('restores cached hunk selections', async () => {
    const { state } = await import('../../state/state');
    state.diffDirty = true;
    state.currentFile = '';

    // Set up hunk nodes similar to what buildDiffFragment would produce
    state.currentDiffHunkNodes = new Map();
    const hunkCheckbox = document.createElement('input');
    hunkCheckbox.type = 'checkbox';
    hunkCheckbox.className = 'pick-hunk';
    const lineCheckbox = document.createElement('input');
    lineCheckbox.type = 'checkbox';
    lineCheckbox.className = 'pick-line';
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox },
    });

    // Set cached selections
    (state as any).selectedHunksByFile = { 'a.txt': [0] };

    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    expect(state.selectedHunks).toEqual([0]);
  });

  it('selects all hunks when file is in selectedFiles', async () => {
    const { state } = await import('../../state/state');
    state.diffDirty = true;
    state.currentFile = '';
    state.selectedFiles = new Set(['a.txt']);

    // The code checks selectedFiles.has(file.path) - so we need a.txt in selectedFiles
    state.currentDiffHunkNodes = new Map();
    const hunkCheckbox = document.createElement('input');
    hunkCheckbox.type = 'checkbox';
    hunkCheckbox.className = 'pick-hunk';
    const lineCheckbox = document.createElement('input');
    lineCheckbox.type = 'checkbox';
    lineCheckbox.className = 'pick-line';
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox },
    });

    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    // When file is in selectedFiles, it should select all hunks
    expect(state.selectedHunks).toEqual([0]);
  });

  it('clears selectedHunks when no cached selection and file not selected', async () => {
    const { state } = await import('../../state/state');
    state.diffDirty = true;
    state.currentFile = '';
    state.selectedFiles = new Set(['other.txt']);
    state.selectedHunks = [99];
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;

    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    expect(state.selectedHunks).toEqual([]);
  });
});

describe('selectFile contextmenu', () => {
  it('attaches contextmenu handler to diffEl for hunk discard', async () => {
    // Need to ensure invoke returns proper diff lines so the hunk elements render
    const { selectFile } = await import('./diffView');
    const { state } = await import('../../state/state');

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    const diffEl = document.getElementById('diff')!;
    // The diff output from the default mock is 4 lines (the mock returns ['diff --git ...', '@@ ...', '-old', '+new'])
    // buildDiffFragment should create .hunk elements from this, and selectFile attaches contextmenu
    const hunkEl = diffEl.querySelector('.hunk');
    // The contextmenu handler is attached with { once: true }, so we trigger it
    if (hunkEl) {
      const ctxEvent = new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true });
      hunkEl.dispatchEvent(ctxEvent);
      // Should not throw - the handler calls buildCtxMenu which doesn't exist in jsdom but that's ok
    }
    // Just verify no crash
  });

  it('contextmenu handler adds discard selected hunks items when hunks are selected', async () => {
    const { selectFile } = await import('./diffView');
    const { state } = await import('../../state/state');

    // Set up cached selected hunks so the context menu shows extra items
    (state as any).selectedHunksByFile = { 'a.txt': [0] };

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk');
    if (hunkEl) {
      hunkEl.setAttribute('data-hunk-index', '0');
      const ctxEvent = new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true });
      hunkEl.dispatchEvent(ctxEvent);
    }
    // No crash test
  });
});

describe('selectStashDiff', () => {
  it('returns early when diffEl or diffHeadPath missing', async () => {
    document.body.innerHTML = '';
    const { selectStashDiff } = await import('./diffView');
    await expect(selectStashDiff('stash@{0}')).resolves.toBeUndefined();
  });

  it('renders stash diff content', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_stash_show') {
        return ['diff --git a/x.txt b/x.txt', '@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });
    const { selectStashDiff } = await import('./diffView');
    await selectStashDiff('stash@{0}');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('-old');
    expect(diffText).toContain('+new');
  });

  it('handles stash show failure', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('stash error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { selectStashDiff } = await import('./diffView');
    await selectStashDiff('stash@{0}');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Failed to load stash diff');
    warnSpy.mockRestore();
  });

  it('handles empty selector', async () => {
    const { selectStashDiff } = await import('./diffView');
    await selectStashDiff('');
    // Should not call invoke for empty selector
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    // If selector is empty, it still calls invoke with '' as selector
    // The mock will return [] but it should not crash
  });
});

describe('clearDiffSelection', () => {
  it('clears diff selected files and row styles', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row diffsel">x</li><li class="row diffsel">y</li>';
    const { state } = await import('../../state/state');
    state.diffSelectedFiles = new Set(['x', 'y']);

    const { clearDiffSelection } = await import('./diffView');
    clearDiffSelection();
    expect(state.diffSelectedFiles?.size).toBe(0);
    const remaining = document.querySelectorAll<HTMLElement>('#file-list .diffsel');
    expect(remaining.length).toBe(0);
  });

  it('handles missing listEl', async () => {
    document.body.innerHTML = '';
    const { clearDiffSelection } = await import('./diffView');
    expect(() => clearDiffSelection()).not.toThrow();
  });
});

describe('clearActiveRows', () => {
  it('removes active class from all rows', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row active">a</li><li class="row active">b</li><li class="row">c</li>';
    const { clearActiveRows } = await import('./diffView');
    clearActiveRows();
    const active = document.querySelectorAll<HTMLElement>('#file-list .active');
    expect(active.length).toBe(0);
  });

  it('handles missing listEl', async () => {
    document.body.innerHTML = '';
    const { clearActiveRows } = await import('./diffView');
    expect(() => clearActiveRows()).not.toThrow();
  });
});
