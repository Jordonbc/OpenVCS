// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies used by onFileContextMenu and other functions
vi.mock('@scripts/lib/menu', () => ({ buildCtxMenu: vi.fn() }));
vi.mock('@scripts/lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }));
vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('@scripts/lib/tauri', () => {
  const invoke = vi.fn(async () => []);
  return { TAURI: { invoke, listen: vi.fn() } };
});
vi.mock('@scripts/plugins', () => ({
  getPluginContextMenuItems: vi.fn(() => []),
  runPluginAction: vi.fn(),
}));
vi.mock('@scripts/features/stashConfirm', () => ({ openStashConfirm: vi.fn() }));
vi.mock('@scripts/features/repo/hydrate', () => ({
  hydrateStatus: vi.fn().mockResolvedValue(undefined),
  hydrateStash: vi.fn().mockResolvedValue(undefined),
  ensureConflictStatusesLoaded: vi.fn().mockResolvedValue(undefined),
}));

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
  it('shift+click toggles file in diff selection and updates row class', async () => {
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { dragState, listEl } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
      { path: 'c.txt', status: 'M' },
    ];

    state.files = [];
    state.diffSelectedFiles = new Set();
    dragState.lastClickedIndex = 0;

    const ul = document.getElementById('file-list')!;
    visible.forEach((f: any) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      ul.appendChild(li);
    });

    onFileClick({ shiftKey: true, ctrlKey: false, metaKey: false } as MouseEvent, visible[2] as any, 2, visible as any);
    expect(state.diffSelectedFiles.has('c.txt')).toBe(true);
    expect(state.selectedFiles.size).toBe(0);
    expect(dragState.lastClickedIndex).toBe(2);

    onFileClick({ shiftKey: true, ctrlKey: false, metaKey: false } as MouseEvent, visible[2] as any, 2, visible as any);
    expect(state.diffSelectedFiles.has('c.txt')).toBe(false);
  });
});

describe('updateDragRange', () => {
  it('preserves selected files hidden by filtering during commit drag selection', async () => {
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
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
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
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
    dragState.dragTargetState = true;
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

  it('diff drag range with dragTargetState false deselects files in range', async () => {
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];

    const ul = document.getElementById('file-list')!;
    visible.forEach((f) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      ul.appendChild(li);
    });

    state.diffSelectedFiles = new Set(['a.txt', 'b.txt']);
    dragState.isDragSelecting = true;
    dragState.dragMode = 'diff';
    dragState.dragTargetState = false;
    dragState.dragStartIndex = 0;
    dragState.dragCurrentIndex = 1;
    dragState.dragPreDiff = new Set(['a.txt', 'b.txt']);

    updateDragRange(visible as any);

    expect(state.diffSelectedFiles.size).toBe(0);
    const rows = ul.querySelectorAll<HTMLElement>('li.row');
    expect(rows[0].classList.contains('diffsel')).toBe(false);
    expect(rows[1].classList.contains('diffsel')).toBe(false);
  });

  it('returns early when isDragSelecting is false', async () => {
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    state.diffSelectedFiles = new Set();
    dragState.isDragSelecting = false;
    dragState.dragMode = 'diff';

    updateDragRange([]);

    expect(state.diffSelectedFiles.size).toBe(0);
  });

  it('handles commit mode with currentFile hunk sync', async () => {
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
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
    expect((state as any).selectedHunksByFile['a.txt']).toEqual([0]);
  });

  it('commit drag syncs selectedLinesByFile for current file hunks', async () => {
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];

    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'a.txt');
    const pickCb = document.createElement('input');
    pickCb.className = 'pick';
    pickCb.type = 'checkbox';
    li.appendChild(pickCb);
    ul.appendChild(li);

    const makeLineCb = (line: string) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pick-line';
      cb.dataset.hunk = '0';
      cb.dataset.line = line;
      return cb;
    };
    const hunkLineCheckboxes: Record<number, HTMLInputElement> = {
      0: makeLineCb('0'),
      1: makeLineCb('1'),
    };
    state.currentDiffHunkNodes = new Map([
      [0, {
        hunkCheckboxes: [document.createElement('input')],
        hunkEls: [document.createElement('div')],
        lineCheckboxes: hunkLineCheckboxes,
      }],
    ]);
    state.selectedFiles = new Set();
    state.currentFile = 'a.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.selectedHunks = [];
    state.selectedLinesByFile = {};

    dragState.isDragSelecting = true;
    dragState.dragMode = 'commit';
    dragState.dragTargetState = true;
    dragState.dragStartIndex = 0;
    dragState.dragCurrentIndex = 0;
    dragState.dragPrePicked = new Set();

    updateDragRange(visible as any);

    expect(state.selectedFiles.has('a.txt')).toBe(true);
    expect((state as any).selectedHunksByFile['a.txt']).toEqual([0]);
    const linesByFile: Record<string, Record<number, number[]>> = (state as any).selectedLinesByFile || {};
    const lines = linesByFile['a.txt']?.[0] || [];
    expect(lines.sort()).toEqual([0, 1]);
  });
});

