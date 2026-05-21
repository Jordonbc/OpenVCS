// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies used by onFileContextMenu and other functions
vi.mock('../../lib/menu', () => ({ buildCtxMenu: vi.fn() }));
vi.mock('../../lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/tauri', () => {
  const invoke = vi.fn(async () => []);
  return { TAURI: { invoke, listen: vi.fn() } };
});
vi.mock('../../plugins', () => ({
  getPluginContextMenuItems: vi.fn(() => []),
  runPluginAction: vi.fn(),
}));
vi.mock('../stashConfirm', () => ({ openStashConfirm: vi.fn() }));

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes touched by repository interaction handlers. */
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
    <div id="status"></div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  mountRepoDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('onFileClick', () => {
  it('selects every file in a shift-click range without toggling selected files off', async () => {
    const { onFileClick } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
      { path: 'c.txt', status: 'M' },
    ];

    state.files = [];
    state.selectedFiles = new Set(['b.txt']);
    dragState.lastClickedIndex = 0;

    onFileClick({ shiftKey: true, ctrlKey: false, metaKey: false } as MouseEvent, visible[2] as any, 2, visible as any);

    expect(Array.from(state.selectedFiles).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });
});

describe('updateDragRange', () => {
  it('preserves selected files hidden by filtering during commit drag selection', async () => {
    const { updateDragRange } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];

    state.selectedFiles = new Set(['hidden.txt']);
    dragState.isDragSelecting = true;
    dragState.dragMode = 'commit';
    dragState.dragTargetState = true;
    dragState.dragStartIndex = 0;
    dragState.dragCurrentIndex = 1;
    dragState.dragPrePicked = new Set(['hidden.txt']);

    updateDragRange(visible as any);

    expect(Array.from(state.selectedFiles).sort()).toEqual(['a.txt', 'b.txt', 'hidden.txt']);
  });

  it('selects files in diff range and updates DOM classes', async () => {
    const { updateDragRange } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];

    // Set up DOM rows
    const ul = document.getElementById('file-list')!;
    visible.forEach((f) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      ul.appendChild(li);
    });

    state.diffSelectedFiles = new Set();
    dragState.isDragSelecting = true;
    dragState.dragMode = 'diff';
    dragState.dragStartIndex = 0;
    dragState.dragCurrentIndex = 1;
    dragState.dragPreDiff = new Set();

    updateDragRange(visible as any);

    expect(state.diffSelectedFiles.has('a.txt')).toBe(true);
    expect(state.diffSelectedFiles.has('b.txt')).toBe(true);
    const rows = ul.querySelectorAll<HTMLElement>('li.row');
    expect(rows[0].classList.contains('diffsel')).toBe(true);
    expect(rows[1].classList.contains('diffsel')).toBe(true);
  });

  it('returns early when isDragSelecting is false', async () => {
    const { updateDragRange } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    state.diffSelectedFiles = new Set();
    dragState.isDragSelecting = false;
    dragState.dragMode = 'diff';

    updateDragRange([]);

    expect(state.diffSelectedFiles.size).toBe(0);
  });

  it('handles commit mode with currentFile hunk sync', async () => {
    const { updateDragRange } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];

    const ul = document.getElementById('file-list')!;
    visible.forEach((f) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      const cb = document.createElement('input');
      cb.className = 'pick';
      cb.type = 'checkbox';
      li.appendChild(cb);
      ul.appendChild(li);
    });

    state.selectedFiles = new Set();
    state.currentFile = 'a.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.selectedHunks = [];
    dragState.isDragSelecting = true;
    dragState.dragMode = 'commit';
    dragState.dragTargetState = true;
    dragState.dragStartIndex = 0;
    dragState.dragCurrentIndex = 0;
    dragState.dragPrePicked = new Set();

    updateDragRange(visible as any);

    expect(state.selectedFiles.has('a.txt')).toBe(true);
  });
});

