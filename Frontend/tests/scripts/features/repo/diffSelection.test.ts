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

/** Helper to create a mock hunk checkbox input. */
function makeHunkCheckbox(dataHunk: string): HTMLInputElement {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'pick-hunk';
  cb.dataset.hunk = dataHunk;
  return cb;
}

/** Helper to create a mock line checkbox input. */
function makeLineCheckbox(dataHunk: string, dataLine: string): HTMLInputElement {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'pick-line';
  cb.dataset.hunk = dataHunk;
  cb.dataset.line = dataLine;
  return cb;
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
    const { updateListCheckboxForPath } = await import('@scripts/features/repo/diffSelection');
    updateListCheckboxForPath('test.txt', true, false);
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
    expect((cb as any).indeterminate).toBe(false);
  });

  it('sets indeterminate state', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="indet.txt"><input class="pick" type="checkbox" /></li>';
    const { updateListCheckboxForPath } = await import('@scripts/features/repo/diffSelection');
    updateListCheckboxForPath('indet.txt', false, true);
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect((cb as any).indeterminate).toBe(true);
  });

  it('does nothing when listEl is null (no list in DOM)', async () => {
    document.body.innerHTML = '';
    const { updateListCheckboxForPath } = await import('@scripts/features/repo/diffSelection');
    expect(() => updateListCheckboxForPath('x.txt', true, false)).not.toThrow();
  });

  it('does nothing when path is empty', async () => {
    const { updateListCheckboxForPath } = await import('@scripts/features/repo/diffSelection');
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="a.txt"><input class="pick" type="checkbox" /></li>';
    updateListCheckboxForPath('', true, false);
    updateListCheckboxForPath('  ', true, false);
  });

  it('escapes special characters in path selector', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="file[name].txt"><input class="pick" type="checkbox" /></li>';
    const { updateListCheckboxForPath } = await import('@scripts/features/repo/diffSelection');
    updateListCheckboxForPath('file[name].txt', true, false);
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
  });
});

describe('toggleFilePick', () => {
  it('does nothing when path is empty', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();
    toggleFilePick('', true);
    expect(state.selectedFiles.size).toBe(0);
  });

  it('adds path to selectedFiles when on=true', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();
    state.currentFile = '';
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', true);
    expect(state.selectedFiles.has('test.txt')).toBe(true);
  });

  it('disables implicit select-all on explicit file pick without clearing other files', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set(['a.txt', 'b.txt']);
    state.defaultSelectAll = true;
    state.selectionImplicitAll = true;
    state.currentFile = '';
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', true);

    expect(Array.from(state.selectedFiles).sort()).toEqual(['a.txt', 'b.txt', 'test.txt']);
    expect(state.defaultSelectAll).toBe(false);
    expect(state.selectionImplicitAll).toBe(false);
  });

  it('removes path from selectedFiles when on=false', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set(['test.txt']);
    state.currentFile = '';
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', false);
    expect(state.selectedFiles.has('test.txt')).toBe(false);
  });

  it('updates hunk selections when currentFile matches path and not binary', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();
    state.currentFile = 'test.txt';
    state.currentDiffBinary = false;
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];

    const hunkCheckbox = makeHunkCheckbox('0');
    const lineCheckbox = makeLineCheckbox('0', '0');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox },
    });

    toggleFilePick('test.txt', true);

    expect(state.selectedFiles.has('test.txt')).toBe(true);
    expect(state.selectedHunks).toContain(0);
    expect(hunkCheckbox.checked).toBe(true);
  });

  it('clears hunk selections when toggling off with currentFile match', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set(['test.txt']);
    state.currentFile = 'test.txt';
    state.currentDiffBinary = false;
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];

    const hunkCheckbox = makeHunkCheckbox('0');
    const lineCheckbox = makeLineCheckbox('0', '0');
    lineCheckbox.checked = true;
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox },
    });

    toggleFilePick('test.txt', false);

    expect(state.selectedFiles.has('test.txt')).toBe(false);
    expect(state.selectedHunks.length).toBe(0);
    expect(hunkCheckbox.checked).toBe(false);
  });

  it('skips hunk sync when currentDiffBinary is true', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();
    state.currentFile = 'test.txt';
    state.currentDiffBinary = true;
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];

    toggleFilePick('test.txt', true);
    expect(state.selectedFiles.has('test.txt')).toBe(true);
    expect(state.selectedHunks.length).toBe(0);
  });

  it('does nothing with hunk nodes when currentFile does not match path', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();
    state.currentFile = 'other.txt';
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', true);
    expect(state.selectedFiles.has('test.txt')).toBe(true);
    expect(state.currentFile).toBe('other.txt');
  });
});

