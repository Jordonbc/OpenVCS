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
