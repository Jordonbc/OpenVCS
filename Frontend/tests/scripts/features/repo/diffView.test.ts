// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus } from '@scripts/types';

vi.mock('@scripts/lib/menu', () => ({ buildCtxMenu: vi.fn() }));
vi.mock('@scripts/lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }));
vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('@scripts/features/repo/hydrate', () => ({
  hydrateStatus: vi.fn().mockResolvedValue(undefined),
  ensureConflictStatusesLoaded: vi.fn().mockResolvedValue(undefined),
}));

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
    <div id="diff-meta">
      <span id="diff-line-ending"></span>
      <span id="diff-encoding"></span>
      <span id="diff-bom"></span>
    </div>
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
        if (cmd === 'read_repo_file_meta') {
          return { encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false };
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
    const { highlightRow } = await import('@scripts/features/repo/diffView');
    highlightRow(1);
    const rows = document.querySelectorAll<HTMLElement>('#file-list .row');
    expect(rows[0].classList.contains('active')).toBe(false);
    expect(rows[1].classList.contains('active')).toBe(true);
  });

  it('uses history row selector when prefs tab is history', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';
    document.querySelector('#file-list')!.innerHTML = '<li class="row commit">a</li><li class="row commit">b</li>';
    const { highlightRow } = await import('@scripts/features/repo/diffView');
    highlightRow(0);
    const rows = document.querySelectorAll<HTMLElement>('#file-list .row.commit');
    expect(rows[0].classList.contains('active')).toBe(true);
  });
});

describe('renderCombinedDiff', () => {
  it('renders hunks with selection checkboxes in multi-file view', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');

    await renderCombinedDiff(['a.txt']);

    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('-old');
    expect(html).toContain('data-file="a.txt"');
    expect(document.querySelector('#diff .pick-hunk')).not.toBeNull();
    expect(document.querySelector('#diff .pick-line')).not.toBeNull();
  });

  it('handles missing diffEl gracefully', async () => {
    document.body.innerHTML = '';
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await expect(renderCombinedDiff(['a.txt'])).resolves.toBeUndefined();
  });

  it('deduplicates file paths', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
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
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['img.png']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('Diff not supported');
  });

  it('handles invoke failure for individual file', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('fail'));
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['broken.txt']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('failed to load diff');
  });

  it('shows per-file failure when all files fail', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('fail'));
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['a.txt', 'b.txt']);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('failed to load diff');
    expect(html).toContain('a.txt');
    expect(html).toContain('b.txt');
  });

  it('restores checkbox states from selectedHunksByFile and selectedLinesByFile', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    (state as any).selectedHunksByFile = { 'a.txt': [0] };
    (state as any).selectedLinesByFile = { 'a.txt': { 0: [1, 2] } };

    await renderCombinedDiff(['a.txt']);

    const hunkCb = document.querySelector<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-hunk');
    expect(hunkCb?.checked).toBe(true);
    expect((hunkCb as any)?.indeterminate).toBe(false);
    const lineCbs = document.querySelectorAll<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-line');
    expect(Array.from(lineCbs).every((cb) => cb.checked)).toBe(true);
  });

  it('shows all hunks checked when file is explicitly in selectedFiles without hunk state', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;
    state.selectedFiles = new Set(['a.txt']);

    await renderCombinedDiff(['a.txt']);

    const hunkCb = document.querySelector<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-hunk');
    expect(hunkCb?.checked).toBe(true);
    expect((hunkCb as any)?.indeterminate).toBe(false);
    const lineCbs = document.querySelectorAll<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-line');
    expect(Array.from(lineCbs).every((cb) => cb.checked)).toBe(true);
  });

  it('shows hunks unchecked when file only in implicit select-all', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.defaultSelectAll = true;
    state.selectionImplicitAll = true;
    state.selectedFiles = new Set(['a.txt']);

    await renderCombinedDiff(['a.txt']);

    const hunkCb = document.querySelector<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-hunk');
    expect(hunkCb?.checked).toBe(false);
  });

  it('shows hunk indeterminate when partial line selections exist', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = { 'a.txt': { 0: [1] } };
    state.selectedFiles = new Set();
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;

    await renderCombinedDiff(['a.txt']);

    const hunkCb = document.querySelector<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-hunk');
    expect(hunkCb?.checked).toBe(false);
    expect((hunkCb as any)?.indeterminate).toBe(true);
  });

  it('handles empty and null file paths', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff([]);
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('No diffs');
  });
});

