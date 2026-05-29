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

describe('toggleFilePick', () => {
  it('does nothing when path is empty', async () => {
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set();
    toggleFilePick('', true);
    expect(state.selectedFiles.size).toBe(0);
  });

  it('adds path to selectedFiles when on=true', async () => {
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set();
    state.currentFile = '';
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', true);
    expect(state.selectedFiles.has('test.txt')).toBe(true);
  });

  it('removes path from selectedFiles when on=false', async () => {
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set(['test.txt']);
    state.currentFile = '';
    state.currentDiffBinary = false;

    toggleFilePick('test.txt', false);
    expect(state.selectedFiles.has('test.txt')).toBe(false);
  });

  it('updates hunk selections when currentFile matches path and not binary', async () => {
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { toggleFilePick } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { updateHunkCheckboxes } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.currentDiffHunkNodes = new Map();
    expect(() => updateHunkCheckboxes()).not.toThrow();
  });

  it('updates hunk checkboxes based on selectedHunks', async () => {
    const { updateHunkCheckboxes } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { updateHunkCheckboxes } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { updateHunkCheckboxes } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { updateHunkCheckboxes } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { updateHunkCheckboxes } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    bindHunkToggles(diff);
    diff.innerHTML = '<input type="checkbox" class="pick-hunk" data-hunk="0" />';
    const cb = diff.querySelector<HTMLInputElement>('.pick-hunk')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('handles pick-line changes via delegated change event', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { bindHunkToggles } = await import('./diffSelection');
    bindHunkToggles(diff);
    const nonInput = document.createElement('div');
    nonInput.className = 'pick-hunk';
    diff.appendChild(nonInput);
    expect(() => nonInput.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('handles hunk toggle via delegated change event', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { bindHunkToggles } = await import('./diffSelection');
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
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.currentFile = '';
    const cb = makeHunkCheckbox('0');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('returns early when hunk index is negative', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.currentFile = 'test.txt';
    const cb = makeHunkCheckbox('-1');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    cb.checked = true;
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('unchecking hunk removes from selection', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.currentFile = '';
    const cb = makeLineCheckbox('0', '0');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('returns early when hunk index is negative', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.currentFile = 'test.txt';
    const cb = makeLineCheckbox('-1', '0');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('returns early when line index is negative', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
    state.currentFile = 'test.txt';
    const cb = makeLineCheckbox('0', '-1');
    diff.appendChild(cb);
    bindHunkToggles(diff);
    expect(() => cb.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('unchecking line removes from selection and updates hunk state', async () => {
    const diff = document.getElementById('diff')!;
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
    const { bindHunkToggles } = await import('./diffSelection');
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
    const { bindHunkToggles } = await import('./diffSelection');
    const { state } = await import('../../state/state');
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
