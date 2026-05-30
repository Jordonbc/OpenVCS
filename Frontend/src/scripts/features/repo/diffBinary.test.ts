// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Mounts DOM nodes referenced by diffBinary helpers. */
function mountDiffDom() {
  document.body.innerHTML = `
    <ul id="file-list"></ul>
    <div id="diff-path"></div>
    <div class="diff-scroll"><div id="diff"></div></div>
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

describe('scrollDiffToTop', () => {
  it('resets scroll position of viewport', async () => {
    const { scrollDiffToTop } = await import('./diffBinary');
    // diffEl uses closest('.diff-scroll'), so .diff-scroll must be an ancestor
    const scrollHost = document.querySelector('.diff-scroll') as HTMLElement;
    scrollHost.scrollTop = 50;
    scrollHost.scrollLeft = 30;
    scrollDiffToTop();
    expect(scrollHost.scrollTop).toBe(0);
    expect(scrollHost.scrollLeft).toBe(0);
  });

  it('handles missing diff element gracefully', async () => {
    document.body.innerHTML = '';
    const { scrollDiffToTop } = await import('./diffBinary');
    expect(() => scrollDiffToTop()).not.toThrow();
  });
});

describe('detectBinaryDiff', () => {
  it('returns true for non-array input', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    expect(detectBinaryDiff(null as any)).toBe(true);
    // undefined uses default parameter value ([]), so returns false
    expect(detectBinaryDiff('foo' as any)).toBe(true);
  });

  it('returns false for empty array', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    expect(detectBinaryDiff([])).toBe(false);
  });

  it('returns false when diff has hunks', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    const lines = ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
    expect(detectBinaryDiff(lines)).toBe(false);
  });

  it('returns true for Binary Files indicator', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    const lines = ['Binary files a/img.png and b/img.png differ'];
    expect(detectBinaryDiff(lines)).toBe(true);
  });

  it('returns true for GIT binary patch indicator', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    const lines = ['GIT binary patch', 'literal 123'];
    expect(detectBinaryDiff(lines)).toBe(true);
  });

  it('returns true for literal marker', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    const lines = ['literal 456'];
    expect(detectBinaryDiff(lines)).toBe(true);
  });

  it('returns false for regular textual diff', async () => {
    const { detectBinaryDiff } = await import('./diffBinary');
    const lines = ['diff --git a/a.txt b/a.txt', 'index abc..def', '--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,4 @@', ' unchanged', '-removed', '+added'];
    expect(detectBinaryDiff(lines)).toBe(false);
  });
});

describe('renderBinaryDiffPlaceholder', () => {
  it('renders placeholder with path', async () => {
    const { renderBinaryDiffPlaceholder } = await import('./diffBinary');
    const html = renderBinaryDiffPlaceholder('image.png');
    expect(html).toContain('image.png');
    expect(html).toContain('Diff not supported on this file type');
    expect(html).toContain('binary-placeholder');
  });

  it('renders placeholder without path', async () => {
    const { renderBinaryDiffPlaceholder } = await import('./diffBinary');
    const html = renderBinaryDiffPlaceholder();
    expect(html).not.toContain('(undefined)');
    expect(html).toContain('Diff not supported on this file type');
  });
});

describe('buildUntrackedTextPatch', () => {
  it('builds a synthetic unified diff for untracked file', async () => {
    const { buildUntrackedTextPatch } = await import('./diffBinary');
    const lines = buildUntrackedTextPatch('newfile.txt', 'line1\nline2\nline3\n');
    expect(lines[0]).toBe('diff --git a/newfile.txt b/newfile.txt');
    expect(lines[1]).toBe('new file mode 100644');
    expect(lines[2]).toBe('--- /dev/null');
    expect(lines[3]).toBe('+++ b/newfile.txt');
    expect(lines[4]).toBe('@@ -0,0 +1,3 @@');
    expect(lines[5]).toBe('+line1');
    expect(lines[6]).toBe('+line2');
    expect(lines[7]).toBe('+line3');
  });

  it('handles empty text', async () => {
    const { buildUntrackedTextPatch } = await import('./diffBinary');
    const lines = buildUntrackedTextPatch('empty.txt', '');
    expect(lines[4]).toBe('@@ -0,0 +1,0 @@');
    expect(lines).toHaveLength(5);
  });

  it('normalizes CRLF to LF', async () => {
    const { buildUntrackedTextPatch } = await import('./diffBinary');
    const lines = buildUntrackedTextPatch('crlf.txt', 'a\r\nb\r\n');
    expect(lines).toHaveLength(7); // header(4) + hunk header(1) + +a + +b = 7
    expect(lines[5]).toBe('+a');
    expect(lines[6]).toBe('+b');
  });
});

describe('isUntrackedStatus', () => {
  it('returns true when status contains question mark', async () => {
    const { isUntrackedStatus } = await import('./diffBinary');
    expect(isUntrackedStatus('??')).toBe(true);
    expect(isUntrackedStatus('? ')).toBe(true);
    expect(isUntrackedStatus(' A?')).toBe(true);
  });

  it('returns false when status has no question mark', async () => {
    const { isUntrackedStatus } = await import('./diffBinary');
    expect(isUntrackedStatus('M')).toBe(false);
    expect(isUntrackedStatus('A')).toBe(false);
    expect(isUntrackedStatus('')).toBe(false);
    expect(isUntrackedStatus(null as any)).toBe(false);
    expect(isUntrackedStatus(undefined as any)).toBe(false);
  });
});