describe('onFileClick', () => {
  it('handles ctrl+click toggle selection', async () => {
    const { onFileClick } = await import('./interactions');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];
    state.files = [];
    state.selectedFiles = new Set();

    onFileClick({ ctrlKey: true, metaKey: false, shiftKey: false } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
  });

  it('handles meta+click toggle selection', async () => {
    const { onFileClick } = await import('./interactions');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
    ];
    state.files = [];
    state.selectedFiles = new Set();

    onFileClick({ metaKey: true, ctrlKey: false, shiftKey: false } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
  });

  it('handles plain click (select file)', async () => {
    const { onFileClick } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { dragState } = await import('./context');
    const visible = [
      { path: 'a.txt', status: 'M' },
    ];
    state.files = [];
    state.selectedFiles = new Set();
    dragState.lastClickedIndex = -1;

    onFileClick({ ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(dragState.lastClickedIndex).toBe(0);
  });

  it('handles suppressNextClick flow', async () => {
    const { onFileClick } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { dragState } = await import('./context');
    const visible = [
      { path: 'a.txt', status: 'M' },
    ];
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    dragState.suppressNextClick = true;

    onFileClick({ ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(dragState.suppressNextClick).toBe(false);
  });

  it('suppressNextClick with multiple diff selected renders combined diff', async () => {
    const { onFileClick } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { dragState } = await import('./context');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set(['a.txt', 'b.txt']);
    dragState.suppressNextClick = true;

    onFileClick({ ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(dragState.suppressNextClick).toBe(false);
  });
});

describe('onFileMouseDown', () => {
  it('does nothing for non-left button', async () => {
    const { onFileMouseDown } = await import('./interactions');
    const { dragState } = await import('./context');
    const visible = [{ path: 'a.txt', status: 'M' }];
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')?.appendChild(li);

    onFileMouseDown({ button: 2, shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent, visible[0] as any, 0, visible as any, li);
    expect(dragState.isDragSelecting).toBe(false);
  });

  it('initiates diff drag selection with shift+mousedown', async () => {
    const { onFileMouseDown } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);

    const preventDefault = vi.fn();
    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, preventDefault } as any, visible[0] as any, 0, visible as any, li);

    expect(dragState.dragMode).toBe('diff');
    expect(dragState.isDragSelecting).toBe(true);
    expect(dragState.dragStartIndex).toBe(0);
    expect(dragState.dragCurrentIndex).toBe(0);
    expect(document.body.classList.contains('drag-selecting')).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('initiates commit drag selection with ctrl+mousedown', async () => {
    const { onFileMouseDown } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);

    onFileMouseDown({ button: 0, shiftKey: false, ctrlKey: true, metaKey: false, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(dragState.dragMode).toBe('commit');
    expect(dragState.isDragSelecting).toBe(true);
    expect(dragState.dragStartIndex).toBe(0);
    expect(dragState.dragCurrentIndex).toBe(0);
    expect(dragState.dragPrePicked).toBeDefined();
  });

  it('resets drag state when no modifier key is pressed', async () => {
    const { onFileMouseDown } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    dragState.dragMode = 'diff' as any;
    dragState.isDragSelecting = true;

    onFileMouseDown({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(dragState.dragMode).toBeNull();
    expect(dragState.isDragSelecting).toBe(false);
    expect(dragState.dragMoved).toBe(false);
  });

  it('registers mousemove and mouseup handlers and cleans up on mouseup', async () => {
    const { onFileMouseDown } = await import('./interactions');
    const { dragState } = await import('./context');
    const { state } = await import('../../state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);

    const addListenerSpy = vi.spyOn(document, 'addEventListener');

    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(addListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(addListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function), { once: true });

    // Simulate mouseup
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(dragState.isDragSelecting).toBe(false);
    expect(dragState.dragMode).toBeNull();
    expect(document.body.classList.contains('drag-selecting')).toBe(false);
  });
});

describe('applySelect', () => {
  it('adds file to commit selection', async () => {
    const { applySelect } = await import('./interactions');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set();

    applySelect('a.txt', true, null, [], 'commit');
    expect(state.selectedFiles.has('a.txt')).toBe(true);

    applySelect('a.txt', false, null, [], 'commit');
    expect(state.selectedFiles.has('a.txt')).toBe(false);
  });

  it('adds file to diff selection', async () => {
    const { applySelect } = await import('./interactions');
    const { state } = await import('../../state/state');
    state.diffSelectedFiles = new Set();

    applySelect('a.txt', true, null, [], 'diff');
    expect(state.diffSelectedFiles.has('a.txt')).toBe(true);
  });

  it('updates DOM checkbox and row class in commit mode', async () => {
    const { applySelect } = await import('./interactions');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set();

    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'a.txt');
    const cb = document.createElement('input');
    cb.className = 'pick';
    cb.type = 'checkbox';
    li.appendChild(cb);
    ul.appendChild(li);

    applySelect('a.txt', true, li, [], 'commit');
    expect(state.selectedFiles.has('a.txt')).toBe(true);
    expect(li.classList.contains('picked')).toBe(true);
    expect(cb.checked).toBe(true);
    expect((cb as any).indeterminate).toBe(false);

    applySelect('a.txt', false, li, [], 'commit');
    expect(state.selectedFiles.has('a.txt')).toBe(false);
    expect(li.classList.contains('picked')).toBe(false);
    expect(cb.checked).toBe(false);
  });

  it('updates DOM row class in diff mode', async () => {
    const { applySelect } = await import('./interactions');
    const { state } = await import('../../state/state');
    state.diffSelectedFiles = new Set();

    const li = document.createElement('li');
    li.className = 'row';
    applySelect('a.txt', true, li, [], 'diff');
    expect(state.diffSelectedFiles.has('a.txt')).toBe(true);
    expect(li.classList.contains('diffsel')).toBe(true);

    applySelect('a.txt', false, li, [], 'diff');
    expect(state.diffSelectedFiles.has('a.txt')).toBe(false);
    expect(li.classList.contains('diffsel')).toBe(false);
  });
});

describe('toggleSelectAll', () => {
  it('selects all visible files', async () => {
    const { toggleSelectAll } = await import('./interactions');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set();
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ] as any;

    toggleSelectAll(true, visible);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
    expect(state.selectedFiles.has('b.txt')).toBe(true);

    toggleSelectAll(false, visible);
    expect(state.selectedFiles.has('a.txt')).toBe(false);
    expect(state.selectedFiles.has('b.txt')).toBe(false);
  });

  it('ignores files without a path', async () => {
    const { toggleSelectAll } = await import('./interactions');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set();
    const visible = [
      { path: '', status: 'M' },
      { path: undefined as any, status: 'M' },
    ] as any;

    toggleSelectAll(true, visible);
    expect(state.selectedFiles.size).toBe(0);
  });
});

describe('onFileContextMenu', () => {
  it('calls buildCtxMenu with open action for single selected file', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = true;

    const file = { path: 'a.txt', status: 'M' } as any;
    const ev = { clientX: 100, clientY: 200, preventDefault: vi.fn() } as any;

    await onFileContextMenu(ev, file);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(buildCtxMenu).toHaveBeenCalled();
    const items = buildCtxMenu.mock.lastCall[0];
    expect(items[0].label).toContain('Open with default');
  });

  it('includes stash option for explicit multi-selection', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');

    state.selectedFiles = new Set(['a.txt', 'b.txt', 'c.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    const ev = { clientX: 100, clientY: 200, preventDefault: vi.fn() } as any;
    await onFileContextMenu(ev, file);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(buildCtxMenu).toHaveBeenCalled();
    const items = buildCtxMenu.mock.lastCall[0];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    const stashItem = items.find((i: any) => String(i.label).includes('Create stash from selection'));
    expect(stashItem).toBeDefined();
  });

  it('includes single file stash option for single selection', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = buildCtxMenu.mock.lastCall[0];
    const stashFileItem = items.find((i: any) => i.label?.includes('Create stash for this file'));
    expect(stashFileItem).toBeDefined();
  });

  it('includes add to gitignore action', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');
    const { confirmBool } = await import('../../lib/confirm');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = buildCtxMenu.mock.lastCall[0];
    const gitignoreItem = items.find((i: any) => i.label?.includes('Add to .gitignore'));
    expect(gitignoreItem).toBeDefined();

    await gitignoreItem.action!();
    expect(confirmBool).toHaveBeenCalled();
  });

  it('includes discard changes action', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = buildCtxMenu.mock.lastCall[0];
    const discardItem = items.find((i: any) => i.label === 'Discard changes');
    expect(discardItem).toBeDefined();
  });

  it('includes discard all selected for explicit multi-selection', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');

    state.selectedFiles = new Set(['a.txt', 'b.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = buildCtxMenu.mock.lastCall[0];
    const discardAllItem = items.find((i: any) => i.label?.includes('Discard all selected'));
    expect(discardAllItem).toBeDefined();
  });

  it('includes plugin context menu items when available', async () => {
    const { onFileContextMenu } = await import('./interactions');
    const { state } = await import('../../state/state');
    const { buildCtxMenu } = await import('../../lib/menu');
    const { getPluginContextMenuItems } = await import('../../plugins');

    (getPluginContextMenuItems as any).mockReturnValue([
      { label: 'Plugin Action', action: 'plugin.test' },
    ]);

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = buildCtxMenu.mock.lastCall[0];
    const pluginItem = items.find((i: any) => i.label === 'Plugin Action');
    expect(pluginItem).toBeDefined();
  });
});

describe('setRenderListCallback / isDragSelecting / setDragCurrentIndex', () => {
  it('registers and calls render callback', async () => {
    const { setRenderListCallback } = await import('./interactions');
    const fn = vi.fn();
    setRenderListCallback(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('isDragSelecting returns dragState value', async () => {
    const { isDragSelecting } = await import('./interactions');
    const { dragState } = await import('./context');
    dragState.isDragSelecting = true;
    expect(isDragSelecting()).toBe(true);
    dragState.isDragSelecting = false;
    expect(isDragSelecting()).toBe(false);
  });

  it('setDragCurrentIndex sets dragCurrentIndex', async () => {
    const { setDragCurrentIndex } = await import('./interactions');
    const { dragState } = await import('./context');
    setDragCurrentIndex(5);
    expect(dragState.dragCurrentIndex).toBe(5);
  });
});
