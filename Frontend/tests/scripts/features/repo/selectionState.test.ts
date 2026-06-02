// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes required by selectionState module. */
function mountRepoDom() {
  document.body.innerHTML = `
    <input id="filter" />
    <input id="select-all" type="checkbox" />
    <ul id="file-list"></ul>
    <span id="changes-count"></span>
    <div id="left-foot"></div>
    <div id="diff-path"></div>
    <div id="diff"></div>
  `;
}

beforeEach(async () => {
  vi.resetModules();
  mountRepoDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('getVisibleFiles', () => {
  it('returns empty array when tab is not changes', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';
    expect(getVisibleFiles()).toEqual([]);
  });

  it('returns all files when filter is empty', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.rs', status: 'A' },
    ] as any;
    const result = getVisibleFiles();
    expect(result).toHaveLength(2);
  });

  it('filters files by query', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.rs', status: 'A' },
    ] as any;
    (document.getElementById('filter') as HTMLInputElement).value = '.rs';
    const result = getVisibleFiles();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('b.rs');
  });

  it('returns all files when filter is whitespace', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'a.txt', status: 'M' }] as any;
    (document.getElementById('filter') as HTMLInputElement).value = '   ';
    const result = getVisibleFiles();
    expect(result).toHaveLength(1);
  });

  it('returns empty array when state.files is undefined', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    delete (state as any).files;
    const result = getVisibleFiles();
    expect(result).toEqual([]);
  });

  it('returns empty array when state.files is null', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    (state as any).files = null;
    const result = getVisibleFiles();
    expect(result).toEqual([]);
  });

  it('filters files by query with null path in file', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: null, status: 'M' },
      { path: 'a.txt', status: 'A' },
    ] as any;
    (document.getElementById('filter') as HTMLInputElement).value = '.txt';
    const result = getVisibleFiles();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('a.txt');
  });

  it('handles case-insensitive filter matching', async () => {
    const { getVisibleFiles } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [
      { path: 'README.md', status: 'M' },
      { path: 'main.rs', status: 'A' },
    ] as any;
    (document.getElementById('filter') as HTMLInputElement).value = 'Readme';
    const result = getVisibleFiles();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('README.md');
  });
});

describe('updateSelectAllState', () => {
  it('unchecks when tab is not changes', async () => {
    const { updateSelectAllState } = await import('@scripts/features/repo/selectionState');
    const { prefs } = await import('@scripts/state/state');
    const selectAll = document.getElementById('select-all') as HTMLInputElement;
    selectAll.checked = true;
    prefs.tab = 'history';
    updateSelectAllState([]);
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('unchecks when no visible files', async () => {
    const { updateSelectAllState } = await import('@scripts/features/repo/selectionState');
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    const selectAll = document.getElementById('select-all') as HTMLInputElement;
    selectAll.checked = true;
    selectAll.indeterminate = true;
    updateSelectAllState([]);
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('checks all when every file is selected', async () => {
    const { updateSelectAllState } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'M' }] as any;
    state.selectedFiles = new Set(['a.txt', 'b.txt']);
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ];
    const selectAll = document.getElementById('select-all') as HTMLInputElement;
    updateSelectAllState(visible as any);
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('shows indeterminate when partial selection', async () => {
    const { updateSelectAllState } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'M' }] as any;
    state.selectedFiles = new Set(['a.txt']);
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ] as any;
    const selectAll = document.getElementById('select-all') as HTMLInputElement;
    updateSelectAllState(visible);
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
  });

  it('unchecks when no files selected', async () => {
    const { updateSelectAllState } = await import('@scripts/features/repo/selectionState');
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.files = [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'M' }] as any;
    state.selectedFiles = new Set();
    const visible = [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'M' },
    ] as any;
    const selectAll = document.getElementById('select-all') as HTMLInputElement;
    updateSelectAllState(visible);
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('does nothing when selectAllBox is null', async () => {
    const { updateSelectAllState } = await import('@scripts/features/repo/selectionState');
    document.getElementById('select-all')?.remove();
    expect(() => updateSelectAllState([] as any)).not.toThrow();
  });
});