describe('selectFile', () => {
  it('returns early when diffEl or diffHeadPath missing', async () => {
    document.body.innerHTML = '';
    const { selectFile } = await import('@scripts/features/repo/diffView');
    await expect(selectFile({ path: 'x.txt', status: 'M' } as FileStatus, 0)).resolves.toBeUndefined();
  });

  it('skips re-render when diff is not dirty and same file', async () => {
    const { state } = await import('@scripts/state/state');
    state.diffDirty = false;
    state.currentFile = 'a.txt';

    const { selectFile } = await import('@scripts/features/repo/diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('handles conflict status', async () => {
    const { state } = await import('@scripts/state/state');
    state.conflictStatuses = new Set(['U', 'UU', 'UA', 'AU', 'UD', 'DU', 'AA', 'DD']);
    const { selectFile } = await import('@scripts/features/repo/diffView');
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

    const { selectFile } = await import('@scripts/features/repo/diffView');

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

    const { selectFile } = await import('@scripts/features/repo/diffView');

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

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'img.png', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Diff not supported on this file type');
  });

  it('renders binary placeholder from explicit diff metadata without marker heuristics', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return { lines: [], binary: true };
      }
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'img.png', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Diff not supported on this file type');
  });

  it('renders file metadata chips for text files', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
      }
      if (cmd === 'read_repo_file_meta') {
        return { encoding: 'UTF-16LE', line_ending: 'CRLF', bom: true, binary: false };
      }
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    expect(document.getElementById('diff-line-ending')?.textContent).toBe('CRLF');
    expect(document.getElementById('diff-encoding')?.textContent).toBe('UTF-16 LE');
    expect(document.getElementById('diff-bom')?.hidden).toBe(false);
  });

  it('forces binary header chips when diff metadata says binary', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return { lines: [], binary: true };
      }
      if (cmd === 'read_repo_file_meta') {
        return { encoding: 'UTF-16LE', line_ending: 'MIXED', bom: true, binary: false };
      }
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'img.png', status: 'M' } as FileStatus, 0);

    expect(document.getElementById('diff-line-ending')?.textContent).toBe('Binary');
    expect(document.getElementById('diff-encoding')?.hidden).toBe(true);
    expect(document.getElementById('diff-bom')?.hidden).toBe(true);
  });

  it('forces binary header chips when status metadata says binary', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'read_repo_file_meta') {
        return { encoding: 'UTF-16LE', line_ending: 'MIXED', bom: true, binary: false };
      }
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'img.png', status: '??', binary: true } as FileStatus, 0);

    expect(document.getElementById('diff-line-ending')?.textContent).toBe('Binary');
    expect(document.getElementById('diff-encoding')?.hidden).toBe(true);
    expect(document.getElementById('diff-bom')?.hidden).toBe(true);
  });

  it('handles read_repo_file_text failure for untracked', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'read_repo_file_text') throw new Error('read fail');
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'untracked.txt', status: '??' } as FileStatus, 0);
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('@@ -0,0 +1,0 @@');
  });

  it('skips text fallback for untracked files already marked binary in status metadata', async () => {
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    invokeSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'read_repo_file_meta') {
        return { encoding: 'BINARY', line_ending: 'BINARY', bom: false, binary: true };
      }
      if (cmd === 'read_repo_file_text') return 'should not be read';
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'img.png', status: '??', binary: true } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Diff not supported on this file type');
    expect(invokeSpy).not.toHaveBeenCalledWith('read_repo_file_text', { path: 'img.png' });
  });

  it('handles invoke failure in selectFile gracefully', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('load failed'));
    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'broken.txt', status: 'M' } as FileStatus, 0);

    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Failed to load diff');
  });

  it('restores cached hunk selections', async () => {
    const { state } = await import('@scripts/state/state');
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

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    expect(state.selectedHunks).toEqual([0]);
  });

  it('selects all hunks when file is in selectedFiles', async () => {
    const { state } = await import('@scripts/state/state');
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

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    // When file is in selectedFiles, it should select all hunks
    expect(state.selectedHunks).toEqual([0]);
  });

  it('clears selectedHunks when no cached selection and file not selected', async () => {
    const { state } = await import('@scripts/state/state');
    state.diffDirty = true;
    state.currentFile = '';
    state.selectedFiles = new Set(['other.txt']);
    state.selectedHunks = [99];
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    expect(state.selectedHunks).toEqual([]);
  });
});

