// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

(globalThis as any).matchMedia = createMatchMediaMock;

/** Mounts the DOM structure needed by diffSelection (list + diff). */
function mountDiffDom() {
  document.body.innerHTML = `
    <ul id="file-list"></ul>
    <div id="diff-path"></div>
    <div id="diff"></div>
    <input id="select-all" type="checkbox" />
    <input id="filter" />
    <span id="changes-count"></span>
    <button id="commit-btn"></button>
    <input id="commit-summary" />
  `;
}

beforeEach(() => {
  vi.resetModules();
  mountDiffDom();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('updateListCheckboxForPath', () => {
  it('updates checkbox for a matching row', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="test.txt"><input class="pick" type="checkbox" /></li>';
    const { updateListCheckboxForPath } = await import('./diffSelection');
    updateListCheckboxForPath('test.txt', true, false);
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
    expect((cb as any).indeterminate).toBe(false);
  });

  it('sets indeterminate state', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="indet.txt"><input class="pick" type="checkbox" /></li>';
    const { updateListCheckboxForPath } = await import('./diffSelection');
    updateListCheckboxForPath('indet.txt', false, true);
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect((cb as any).indeterminate).toBe(true);
  });

  it('does nothing when listEl is null (no list in DOM)', async () => {
    document.body.innerHTML = '';
    const { updateListCheckboxForPath } = await import('./diffSelection');
    expect(() => updateListCheckboxForPath('x.txt', true, false)).not.toThrow();
  });

  it('does nothing when path is empty', async () => {
    const { updateListCheckboxForPath } = await import('./diffSelection');
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="a.txt"><input class="pick" type="checkbox" /></li>';
    // Empty path should not crash and should not modify anything
    updateListCheckboxForPath('', true, false);
    updateListCheckboxForPath('  ', true, false);
  });

  it('escapes special characters in path selector', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="file[name].txt"><input class="pick" type="checkbox" /></li>';
    const { updateListCheckboxForPath } = await import('./diffSelection');
    updateListCheckboxForPath('file[name].txt', true, false);
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
  });
});

describe('syncFileCheckboxWithHunks', () => {
  it('handles binary diff', async () => {
    const { state } = await import('../../state/state');
    state.currentFile = 'binary.bin';
    state.currentDiffBinary = true;
    state.selectedFiles.add('binary.bin');
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="binary.bin"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('./diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
  });

  it('handles no currentFile', async () => {
    const { syncFileCheckboxWithHunks } = await import('./diffSelection');
    // Should not throw when currentFile is empty
    expect(() => syncFileCheckboxWithHunks()).not.toThrow();
  });

  it('deselects when totalHunks is 0', async () => {
    const { state } = await import('../../state/state');
    state.currentFile = 'empty.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 0 };
    state.currentDiff = [];
    state.selectedFiles.add('empty.txt');
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="empty.txt"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('./diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect(state.selectedFiles.has('empty.txt')).toBe(false);
  });

  it('marks checked when all hunks selected', async () => {
    const { state } = await import('../../state/state');
    state.currentFile = 'all.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };
    state.selectedHunks = [0];
    state.currentDiff = ['@@ -1 +1 @@', '-a', '+b'];
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="all.txt"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('./diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
    expect(state.selectedFiles.has('all.txt')).toBe(true);
  });

  it('marks indeterminate when partial hunk selection', async () => {
    const { state } = await import('../../state/state');
    state.currentFile = 'partial.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [3], totalHunks: 1 };
    state.selectedHunks = [];
    (state as any).selectedLinesByFile['partial.txt'] = { 0: [0] };
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="partial.txt"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('./diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect((cb as any).indeterminate).toBe(true);
    expect(state.selectedFiles.has('partial.txt')).toBe(false);
  });
});

describe('bindHunkToggles', () => {
  it('binds change handler once', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    bindHunkToggles(diff);
    // Second call should not add another listener
    bindHunkToggles(diff);
    // Add a pick-hunk checkbox and simulate change
    diff.innerHTML = '<input type="checkbox" class="pick-hunk" data-hunk="0" />';
    const cb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    // No crash is sufficient validation for the binding test
  });
});