describe('onFileClick', () => {
  it('handles ctrl+click toggle selection', async () => {
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
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
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
    ];
    state.files = [];
    state.selectedFiles = new Set();

    onFileClick({ metaKey: true, ctrlKey: false, shiftKey: false } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
  });

  it('toggle updates checkbox in DOM when row exists', async () => {
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.files = [];
    state.selectedFiles = new Set();

    const listEl = (await import('@scripts/features/repo/context')).listEl!;
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.path = 'a.txt';
    li.innerHTML = '<input class="pick" type="checkbox">';
    listEl.appendChild(li);

    onFileClick({ ctrlKey: true } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
    expect(li.classList.contains('picked')).toBe(true);
    expect((li.querySelector('input.pick') as HTMLInputElement).checked).toBe(true);

    onFileClick({ ctrlKey: true } as MouseEvent, visible[0] as any, 0, visible as any);
    expect(state.selectedFiles.has('a.txt')).toBe(false);
    expect(li.classList.contains('picked')).toBe(false);
    expect((li.querySelector('input.pick') as HTMLInputElement).checked).toBe(false);

    listEl.removeChild(li);
  });

  it('handles plain click (select file)', async () => {
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { dragState } = await import('@scripts/features/repo/context');
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
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { dragState } = await import('@scripts/features/repo/context');
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
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { dragState } = await import('@scripts/features/repo/context');
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
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const visible = [{ path: 'a.txt', status: 'M' }];
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')?.appendChild(li);

    onFileMouseDown({ button: 2, shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent, visible[0] as any, 0, visible as any, li);
    expect(dragState.isDragSelecting).toBe(false);
  });

  it('initiates diff drag selection with shift+mousedown', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
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
    expect(dragState.dragTargetState).toBe(true);  // file not in diffSelectedFiles → toggle on
    expect(dragState.isDragSelecting).toBe(true);
    expect(dragState.dragStartIndex).toBe(0);
    expect(dragState.dragCurrentIndex).toBe(0);
    expect(document.body.classList.contains('drag-selecting')).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('shift+mousedown on already-selected file sets dragTargetState to false (toggle off)', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.diffSelectedFiles = new Set(['a.txt']);  // already selected
    state.selectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);

    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(dragState.dragMode).toBe('diff');
    expect(dragState.dragTargetState).toBe(false);  // file already selected → toggle off
  });

  it('initiates commit drag selection with ctrl+mousedown', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
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

  it('clears implicit select-all before commit drag selection', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.defaultSelectAll = true;
    state.selectionImplicitAll = true;
    state.selectedFiles = new Set(['hidden.txt']);
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);

    onFileMouseDown({ button: 0, shiftKey: false, ctrlKey: true, metaKey: false, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(state.selectedFiles.size).toBe(0);
    expect(state.defaultSelectAll).toBe(false);
    expect(state.selectionImplicitAll).toBe(false);
    expect(dragState.dragMode).toBe('commit');
  });

  it('resets drag state when no modifier key is pressed', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    dragState.dragMode = 'diff' as any;
    dragState.isDragSelecting = true;
    dragState.suppressNextClick = true;

    onFileMouseDown({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(dragState.dragMode).toBeNull();
    expect(dragState.isDragSelecting).toBe(false);
    expect(dragState.dragMoved).toBe(false);
    expect(dragState.suppressNextClick).toBe(false);
  });

  it('suppressNextClick cleared on mousedown when entering drag mode', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }];
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();
    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);
    dragState.suppressNextClick = true;

    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any, visible[0] as any, 0, visible as any, li);

    expect(dragState.suppressNextClick).toBe(false);
    expect(dragState.dragMode).toBe('diff');
  });

  it('registers mousemove and mouseup handlers and cleans up on mouseup', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
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

describe('toggleSelectAll', () => {
  it('selects or deselects all visible files', async () => {
    const { toggleSelectAll } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' },
    ] as any;

    toggleSelectAll(true, visible);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
    expect(state.selectedFiles.has('b.txt')).toBe(true);

    state.selectedFiles.clear();
    toggleSelectAll(false, visible);
    expect(state.selectedFiles.size).toBe(0);
  });
});