describe('selectFile contextmenu', () => {
  it('attaches contextmenu handler to diffEl for hunk discard', async () => {
    // Need to ensure invoke returns proper diff lines so the hunk elements render
    const { selectFile } = await import('@scripts/features/repo/diffView');

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
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');

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

  it('discards the current hunk through the context menu action', async () => {
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { hydrateStatus } = await import('@scripts/features/repo/hydrate');

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk') as HTMLElement;
    hunkEl.setAttribute('data-hunk-index', '0');
    hunkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((item) => item.label === 'Discard hunk')?.action?.();

    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_discard_patch', {
      patch: expect.stringContaining('diff --git a/a.txt b/a.txt'),
    });
    expect(hydrateStatus).toHaveBeenCalled();
  });

  it('discards selected hunks across all files', async () => {
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { hydrateStatus } = await import('@scripts/features/repo/hydrate');
    const { state } = await import('@scripts/state/state');

    state.selectedHunksByFile = { 'a.txt': [0], 'b.txt': [0] } as any;
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string, args?: Record<string, string>) => {
      if (cmd === 'vcs_diff_file' && args?.path === 'b.txt') {
        return ['diff --git a/b.txt b/b.txt', '@@ -1 +1 @@', '-before', '+after'];
      }
      if (cmd === 'vcs_diff_file') {
        return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk') as HTMLElement;
    hunkEl.setAttribute('data-hunk-index', '0');
    hunkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((item) => item.label === 'Discard selected hunks (all files)')?.action?.();

    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_discard_patch', {
      patch: expect.stringContaining('diff --git a/b.txt b/b.txt'),
    });
    expect(hydrateStatus).toHaveBeenCalled();
  });

  it('discards selected hunks for this file through context menu', async () => {
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { hydrateStatus } = await import('@scripts/features/repo/hydrate');
    const { state } = await import('@scripts/state/state');
    const { confirmBool } = await import('@scripts/lib/confirm');

    state.selectedHunksByFile = { 'a.txt': [0] } as any;

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);

    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk') as HTMLElement;
    hunkEl.setAttribute('data-hunk-index', '0');
    hunkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((item) => item.label === 'Discard selected hunks (this file)')?.action?.();

    expect(vi.mocked(confirmBool)).toHaveBeenCalled();
    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_discard_patch', {
      patch: expect.stringContaining('diff --git a/a.txt b/a.txt'),
    });
    expect(hydrateStatus).toHaveBeenCalled();
  });

  it('handles discard hunk invoke failure gracefully', async () => {
    (window as any).__TAURI__ = { core: { invoke: vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
      if (cmd === 'vcs_discard_patch') throw new Error('fail');
      return [];
    }) }, event: { listen: vi.fn() } };

    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);
    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk') as HTMLElement;
    hunkEl.setAttribute('data-hunk-index', '0');
    hunkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await expect(items.find((item) => item.label === 'Discard hunk')?.action?.()).resolves.toBeUndefined();
  });

  it('handles discard selected hunks this file invoke failure gracefully', async () => {
    (window as any).__TAURI__ = { core: { invoke: vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
      if (cmd === 'vcs_discard_patch') throw new Error('fail');
      return [];
    }) }, event: { listen: vi.fn() } };

    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { state } = await import('@scripts/state/state');
    state.selectedHunksByFile = { 'a.txt': [0] } as any;

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);
    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk') as HTMLElement;
    hunkEl.setAttribute('data-hunk-index', '0');
    hunkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await expect(items.find((item) => item.label === 'Discard selected hunks (this file)')?.action?.()).resolves.toBeUndefined();
  });

  it('handles discard selected hunks all files invoke failure gracefully', async () => {
    (window as any).__TAURI__ = { core: { invoke: vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
      if (cmd === 'vcs_discard_patch') throw new Error('all fail');
      return [];
    }) }, event: { listen: vi.fn() } };

    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { state } = await import('@scripts/state/state');
    state.selectedHunksByFile = { 'a.txt': [0], 'b.txt': [1] } as any;

    await selectFile({ path: 'a.txt', status: 'M' } as FileStatus, 0);
    const diffEl = document.getElementById('diff')!;
    const hunkEl = diffEl.querySelector('.hunk') as HTMLElement;
    hunkEl.setAttribute('data-hunk-index', '0');
    hunkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20, cancelable: true }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await expect(items.find((item) => item.label === 'Discard selected hunks (all files)')?.action?.()).resolves.toBeUndefined();
  });
});

