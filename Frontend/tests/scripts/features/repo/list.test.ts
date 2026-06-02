// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@scripts/ui/layout', () => ({
  refreshRepoActions: vi.fn(),
}));

vi.mock('@scripts/features/repo/history', () => ({
  renderHistoryList: vi.fn(),
}));

vi.mock('@scripts/features/repo/stash', () => ({
  renderStashList: vi.fn(),
  showStashFooter: vi.fn(),
  hideStashFooter: vi.fn(),
  setRenderListRef: vi.fn(),
}));

vi.mock('@scripts/features/repo/diffView', () => ({
  renderCombinedDiff: vi.fn(),
  selectFile: vi.fn(),
  toggleFilePick: vi.fn(),
  updateDiffHeaderMeta: vi.fn(),
}));

vi.mock('@scripts/features/repo/interactions', () => ({
  onFileClick: vi.fn(),
  onFileMouseDown: vi.fn(),
  onFileContextMenu: vi.fn(),
  setRenderListCallback: vi.fn(),
  isDragSelecting: vi.fn(() => false),
  setDragCurrentIndex: vi.fn(),
  updateDragRange: vi.fn(),
}));

vi.mock('@scripts/features/repo/commit', () => ({
  updateCommitButton: vi.fn(),
}));

function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

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

beforeEach(() => {
  vi.resetModules();
  mountRepoDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('wireRenderListCallbacks', () => {
  it('registers renderList as both list ref and callback', async () => {
    const stash = await import('@scripts/features/repo/stash');
    const interactions = await import('@scripts/features/repo/interactions');
    const { wireRenderListCallbacks, renderList } = await import('@scripts/features/repo/list');

    wireRenderListCallbacks();
    expect(vi.mocked(stash.setRenderListRef)).toHaveBeenCalledWith(renderList);
    expect(vi.mocked(interactions.setRenderListCallback)).toHaveBeenCalledWith(renderList);
  });
});

describe('renderList', () => {
  it('returns early when required DOM elements are missing', async () => {
    document.body.innerHTML = '';
    const { renderList } = await import('@scripts/features/repo/list');
    expect(() => renderList()).not.toThrow();
  });

  it('renders changes list when tab is changes', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'a.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();

    const fileList = document.getElementById('file-list') as HTMLElement;
    expect(fileList.innerHTML).not.toBe('');
    const rows = fileList.querySelectorAll('li.row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-path')).toBe('a.txt');
  });

  it('renders history list when tab is history', async () => {
    const history = await import('@scripts/features/repo/history');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';

    renderList();
    expect(vi.mocked(history.renderHistoryList)).toHaveBeenCalled();
  });

  it('renders stash list when tab is stash', async () => {
    const stash = await import('@scripts/features/repo/stash');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'stash';

    renderList();
    expect(vi.mocked(stash.renderStashList)).toHaveBeenCalled();
  });
});