describe('updateHunkCheckboxes', () => {
  it('does nothing when currentDiffHunkNodes is empty', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentDiffHunkNodes = new Map();
    expect(() => updateHunkCheckboxes()).not.toThrow();
  });

  it('updates hunk checkboxes based on selectedHunks', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];

    const hunkCheckbox = makeHunkCheckbox('0');
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: {},
    });

    updateHunkCheckboxes();

    expect(hunkCheckbox.checked).toBe(true);
    expect(hunkEl.classList.contains('picked')).toBe(true);
  });

  it('clears hunk checkboxes when hunk not selected', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];

    const hunkCheckbox = makeHunkCheckbox('0');
    hunkCheckbox.checked = true;
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: {},
    });

    updateHunkCheckboxes();

    expect(hunkCheckbox.checked).toBe(false);
    expect(hunkEl.classList.contains('picked')).toBe(false);
  });

  it('sets indeterminate state for partial line selection', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = { 'test.txt': { 0: [0] } };
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [3], totalHunks: 1 };
    state.currentDiffHunkNodes = new Map();

    const hunkCheckbox = makeHunkCheckbox('0');
    const lineCheckbox0 = makeLineCheckbox('0', '0');
    const lineCheckbox1 = makeLineCheckbox('0', '1');
    const lineCheckbox2 = makeLineCheckbox('0', '2');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox0, 1: lineCheckbox1, 2: lineCheckbox2 },
    });

    updateHunkCheckboxes();

    expect(lineCheckbox0.checked).toBe(true);
    expect(lineCheckbox1.checked).toBe(false);
    expect(lineCheckbox2.checked).toBe(false);
    expect((hunkCheckbox as any).indeterminate).toBe(true);
  });

  it('marks hunk checked when all lines are selected', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = { 'test.txt': { 0: [0, 1, 2] } };
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [3], totalHunks: 1 };
    state.currentDiffHunkNodes = new Map();

    const hunkCheckbox = makeHunkCheckbox('0');
    const lineCheckbox0 = makeLineCheckbox('0', '0');
    const lineCheckbox1 = makeLineCheckbox('0', '1');
    const lineCheckbox2 = makeLineCheckbox('0', '2');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox0, 1: lineCheckbox1, 2: lineCheckbox2 },
    });

    updateHunkCheckboxes();

    expect(hunkCheckbox.checked).toBe(true);
    expect((hunkCheckbox as any).indeterminate).toBe(false);
  });

  it('uses fallback total from lineCheckboxes when changeCounts missing', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = { 'test.txt': { 0: [0] } };
    state.currentDiffMeta = null as any;
    state.currentDiffHunkNodes = new Map();

    const hunkCheckbox = makeHunkCheckbox('0');
    const lineCheckbox0 = makeLineCheckbox('0', '0');
    const lineCheckbox1 = makeLineCheckbox('0', '1');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: lineCheckbox0, 1: lineCheckbox1 },
    });

    updateHunkCheckboxes();

    expect(lineCheckbox0.checked).toBe(true);
    expect((hunkCheckbox as any).indeterminate).toBe(true);
  });
});

describe('syncFileCheckboxWithHunks', () => {
  it('handles binary diff', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'binary.bin';
    state.currentDiffBinary = true;
    state.selectedFiles.add('binary.bin');
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="binary.bin"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
  });

  it('handles no currentFile', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    expect(() => syncFileCheckboxWithHunks()).not.toThrow();
  });

  it('deselects when totalHunks is 0', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'empty.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 0 };
    state.currentDiff = [];
    state.selectedFiles.add('empty.txt');
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="empty.txt"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect(state.selectedFiles.has('empty.txt')).toBe(false);
  });

  it('marks checked when all hunks selected', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'all.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };
    state.selectedHunks = [0];
    state.currentDiff = ['@@ -1 +1 @@', '-a', '+b'];
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="all.txt"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
    expect(state.selectedFiles.has('all.txt')).toBe(true);
  });

  it('marks indeterminate when partial hunk selection', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'partial.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [3], totalHunks: 1 };
    state.selectedHunks = [];
    (state as any).selectedLinesByFile['partial.txt'] = { 0: [0] };
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="partial.txt"><input class="pick" type="checkbox" /></li>';

    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
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
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);
    bindHunkToggles(diff);
    diff.innerHTML = '<input type="checkbox" class="pick-hunk" data-hunk="0" />';
    const cb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('handles pick-line changes via delegated change event', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };

    const lineCb = makeLineCheckbox('0', '1');
    const hunkCheckbox = makeHunkCheckbox('0');
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCheckbox],
      lineCheckboxes: { 0: makeLineCheckbox('0', '0'), 1: lineCb },
    });

    diff.appendChild(lineCb);
    bindHunkToggles(diff);

    lineCb.checked = true;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    const rec = (state as any).selectedLinesByFile['test.txt'];
    expect(rec).toBeDefined();
    expect(rec[0]).toContain(1);
  });

  it('ignores non-input change events', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);
    const nonInput = document.createElement('div');
    nonInput.className = 'pick-hunk';
    diff.appendChild(nonInput);
    expect(() => nonInput.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('handles hunk toggle via delegated change event', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };

    const hunkCb = makeHunkCheckbox('0');
    const lineCb0 = makeLineCheckbox('0', '0');
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.checked = true;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedHunks).toContain(0);
  });

  it('does nothing for elements without hunk or line class', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);
    const otherCb = document.createElement('input');
    otherCb.type = 'checkbox';
    otherCb.className = 'other';
    diff.appendChild(otherCb);
    expect(() => otherCb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });
});

