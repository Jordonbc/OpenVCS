// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../plugins', () => ({
  runHook: vi.fn(async () => ({ cancelled: false })),
}));

vi.mock('../lib/tauri', () => {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'commit_patch_and_files') return 'oid-123';
    return [];
  });
  return {
    TAURI: {
      invoke,
      listen: vi.fn(),
    },
    isTauriRuntimeAvailable: () => true,
    assertDesktopRuntime: () => {},
    __invoke: invoke,
  };
});

vi.mock('./repo', () => ({
  hydrateStatus: vi.fn(async () => {}),
  hydrateCommits: vi.fn(async () => {}),
}));

let state: typeof import('../state/state').state;

/** Mounts the minimal DOM needed for commit binding. */
function mountCommitDom() {
  document.body.innerHTML = `
    <div id="status"></div>
    <input id="commit-summary" />
    <textarea id="commit-desc"></textarea>
    <button id="commit-btn"></button>
  `;
}

beforeEach(async () => {
  vi.resetModules();
  mountCommitDom();
  state = (await import('../state/state')).state;
  state.files = [{ path: 'content/posts/2026/05/openvcs-announcement.md', status: '??' }] as any;
  state.selectedFiles = new Set(['content/posts/2026/05/openvcs-announcement.md']);
  state.selectedHunksByFile = {
    'content/posts/2026/05/openvcs-announcement.md': [0],
  } as any;
  state.selectedLinesByFile = {};
  state.selectedHunks = [];
  state.diffSelectedFiles = new Set();
  (state as any).branch = 'main';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bindCommit', () => {
  it('keeps untracked selected files in stage_paths', async () => {
    const { bindCommit } = await import('./diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Add post';
    commitBtn.disabled = false;

    bindCommit();
    commitBtn.click();

    await Promise.resolve();

    const { __invoke: invoke } = await import('../lib/tauri') as any;
    const call = (invoke as ReturnType<typeof vi.fn>).mock.calls.find((args: unknown[]) => args[0] === 'commit_patch_and_files');
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({
      summary: 'Add post',
      patch: '',
      files: ['content/posts/2026/05/openvcs-announcement.md'],
      stagePaths: ['content/posts/2026/05/openvcs-announcement.md'],
    });
  });
});
