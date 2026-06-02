// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable mock vars – reassigned in beforeEach so tests always get fresh fns
// ---------------------------------------------------------------------------
let mockFilterInput: HTMLInputElement;
let mockSelectAllBox: HTMLInputElement;
let _renderList = vi.fn();
let _getVisibleFiles = vi.fn();
let _toggleSelectAll = vi.fn();
let _disableDefaultSelectAll = vi.fn();

function makeFilterInput() {
  const el = document.createElement('input');
  el.id = 'filter';
  return el;
}
function makeSelectAllBox() {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.id = 'select-all';
  return el;
}

// Use getters so every import (even after resetModules) returns the current vars
vi.mock('@scripts/features/repo/context', () => ({
  get filterInput() { return mockFilterInput; },
  get selectAllBox() { return mockSelectAllBox; },
}));
vi.mock('@scripts/features/repo/list', () => ({
  get renderList() { return _renderList; },
}));
vi.mock('@scripts/features/repo/selectionState', () => ({
  get getVisibleFiles() { return _getVisibleFiles; },
}));
const _isDragSelecting = vi.fn(() => false);
vi.mock('@scripts/features/repo/interactions', () => ({
  get toggleSelectAll() { return _toggleSelectAll; },
  get isDragSelecting() { return _isDragSelecting; },
}));
vi.mock('@scripts/state/state', () => ({
  state: { defaultSelectAll: true, selectionImplicitAll: true },
  prefs: { tab: 'changes' },
  get disableDefaultSelectAll() { return _disableDefaultSelectAll; },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  mockFilterInput = makeFilterInput();
  mockSelectAllBox = makeSelectAllBox();
  _renderList = vi.fn();
  _getVisibleFiles = vi.fn();
  _toggleSelectAll = vi.fn();
  _disableDefaultSelectAll = vi.fn();
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// bindFilter
// ---------------------------------------------------------------------------
describe('bindFilter', () => {
  it('calls renderList on filter input event', async () => {
    const mod = await import('@scripts/features/repo/filter');
    mod.bindFilter();

    mockFilterInput.value = 'test';
    mockFilterInput.dispatchEvent(new Event('input'));

    expect(_renderList).toHaveBeenCalledTimes(1);
  });

  it('select-all checkbox change triggers toggleSelectAll when tab is changes', async () => {
    const visibleFiles = [{ path: 'a.js' as string }, { path: 'b.js' as string }];
    _getVisibleFiles.mockReturnValue(visibleFiles);
    mockSelectAllBox.checked = true;

    const mod = await import('@scripts/features/repo/filter');
    mod.bindFilter();

    mockSelectAllBox.dispatchEvent(new Event('change'));

    expect(_disableDefaultSelectAll).toHaveBeenCalled();
    expect(_toggleSelectAll).toHaveBeenCalledWith(true, visibleFiles);
    expect(_renderList).toHaveBeenCalled();
  });

  it('select-all toggles all files when checked becomes false', async () => {
    const visibleFiles = [{ path: 'a.js' as string }];
    _getVisibleFiles.mockReturnValue(visibleFiles);
    mockSelectAllBox.checked = false;

    const mod = await import('@scripts/features/repo/filter');
    mod.bindFilter();

    mockSelectAllBox.dispatchEvent(new Event('change'));

    expect(_toggleSelectAll).toHaveBeenCalledWith(false, visibleFiles);
  });

  it('does nothing on select-all change when tab is not changes', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';

    const mod = await import('@scripts/features/repo/filter');
    mod.bindFilter();

    mockSelectAllBox.dispatchEvent(new Event('change'));

    expect(_toggleSelectAll).not.toHaveBeenCalled();
  });

  it('skips renderList when isDragSelecting returns true', async () => {
    _isDragSelecting.mockReturnValue(true);

    const mod = await import('@scripts/features/repo/filter');
    mod.bindFilter();

    mockFilterInput.dispatchEvent(new Event('input'));

    expect(_renderList).not.toHaveBeenCalled();
  });
});