describe('handleHunkToggle - additional paths', () => {
  it('returns early when no currentFile', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';
    const cb = makeHunkCheckbox('0');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('returns early when hunk index is negative', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    const cb = makeHunkCheckbox('-1');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('unchecking hunk removes from selection', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0, 1];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 2 };

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = true;
    const lineCb0 = makeLineCheckbox('0', '0');
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });
    const hunkCb1 = makeHunkCheckbox('1');
    state.currentDiffHunkNodes.set(1, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCb1],
      lineCheckboxes: {},
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.checked = false;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedHunks).not.toContain(0);
    expect(state.selectedHunks).toContain(1);
    expect(hunkEl.classList.contains('picked')).toBe(false);
    expect(lineCb0.checked).toBe(false);
  });
});

describe('handleLineToggle - additional paths', () => {
  it('returns early when currentFile is empty', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';
    const cb = makeLineCheckbox('0', '0');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('returns early when hunk index is negative', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    const cb = makeLineCheckbox('-1', '0');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('returns early when line index is negative', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    const cb = makeLineCheckbox('0', '-1');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('unchecking line removes from selection and updates hunk state', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = { 'test.txt': { 0: [0, 1] } };
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [3], totalHunks: 1 };

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = true;
    const lineCb0 = makeLineCheckbox('0', '0');
    lineCb0.checked = true;
    const lineCb1 = makeLineCheckbox('0', '1');
    lineCb1.checked = true;
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0, 1: lineCb1 },
    });

    diff.appendChild(lineCb1);
    bindHunkToggles(diff);

    lineCb1.checked = false;
    lineCb1.dispatchEvent(new Event('change', { bubbles: true }));

    const rec = (state as any).selectedLinesByFile['test.txt'];
    expect(rec[0]).not.toContain(1);
    expect(rec[0]).toContain(0);
  });
});

describe('handleDiffInputChange - non-input target', () => {
  it('ignores change events on non-input elements', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);
    const nonInput = document.createElement('div');
    nonInput.className = 'pick-hunk';
    diff.appendChild(nonInput);
    expect(() => nonInput.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });
});

describe('clearAllFileSelections via implicit clear', () => {
  it('clears picked class and checkbox when clearedImplicit is true', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [1], totalHunks: 1 };
    state.defaultSelectAll = true;
    state.selectionImplicitAll = true;

    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'test.txt');
    li.classList.add('picked');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    pickCb.checked = true;
    li.appendChild(pickCb);
    ul.appendChild(li);

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = false;
    const lineCb0 = makeLineCheckbox('0', '0');
    lineCb0.checked = true;
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(li.classList.contains('picked')).toBe(false);
    expect(pickCb.checked).toBe(false);
  });
});

// ============================================================================
// handleLineToggle - delete rec[hunk] path and selectedHunks push
// ============================================================================
describe('handleLineToggle additional paths', () => {
  it('deletes rec[hunk] when last line unchecked', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = { 'test.txt': { 0: [0] } };
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [1], totalHunks: 1 };

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = false;
    const lineCb0 = makeLineCheckbox('0', '0');
    lineCb0.checked = true;
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    diff.appendChild(lineCb0);
    bindHunkToggles(diff);

    lineCb0.checked = false;
    lineCb0.dispatchEvent(new Event('change', { bubbles: true }));

    const rec = (state as any).selectedLinesByFile['test.txt'];
    expect(rec[0]).toBeUndefined();
  });

  it('adds hunk to selectedHunks when all lines checked', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = { 'test.txt': {} };
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [1], totalHunks: 1 };

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = false;
    const lineCb0 = makeLineCheckbox('0', '0');
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    diff.appendChild(lineCb0);
    bindHunkToggles(diff);

    lineCb0.checked = true;
    lineCb0.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedHunks).toContain(0);
  });
});

