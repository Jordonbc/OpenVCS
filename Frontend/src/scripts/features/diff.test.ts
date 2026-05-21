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
  yieldToPaint: vi.fn(async () => {}),
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

  it('yields to paint before committing', async () => {
    const repo = await import('./repo');
    const { bindCommit } = await import('./diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Add post';
    commitBtn.disabled = false;

    bindCommit();
    commitBtn.click();

    await Promise.resolve();
    expect(vi.mocked(repo.yieldToPaint)).toHaveBeenCalled();
  });
});

describe('buildPatchForSelectedHunks', () => {
  it('returns empty string for empty inputs', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    expect(buildPatchForSelectedHunks('test.txt', [], [])).toBe('');
    expect(buildPatchForSelectedHunks('test.txt', ['line'], [])).toBe('');
  });

  it('builds a patch with selected hunks', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/file.txt b/file.txt',
      'index abc..def 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '@@ -5 +5 @@',
      '-old2',
      '+new2',
    ];
    const result = buildPatchForSelectedHunks('file.txt', lines, [0]);
    expect(result).toContain('diff --git a/file.txt b/file.txt');
    expect(result).toContain('@@ -1 +1 @@');
    expect(result).not.toContain('@@ -5 +5 @@');
  });

  it('includes index/metadata from prelude', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/file.txt b/file.txt',
      'index abc..def 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('file.txt', lines, [0]);
    expect(result).toContain('index abc..def 100644');
  });

  it('handles add (new file) patches', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+content',
    ];
    const result = buildPatchForSelectedHunks('new.txt', lines, [0]);
    expect(result).toContain('--- /dev/null');
    expect(result).toContain('+++ b/new.txt');
  });

  it('handles delete patches', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/del.txt b/del.txt',
      'deleted file mode 100644',
      '--- a/del.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-removed',
    ];
    const result = buildPatchForSelectedHunks('del.txt', lines, [0]);
    expect(result).toContain('+++ /dev/null');
    expect(result).toContain('--- a/del.txt');
  });

  it('returns empty when no hunk starts found', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const result = buildPatchForSelectedHunks('file.txt', ['no hunks'], [0]);
    expect(result).toBe('');
  });

  it('skips out-of-range hunk indices', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      '--- a/file.txt', '+++ b/file.txt',
      '@@ -1 +1 @@', '-old', '+new',
    ];
    const result = buildPatchForSelectedHunks('file.txt', lines, [99]);
    expect(result).not.toContain('@@');
  });
});

describe('buildPatchForSelectedHunks privates', () => {
  it('builds patches via the buildPatchForSelectedHunks exported function (adds, deletes, metadata)', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');

    // Add scenario
    const addLines = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+content',
    ];
    const addResult = buildPatchForSelectedHunks('new.txt', addLines, [0]);
    expect(addResult).toContain('--- /dev/null');
    expect(addResult).toContain('+++ b/new.txt');

    // Delete scenario
    const delLines = [
      'diff --git a/del.txt b/del.txt',
      'deleted file mode 100644',
      '--- a/del.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-removed',
    ];
    const delResult = buildPatchForSelectedHunks('del.txt', delLines, [0]);
    expect(delResult).toContain('+++ /dev/null');

    // Multiple hunks, select second only
    const multiLines = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old1',
      '+new1',
      '@@ -5 +5 @@',
      '-old2',
      '+new2',
    ];
    const multiResult = buildPatchForSelectedHunks('f.txt', multiLines, [1]);
    expect(multiResult).not.toContain('old1');
    expect(multiResult).toContain('old2');
  });

  it('returns empty for empty lines array', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    expect(buildPatchForSelectedHunks('f.txt', [], [0])).toBe('');
  });
});