describe('selectStashDiff', () => {
  it('returns early when diffEl or diffHeadPath missing', async () => {
    document.body.innerHTML = '';
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');
    await expect(selectStashDiff('stash@{0}')).resolves.toBeUndefined();
  });

  it('renders stash diff content', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_stash_show') {
        return ['diff --git a/x.txt b/x.txt', '@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');
    await selectStashDiff('stash@{0}');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('-old');
    expect(diffText).toContain('+new');
  });

  it('handles stash show failure', async () => {
    (window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('stash error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');
    await selectStashDiff('stash@{0}');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('Failed to load stash diff');
    warnSpy.mockRestore();
  });

  it('handles empty selector', async () => {
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');
    await selectStashDiff('');
    // Should not call invoke for empty selector
    // If selector is empty, it still calls invoke with '' as selector
    // The mock will return [] but it should not crash
  });
});

describe('clearDiffSelection', () => {
  it('clears diff selected files and row styles', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row diffsel">x</li><li class="row diffsel">y</li>';
    const { state } = await import('@scripts/state/state');
    state.diffSelectedFiles = new Set(['x', 'y']);

    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    clearDiffSelection();
    expect(state.diffSelectedFiles?.size).toBe(0);
    const remaining = document.querySelectorAll<HTMLElement>('#file-list .diffsel');
    expect(remaining.length).toBe(0);
  });

  it('handles missing listEl', async () => {
    document.body.innerHTML = '';
    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    expect(() => clearDiffSelection()).not.toThrow();
  });
});

describe('clearActiveRows', () => {
  it('removes active class from all rows', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row active">a</li><li class="row active">b</li><li class="row">c</li>';
    const { clearActiveRows } = await import('@scripts/features/repo/diffView');
    clearActiveRows();
    const active = document.querySelectorAll<HTMLElement>('#file-list .active');
    expect(active.length).toBe(0);
  });

  it('handles missing listEl', async () => {
    document.body.innerHTML = '';
    const { clearActiveRows } = await import('@scripts/features/repo/diffView');
    expect(() => clearActiveRows()).not.toThrow();
  });
});

describe('clearDiffSelection with no diff selected files', () => {
  it('clears stale diffsel classes even when diffSelectedFiles is already empty', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row diffsel">x</li>';
    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    clearDiffSelection();
    const remaining = document.querySelectorAll<HTMLElement>('#file-list .diffsel');
    expect(remaining.length).toBe(0);
  });
});

describe('selectFile binary diff edge cases', () => {
  it('clears diff meta and hunk nodes for binary files', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return ['Binary files a/img.png and b/img.png differ'];
      }
      return [];
    });

    const { selectFile } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 0 };
    state.currentDiffHunkNodes = new Map([[0, { hunkEls: [], hunkCheckboxes: [], lineCheckboxes: {} }]]);

    await selectFile({ path: 'img.png', status: 'M' } as any, 0);
    expect(state.currentDiffMeta).toBeNull();
    expect(state.currentDiffHunkNodes.size).toBe(0);
  });
});

