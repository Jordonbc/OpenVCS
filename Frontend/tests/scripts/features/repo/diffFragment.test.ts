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
    expect(html).not.toContain('pick-hunk');
    expect(html).not.toContain('pick-line');
  });

  it('renders read-only with context lines', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,3 +1,3 @@', ' context', '-old', '+new', ' context'];
    const html = renderHunksReadonly(lines);
    expect(html).toContain('context');
    expect(html).toContain('-old');
    expect(html).toContain('+new');
    const matchContext = html.match(/hline(?!.*(?:add|del))/);
    expect(html).not.toContain('pick-hunk');
  });

  it('renders read-only with add-only lines (no deletions)', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -0,0 +1,2 @@', '+new1', '+new2'];
    const html = renderHunksReadonly(lines);
    expect(html).toContain('add');
    expect(html).not.toContain('del');
  });

  it('renders read-only with delete-only lines (no additions)', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +0,0 @@', '-gone1', '-gone2'];
    const html = renderHunksReadonly(lines);
    expect(html).toContain('del');
    expect(html).not.toContain('add');
  });

  it('renders read-only with empty string line values', async () => {
    const { renderHunksReadonly } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +1,2 @@', '-a', '', '+b'];
    const html = renderHunksReadonly(lines);
    expect(html).toContain('-a');
    expect(html).toContain('+b');
  });
});

// ============================================================================
// buildDiffFragment - additional branches
// ============================================================================
describe('buildDiffFragment additional branches', () => {
  it('handles flushSegment with context between change groups', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = [
      '@@ -1,5 +1,5 @@',
      ' context1',
      '-old1',
      '+new1',
      ' context2',
      '-old2',
      '+new2',
      ' context3',
    ];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);

    const hunks = div.querySelectorAll('.hunk');
    expect(hunks.length).toBe(2);
    expect(div.querySelectorAll('.pick-hunk').length).toBe(2);
    expect(div.querySelectorAll('.pick-line').length).toBe(4);
  });

  it('handles context lines with empty string values', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +1,2 @@', '', '-old', '+new'];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);
    expect(div.querySelector('.hunk')).toBeTruthy();
  });

  it('handles context lines with matching line numbers', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,3 +1,3 @@', ' common', '-old', '+new'];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);
    const rightNums = div.querySelectorAll('.line-number-right');
    expect(rightNums.length).toBeGreaterThanOrEqual(2);
  });

  it('handles add-only diff (no context lines between changes)', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -0,0 +1,2 @@', '+new1', '+new2'];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);
    const hunks = div.querySelectorAll('.hunk');
    expect(hunks.length).toBe(1);
    const pickLines = div.querySelectorAll('.pick-line');
    expect(pickLines.length).toBe(2);
  });
});

// ============================================================================
// allHunkIndices - meta edge cases
// ============================================================================
describe('allHunkIndices with state.currentDiffMeta', () => {
  it('returns empty when meta exists but totalHunks is 0', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentDiffMeta = { offset: 0, rest: [], starts: [], changeCounts: [], totalHunks: 0 };
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    expect(allHunkIndices([])).toEqual([]);
  });

  it('returns empty when meta exists but is null', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentDiffMeta = null as any;
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    expect(allHunkIndices([])).toEqual([]);
  });
});

// ============================================================================
// renderHunksWithSelection - additional branches
// ============================================================================
describe('renderHunksWithSelection context and change dispatch', () => {
  it('handles context lines between multiple change groups with flush segment', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const lines = [
      '@@ -1,5 +1,5 @@',
      ' header',
      '-old1',
      '+new1',
      ' middle',
      '-old2',
      '+new2',
      ' footer',
    ];
    const html = renderHunksWithSelection(lines);
    expect(html).toContain('pick-hunk');
    expect(html).toContain('pick-line');
    expect(html).toContain('header');
    expect(html).toContain('middle');
    expect(html).toContain('footer');
    expect(html).toContain('-old1');
    expect(html).toContain('+new2');
  });

  it('handles empty string line values', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +1,2 @@', '', '-old', '+new'];
    const html = renderHunksWithSelection(lines);
    expect(html).toContain('pick-hunk');
    expect(html).toContain('-old');
    expect(html).toContain('+new');
  });

  it('renders spacing for add-only lines in gutter', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -0,0 +1,2 @@', '+new1', '+new2'];
    const html = renderHunksWithSelection(lines);
    expect(html).toContain('line-number-left');
    expect(html).toContain('line-number-right');
  });
});

// ============================================================================
// buildDiffMeta - single hunk and edge cases
// ============================================================================
describe('buildDiffMeta edge cases', () => {
  it('handles single hunk with no changes', async () => {
    const { buildDiffMeta } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,1 +1,1 @@', ' unchanged'];
    const meta = buildDiffMeta(lines);
    expect(meta.totalHunks).toBe(1);
    expect(meta.changeCounts[0]).toBe(0);
  });

  it('handles hunk header with no content after it', async () => {
    const { buildDiffMeta } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +1,2 @@'];
    const meta = buildDiffMeta(lines);
    expect(meta.totalHunks).toBe(1);
    expect(meta.changeCounts[0]).toBe(0);
  });
});