describe('multi-file hunk toggles (data-file routing)', () => {
  it('handleMultiHunkToggle selects all lines in the hunk and updates file checkbox', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = true;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedHunksByFile['multi.txt']).toEqual([0]);
    const lines = (state as any).selectedLinesByFile['multi.txt']?.[0] || [];
    expect(lines.sort()).toEqual([0, 1]);
    expect(state.selectedFiles.has('multi.txt')).toBe(true);
    expect(pickCb.checked).toBe(true);
  });

  it('handleMultiHunkToggle deselects lines when unchecked', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    pickCb.checked = true;
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = { 'multi.txt': [0] };
    (state as any).selectedLinesByFile = { 'multi.txt': { 0: [0, 1] } };
    state.selectedFiles = new Set(['multi.txt']);

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" checked />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = false;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedHunksByFile['multi.txt']?.length ?? 0).toBe(0);
    expect(state.selectedFiles.has('multi.txt')).toBe(false);
    expect(pickCb.checked).toBe(false);
  });

  it('handleMultiLineToggle toggles a single line in multi-file view', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lineCb = diff.querySelector<HTMLInputElement>('.pick-line[data-line="1"]')!;
    lineCb.checked = true;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    const lines = (state as any).selectedLinesByFile['multi.txt']?.[0] || [];
    expect(lines).toContain(1);
    expect(diff.querySelector<HTMLInputElement>('.pick-hunk')?.checked).toBe(false);
    expect((diff.querySelector<HTMLInputElement>('.pick-hunk') as any).indeterminate).toBe(true);
  });

  it('checkboxes outside data-file container use single-file handlers', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'single.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };

    const hunkCb = document.createElement('input');
    hunkCb.type = 'checkbox';
    hunkCb.className = 'pick-hunk';
    hunkCb.dataset.hunk = '0';
    const lineCb = document.createElement('input');
    lineCb.type = 'checkbox';
    lineCb.className = 'pick-line';
    lineCb.dataset.hunk = '0';
    lineCb.dataset.line = '0';
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb },
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.checked = true;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.selectedHunks).toContain(0);
  });

  it('multi-line toggle: deselecting last line removes hunk entry', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = { 'multi.txt': [0] };
    (state as any).selectedLinesByFile = { 'multi.txt': { 0: [0] } };
    state.selectedFiles = new Set(['multi.txt']);

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" checked />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" checked />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lineCb = diff.querySelector<HTMLInputElement>('.pick-line')!;
    lineCb.checked = false;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    const lines = (state as any).selectedLinesByFile['multi.txt']?.[0];
    expect(lines).toBeUndefined();
    expect((state as any).selectedHunksByFile['multi.txt']?.length ?? 0).toBe(0);
    expect(state.selectedFiles.has('multi.txt')).toBe(false);
  });

  it('syncFileCheckboxWithHunks: binary diff path', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'binary.bin';
    state.currentDiffBinary = true;
    state.selectedFiles.add('binary.bin');

    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'binary.bin');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    pickCb.checked = true;
    li.appendChild(pickCb);
    ul.appendChild(li);

    syncFileCheckboxWithHunks();
    expect(pickCb.checked).toBe(true);
  });

  it('syncFileCheckboxWithHunks: totalHunks zero removes file from selectedFiles', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'empty.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 0 };
    state.currentDiff = [];
    state.selectedFiles.add('empty.txt');

    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'empty.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    pickCb.checked = true;
    li.appendChild(pickCb);
    ul.appendChild(li);

    syncFileCheckboxWithHunks();
    expect(pickCb.checked).toBe(false);
    expect(state.selectedFiles.has('empty.txt')).toBe(false);
  });

  it('multi-line toggle: selecting last line marks hunk fully checked', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = { 'multi.txt': { 0: [0] } };
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" checked />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lastLineCb = diff.querySelector<HTMLInputElement>('.pick-line[data-line="1"]')!;
    lastLineCb.checked = true;
    lastLineCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedHunksByFile['multi.txt']).toContain(0);
    expect(diff.querySelector<HTMLInputElement>('.pick-hunk')?.checked).toBe(true);
    expect((diff.querySelector<HTMLInputElement>('.pick-hunk') as any).indeterminate).toBe(false);
    expect(state.selectedFiles.has('multi.txt')).toBe(true);
  });

  it('handleMultiLineToggle: next.length===totalLines does not push duplicate hunk index', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = { 'multi.txt': [0] };
    (state as any).selectedLinesByFile = { 'multi.txt': { 0: [0] } };
    state.selectedFiles = new Set(['multi.txt']);

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" checked />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" checked />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lastLineCb = diff.querySelector<HTMLInputElement>('.pick-line[data-line="1"]')!;
    lastLineCb.checked = true;
    lastLineCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedHunksByFile['multi.txt']).toEqual([0]);
    expect(state.selectedFiles.has('multi.txt')).toBe(true);
  });

  it('handleMultiLineToggle: deselect when hunk not previously in hunks array', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = { 'multi.txt': { 0: [0] } };
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" checked />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lineCb = diff.querySelector<HTMLInputElement>('.pick-line')!;
    lineCb.checked = false;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedLinesByFile['multi.txt']?.[0]).toBeUndefined();
    expect((state as any).selectedHunksByFile['multi.txt']).toEqual([]);
  });

  it('handleMultiLineToggle: partial selection when hunk not previously in hunks array', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lineCb = diff.querySelector<HTMLInputElement>('.pick-line[data-line="0"]')!;
    lineCb.checked = true;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedLinesByFile['multi.txt']?.[0]).toEqual([0]);
    expect((state as any).selectedHunksByFile['multi.txt']).toEqual([]);
    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    expect(hunkCb.checked).toBe(false);
    expect((hunkCb as any).indeterminate).toBe(true);
    expect(state.selectedFiles.has('multi.txt')).toBe(false);
  });
});