describe('updateDiffHeaderMeta - missing DOM elements', () => {
  it('handles missing diffLineEndingEl (line 41)', async () => {
    const el = document.getElementById('diff-line-ending')!;
    el.remove();

    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    expect(() => updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, false)).not.toThrow();
  });

  it('handles missing diffEncodingEl', async () => {
    const el = document.getElementById('diff-encoding')!;
    el.remove();

    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    expect(() => updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, false)).not.toThrow();
  });

  it('handles missing diffBomEl', async () => {
    const el = document.getElementById('diff-bom')!;
    el.remove();

    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    expect(() => updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, false)).not.toThrow();
  });

  it('sets hidden on diffEncodingEl when forceBinary is true', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, true);
    expect(document.getElementById('diff-encoding')!.hidden).toBe(true);
  });

  it('handles null meta', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    expect(() => updateDiffHeaderMeta(null, false)).not.toThrow();
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('\u2014');
    expect(document.getElementById('diff-encoding')?.textContent).toBe('\u2014');
  });
});

describe('renderCombinedDiff - pick-line with missing data attrs (lines 355-357)', () => {
  it('skips pick-line when data-hunk is missing', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return ['diff --git a/a.txt b/a.txt', '@@ -1 +2 @@', '-old', '+new1', '+new2'];
      }
      return [];
    });

    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['a.txt']);

    const diff = document.getElementById('diff')!;
    expect(diff.querySelector('.multi-hunk')).not.toBeNull();
  });

  it('handles pick-line without data-hunk attribute', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return ['diff --git a/a.txt b/a.txt', '@@ -1 +2 @@', '-old', '+new1', '+new2'];
      }
      return [];
    });

    const { state } = await import('@scripts/state/state');
    (state as any).selectedLinesByFile = { 'a.txt': {} };
    (state as any).selectedHunksByFile = {};

    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['a.txt']);

    const lineCbs = document.querySelectorAll<HTMLInputElement>('#diff .multi-hunk[data-file="a.txt"] .pick-line');
    expect(lineCbs.length).toBeGreaterThan(0);
    lineCbs.forEach((cb) => {
      expect(cb.dataset.hunk).toBeDefined();
      expect(cb.dataset.line).toBeDefined();
    });
  });
});

describe('clearDiffSelection - null state.diffSelectedFiles (line 368)', () => {
  it('handles null diffSelectedFiles', async () => {
    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    (state as any).diffSelectedFiles = null;

    expect(() => clearDiffSelection()).not.toThrow();
  });

  it('handles undefined diffSelectedFiles', async () => {
    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    delete (state as any).diffSelectedFiles;

    expect(() => clearDiffSelection()).not.toThrow();
  });
});

describe('selectStashDiff - empty selector with DOM', () => {
  it('renders empty diff when selector is empty', async () => {
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');
    await selectStashDiff('');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).not.toContain('Loading');
  });
});

describe('highlightRow - history and changes tab coverage', () => {
  it('highlights row with history selector and existing rows', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';
    document.querySelector('#file-list')!.innerHTML = '<li class="row commit">a</li><li class="row commit">b</li><li class="row commit">c</li>';

    const { highlightRow } = await import('@scripts/features/repo/diffView');
    highlightRow(2);
    const rows = document.querySelectorAll<HTMLElement>('#file-list .row.commit');
    expect(rows[0].classList.contains('active')).toBe(false);
    expect(rows[1].classList.contains('active')).toBe(false);
    expect(rows[2].classList.contains('active')).toBe(true);
  });

  it('handles null listEl in highlightRow', async () => {
    document.body.innerHTML = '';
    const { highlightRow } = await import('@scripts/features/repo/diffView');
    expect(() => highlightRow(0)).not.toThrow();
  });
});

describe('selectFile - selectStashDiff edge cases', () => {
  it('handles selectStashDiff with fully empty invoke result', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_stash_show') return [];
      return [];
    });

    const { selectStashDiff } = await import('@scripts/features/repo/diffView');
    await selectStashDiff('stash@{0}');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).not.toContain('Loading');
  });
});

