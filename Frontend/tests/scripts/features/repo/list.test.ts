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