// ============================================================================
// renderHunksWithSelection — add-only: leftNumber empty span (line 198 false)
// ============================================================================
describe('renderHunksWithSelection add-only leftNumber', () => {
  it('renders empty leftNumber span for add-only lines', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -0,0 +1,2 @@', '+new1', '+new2'];
    const html = renderHunksWithSelection(lines);
    // For add-only lines, leftNumber should be an empty span
    // The leftNumber span is: <span class="line-number line-number-left"></span>
    expect(html).toContain('<span class="line-number line-number-left"></span>');
    expect(html).toContain('+new1');
    expect(html).toContain('+new2');
    expect(html).toContain('line-number-right');
  });
});

// ============================================================================
// renderHunksWithSelection — delete-only: rightNumber empty span (line 199 false)
// ============================================================================
describe('renderHunksWithSelection delete-only rightNumber', () => {
  it('renders empty rightNumber span for delete-only lines', async () => {
    const { renderHunksWithSelection } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +0,0 @@', '-gone1', '-gone2'];
    const html = renderHunksWithSelection(lines);
    // For delete-only lines, rightNumber should be an empty span
    expect(html).toContain('<span class="line-number line-number-right"></span>');
    expect(html).toContain('-gone1');
    expect(html).toContain('-gone2');
    expect(html).toContain('line-number-left');
    expect(html).toContain('pick-hunk');
    expect(html).toContain('pick-line');
  });
});

// ============================================================================
// buildDiffFragment — add-only: leftNumber stays empty (first === '+')
// ============================================================================
describe('buildDiffFragment add-only leftNumber', () => {
  it('does not set leftNumber textContent on add-only lines', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -0,0 +1,2 @@', '+new1', '+new2'];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);

    const leftNums = div.querySelectorAll('.line-number-left');
    // Add-only lines produce empty left-number spans (except @@ header)
    const emptyLeftNums = Array.from(leftNums).filter((s) => !s.textContent);
    expect(emptyLeftNums.length).toBeGreaterThan(0);
    const rightNums = div.querySelectorAll('.line-number-right');
    expect(rightNums.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// buildDiffFragment — delete-only: rightNumber stays empty (first === '-')
// ============================================================================
describe('buildDiffFragment delete-only rightNumber', () => {
  it('does not set rightNumber textContent on delete-only lines', async () => {
    const { buildDiffFragment } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,2 +0,0 @@', '-gone1', '-gone2'];
    const frag = buildDiffFragment(lines);
    const div = document.createElement('div');
    div.appendChild(frag);

    const rightNums = div.querySelectorAll('.line-number-right');
    // Delete-only lines produce empty right-number spans, but the @@ header
    // line produces a right-number with text. Verify at least one is empty.
    const emptyRightNums = Array.from(rightNums).filter((s) => !s.textContent);
    expect(emptyRightNums.length).toBeGreaterThan(0);
    const leftNums = div.querySelectorAll('.line-number-left');
    expect(leftNums.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// allHunkIndices — prefers state.currentDiffMeta totalHunks over lines scan
// ============================================================================
describe('allHunkIndices prefers currentDiffMeta', () => {
  it('returns indices from meta when totalHunks > 0, ignoring lines content', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentDiffMeta = { offset: 0, rest: [], starts: [0, 2], changeCounts: [1, 1], totalHunks: 2 };
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    const indices = allHunkIndices(['@@ -1 +1 @@']);
    // Should use meta.totalHunks=2, not scan lines (which has only 1 hunk)
    expect(indices).toEqual([0, 1]);
  });

  it('falls back to scanning lines when meta is null', async () => {
    const { state } = await import('@scripts/state/state');
    state.currentDiffMeta = null as any;
    const { allHunkIndices } = await import('@scripts/features/repo/diffFragment');
    const indices = allHunkIndices(['@@ -1 +1 @@', '-a', '+b', '@@ -5 +5 @@', '-c', '+d']);
    expect(indices).toEqual([0, 1]);
  });
});

// ============================================================================
// buildDiffMeta — multiple hunks with mixed change counts
// ============================================================================
describe('buildDiffMeta mixed hunks', () => {
  it('computes correct change counts for each hunk', async () => {
    const { buildDiffMeta } = await import('@scripts/features/repo/diffFragment');
    const lines = [
      '@@ -1,3 +1,4 @@',
      ' context',
      '-removed',
      '+added',
      ' context',
      '@@ -10,2 +11,3 @@',
      '+insert',
      '-gone',
      ' more',
    ];
    const meta = buildDiffMeta(lines);
    expect(meta.totalHunks).toBe(2);
    expect(meta.changeCounts[0]).toBe(2); // -removed, +added
    expect(meta.changeCounts[1]).toBe(2); // +insert, -gone
    expect(meta.offset).toBe(0);
  });

  it('handles hunk with context and no changes (changeCount = 0)', async () => {
    const { buildDiffMeta } = await import('@scripts/features/repo/diffFragment');
    const lines = ['@@ -1,1 +1,1 @@', ' unchanged'];
    const meta = buildDiffMeta(lines);
    expect(meta.totalHunks).toBe(1);
    expect(meta.changeCounts[0]).toBe(0);
  });
});
