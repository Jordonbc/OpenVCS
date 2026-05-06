// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Provides a minimal `matchMedia` test shim used by state imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

/** Mounts DOM nodes touched by diff rendering. */
function mountDiffDom() {
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
function installTauriMock() {
  (window as any).__TAURI__ = {
    core: {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'vcs_diff_file') {
          return ['diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-old', '+new'];
        }
        return [];
      }),
    },
    event: { listen: vi.fn() },
  };
}

beforeEach(() => {
  vi.resetModules();
  mountDiffDom();
  installTauriMock();
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('renderCombinedDiff', () => {
  it('renders read-only hunks without stale selection checkboxes', async () => {
    const { renderCombinedDiff } = await import('./diffView');

    await renderCombinedDiff(['a.txt']);

    expect(document.querySelector('#diff')?.innerHTML).toContain('-old');
    expect(document.querySelector('#diff .pick-hunk')).toBeNull();
    expect(document.querySelector('#diff .pick-line')).toBeNull();
  });
});