describe('handleDiffInputChange - null target branch', () => {
  it('returns early when event target is null', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'pick-hunk';
    input.dataset.hunk = '0';
    diff.appendChild(input);

    const ev = new Event('change', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: null, configurable: true });
    expect(() => input.dispatchEvent(ev)).not.toThrow();
  });
});

describe('toggleFilePick - currentFile null', () => {
  it('handles currentFile null (not just empty)', async () => {
    const { toggleFilePick } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.selectedFiles = new Set();
    state.currentFile = null as any;
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', true);
    expect(state.selectedFiles.has('test.txt')).toBe(true);
  });
});

describe('updateHunkCheckboxes - null nodes', () => {
  it('does nothing when currentDiffHunkNodes is null', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentDiffHunkNodes = null as any;
    expect(() => updateHunkCheckboxes()).not.toThrow();
  });
});

describe('handleMultiHunkToggle - missing hunk container', () => {
  it('returns early when hunkContainer is null', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';
    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="somefile.txt">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '</div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = true;
    expect(() => hunkCb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });
});

describe('handleMultiHunkToggle - unchecked with missing hunk index', () => {
  it('does not error when unchecked hunk was never in array', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    pickCb.checked = true;
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = { 'multi.txt': [] };
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set(['multi.txt']);

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" checked />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = false;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedHunksByFile['multi.txt']).toEqual([]);
    expect(state.selectedFiles.has('multi.txt')).toBe(false);
  });
});

describe('syncFileCheckboxWithHunks - edge cases', () => {
  it('handles hasPartialLineSel with missing changeCounts', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'partial.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 1 };
    state.selectedHunks = [];
    (state as any).selectedLinesByFile['partial.txt'] = { 0: [0] };
    state.selectedFiles = new Set();
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="partial.txt"><input class="pick" type="checkbox" /></li>';

    syncFileCheckboxWithHunks();

    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect((cb as any).indeterminate).toBe(true);
    expect(state.selectedFiles.has('partial.txt')).toBe(false);
  });

  it('marks full check when all hunks selected without partial line sel', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'full.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = {};
    state.currentDiff = ['@@ -1 +1 @@', '-a', '+b'];
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="full.txt"><input class="pick" type="checkbox" /></li>';

    syncFileCheckboxWithHunks();
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(true);
    expect((cb as any).indeterminate).toBe(false);
    expect(state.selectedFiles.has('full.txt')).toBe(true);
  });
});

