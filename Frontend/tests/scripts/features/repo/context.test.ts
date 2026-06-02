// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes required by context module imports. */
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

beforeEach(() => {
  vi.resetModules();
  mountRepoDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('context exports', () => {
  it('exports expected DOM references', async () => {
    const ctx = await import('@scripts/features/repo/context');
    expect(ctx.filterInput).toBeInstanceOf(HTMLInputElement);
    expect(ctx.filterInput?.id).toBe('filter');
    expect(ctx.selectAllBox).toBeInstanceOf(HTMLInputElement);
    expect(ctx.selectAllBox?.id).toBe('select-all');
    expect(ctx.listEl).toBeInstanceOf(HTMLElement);
    expect(ctx.listEl?.id).toBe('file-list');
    expect(ctx.countEl).toBeInstanceOf(HTMLElement);
    expect(ctx.countEl?.id).toBe('changes-count');
    expect(ctx.leftFootEl).toBeInstanceOf(HTMLElement);
    expect(ctx.leftFootEl?.id).toBe('left-foot');
    expect(ctx.undoLeftBtn).toBeNull();
    expect(ctx.diffHeadPath).toBeInstanceOf(HTMLElement);
    expect(ctx.diffHeadPath?.id).toBe('diff-path');
    expect(ctx.diffEl).toBeInstanceOf(HTMLElement);
    expect(ctx.diffEl?.id).toBe('diff');
  });

  it('exports dragState with default values', async () => {
    const ctx = await import('@scripts/features/repo/context');
    expect(ctx.dragState.lastClickedIndex).toBe(-1);
    expect(ctx.dragState.isDragSelecting).toBe(false);
    expect(ctx.dragState.dragTargetState).toBe(true);
    expect(ctx.dragState.dragVisited).toBeInstanceOf(Set);
    expect(ctx.dragState.dragVisited.size).toBe(0);
    expect(ctx.dragState.dragMoved).toBe(false);
    expect(ctx.dragState.suppressNextClick).toBe(false);
    expect(ctx.dragState.dragMode).toBeNull();
    expect(ctx.dragState.dragStartIndex).toBe(-1);
    expect(ctx.dragState.dragCurrentIndex).toBe(-1);
    expect(ctx.dragState.dragPreDiff).toBeInstanceOf(Set);
    expect(ctx.dragState.dragPrePicked).toBeInstanceOf(Set);
  });
});

describe('context event listeners', () => {
  it('prevents selectstart when drag selecting', async () => {
    const ctx = await import('@scripts/features/repo/context');
    ctx.dragState.isDragSelecting = true;
    const ev = new Event('selectstart', { cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('prevents dragstart when drag selecting', async () => {
    const ctx = await import('@scripts/features/repo/context');
    ctx.dragState.isDragSelecting = true;
    const ev = new Event('dragstart', { cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('handles selectstart when not drag selecting without error', async () => {
    const ctx = await import('@scripts/features/repo/context');
    ctx.dragState.isDragSelecting = false;
    const ev = new Event('selectstart', { cancelable: true });
    expect(() => document.dispatchEvent(ev)).not.toThrow();
  });

  it('handles dragstart when not drag selecting without error', async () => {
    const ctx = await import('@scripts/features/repo/context');
    ctx.dragState.isDragSelecting = false;
    const ev = new Event('dragstart', { cancelable: true });
    expect(() => document.dispatchEvent(ev)).not.toThrow();
  });
});

describe('context null element exports', () => {
  it('exports null for elements not in the DOM', async () => {
    const ctx = await import('@scripts/features/repo/context');
    expect(ctx.diffHeadMeta).toBeNull();
    expect(ctx.diffLineEndingEl).toBeNull();
    expect(ctx.diffEncodingEl).toBeNull();
    expect(ctx.diffBomEl).toBeNull();
  });

  it('exports null for undoLeftBtn when leftFootEl has no child', async () => {
    const ctx = await import('@scripts/features/repo/context');
    expect(ctx.undoLeftBtn).toBeNull();
    expect(ctx.leftFootEl).not.toBeNull();
  });
});