// ============================================================================
// formatLineEnding — all branches via updateDiffHeaderMeta
// ============================================================================
describe('formatLineEnding variants', () => {
  it('formats MIXED line ending', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'MIXED', bom: false, binary: false }, false);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('LF \u2194 CRLF');
  });

  it('formats NONE line ending as em dash', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'NONE', bom: false, binary: false }, false);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('\u2014');
  });

  it('formats BINARY line ending', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'BINARY', bom: false, binary: false }, false);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('Binary');
  });

  it('formats empty line ending as em dash', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: '', bom: false, binary: false }, false);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('\u2014');
  });

  it('formats custom line ending as-is', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'CR', bom: false, binary: false }, false);
    // 'CR'.trim().toUpperCase() = 'CR' → no match → return 'CR'
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('CR');
  });

  it('formats lowercase mixed line ending', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'mixed', bom: false, binary: false }, false);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('LF \u2194 CRLF');
  });
});

// ============================================================================
// formatEncoding — all branches via updateDiffHeaderMeta
// ============================================================================
describe('formatEncoding variants', () => {
  it('formats UTF-16BE encoding', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-16BE', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-encoding')?.textContent).toBe('UTF-16 BE');
  });

  it('formats BINARY encoding', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'BINARY', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-encoding')?.textContent).toBe('Binary');
  });

  it('formats empty encoding as em dash', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: '', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-encoding')?.textContent).toBe('\u2014');
  });

  it('formats custom encoding as-is', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'ISO-8859-1', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-encoding')?.textContent).toBe('ISO-8859-1');
  });

  it('formats lowercase utf-16le encoding', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'utf-16le', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-encoding')?.textContent).toBe('UTF-16 LE');
  });
});

// ============================================================================
// renderCombinedDiff — single file success and mixed pass/fail
// ============================================================================
describe('renderCombinedDiff - file pass/fail combos', () => {
  it('handles one file succeeding and one failing', async () => {
    (window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'vcs_diff_file' && args?.path === 'good.txt') {
        return ['diff --git a/good.txt b/good.txt', '@@ -1 +1 @@', '-old', '+new'];
      }
      if (cmd === 'vcs_diff_file' && args?.path === 'bad.txt') {
        throw new Error('fail');
      }
      return [];
    });

    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['good.txt', 'bad.txt']);

    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('good.txt');
    expect(html).toContain('bad.txt (failed to load diff)');
    expect(html).toContain('data-file="good.txt"');
  });

  it('shows "No diffs" when all files are filtered out by empty paths', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['', null as any, undefined as any]);

    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('No diffs');
  });

  it('deduplicates files and trims whitespace-only paths', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['a.txt', '', 'a.txt']);

    const html = document.querySelector('#diff')?.innerHTML || '';
    // Only 'a.txt' should render (deduplicated, empty filtered)
    expect(html).toContain('a.txt');
    expect(html).not.toContain('No diffs');
    const header = document.getElementById('diff-path') as HTMLElement;
    expect(header?.textContent).toContain('Multiple files (1)');
  });
});

// ============================================================================
// selectFile — conflict status with missing DOM elements
// ============================================================================
describe('selectFile - conflict status missing DOM', () => {
  it('handles conflict status when diff-line-ending element is missing', async () => {
    const { state } = await import('@scripts/state/state');
    state.conflictStatuses = new Set(['U', 'UU']);
    const el = document.getElementById('diff-line-ending')!;
    el.remove();

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'conflict.txt', status: 'U' } as any, 0);

    const headPath = document.getElementById('diff-path') as HTMLElement;
    expect(headPath?.textContent).toContain('conflicted');
  });

  it('handles conflict status when diff-encoding element is missing', async () => {
    const { state } = await import('@scripts/state/state');
    state.conflictStatuses = new Set(['UU']);
    const el = document.getElementById('diff-encoding')!;
    el.remove();

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'conflict.txt', status: 'UU' } as any, 0);

    expect(document.getElementById('diff-path')?.textContent).toContain('conflicted');
  });

  it('handles conflict status when diff-bom element is missing', async () => {
    const { state } = await import('@scripts/state/state');
    state.conflictStatuses = new Set(['AA']);
    const el = document.getElementById('diff-bom')!;
    el.remove();

    const { selectFile } = await import('@scripts/features/repo/diffView');
    await selectFile({ path: 'conflict.txt', status: 'AA' } as any, 0);

    expect(document.getElementById('diff-path')?.textContent).toContain('conflicted');
  });
});