describe('handleHunkToggle - restores hunk checkbox state', () => {
  it('unchecking a checked hunk with lines resets to indeterminate for parent', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiff = ['@@ -1 +2 @@', '-old', '+new1', '+new2'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };

    const hunkCb = document.createElement('input');
    hunkCb.type = 'checkbox';
    hunkCb.className = 'pick-hunk';
    hunkCb.dataset.hunk = '0';
    hunkCb.checked = true;
    const lineCb0 = document.createElement('input');
    lineCb0.type = 'checkbox';
    lineCb0.className = 'pick-line';
    lineCb0.dataset.hunk = '0';
    lineCb0.dataset.line = '0';
    lineCb0.checked = true;
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.checked = false;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedHunks).not.toContain(0);
    expect(lineCb0.checked).toBe(false);
    expect(hunkCb.indeterminate).toBe(false);
  });
});

// ============================================================================
// handleMultiHunkToggle — unchecked when hunk not in hunks array
// ============================================================================
describe('handleMultiHunkToggle - unchecked, hunk absent from hunks', () => {
  it('does not error when unchecking hunk never added to hunks array', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    pickCb.checked = false;
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = false;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    // hunk was never in hunks → pos = -1 → splice not called → no error
    expect((state as any).selectedHunksByFile['multi.txt']).toEqual([]);
  });
});

// ============================================================================
// handleMultiLineToggle — line toggling with multi-hunk container
// ============================================================================
describe('handleMultiLineToggle - multi-file line toggle', () => {
  it('toggles a line on then off within a multi-hunk container', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lineCb = diff.querySelector<HTMLInputElement>('.pick-line[data-line="0"]')!;
    // Toggle on
    lineCb.checked = true;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    const lines0 = (state as any).selectedLinesByFile['multi.txt']?.[0] || [];
    expect(lines0).toContain(0);
    expect(lines0).not.toContain(1);

    // Toggle off
    lineCb.checked = false;
    lineCb.dispatchEvent(new Event('change', { bubbles: true }));

    const linesAfter = (state as any).selectedLinesByFile['multi.txt']?.[0];
    expect(linesAfter).toBeUndefined();
  });
});

// ============================================================================
// syncFileCheckboxWithHunks — totalHunks = 0 via allHunkIndices fallback
// ============================================================================
describe('syncFileCheckboxWithHunks - meta null, 0 hunks from diff', () => {
  it('handles null meta and empty diff (totalHunks computes to 0)', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'empty.txt';
    state.currentDiffMeta = null as any;          // meta is null
    state.currentDiff = [];                       // allHunkIndices([]) returns 0
    state.selectedFiles = new Set(['empty.txt']);
    const ul = document.getElementById('file-list')!;
    ul.innerHTML = '<li class="row" data-path="empty.txt"><input class="pick" type="checkbox" checked /></li>';

    syncFileCheckboxWithHunks();

    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect(state.selectedFiles.has('empty.txt')).toBe(false);
  });
});

// ============================================================================
// updateListCheckboxForPath — missing row
// ============================================================================
describe('updateListCheckboxForPath - row not found', () => {
  it('does nothing when no row matches the data-path selector', async () => {
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="exists.txt"><input class="pick" type="checkbox" /></li>';
    const { updateListCheckboxForPath } = await import('@scripts/features/repo/diffSelection');
    // Path not present in DOM → querySelector returns null → no crash
    expect(() => updateListCheckboxForPath('missing.txt', true, false)).not.toThrow();
    // Existing row should be unaffected
    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
  });
});

// ============================================================================
// handleDiffInputChange — non-matching targets
// ============================================================================
describe('handleDiffInputChange - non-matching targets', () => {
  it('ignores input in data-file container without pick-hunk or pick-line class', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');

    diff.innerHTML = '<div class="multi-hunk" data-file="some.txt">'
      + '<input type="checkbox" class="some-other-class" data-hunk="0" />'
      + '</div>';

    bindHunkToggles(diff);

    const cb = diff.querySelector<HTMLInputElement>('input')!;
    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('ignores non-hunk, non-line input outside data-file container', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'some-other-input';
    diff.appendChild(cb);
    bindHunkToggles(diff);

    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('handles target with data-file container but empty file attribute', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');

    diff.innerHTML = '<div class="multi-hunk" data-file="">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '</div>';

    bindHunkToggles(diff);

    const cb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
    // file is empty → handleMultiHunkToggle returns early
  });
});

// ============================================================================
// handleHunkToggle — checking with already-included hunk
// ============================================================================
describe('handleHunkToggle - already included hunk', () => {
  it('does not push duplicate hunk index when already in selectedHunks', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'test.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    // Hunk 0 is already in selectedHunks
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 1 };

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = true;
    const lineCb0 = makeLineCheckbox('0', '0');
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    // Already included → the push branch is skipped but checkbox is already true
    // Dispatching with checked=true should not add duplicates
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedHunks).toEqual([0]);
    expect(hunkCb.checked).toBe(true);
  });
});

