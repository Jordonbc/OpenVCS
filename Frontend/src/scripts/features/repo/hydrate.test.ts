// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes required by repository hydration rendering. */
function mountRepoDom() {
  document.body.innerHTML = `
    <input id="filter" />
    <input id="select-all" type="checkbox" />
    <ul id="file-list"></ul>
    <span id="changes-count"></span>
    <div id="left-foot"></div>
    <div id="diff-path"></div>
    <div id="diff"></div>
    <button id="commit-btn"></button>
    <input id="commit-summary" />
  `;
}

/** Installs a mocked Tauri runtime before modules capture it at import time. */
function installTauriMock(invoke: (cmd: string) => Promise<unknown>) {
  (window as any).__TAURI__ = {
    core: { invoke },
    event: { listen: vi.fn() },
  };
}

beforeEach(() => {
  vi.resetModules();
  mountRepoDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('hydrateStatus selection reconciliation', () => {
  it('prunes stale per-file selection maps when status changes', async () => {
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') return { files: [{ path: 'keep.txt', status: 'M' }] };
      if (cmd === 'vcs_merge_context') return { in_progress: false };
      if (cmd === 'vcs_diff_file') return ['diff --git a/keep.txt b/keep.txt', '@@ -1 +1 @@', '-old', '+new'];
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.defaultSelectAll = false;
    state.selectedFiles = new Set(['keep.txt', 'gone.txt']);
    state.selectedHunksByFile = { 'keep.txt': [0], 'gone.txt': [1] };
    state.selectedLinesByFile = { 'keep.txt': { 0: [1, 2] }, 'gone.txt': { 0: [2] } };
    state.diffSelectedFiles = new Set(['keep.txt', 'gone.txt']);

    await hydrateStatus();

    expect(Array.from(state.selectedFiles)).toEqual(['keep.txt']);
    expect(state.selectedHunksByFile).toEqual({ 'keep.txt': [0] });
    expect(state.selectedLinesByFile).toEqual({ 'keep.txt': { 0: [1, 2] } });
    expect(Array.from(state.diffSelectedFiles)).toEqual(['keep.txt']);
  });

  it('clears all selection maps when status hydration fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installTauriMock(async (cmd) => {
      if (cmd === 'vcs_status') throw new Error('boom');
      return [];
    });

    const { hydrateStatus } = await import('./hydrate');
    const { state } = await import('../../state/state');
    state.selectedFiles = new Set(['gone.txt']);
    state.selectedHunks = [0];
    state.selectedHunksByFile = { 'gone.txt': [0] };
    state.selectedLinesByFile = { 'gone.txt': { 0: [1] } };
    state.diffSelectedFiles = new Set(['gone.txt']);

    await hydrateStatus();

    expect(state.selectedFiles.size).toBe(0);
    expect(state.selectedHunks).toEqual([]);
    expect(state.selectedHunksByFile).toEqual({});
    expect(state.selectedLinesByFile).toEqual({});
    expect(state.diffSelectedFiles.size).toBe(0);
  });
});
