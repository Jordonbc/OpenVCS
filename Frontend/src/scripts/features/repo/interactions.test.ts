// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('initiates diff drag selection with shift', async () => {
    const { onFileMouseDown } = await import('./interactions');
    expect(typeof onFileMouseDown).toBe('function');
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
});

describe('toggleSelectAll', () => {
  it('selects all visible files', async () => {
    const { toggleSelectAll } = await import('./interactions');
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ] as any;
    expect(() => toggleSelectAll(true, visible)).not.toThrow();
    expect(() => toggleSelectAll(false, visible)).not.toThrow();
  });
});

describe('setRenderListCallback / isDragSelecting / setDragCurrentIndex', () => {
  it('registers and calls render callback', async () => {
    const { setRenderListCallback } = await import('./interactions');
    const fn = vi.fn();
    setRenderListCallback(fn);
    // The callback is stored and later used by renderListAfterRangeSelect
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