// ============================================================================
// updateHunkCheckboxes — without state.currentFile
// ============================================================================
describe('updateHunkCheckboxes - no currentFile', () => {
  it('clears line checkboxes when state.currentFile is falsy', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];  // hunk 0 considered "selected"

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = false;
    const lineCb0 = makeLineCheckbox('0', '0');
    lineCb0.checked = true;  // should be reset to false
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    updateHunkCheckboxes();

    // Hunk checkbox checked = isSelected = true, line checkboxes reset to false
    expect(hunkCb.checked).toBe(true);
    expect(lineCb0.checked).toBe(false);  // else branch clears line checkboxes
    expect(hunkCb.indeterminate).toBe(false);
  });

  it('handles null currentFile (not just empty string)', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = null as any;
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = true;
    const lineCb0 = makeLineCheckbox('0', '0');
    lineCb0.checked = true;
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [document.createElement('div')],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    updateHunkCheckboxes();

    expect(hunkCb.checked).toBe(false);  // isSelected = false
    expect(lineCb0.checked).toBe(false); // else branch
  });
});

// ============================================================================
// handleMultiHunkToggle - checked with no line checkboxes
// ============================================================================
describe('handleMultiHunkToggle - checked with no line checkboxes', () => {
  it('handles checked hunk with no .pick-line elements', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'noline.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="noline.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = true;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedHunksByFile['noline.txt']).toEqual([0]);
    expect(state.selectedFiles.has('noline.txt')).toBe(true);
  });
});

// ============================================================================
// handleMultiHunkToggle - checked with lineCbs
// ============================================================================
describe('handleMultiHunkToggle - checked with no lineCbs, fallback map delete', () => {
  it('does not error when lineCbs is empty and hunk checked', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'emptycb.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = { 'emptycb.txt': [] };
    (state as any).selectedLinesByFile = { 'emptycb.txt': { 0: [0] } };
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="emptycb.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const hunkCb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    hunkCb.checked = true;
    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));

    expect((state as any).selectedLinesByFile['emptycb.txt']?.[0]).toBeUndefined();
  });
});

// ============================================================================
// handleMultiLineToggle - multiple hunks allChecked and anyChecked
// ============================================================================
describe('handleMultiLineToggle - multiple hunks allChecked/anyChecked', () => {
  it('sets file checked when all hunks are fully selected', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'multi-hunk.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="multi-hunk.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '</div>'
      + '<div class="hunk" data-hunk-index="1">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="1" />'
      + '<input type="checkbox" class="pick-line" data-hunk="1" data-line="0" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const line0 = diff.querySelector<HTMLInputElement>('.pick-line[data-hunk="0"]')!;
    line0.checked = true;
    line0.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedFiles.has('multi-hunk.txt')).toBe(false);

    const line1 = diff.querySelector<HTMLInputElement>('.pick-line[data-hunk="1"]')!;
    line1.checked = true;
    line1.dispatchEvent(new Event('change', { bubbles: true }));

    expect(state.selectedFiles.has('multi-hunk.txt')).toBe(true);
    expect(pickCb.checked).toBe(true);
  });

  it('sets indeterminate file cb when some hunks partial', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'partial-multi.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="multi-hunk" data-file="partial-multi.txt">'
      + '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="1" />'
      + '</div>'
      + '<div class="hunk" data-hunk-index="1">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="1" />'
      + '<input type="checkbox" class="pick-line" data-hunk="1" data-line="0" />'
      + '</div></div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const line0 = diff.querySelector<HTMLInputElement>('.pick-line[data-hunk="0"][data-line="0"]')!;
    line0.checked = true;
    line0.dispatchEvent(new Event('change', { bubbles: true }));

    expect((pickCb as any).indeterminate).toBe(true);
    expect(pickCb.checked).toBe(false);
    expect(state.selectedFiles.has('partial-multi.txt')).toBe(false);
  });
});