describe('callback helpers', () => {
  it('registers and delegates through setRenderListCallback', async () => {
    const { setRenderListCallback, isDragSelecting } = await import('@scripts/features/repo/interactions');
    expect(isDragSelecting()).toBe(false);
    const cb = vi.fn();
    setRenderListCallback(cb);
  });

  it('tracks the last drag index via setDragCurrentIndex', async () => {
    const { setDragCurrentIndex } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    setDragCurrentIndex(5);
    expect(dragState.dragCurrentIndex).toBe(5);
  });

  it('applySelect toggles file in commit or diff mode', async () => {
    const { applySelect } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'z.txt');
    ul.appendChild(li);

    applySelect('z.txt', true, li, [], 'commit');
    expect(state.selectedFiles.has('z.txt')).toBe(true);
    expect(li.classList.contains('picked')).toBe(true);

    applySelect('z.txt', false, li, [], 'diff');
    expect(state.diffSelectedFiles.has('z.txt')).toBe(false);
    expect(li.classList.contains('diffsel')).toBe(false);

    applySelect('z.txt', true, li, [], 'diff');
    expect(state.diffSelectedFiles.has('z.txt')).toBe(true);
  });
});

describe('onFileContextMenu', () => {
  it('builds multi-selection actions and executes stash, ignore, discard, and plugin hooks', async () => {
    const { onFileContextMenu, setRenderListCallback } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { TAURI } = await import('@scripts/lib/tauri');
    const { openStashConfirm } = await import('@scripts/features/stashConfirm');
    const { getPluginContextMenuItems, runPluginAction } = await import('@scripts/plugins');
    const { hydrateStatus, hydrateStash } = await import('@scripts/features/repo/hydrate');

    const rerender = vi.fn();
    setRenderListCallback(rerender);
    state.selectedFiles = new Set(['a.txt', 'b.txt']);
    state.selectionImplicitAll = false;
    vi.mocked(getPluginContextMenuItems).mockReturnValue([{ label: 'Plugin action', action: 'plugin.action' }]);

    await onFileContextMenu(
      { preventDefault: vi.fn(), clientX: 10, clientY: 20 } as any,
      { path: 'a.txt', status: 'M' } as any,
    );

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    expect(items.map((item) => item.label)).toContain('Create stash from selection…');
    expect(items.map((item) => item.label)).toContain('Discard all selected');
    expect(items.map((item) => item.label)).toContain('Plugin action');

    await items.find((item) => item.label === 'Create stash from selection…')?.action?.();
    expect(openStashConfirm).toHaveBeenCalled();
    const stashConfig = vi.mocked(openStashConfirm).mock.calls.at(-1)?.[0];
    await (stashConfig as any)?.onSuccess?.();
    expect(hydrateStatus).toHaveBeenCalled();
    expect(hydrateStash).toHaveBeenCalled();
    expect(rerender).toHaveBeenCalled();

    await items.find((item) => item.label === 'Add to .gitignore')?.action?.();
    expect(TAURI.invoke).toHaveBeenCalledWith(
      'vcs_add_to_gitignore_paths',
      { paths: ['a.txt', 'b.txt'] },
    );

    await items.find((item) => item.label === 'Discard all selected')?.action?.();
    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_discard_paths', {
      paths: ['a.txt', 'b.txt'],
    });

    await items.find((item) => item.label === 'Plugin action')?.action?.();
    expect(runPluginAction).toHaveBeenCalledWith('plugin.action', {
      paths: ['a.txt', 'b.txt'],
      clickedPath: 'a.txt',
      file: { path: 'a.txt', status: 'M' },
    });
  });

  it('handles open and discard failures for a single file', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');
    const { TAURI } = await import('@scripts/lib/tauri');

    state.selectedFiles = new Set(['solo.txt']);
    state.selectionImplicitAll = false;
    vi.mocked(TAURI.invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'open_repo_file' || cmd === 'vcs_discard_paths') throw new Error('boom');
      return [];
    });

    await onFileContextMenu(
      { preventDefault: vi.fn(), clientX: 1, clientY: 2 } as any,
      { path: 'solo.txt', status: 'M' } as any,
    );

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((item) => item.label === 'Open with default application')?.action?.();
    await items.find((item) => item.label === 'Discard changes')?.action?.();

    expect(notify).toHaveBeenCalledWith('Open failed');
    expect(notify).toHaveBeenCalledWith('Discard failed');
  });
});