describe('renderChangesList', () => {
  it('shows no changes message when a repo is selected and files list is empty', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.hasRepo = true;
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();

    renderList();

    const fileList = document.getElementById('file-list') as HTMLElement;
    expect(fileList.innerHTML).toContain('No changes in this repository.');
    expect(fileList.classList.contains('empty-state')).toBe(true);
    expect(fileList.querySelector('.empty-state-message')).not.toBeNull();
    const diffPath = document.getElementById('diff-path') as HTMLElement;
    expect(diffPath.textContent).toBe('Select a file to view changes');
  });

  it('shows no repository message when no repo is open', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.hasRepo = false;
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();

    renderList();

    const fileList = document.getElementById('file-list') as HTMLElement;
    expect(fileList.innerHTML).toContain('No repository is open. Clone or add a repository to get started.');
  });

  it('filters files by query in filter input', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.rs', status: 'A' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    (document.getElementById('filter') as HTMLInputElement).value = '.rs';

    renderList();

    const fileList = document.getElementById('file-list') as HTMLElement;
    const rows = fileList.querySelectorAll('li.row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-path')).toBe('b.rs');
  });

  it('shows no matching message when filter matches nothing', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.hasRepo = true;
    state.files = [{ path: 'a.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    (document.getElementById('filter') as HTMLInputElement).value = 'zzz';

    renderList();

    const fileList = document.getElementById('file-list') as HTMLElement;
    expect(fileList.innerHTML).toContain('No changes in this repository.');
  });

  it('renders file rows with correct attributes', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'src/main.rs', status: 'M' },
    ] as any;
    state.selectedFiles = new Set(['src/main.rs']);
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();

    const row = document.querySelector('li.row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('data-path')).toBe('src/main.rs');
    expect(row.classList.contains('picked')).toBe(true);
    const cb = row.querySelector('input.pick') as HTMLInputElement;
    expect(cb).not.toBeNull();
    expect(cb.checked).toBe(true);
  });

  it('shows resolved conflict styling for staged files previously in conflict', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.mergeInProgress = true;
    state.seenConflicts = new Set(['conflict.txt']);
    state.files = [
      { path: 'conflict.txt', status: 'M', staged: true },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();

    const row = document.querySelector('li.row') as HTMLElement;
    expect(row.classList.contains('resolved')).toBe(true);
  });

  it('shows renamed path for renamed files', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'new.txt', status: 'R', old_path: 'old.txt' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();

    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toContain('old.txt → new.txt');
  });

  it('adds commit-list class for history and stash tabs', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    const fileList = document.getElementById('file-list') as HTMLElement;

    prefs.tab = 'history';
    renderList();
    expect(fileList.classList.contains('commit-list')).toBe(true);

    prefs.tab = 'stash';
    renderList();
    expect(fileList.classList.contains('commit-list')).toBe(true);

    prefs.tab = 'changes';
    state.files = [] as any;
    renderList();
    expect(fileList.classList.contains('commit-list')).toBe(false);
  });

  it('renders combined diff when multiple diff selections exist', async () => {
    const diffView = await import('@scripts/features/repo/diffView');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set(['a.txt', 'b.txt']);

    renderList();

    expect(vi.mocked(diffView.renderCombinedDiff)).toHaveBeenCalledWith(['a.txt', 'b.txt']);
  });

  it('reselects the current file when exactly one diff selection is active', async () => {
    const diffView = await import('@scripts/features/repo/diffView');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set(['a.txt']);
    state.currentFile = 'b.txt';

    renderList();

    expect(vi.mocked(diffView.selectFile)).toHaveBeenCalledWith(expect.objectContaining({ path: 'b.txt' }), 1);
  });

  it('falls back to the first file when no current file is selected', async () => {
    const diffView = await import('@scripts/features/repo/diffView');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';

    renderList();

    expect(vi.mocked(diffView.selectFile)).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.txt' }), 0);
  });

  it('routes row hover updates while drag selection is active', async () => {
    const interactions = await import('@scripts/features/repo/interactions');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'drag.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    vi.mocked(interactions.isDragSelecting).mockReturnValue(true);

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect(vi.mocked(interactions.setDragCurrentIndex)).toHaveBeenCalledWith(0);
    expect(vi.mocked(interactions.updateDragRange)).toHaveBeenCalled();
  });

  it('toggles file picks from the checkbox without bubbling to row click', async () => {
    const diffView = await import('@scripts/features/repo/diffView');
    const selectionState = await import('@scripts/features/repo/selectionState');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    const updateSelectAllSpy = vi.spyOn(selectionState, 'updateSelectAllState');
    prefs.tab = 'changes';
    state.files = [{ path: 'pick.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();

    (diffView.toggleFilePick as Mock).mockImplementation((path: string, on: boolean) => {
      if (on) state.selectedFiles.add(path);
      else state.selectedFiles.delete(path);
    });

    renderList();
    const checkbox = document.querySelector('input.pick') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('click', { bubbles: true }));

    expect(vi.mocked(diffView.toggleFilePick)).toHaveBeenCalledWith('pick.txt', true);
    expect(updateSelectAllSpy).toHaveBeenCalled();
    expect(Array.from(state.selectedFiles)).toEqual(['pick.txt']);
    expect(document.querySelector('li.row')?.classList.contains('picked')).toBe(true);
  });
});

describe('renderList event handlers', () => {
  it('triggers contextmenu and mouseenter on file rows', async () => {
    const interactions = await import('@scripts/features/repo/interactions');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'ctx.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect(vi.mocked(interactions.onFileContextMenu)).toHaveBeenCalled();
    expect(vi.mocked(interactions.isDragSelecting)).toHaveBeenCalled();
  });
});