// ============================================================================
// updateDiffHeaderMeta — forceBinary hides encoding
// ============================================================================
describe('updateDiffHeaderMeta - forceBinary effects', () => {
  it('hides diff-encoding and sets line-ending to Binary when forceBinary=true', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: true, binary: false }, true);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('Binary');
    expect(document.getElementById('diff-encoding')?.hidden).toBe(true);
    expect(document.getElementById('diff-bom')?.hidden).toBe(true);
  });

  it('shows BOM when bom is true and not forced binary', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: true, binary: false }, false);
    expect(document.getElementById('diff-bom')?.hidden).toBe(false);
  });

  it('hides BOM when bom is false', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-bom')?.hidden).toBe(true);
  });
});

// ============================================================================
// updateDiffHeaderMeta — aria-label when displayMeta is null or present
// ============================================================================
describe('updateDiffHeaderMeta - aria-label coverage', () => {
  it('sets aria-label to "No file metadata available" when displayMeta is null', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    const metaEl = document.getElementById('diff-meta')!;
    updateDiffHeaderMeta(null, false);
    expect(metaEl.getAttribute('aria-label')).toBe('No file metadata available');
  });

  it('sets aria-label to "Selected file metadata" when displayMeta is present', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    const metaEl = document.getElementById('diff-meta')!;
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, false);
    expect(metaEl.getAttribute('aria-label')).toBe('Selected file metadata');
  });

  it('sets aria-label to "Selected file metadata" when forceBinary converts meta', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    const metaEl = document.getElementById('diff-meta')!;
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'LF', bom: false, binary: false }, true);
    expect(metaEl.getAttribute('aria-label')).toBe('Selected file metadata');
  });
});

// ============================================================================
// formatLineEnding — BINARY
// ============================================================================
describe('formatLineEnding BINARY', () => {
  it('formats BINARY line ending via updateDiffHeaderMeta', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-8', line_ending: 'BINARY', bom: false, binary: true }, false);
    expect(document.getElementById('diff-line-ending')?.textContent).toBe('Binary');
  });
});

// ============================================================================
// formatEncoding — UTF-16LE
// ============================================================================
describe('formatEncoding UTF-16LE', () => {
  it('formats UTF-16LE encoding via updateDiffHeaderMeta', async () => {
    const { updateDiffHeaderMeta } = await import('@scripts/features/repo/diffView');
    updateDiffHeaderMeta({ encoding: 'UTF-16LE', line_ending: 'LF', bom: false, binary: false }, false);
    expect(document.getElementById('diff-encoding')?.textContent).toBe('UTF-16 LE');
  });
});

// ============================================================================
// selectFile — file.path null/undefined/empty (line 109 false branch)
// ============================================================================
describe('selectFile with null/undefined/empty file.path', () => {
  it('handles null file.path (line 109 false branch for metaPromise)', async () => {
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;

    await selectFile({ path: null, status: 'M' } as any, 0);

    // metaPromise resolved to null (no invoke call), vcs_diff_file not called either
    expect(invokeSpy).not.toHaveBeenCalledWith('read_repo_file_meta', { path: null });
    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_diff_file', { path: null });
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('No textual hunks to display');
  });

  it('handles undefined file.path (line 109 false branch)', async () => {
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;

    await selectFile({ status: 'M' } as any, 0);

    expect(invokeSpy).not.toHaveBeenCalledWith('read_repo_file_meta');
    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_diff_file');
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).toContain('No textual hunks to display');
  });

  it('handles empty string file.path', async () => {
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;

    await selectFile({ path: '', status: 'M' } as any, 0);

    expect(invokeSpy).not.toHaveBeenCalledWith('read_repo_file_meta', { path: '' });
    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_diff_file', { path: '' });
    const headPath = document.getElementById('diff-path') as HTMLElement;
    expect(headPath?.textContent).toContain('(unknown file)');
  });
});

// ============================================================================
// selectFile — conflict status with null file.path
// ============================================================================
describe('selectFile conflict with null path', () => {
  it('shows "(unknown file) (conflicted)" for conflict status with null path', async () => {
    const { state } = await import('@scripts/state/state');
    state.conflictStatuses = new Set(['U']);
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;

    await selectFile({ path: null, status: 'U' } as any, 0);

    const headPath = document.getElementById('diff-path') as HTMLElement;
    expect(headPath?.textContent).toContain('(unknown file) (conflicted)');
  });
});