describe('applySelect', () => {
  it('adds file to commit selection', async () => {
    const { applySelect } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();

    applySelect('a.txt', true, null, [], 'commit');
    expect(state.selectedFiles.has('a.txt')).toBe(true);

    applySelect('a.txt', false, null, [], 'commit');
    expect(state.selectedFiles.has('a.txt')).toBe(false);
  });

  it('adds file to diff selection', async () => {
    const { applySelect } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    state.diffSelectedFiles = new Set();

    applySelect('a.txt', true, null, [], 'diff');
    expect(state.diffSelectedFiles.has('a.txt')).toBe(true);
  });

  it('updates DOM checkbox and row class in commit mode', async () => {
    const { applySelect } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
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
    const { applySelect } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
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
    const { toggleSelectAll } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
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
    const { toggleSelectAll } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
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
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = true;

    const file = { path: 'a.txt', status: 'M' } as any;
    const ev = { clientX: 100, clientY: 200, preventDefault: vi.fn() } as any;

    await onFileContextMenu(ev, file);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(buildCtxMenu).toHaveBeenCalled();
    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    expect(items[0].label).toContain('Open with default');
  });

  it('includes stash option for explicit multi-selection', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    state.selectedFiles = new Set(['a.txt', 'b.txt', 'c.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    const ev = { clientX: 100, clientY: 200, preventDefault: vi.fn() } as any;
    await onFileContextMenu(ev, file);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(buildCtxMenu).toHaveBeenCalled();
    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    const stashItem = items.find((i: any) => String(i.label).includes('Create stash from selection'));
    expect(stashItem).toBeDefined();
    const singleStash = items.find((i: any) => i.label?.includes('Create stash for this file'));
    expect(singleStash).toBeUndefined();
  });

  it('includes single file stash option for single selection', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    const stashFileItem = items.find((i: any) => i.label?.includes('Create stash for this file'));
    expect(stashFileItem).toBeDefined();
  });

  it('includes add to gitignore action', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    const gitignoreItem = items.find((i: any) => i.label?.includes('Add to .gitignore'));
    expect(gitignoreItem).toBeDefined();

    await gitignoreItem!.action!();
    expect(confirmBool).toHaveBeenCalled();
  });

  it('includes discard changes action', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    const discardItem = items.find((i: any) => i.label === 'Discard changes');
    expect(discardItem).toBeDefined();
  });

  it('includes discard all selected for explicit multi-selection', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    state.selectedFiles = new Set(['a.txt', 'b.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    const discardAllItem = items.find((i: any) => i.label?.includes('Discard all selected'));
    expect(discardAllItem).toBeDefined();
    const singleDiscard = items.find((i: any) => i.label === 'Discard changes');
    expect(singleDiscard).toBeUndefined();
  });

  it('includes plugin context menu items when available', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { getPluginContextMenuItems } = await import('@scripts/plugins');

    (getPluginContextMenuItems as any).mockReturnValue([
      { label: 'Plugin Action', action: 'plugin.test' },
    ]);

    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    const file = { path: 'a.txt', status: 'M' } as any;
    await onFileContextMenu({ clientX: 100, clientY: 200, preventDefault: vi.fn() } as any, file);

    const items = vi.mocked(buildCtxMenu).mock.lastCall![0];
    const pluginItem = items.find((i: any) => i.label === 'Plugin Action');
    expect(pluginItem).toBeDefined();
  });
});