describe('renderChangesList display edge cases', () => {
  it('shows copied path for status C (copy)', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'new.txt', status: 'C', old_path: 'original.txt' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toContain('original.txt → new.txt');
  });

  it('shows resolved conflict for files with resolved_conflict flag', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'resolved.txt', status: 'M', staged: true, resolved_conflict: true },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    expect(row.classList.contains('resolved')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // displayPath false branch: status R or C with empty old_path
  // --------------------------------------------------------------------------
  it('displays path directly when status R has no old_path', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'renamed.txt', status: 'R' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toBe('renamed.txt');
  });

  it('displays path directly when status C has no old_path', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'copy.txt', status: 'C' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toBe('copy.txt');
  });

  it('displays path directly when status R has empty string old_path', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'renamed2.txt', status: 'R', old_path: '' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toBe('renamed2.txt');
  });

  it('displays path directly when status C has empty string old_path', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'copy2.txt', status: 'C', old_path: '' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toBe('copy2.txt');
  });
});

// ============================================================================
// renderList - click and mousedown on rows
// ============================================================================
describe('renderList row click and mousedown handlers', () => {
  it('click handler fires onFileClick', async () => {
    const interactions = await import('@scripts/features/repo/interactions');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'click.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vi.mocked(interactions.onFileClick)).toHaveBeenCalled();
  });

  it('mousedown handler fires onFileMouseDown', async () => {
    const interactions = await import('@scripts/features/repo/interactions');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'mousedown.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(vi.mocked(interactions.onFileMouseDown)).toHaveBeenCalled();
  });
});

// ============================================================================
// renderChangesList - staged file shows stage-mark and conflict file shows conflict-mark
// ============================================================================
describe('renderChangesList status marks', () => {
  it('renders stage-mark for staged files', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'staged.txt', status: 'M', staged: true }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const rowMarks = document.querySelector('.row-marks') as HTMLElement;
    expect(rowMarks).not.toBeNull();
    const stageMark = rowMarks.querySelector('.stage-mark') as HTMLElement;
    expect(stageMark).not.toBeNull();
  });

  it('renders conflict-mark for conflicted files', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'conflict.txt', status: 'UU' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const rowMarks = document.querySelector('.row-marks') as HTMLElement;
    expect(rowMarks).not.toBeNull();
    const conflictMark = rowMarks.querySelector('.conflict-mark') as HTMLElement;
    expect(conflictMark).not.toBeNull();
  });
});

// ============================================================================
// renderList - mouseenter edge cases (isDragSelecting false branch)
// ============================================================================
describe('renderList mouseenter edge cases', () => {
  it('does not fire drag actions when isDragSelecting returns false', async () => {
    const interactions = await import('@scripts/features/repo/interactions');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'nodrag.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    // Ensure isDragSelecting starts returning false
    (interactions.isDragSelecting as Mock).mockReturnValue(false);
    (interactions.setDragCurrentIndex as Mock).mockClear();
    (interactions.updateDragRange as Mock).mockClear();

    renderList();

    // The row was created, but isDragSelecting returns false,
    // so mouseenter should NOT trigger setDragCurrentIndex
    const row = document.querySelector('li.row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect((interactions.isDragSelecting as Mock)).toHaveBeenCalled();
    expect(interactions.setDragCurrentIndex as Mock).not.toHaveBeenCalled();
    expect(interactions.updateDragRange as Mock).not.toHaveBeenCalled();
  });

  it('handles mouseenter after isDragSelecting toggles from true to false', async () => {
    const interactions = await import('@scripts/features/repo/interactions');
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    vi.mocked(interactions.isDragSelecting).mockReturnValueOnce(true).mockReturnValueOnce(false);

    renderList();
    const rows = document.querySelectorAll('li.row');

    // First row: isDragSelecting returns true
    rows[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(vi.mocked(interactions.setDragCurrentIndex)).toHaveBeenCalledWith(0);

    // Second row: isDragSelecting returns false
    vi.mocked(interactions.setDragCurrentIndex).mockClear();
    rows[1].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(vi.mocked(interactions.setDragCurrentIndex)).not.toHaveBeenCalled();
  });
});

// ============================================================================
// renderChangesList - file path edge cases (null, undefined, spaces)
// ============================================================================
describe('renderChangesList path edge cases', () => {
  it('handles file with null path gracefully', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: null, status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('data-path')).toBe('');
  });

  it('handles file with undefined path gracefully', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: undefined, status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('data-path')).toBe('');
  });

  it('handles file with path containing leading/trailing whitespace', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: '  spaced.txt  ', status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    // displayPath uses String(f.path || '') without trim — path preserved as-is
    expect(fileDiv.textContent).toBe('  spaced.txt  ');
  });
});

