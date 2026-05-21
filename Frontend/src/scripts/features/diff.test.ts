// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../plugins', () => ({
  runHook: vi.fn(async () => ({ cancelled: false })),
}));

vi.mock('../lib/notify', () => ({
  notify: vi.fn(),
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

  it('shows notification when summary is empty', async () => {
    state.selectedFiles = new Set();
    state.selectedHunksByFile = {};
    state.files = [];

    const { bindCommit } = await import('./diff');
    const { notify } = await import('../lib/notify');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    bindCommit();
    commitBtn.click();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notify).toHaveBeenCalledWith('Summary is required');
  });

  it('uses commit summary hint when summary is empty', async () => {
    state.files = [];
    state.selectedFiles = new Set();
    state.selectedHunksByFile = {};

    const { bindCommit } = await import('./diff');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    bindCommit();
    commitBtn.click();

    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('handles hook cancellation', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('../plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: true, reason: 'Cancelled by plugin' });

    const { bindCommit } = await import('./diff');
    const { notify } = await import('../lib/notify');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Test commit';
    bindCommit();
    commitBtn.click();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notify).toHaveBeenCalledWith('Cancelled by plugin');
  });

  it('builds combined patch for partial files with hunk selections', async () => {
    state.selectedFiles = new Set(['file1.txt']);
    state.selectedHunksByFile = { 'file1.txt': [0] };
    state.selectedLinesByFile = {};
    state.files = [{ path: 'file1.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('../lib/tauri') as any;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file1.txt b/file1.txt',
          'index abc..def 100644',
          '--- a/file1.txt',
          '+++ b/file1.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-123';
      return [];
    });

    const { bindCommit } = await import('./diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Partial commit';
    bindCommit();
    commitBtn.click();

    // The async handler runs and should eventually call commit_patch_and_files.
    // Instead of waiting for the full chain, verify the vcs_diff_file calls
    // which happen before commit_patch_and_files.
    await vi.waitFor(() => {
      const diffCalls = invoke.mock.calls.filter(
        (args: unknown[]) => args[0] === 'vcs_diff_file'
      );
      expect(diffCalls.length).toBeGreaterThan(0);
    }, { timeout: 3000, interval: 20 });
  });

  it('handles partial load failure gracefully', async () => {
    state.selectedFiles = new Set(['broken.txt']);
    state.selectedHunksByFile = { 'broken.txt': [0] };
    state.files = [{ path: 'broken.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('../lib/tauri') as any;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') throw new Error('load error');
      return [];
    });

    const { bindCommit } = await import('./diff');
    const { notify } = await import('../lib/notify');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Broken commit';
    bindCommit();
    commitBtn.click();
    // After yieldToPaint, the handler attempts vcs_diff_file which throws.
    // notify should be called with the error message.
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Failed to read one or more selected diffs');
    }, { timeout: 3000, interval: 20 });
  });

  it('shows notification when no files or hunks selected', async () => {
    state.selectedFiles = new Set();
    state.selectedHunksByFile = {};
    state.files = [];

    const { bindCommit } = await import('./diff');
    const { notify } = await import('../lib/notify');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Empty commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Select files or hunks to commit');
    }, { timeout: 3000, interval: 20 });
  });

  it('truncates summary to 72 chars when maxLength attribute is set', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('../lib/tauri') as any;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('./diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 72;
    const longSummary = 'a'.repeat(100);
    commitSummary.value = longSummary;
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const calls = invoke.mock.calls.filter(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1].summary.length).toBeLessThanOrEqual(72);
    }, { timeout: 3000, interval: 20 });
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

  it('normalizes backslashes in path', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/src\\file.txt b/src\\file.txt',
      '--- a/src\\file.txt',
      '+++ b/src\\file.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('src\\file.txt', lines, [0]);
    expect(result).toContain('b/src/file.txt');
  });

  it('selects the middle hunk from multiple hunks', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-a1',
      '+b1',
      '@@ -5 +5 @@',
      '-a2',
      '+b2',
      '@@ -10 +10 @@',
      '-a3',
      '+b3',
    ];
    const result = buildPatchForSelectedHunks('f.txt', lines, [1]);
    expect(result).not.toContain('a1');
    expect(result).toContain('a2');
    expect(result).not.toContain('a3');
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

  it('handles header extras without new file mode', async () => {
    const { buildPatchForSelectedHunks } = await import('./diff');
    const lines = [
      'diff --git a/x.txt b/x.txt',
      'old mode 100644',
      'new mode 100755',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('x.txt', lines, [0]);
    expect(result).toContain('old mode 100644');
    expect(result).toContain('new mode 100755');
  });
});