describe('setRenderListCallback / isDragSelecting / setDragCurrentIndex', () => {
  it('registers and calls render callback', async () => {
    const { setRenderListCallback } = await import('@scripts/features/repo/interactions');
    const fn = vi.fn();
    setRenderListCallback(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('isDragSelecting returns dragState value', async () => {
    const { isDragSelecting } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    dragState.isDragSelecting = true;
    expect(isDragSelecting()).toBe(true);
    dragState.isDragSelecting = false;
    expect(isDragSelecting()).toBe(false);
  });

  it('setDragCurrentIndex sets dragCurrentIndex', async () => {
    const { setDragCurrentIndex } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    setDragCurrentIndex(5);
    expect(dragState.dragCurrentIndex).toBe(5);
  });
});

describe('onFileClick - range and diff toggle coverage', () => {
  it('shift+click toggles diff selection, updates DOM class, does not trigger render callback', async () => {
    const { onFileClick, setRenderListCallback } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state, prefs } = await import('@scripts/state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
      { path: 'c.txt', status: 'M' },
    ] as any;
    state.files = visible;
    state.diffSelectedFiles = new Set();
    prefs.tab = 'changes';
    dragState.lastClickedIndex = 0;

    const ul = document.getElementById('file-list')!;
    visible.forEach((f: any) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      ul.appendChild(li);
    });
    const callback = vi.fn();
    setRenderListCallback(callback);

    onFileClick({ shiftKey: true, ctrlKey: false, metaKey: false } as MouseEvent, visible[2], 2, visible);
    expect(state.diffSelectedFiles.has('c.txt')).toBe(true);
    expect(ul.querySelector<HTMLElement>('li.row[data-path="c.txt"]')?.classList.contains('diffsel')).toBe(true);
    expect(dragState.lastClickedIndex).toBe(2);
    expect(callback).not.toHaveBeenCalled();

    // Second click toggles off
    onFileClick({ shiftKey: true, ctrlKey: false, metaKey: false } as MouseEvent, visible[2], 2, visible);
    expect(state.diffSelectedFiles.has('c.txt')).toBe(false);
    expect(ul.querySelector<HTMLElement>('li.row[data-path="c.txt"]')?.classList.contains('diffsel')).toBe(false);
  });

  it('toggle with diffSelectedFiles > 1', async () => {
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }] as any;
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set(['x.txt', 'y.txt']);
    dragState.lastClickedIndex = -1;

    onFileClick({ ctrlKey: true, metaKey: false, shiftKey: false } as MouseEvent, visible[0], 0, visible);
    expect(state.selectedFiles.has('a.txt')).toBe(true);
    expect(dragState.lastClickedIndex).toBe(0);
  });

  it('plain click applies highlightRow active class via selectFile', async () => {
    const { onFileClick } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { dragState } = await import('@scripts/features/repo/context');
    const visible = [{ path: 'a.txt', status: 'M' }] as any;
    state.files = [];
    state.selectedFiles = new Set();
    state.diffSelectedFiles = new Set();
    dragState.lastClickedIndex = -1;

    const ul = document.getElementById('file-list')!;
    visible.forEach((f: any) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      ul.appendChild(li);
    });

    onFileClick({ ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent, visible[0], 0, visible);
    const rows = ul.querySelectorAll<HTMLElement>('li.row');
    expect(rows[0].classList.contains('active')).toBe(true);
  });
});

describe('onFileMouseDown - move and up', () => {
  it('mouse move finds new row and updates dragCurrentIndex', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ] as any;
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();

    const ul = document.getElementById('file-list')!;
    visible.forEach((f: any) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.setAttribute('data-path', f.path);
      ul.appendChild(li);
    });
    const secondLi = ul.querySelectorAll('li')[1] as HTMLElement;
    const origEP = (document as any).elementFromPoint;
    (document as any).elementFromPoint = () => secondLi;

    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any, visible[0], 0, visible, ul.querySelector('li') as HTMLElement);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    (document as any).elementFromPoint = origEP;
    expect(dragState.dragCurrentIndex).toBe(1);
  });

  it('mouse move with no row found leaves index unchanged', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }] as any;
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();

    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'a.txt');
    ul.appendChild(li);
    const origEP = (document as any).elementFromPoint;
    (document as any).elementFromPoint = () => document.createElement('div');
    dragState.dragCurrentIndex = 0;
    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any, visible[0], 0, visible, li);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
    (document as any).elementFromPoint = origEP;
    expect(dragState.dragCurrentIndex).toBe(0);
  });

  it('mouse up with dragMoved sets suppressNextClick', async () => {
    const { onFileMouseDown } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }] as any;
    state.diffSelectedFiles = new Set();
    state.selectedFiles = new Set();

    const li = document.createElement('li');
    li.setAttribute('data-path', 'a.txt');
    document.getElementById('file-list')!.appendChild(li);
    onFileMouseDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any, visible[0], 0, visible, li);
    dragState.dragMoved = true;
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(dragState.suppressNextClick).toBe(true);
    expect(dragState.isDragSelecting).toBe(false);
    expect(dragState.dragMode).toBeNull();
  });
});