// ============================================================================
// handleMultiLineToggle - when data-file parent not found
// ============================================================================
describe('handleMultiLineToggle - no data-file parent', () => {
  it('handles line toggle when hunkContainer has no [data-file] ancestor', async () => {
    const { state } = await import('@scripts/state/state');
    const ul = document.getElementById('file-list')!;
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('data-path', 'noparent.txt');
    const pickCb = document.createElement('input');
    pickCb.type = 'checkbox';
    pickCb.className = 'pick';
    li.appendChild(pickCb);
    ul.appendChild(li);

    (state as any).selectedHunksByFile = {};
    (state as any).selectedLinesByFile = {};
    state.selectedFiles = new Set();

    const diff = document.getElementById('diff')!;
    diff.innerHTML = '<div class="hunk" data-hunk-index="0">'
      + '<input type="checkbox" class="pick-hunk" data-hunk="0" />'
      + '<input type="checkbox" class="pick-line" data-hunk="0" data-line="0" />'
      + '</div>';

    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    bindHunkToggles(diff);

    const lineCb = diff.querySelector<HTMLInputElement>('.pick-line')!;
    lineCb.checked = true;
    expect(() => lineCb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });
});

// ============================================================================
// handleDiffInputChange - pick-hunk outside data-file, no currentFile
// ============================================================================
describe('handleDiffInputChange - pick-hunk outside data-file, no currentFile', () => {
  it('returns early from handleHunkToggle when currentFile is empty', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = '';

    const hunkCb = document.createElement('input');
    hunkCb.type = 'checkbox';
    hunkCb.className = 'pick-hunk';
    hunkCb.dataset.hunk = '0';
    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.checked = true;
    expect(() => hunkCb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });
});

// ============================================================================
// handleHunkToggle - refs undefined (hunk not in currentDiffHunkNodes)
// ============================================================================
describe('handleHunkToggle - refs undefined', () => {
  it('does not error when unchecking hunk with no refs', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'orphan.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [999];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [2], totalHunks: 2 };

    const hunkCb = document.createElement('input');
    hunkCb.type = 'checkbox';
    hunkCb.className = 'pick-hunk';
    hunkCb.dataset.hunk = '999';
    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.checked = false;
    expect(() => hunkCb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
    expect(state.selectedHunks).not.toContain(999);
  });

  it('handles checking hunk already in selectedHunks with empty lineCheckboxes', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'empty-lines.txt';
    state.currentDiff = ['@@ -1 +1 @@', '-old', '+new'];
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [0];
    (state as any).selectedLinesByFile = {};
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [0], totalHunks: 1 };

    const hunkCb = document.createElement('input');
    hunkCb.type = 'checkbox';
    hunkCb.className = 'pick-hunk';
    hunkCb.dataset.hunk = '0';
    hunkCb.checked = true;
    const hunkEl = document.createElement('div');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: {},
    });

    diff.appendChild(hunkCb);
    bindHunkToggles(diff);

    hunkCb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.selectedHunks).toEqual([0]);
  });
});

// ============================================================================
// syncFileCheckboxWithHunks - partial line selection with missing changeCounts
// ============================================================================
describe('syncFileCheckboxWithHunks - partial line missing changeCounts', () => {
  it('handles partial line selection when changeCounts has 0 for the hunk', async () => {
    const { syncFileCheckboxWithHunks } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'partial-zero.txt';
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [0], totalHunks: 1 };
    state.selectedHunks = [];
    (state as any).selectedLinesByFile['partial-zero.txt'] = { 0: [0] };
    document.querySelector('#file-list')!.innerHTML = '<li class="row" data-path="partial-zero.txt"><input class="pick" type="checkbox" /></li>';

    syncFileCheckboxWithHunks();

    const cb = document.querySelector<HTMLInputElement>('input.pick')!;
    expect(cb.checked).toBe(false);
    expect(state.selectedFiles.has('partial-zero.txt')).toBe(false);
  });
});

// ============================================================================
// updateHunkCheckboxes - empty rec for hunk
// ============================================================================
describe('updateHunkCheckboxes - rec[hunk] empty array', () => {
  it('clears hunk checkbox when rec[hunk] is empty array', async () => {
    const { updateHunkCheckboxes } = await import('@scripts/features/repo/diffSelection');
    const { state } = await import('@scripts/state/state');
    state.currentFile = 'empty-rec.txt';
    state.currentDiffHunkNodes = new Map();
    state.selectedHunks = [];
    (state as any).selectedLinesByFile = { 'empty-rec.txt': {} };

    const hunkCb = makeHunkCheckbox('0');
    hunkCb.checked = true;
    const lineCb0 = makeLineCheckbox('0', '0');
    lineCb0.checked = true;
    const hunkEl = document.createElement('div');
    hunkEl.classList.add('picked');
    state.currentDiffHunkNodes.set(0, {
      hunkEls: [hunkEl],
      hunkCheckboxes: [hunkCb],
      lineCheckboxes: { 0: lineCb0 },
    });

    updateHunkCheckboxes();

    expect(hunkCb.checked).toBe(false);
    expect(lineCb0.checked).toBe(false);
    expect((hunkCb as any).indeterminate).toBe(false);
  });
});
