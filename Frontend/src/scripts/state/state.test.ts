// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

// Set matchMedia before importing modules that touch browser media APIs.
(globalThis as any).matchMedia = createMatchMediaMock;

import { disableDefaultSelectAll, hasChanges, hasRepo, isConflictStatus, resolveVcsActionLabel, state, statusClass, statusLabel } from './state';

/** Resets mutable state between assertions. */
afterEach(() => {
  state.hasRepo = false;
  state.files = [];
  state.vcsActionLabels = {};
  state.defaultSelectAll = true;
  state.selectionImplicitAll = true;
  state.selectedFiles = new Set();
});

describe('resolveVcsActionLabel', () => {
  it('falls back to generic VCS text when a label is missing', () => {
    state.vcsActionLabels = {};
    expect(resolveVcsActionLabel('VCS.Push', 'Push')).toBe('Push');
  });

  it('returns the plugin-provided label when available', () => {
    state.vcsActionLabels = { 'VCS.Push': 'Ship' };
    expect(resolveVcsActionLabel('VCS.Push', 'Push')).toBe('Ship');
  });
});

describe('isConflictStatus', () => {
  it('accepts normalized and raw porcelain conflict states', () => {
    expect(isConflictStatus('U')).toBe(true);
    expect(isConflictStatus('UU')).toBe(true);
    expect(isConflictStatus('AA')).toBe(true);
    expect(isConflictStatus('DD')).toBe(true);
    expect(isConflictStatus('M')).toBe(false);
  });
});

describe('statusLabel', () => {
  it.each([
    ['A', 'Added'],
    ['?', 'Untracked'],
    ['R', 'Renamed'],
    ['C', 'Copied'],
    ['T', 'Type change'],
    ['S', 'Submodule'],
    ['U', 'Conflicted'],
    ['M', 'Modified'],
    ['D', 'Deleted'],
    ['AA', 'Conflicted'],
    ['X', 'Changed'],
  ])('maps %s to %s', (code, label) => {
    expect(statusLabel(code)).toBe(label);
  });
});

describe('statusClass', () => {
  it.each([
    ['A', 'add'],
    ['?', 'untracked'],
    ['R', 'ren'],
    ['C', 'cpy'],
    ['T', 'type'],
    ['S', 'submodule'],
    ['U', 'conflict'],
    ['M', 'mod'],
    ['D', 'del'],
    ['AA', 'conflict'],
    ['X', 'mod'],
  ])('maps %s to %s', (code, klass) => {
    expect(statusClass(code)).toBe(klass);
  });
});

describe('state flags', () => {
  it('reports repo and change presence', () => {
    expect(hasRepo()).toBe(false);
    expect(hasChanges()).toBe(false);

    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' }];

    expect(hasRepo()).toBe(true);
    expect(hasChanges()).toBe(true);
  });
});

describe('disableDefaultSelectAll', () => {
  it('clears implicit selections when asked', () => {
    state.selectedFiles = new Set(['a.txt']);
    state.defaultSelectAll = true;
    state.selectionImplicitAll = true;

    expect(disableDefaultSelectAll(true)).toBe(true);
    expect(Array.from(state.selectedFiles)).toEqual([]);
    expect(state.defaultSelectAll).toBe(false);
    expect(state.selectionImplicitAll).toBe(false);
  });

  it('returns false when no implicit selection exists', () => {
    state.selectedFiles = new Set(['a.txt']);
    state.defaultSelectAll = false;
    state.selectionImplicitAll = false;

    expect(disableDefaultSelectAll(true)).toBe(false);
    expect(Array.from(state.selectedFiles)).toEqual(['a.txt']);
    expect(state.defaultSelectAll).toBe(false);
    expect(state.selectionImplicitAll).toBe(false);
  });
});