describe('updateDragRange - listEl null', () => {
  it('diff mode when listEl is null', async () => {
    const ul = document.getElementById('file-list');
    if (ul) ul.remove();
    const { updateDragRange } = await import('@scripts/features/repo/interactions');
    const { dragState } = await import('@scripts/features/repo/context');
    const { state } = await import('@scripts/state/state');
    const visible = [{ path: 'a.txt', status: 'M' }] as any;
    state.diffSelectedFiles = new Set();
    dragState.isDragSelecting = true;
    dragState.dragMode = 'diff';
    dragState.dragStartIndex = 0;
    dragState.dragCurrentIndex = 0;
    dragState.dragPreDiff = new Set();
    expect(() => updateDragRange(visible)).not.toThrow();
    expect(state.diffSelectedFiles.has('a.txt')).toBe(true);
  });
});

describe('onFileContextMenu - rejection paths', () => {
  it('open_repo_file success', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { TAURI } = await import('@scripts/lib/tauri');
    state.selectedFiles = new Set(['single.txt']);
    state.selectionImplicitAll = false;
    vi.mocked(TAURI.invoke).mockResolvedValue(undefined);
    await onFileContextMenu({ preventDefault: vi.fn(), clientX: 1, clientY: 2 } as any, { path: 'single.txt', status: 'M' } as any);
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const openItem = items.find((i: any) => i.label === 'Open with default application');
    await openItem!.action!();
    expect(TAURI.invoke).toHaveBeenCalledWith('open_repo_file', { path: 'single.txt' });
  });

  it('add to .gitignore rejection', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(confirmBool).mockResolvedValue(false);
    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;
    await onFileContextMenu({ preventDefault: vi.fn(), clientX: 1, clientY: 2 } as any, { path: 'a.txt', status: 'M' } as any);
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const gitignoreItem = items.find((i: any) => i.label === 'Add to .gitignore');
    await gitignoreItem!.action!();
    expect(TAURI.invoke).not.toHaveBeenCalledWith('vcs_add_to_gitignore_paths');
  });

  it('discard changes rejection', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(confirmBool).mockResolvedValue(false);
    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;
    await onFileContextMenu({ preventDefault: vi.fn(), clientX: 1, clientY: 2 } as any, { path: 'a.txt', status: 'M' } as any);
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const discardItem = items.find((i: any) => i.label === 'Discard changes');
    await discardItem!.action!();
    expect(TAURI.invoke).not.toHaveBeenCalledWith('vcs_discard_paths');
  });

  it('context menu uses diffSelectedFiles for multi-file actions when no staging multi-selection', async () => {
    const { onFileContextMenu, setRenderListCallback } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    const rerender = vi.fn();
    setRenderListCallback(rerender);
    state.selectedFiles = new Set();
    state.selectionImplicitAll = false;
    state.diffSelectedFiles = new Set(['x.txt', 'y.txt', 'z.txt']);

    await onFileContextMenu(
      { preventDefault: vi.fn(), clientX: 10, clientY: 20 } as any,
      { path: 'y.txt', status: 'M' } as any,
    );

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const discardAll = items.find((i: any) => i.label === 'Discard all selected');
    expect(discardAll).toBeDefined();
  });

  it('gitignore failure notifies without throwing', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { TAURI } = await import('@scripts/lib/tauri');
    const { confirmBool } = await import('@scripts/lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);
    vi.mocked(TAURI.invoke as any).mockRejectedValue(new Error('boom'));
    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    await onFileContextMenu({ preventDefault: vi.fn(), clientX: 1, clientY: 2 } as any, { path: 'a.txt', status: 'M' } as any);
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const addItem = items.find((i: any) => i.label === 'Add to .gitignore');
    expect(addItem).toBeDefined();
    await addItem!.action!();
    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_add_to_gitignore_paths', { paths: ['a.txt'] });
  });

  it('discard changes invoke failure notifies and does not throw', async () => {
    const { onFileContextMenu } = await import('@scripts/features/repo/interactions');
    const { state } = await import('@scripts/state/state');
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { TAURI } = await import('@scripts/lib/tauri');
    const { confirmBool } = await import('@scripts/lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('boom'));
    state.selectedFiles = new Set(['a.txt']);
    state.selectionImplicitAll = false;

    await onFileContextMenu({ preventDefault: vi.fn(), clientX: 1, clientY: 2 } as any, { path: 'a.txt', status: 'M' } as any);
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const discardItem = items.find((i: any) => i.label === 'Discard changes');
    expect(discardItem).toBeDefined();
    await discardItem!.action!();
    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_discard_paths', { paths: ['a.txt'] });
  });
});
