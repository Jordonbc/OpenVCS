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
    // invoke should NOT be called since diff is clean and same file
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
    // Should fallback to empty untracked patch
    expect(diffText).toContain('@@ -0,0 +1,0 @@');
  });

  it('handles invoke failure in selectFile gracefully', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('load failed'));
    const { selectFile } = await import('./diffView');
    await selectFile({ path: 'broken.txt', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Failed to load diff');
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