// ============================================================================
// renderChangesList - null DOM elements on empty files (lines 71-72)
// ============================================================================
describe('renderChangesList null DOM on empty files', () => {
  it('does not crash when diffHeadPath is null and files is empty', async () => {
    (document.getElementById('diff-path') as HTMLElement)?.remove();
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.hasRepo = true;
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();

    expect(() => renderList()).not.toThrow();
  });

  it('does not crash when diffEl is null and files is empty', async () => {
    (document.getElementById('diff') as HTMLElement)?.remove();
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.hasRepo = true;
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();

    expect(() => renderList()).not.toThrow();
  });
});

// ============================================================================
// renderChangesList - status normalization (line 88)
// ============================================================================
describe('renderChangesList status normalization', () => {
  it('handles file with null status via toUpperCase fallback', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'nostatus.txt', status: null }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const statusDot = document.querySelector('.status-dot') as HTMLElement;
    expect(statusDot).not.toBeNull();
    // Null status becomes '' after toUpperCase fallback; statusClass('') defaults to 'mod'
    expect(statusDot.classList.contains('mod')).toBe(true);
  });

  it('handles file with undefined status via toUpperCase fallback', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'undefstatus.txt' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const statusDot = document.querySelector('.status-dot') as HTMLElement;
    expect(statusDot).not.toBeNull();
    // Undefined status falls to '' then 'mod' default
    expect(statusDot.classList.contains('mod')).toBe(true);
  });

  it('converts lowercase status to uppercase', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'lower.txt', status: 'm' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const statusDot = document.querySelector('.status-dot') as HTMLElement;
    expect(statusDot).not.toBeNull();
    // Lowercase 'm' → toUpperCase 'M' → statusClass('M') returns 'mod'
    expect(statusDot.classList.contains('mod')).toBe(true);
  });
});

// ============================================================================
// displayPath - whitespace trim for R/C paths (line 95)
// ============================================================================
describe('displayPath trim edge cases', () => {
  it('trims whitespace from path in renamed display', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: '  new.txt  ', status: 'R', old_path: 'old.txt' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toContain('old.txt → new.txt');
    expect(fileDiv.textContent).not.toContain('  new.txt  ');
  });

  it('trims whitespace from path in copy display', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: '  copy-target.txt  ', status: 'C', old_path: 'source.txt' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const fileDiv = document.querySelector('.file') as HTMLElement;
    expect(fileDiv.textContent).toContain('source.txt → copy-target.txt');
    expect(fileDiv.textContent).not.toContain('  copy-target.txt  ');
  });
});

// ============================================================================
// renderList - early return on missing specific DOM elements (line 25)
// ============================================================================
describe('renderList early return specific elements', () => {
  it('returns early when listEl is missing', async () => {
    (document.getElementById('file-list') as HTMLElement)?.remove();
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    expect(() => renderList()).not.toThrow();
  });

  it('returns early when countEl is missing', async () => {
    (document.getElementById('changes-count') as HTMLElement)?.remove();
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    expect(() => renderList()).not.toThrow();
  });
});

// ============================================================================
// Checkbox dataset.path for null/undefined path (line 119)
// ============================================================================
describe('checkbox dataset.path for edge case paths', () => {
  it('sets empty dataset.path when f.path is null', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: null, status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const cb = document.querySelector('input.pick') as HTMLInputElement;
    expect(cb).not.toBeNull();
    expect(cb.dataset.path).toBe('');
  });

  it('sets empty dataset.path when f.path is undefined', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: undefined, status: 'M' }] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const cb = document.querySelector('input.pick') as HTMLInputElement;
    expect(cb).not.toBeNull();
    expect(cb.dataset.path).toBe('');
  });
});

// ============================================================================
// resolvedConflict via resolved_conflict on staged non-conflict file during merge
// ============================================================================
describe('renderChangesList resolvedConflict edge cases', () => {
  it('marks resolved when resolved_conflict is true on staged file during merge', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.mergeInProgress = true;
    state.seenConflicts = new Set(['conflict.txt']);
    state.files = [
      { path: 'conflict.txt', status: 'M', staged: true },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    expect(row.classList.contains('resolved')).toBe(true);
  });

  it('does not mark resolved when staged but not in seenConflicts', async () => {
    const { renderList } = await import('@scripts/features/repo/list');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.mergeInProgress = true;
    state.seenConflicts = new Set(['other.txt']);
    state.files = [
      { path: 'clean.txt', status: 'M', staged: true },
    ] as any;
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    state.currentFile = '';
    state.currentDiff = [];

    renderList();
    const row = document.querySelector('li.row') as HTMLElement;
    expect(row.classList.contains('resolved')).toBe(false);
  });
});
