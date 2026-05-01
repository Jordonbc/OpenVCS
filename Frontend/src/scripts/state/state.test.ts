// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

// Set matchMedia before importing modules that touch browser media APIs.
(globalThis as any).matchMedia = createMatchMediaMock;

import { resolveVcsActionLabel, state } from './state';

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