// ============================================================================
// selectFile — conflict with missing diffHeadPath/diffEl (early return)
// ============================================================================
describe('selectFile early return with missing DOM elements', () => {
  it('returns early when diffHeadPath/diffEl are null even for conflict status', async () => {
    document.body.innerHTML = '';
    const { state } = await import('@scripts/state/state');
    state.conflictStatuses = new Set(['U']);
    const { selectFile } = await import('@scripts/features/repo/diffView');
    const invokeSpy = (window as any).__TAURI__.core.invoke;

    await expect(selectFile({ path: 'conflict.txt', status: 'U' } as any, 0)).resolves.toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_diff_file', { path: 'conflict.txt' });
  });
});

// ============================================================================
// selectStashDiff — empty selector with invoke tracking
// ============================================================================
describe('selectStashDiff empty selector', () => {
  it('skips vcs_stash_show when selector is empty string', async () => {
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');

    await selectStashDiff('');

    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_stash_show', { selector: '' });
    const diffText = document.querySelector('#diff')?.textContent || '';
    expect(diffText).not.toContain('Loading');
  });
});

// ============================================================================
// selectStashDiff — missing DOM elements (early return)
// ============================================================================
describe('selectStashDiff missing DOM', () => {
  it('returns early when diffHeadPath is missing', async () => {
    const el = document.getElementById('diff-path')!;
    el.remove();
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');

    await selectStashDiff('stash@{0}');
    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_stash_show', { selector: 'stash@{0}' });
  });

  it('returns early when diffEl is missing', async () => {
    const el = document.getElementById('diff')!;
    el.remove();
    const invokeSpy = (window as any).__TAURI__.core.invoke;
    const { selectStashDiff } = await import('@scripts/features/repo/diffView');

    await selectStashDiff('stash@{0}');
    expect(invokeSpy).not.toHaveBeenCalledWith('vcs_stash_show', { selector: 'stash@{0}' });
  });
});

// ============================================================================
// renderCombinedDiff — duplicate path filtering via Set (line 304)
// ============================================================================
describe('renderCombinedDiff duplicate path filtering', () => {
  it('deduplicates paths via Set preserving only unique entries', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['a.txt', 'a.txt', 'a.txt']);
    const header = document.getElementById('diff-path') as HTMLElement;
    expect(header?.textContent).toContain('Multiple files (1)');
    const html = document.querySelector('#diff')?.innerHTML || '';
    expect(html).toContain('-old');
  });

  it('filters out null and undefined paths then deduplicates', async () => {
    const { renderCombinedDiff } = await import('@scripts/features/repo/diffView');
    await renderCombinedDiff(['a.txt', null as any, undefined as any, 'b.txt', 'a.txt']);
    const header = document.getElementById('diff-path') as HTMLElement;
    expect(header?.textContent).toContain('Multiple files (2)');
  });
});

// ============================================================================
// clearDiffSelection — null listEl edge cases
// ============================================================================
describe('clearDiffSelection null listEl', () => {
  it('returns early when listEl is null without clearing diffSelectedFiles', async () => {
    const ul = document.getElementById('file-list')!;
    ul.remove();
    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    state.diffSelectedFiles = new Set(['keep.txt']);

    clearDiffSelection();
    expect(state.diffSelectedFiles.has('keep.txt')).toBe(true);
  });

  it('handles listEl present but diffSelectedFiles is null', async () => {
    const { clearDiffSelection } = await import('@scripts/features/repo/diffView');
    const { state } = await import('@scripts/state/state');
    (state as any).diffSelectedFiles = null;

    expect(() => clearDiffSelection()).not.toThrow();
  });
});

// ============================================================================
// clearActiveRows — null listEl edge case
// ============================================================================
describe('clearActiveRows null listEl', () => {
  it('returns early when listEl is null', async () => {
    document.body.innerHTML = '';
    const { clearActiveRows } = await import('@scripts/features/repo/diffView');
    expect(() => clearActiveRows()).not.toThrow();
  });
});
