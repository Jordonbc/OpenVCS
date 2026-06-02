// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Provides matchMedia shim required by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('allHunkIndices', () => {
  it('returns empty array for empty lines', async () => {
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    expect(allHunkIndices([])).toEqual([]);
  });

  it('returns empty array for lines without hunks', async () => {
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    expect(allHunkIndices(['diff --git a/a b/a'])).toEqual([]);
  });

  it('returns contiguous indices for valid diff', async () => {
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    const lines = ['header', '@@ -1 +1 @@', '-a', '+b', '@@ -5 +5 @@', '-c', '+d'];
    const indices = allHunkIndices(lines);
    expect(indices).toEqual([0, 1]);
  });

  it('uses currentDiffMeta when available', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 3 };
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    expect(allHunkIndices([])).toEqual([0, 1, 2]);
  });
});

describe('buildDiffMeta', () => {
  it('returns empty meta for non-hunk lines', async () => {
    const { buildDiffMeta } = await import('@scripts/features/repo/diffFragment');
    const meta = buildDiffMeta(['header1', 'header2']);
    expect(meta.totalHunks).toBe(0);
    // idx = -1 (no @@ found), Math.max(0, -1) = 0
    expect(meta.offset).toBe(0);
    expect(meta.rest).toEqual([]);
  });

  it('parses hunk headers and change counts', async () => {
    const { buildDiffMeta } = await import('@scripts/features/repo/diffFragment');
    const lines = [
      'diff --git a/f.txt b/f.txt',
      'index abc..def',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,4 @@',
      ' context',
      '-removed',
      '+added',
      ' context',
      '@@ -10,2 +11,3 @@',
      ' more',
      '+insert',
      '-gone',
    ];
    const meta = buildDiffMeta(lines);
    expect(meta.offset).toBe(4);
    expect(meta.totalHunks).toBe(2);
    expect(meta.changeCounts).toHaveLength(2);
    expect(meta.changeCounts[0]).toBe(2); // -removed, +added
    expect(meta.changeCounts[1]).toBe(2); // +insert, -gone
  });
});

describe('buildDiffFragment', () => {
  it('builds fragment with hunk rows and checkboxes', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +1,2 @@', ' common', '-old', '+new', ' common'];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);

    expect(div.querySelector('.hunk')).not.toBeNull();
    expect(div.querySelector('.pick-hunk')).not.toBeNull();
    expect(div.querySelector('.pick-line')).not.toBeNull();
    expect(div.querySelector('.add')).not.toBeNull();
    expect(div.querySelector('.del')).not.toBeNull();
    // Line numbers exist for context and change lines
    const leftNums = div.querySelectorAll('.line-number-left');
    const rightNums = div.querySelectorAll('.line-number-right');
    expect(leftNums.length).toBeGreaterThanOrEqual(1);
    expect(rightNums.length).toBeGreaterThanOrEqual(1);
    // Delete line '-old' has left number
    expect(leftNums[0]?.textContent).toBeTruthy();
  });

  it('renders empty state when no hunks', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const frag = buildDiffFragment(['header only', 'no hunks']);
    const div = document.createElement('div');
    div.appendChild(frag);
    expect(div.textContent).toContain('No textual hunks to display');
  });
});

describe('renderHunksWithSelection', () => {
  it('returns empty string for empty input', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    expect(renderHunksWithSelection([])).toBe('');
    expect(renderHunksWithSelection(null as any)).toBe('');
  });

  it('returns empty placeholder when no hunks found', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const html = renderHunksWithSelection(['no hunks here']);
    expect(html).toContain('No textual hunks to display');
  });

  it('renders HTML with hunk checkboxes and line numbers', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +1,2 @@', ' common', '-old', '+new'];
    const html = renderHunksWithSelection(lines);
    expect(html).toContain('pick-hunk');
    expect(html).toContain('pick-line');
    expect(html).toContain('line-number-left');
    expect(html).toContain('line-number-right');
    expect(html).toContain('add');
    expect(html).toContain('del');
  });
});

describe('renderHunksReadonly', () => {
  it('returns empty string for empty input', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    expect(renderHunksReadonly([])).toBe('');
  });

  it('returns placeholder when no hunks', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    const html = renderHunksReadonly(['just a header']);
    expect(html).toContain('No textual hunks to display');
  });

  it('renders read-only line rows', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1 +1 @@', '-a', '+b'];
    const html = renderHunksReadonly(lines);
    expect(html).toContain('hline');
    expect(html).toContain('gutter');
    expect(html).toContain('add');
    expect(html).toContain('del');
    expect(html).not.toContain('pick-hunk'); // readonly has no checkboxes
    expect(html).not.toContain('pick-line');
  });
});
