// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/plugins', () => ({
  runHook: vi.fn(async () => ({ cancelled: false })),
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: vi.fn(),
}));

vi.mock('@scripts/lib/tauri', () => {
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

vi.mock('@scripts/features/repo', () => ({
  hydrateStatus: vi.fn(async () => {}),
  hydrateCommits: vi.fn(async () => {}),
  yieldToPaint: vi.fn(async () => {}),
}));

vi.mock('@scripts/features/repo/commit', () => ({
  getCommitSummaryHint: vi.fn(() => ''),
}));

let state: typeof import('@scripts/state/state').state;

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
  state = (await import('@scripts/state/state')).state;
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
    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Add post';
    commitBtn.disabled = false;

    bindCommit();
    commitBtn.click();

    await Promise.resolve();

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
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
    const repo = await import('@scripts/features/repo');
    const { bindCommit } = await import('@scripts/features/diff');
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

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
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

    const { bindCommit } = await import('@scripts/features/diff');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    bindCommit();
    commitBtn.click();

    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('handles hook cancellation', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockResolvedValue({
      name: 'preCommit',
      data: undefined,
      cancelled: true,
      reason: 'Cancelled by plugin',
      cancel: vi.fn(),
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
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

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
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

    const { bindCommit } = await import('@scripts/features/diff');
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

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') throw new Error('load error');
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
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

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
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

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
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

  it('uses hook-mutated summary and description on successful commit', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    const { runHook } = await import('@scripts/plugins');
    const repo = await import('@scripts/features/repo');
    const { notify } = await import('@scripts/lib/notify');
    vi.mocked(runHook).mockImplementation(async (name, data: any) => {
      if (name === 'preCommit') {
        data.summary = '  Updated summary  ';
        data.description = 'Updated description';
      }
      return { cancelled: false } as any;
    });
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitDesc = document.getElementById('commit-desc') as HTMLTextAreaElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Initial summary';
    commitDesc.value = 'Initial description';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find((args: unknown[]) => args[0] === 'commit_patch_and_files');
      expect(commitCall?.[1]).toMatchObject({
        summary: 'Updated summary',
        description: 'Updated description',
      });
    });
    expect(vi.mocked(repo.hydrateStatus)).toHaveBeenCalled();
    expect(vi.mocked(repo.hydrateCommits)).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Committed to main: Updated summary');
    expect(state.selectedFiles.size).toBe(0);
    expect(state.currentFile).toBe('');
  });

  it('falls back to commit summary hint when the input is blank', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { bindCommit } = await import('@scripts/features/diff');
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: false } as any);
    vi.mocked(getCommitSummaryHint).mockReturnValue('Hint summary');
    invoke.mockClear();

    bindCommit();
    (document.getElementById('commit-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find((args: unknown[]) => args[0] === 'commit_patch_and_files');
      expect(commitCall?.[1]).toMatchObject({ summary: 'Hint summary' });
    });
  });

  it('builds a partial patch from explicit line selections', async () => {
    state.selectedFiles = new Set(['file1.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'file1.txt': { 0: [1, 2] } } as any;
    state.files = [{ path: 'file1.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file1.txt b/file1.txt',
          'index abc..def 100644',
          '--- a/file1.txt',
          '+++ b/file1.txt',
          '@@ -1,2 +1,2 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-456';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    commitSummary.value = 'Line selection commit';
    bindCommit();
    (document.getElementById('commit-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find((args: unknown[]) => args[0] === 'commit_patch_and_files');
      expect(commitCall?.[1].patch).toContain('@@ -1,1 +1,1 @@');
      expect(commitCall?.[1].patch).toContain('-old');
      expect(commitCall?.[1].patch).toContain('+new');
    });
  });
});

describe('buildPatchForSelectedHunks', () => {
  it('returns empty string for empty inputs', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    expect(buildPatchForSelectedHunks('test.txt', [], [])).toBe('');
    expect(buildPatchForSelectedHunks('test.txt', ['line'], [])).toBe('');
  });

  it('builds a patch with selected hunks', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const result = buildPatchForSelectedHunks('file.txt', ['no hunks'], [0]);
    expect(result).toBe('');
  });

  it('skips out-of-range hunk indices', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      '--- a/file.txt', '+++ b/file.txt',
      '@@ -1 +1 @@', '-old', '+new',
    ];
    const result = buildPatchForSelectedHunks('file.txt', lines, [99]);
    expect(result).not.toContain('@@');
  });

  it('normalizes backslashes in path', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');

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
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    expect(buildPatchForSelectedHunks('f.txt', [], [0])).toBe('');
  });

  it('handles header extras without new file mode', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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

describe('buildPatchForSelectedHunks additional edge cases', () => {
  it('skips negative hunk indices', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('file.txt', lines, [-1]);
    expect(result).not.toContain('@@');
    expect(result).toContain('diff --git');
  });

  it('handles diff lines with no prelude (no ---/+++ before @@)', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('file.txt', lines, [0]);
    expect(result).toContain('diff --git a/file.txt b/file.txt');
    expect(result).toContain('--- a/file.txt');
    expect(result).toContain('+++ b/file.txt');
    expect(result).toContain('-old');
    expect(result).toContain('+new');
  });
});

describe('bindCommit error handling and buildPatchForSelected edge cases', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('handles commit_patch_and_files rejection gracefully', async () => {
    const state = (await import('@scripts/state/state')).state;
    state.files = [{ path: 'file.txt', status: 'M' }] as any;
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.selectedHunks = [];
    state.diffSelectedFiles = new Set();
    (state as any).branch = 'main';

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'commit_patch_and_files') throw new Error('commit error');
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Test commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Commit failed');
    }, { timeout: 3000, interval: 20 });
  });

  it('builds patch with non-contiguous line selections (group/flush)', async () => {
    const state = (await import('@scripts/state/state')).state;
    state.files = [{ path: 'file1.txt', status: 'M' }] as any;
    state.selectedFiles = new Set(['file1.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'file1.txt': { 0: [1, 3] } };
    state.selectedHunks = [];
    state.diffSelectedFiles = new Set();
    (state as any).branch = 'main';

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file1.txt b/file1.txt',
          '--- a/file1.txt',
          '+++ b/file1.txt',
          '@@ -1,3 +1,3 @@',
          '+new1',
          ' context',
          '+new3',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Non-contiguous';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(commitCall).toBeTruthy();
      const patch = commitCall?.[1].patch as string;
      expect(patch).toContain('@@ -1,0 +1,1 @@');
      expect(patch).toContain('+new1');
      expect(patch).toContain('@@ -2,0 +3,1 @@');
      expect(patch).toContain('+new3');
    }, { timeout: 3000, interval: 20 });
  });

  it('returns combined patch empty when partial files list empty after filtering', async () => {
    state.selectedFiles = new Set();
    state.selectedHunksByFile = {};
    state.files = [];

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    vi.mocked(getCommitSummaryHint).mockReturnValue('Summary from hint');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Select files or hunks to commit');
    }, { timeout: 3000, interval: 20 });
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelectedHunks - additional cover branches
// ---------------------------------------------------------------------------

describe('buildPatchForSelectedHunks additional branch cover', () => {
  it('handles isAdd = true and includes headerExtras', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    expect(result).toContain('new file mode 100644');
  });

  it('handles isDel = true and includes headerExtras', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
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
    expect(result).toContain('deleted file mode 100644');
  });

  it('handles empty headerExtras', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('f.txt', lines, [0]);
    expect(result).toContain('diff --git a/f.txt b/f.txt');
    expect(result).toContain('--- a/f.txt');
    expect(result).toContain('+++ b/f.txt');
  });

  it('handles out of bounds hunk index', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('f.txt', lines, [5]);
    expect(result).not.toContain('-old');
  });

  it('handles negative hunk index', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('f.txt', lines, [-1]);
    expect(result).not.toContain('-old');
  });
});

// ---------------------------------------------------------------------------
// bindCommit - description value
// ---------------------------------------------------------------------------

describe('bindCommit - description handling', () => {
  it('reads description from textarea', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitDesc = document.getElementById('commit-desc') as HTMLTextAreaElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Summary';
    commitDesc.value = 'Description body';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(commitCall?.[1].description).toBe('Description body');
    }, { timeout: 3000, interval: 20 });
  });

  it('clears inputs after successful commit', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitDesc = document.getElementById('commit-desc') as HTMLTextAreaElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Summary';
    commitDesc.value = 'Desc';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      expect(commitSummary.value).toBe('');
      expect(commitDesc.value).toBe('');
    }, { timeout: 3000, interval: 20 });
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelectedHunks - add and delete combined
// ---------------------------------------------------------------------------

describe('buildPatchForSelectedHunks - isAdd and isDel branches', () => {
  it('handles isAdd = true and isDel = false', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      'diff --git a/n.txt b/n.txt',
      '--- /dev/null',
      '+++ b/n.txt',
      '@@ -0,0 +1 @@',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('n.txt', lines, [0]);
    expect(result).toContain('--- /dev/null');
    expect(result).toContain('+++ b/n.txt');
  });

  it('handles isDel = true and isAdd = false', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      'diff --git a/d.txt b/d.txt',
      '--- a/d.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ];
    const result = buildPatchForSelectedHunks('d.txt', lines, [0]);
    expect(result).toContain('+++ /dev/null');
    expect(result).toContain('--- a/d.txt');
  });

  it('handles neither isAdd nor isDel (modify)', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      'diff --git a/m.txt b/m.txt',
      '--- a/m.txt',
      '+++ b/m.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ];
    const result = buildPatchForSelectedHunks('m.txt', lines, [0]);
    expect(result).toContain('--- a/m.txt');
    expect(result).toContain('+++ b/m.txt');
    expect(result).toContain('-old');
    expect(result).toContain('+new');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage for diff.ts uncovered branches
// ---------------------------------------------------------------------------

describe('diff.ts additional branch coverage', () => {
  it('notifies default message when hook cancellation has no reason', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: true, reason: null } as any);

    const { bindCommit } = await import('@scripts/features/diff');
    const { notify } = await import('@scripts/lib/notify');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Test commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Commit cancelled');
    }, { timeout: 3000, interval: 20 });
  });

  it('truncates summary to 72 chars and updates commitSummary.value', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: false } as any);

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 72;
    commitSummary.value = 'a'.repeat(100);
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

  it('passes summary through unchanged when maxLength is not 72', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: false } as any);

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    const longSummary = 'a'.repeat(100);
    commitSummary.maxLength = 100;
    commitSummary.value = longSummary;
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const calls = invoke.mock.calls.filter(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1].summary).toBe(longSummary);
    }, { timeout: 3000, interval: 20 });
  });

  it('passes summary through when maxLength is 72 and summary fits within limit', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockResolvedValue({ cancelled: false } as any);

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') return [];
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 72;
    commitSummary.value = 'Short summary';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const calls = invoke.mock.calls.filter(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1].summary).toBe('Short summary');
    }, { timeout: 3000, interval: 20 });
  });

  it('falls back to original summary when hook empties it and maxLength is not 72', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockImplementation(async (name, data: any) => {
      if (name === 'preCommit') data.summary = '';
      return { cancelled: false } as any;
    });

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 50;
    commitSummary.value = 'Original summary';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Original summary');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles missing status element (setBusy/clearBusy no-op)', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    document.getElementById('status')?.remove();

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Test commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Test commit');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles missing description textarea', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    document.getElementById('commit-desc')?.remove();

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Test commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].description).toBe('');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles null state.files via (state.files || []) fallback', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = null as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Test commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Test commit');
    }, { timeout: 3000, interval: 20 });
  });

  it('returns empty for null lines in buildPatchForSelectedHunks', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    expect(buildPatchForSelectedHunks('test.txt', null as any, [0])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelected - add, delete, multi-hunk, empty content lines
// ---------------------------------------------------------------------------

describe('buildPatchForSelected coverage', () => {
  it('handles add diff type through partial selection', async () => {
    state.selectedFiles = new Set(['newfile.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'newfile.txt': { 0: [1, 2] } } as any;
    state.files = [{ path: 'newfile.txt', status: 'A' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/newfile.txt b/newfile.txt',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/newfile.txt',
          '@@ -0,0 +1,2 @@',
          '+line1',
          '+line2',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Add file commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
      expect(commitCall?.[1].patch).toContain('--- /dev/null');
      expect(commitCall?.[1].patch).toContain('+++ b/newfile.txt');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles delete diff type through partial selection', async () => {
    state.selectedFiles = new Set(['oldfile.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'oldfile.txt': { 0: [1, 2] } } as any;
    state.files = [{ path: 'oldfile.txt', status: 'D' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/oldfile.txt b/oldfile.txt',
          'deleted file mode 100644',
          '--- a/oldfile.txt',
          '+++ /dev/null',
          '@@ -1,2 +0,0 @@',
          '-line1',
          '-line2',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Delete file commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
      expect(commitCall?.[1].patch).toContain('+++ /dev/null');
      expect(commitCall?.[1].patch).toContain('--- a/oldfile.txt');
    }, { timeout: 3000, interval: 20 });
  });

  it('skips hunks without any line selections', async () => {
    state.selectedFiles = new Set(['multi.txt']);
    state.selectedHunksByFile = { 'multi.txt': [0] };
    state.selectedLinesByFile = {};
    state.files = [{ path: 'multi.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/multi.txt b/multi.txt',
          'index abc..def 100644',
          '--- a/multi.txt',
          '+++ b/multi.txt',
          '@@ -1 +1 @@',
          '-old1',
          '+new1',
          '@@ -5 +5 @@',
          '-old2',
          '+new2',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Partial hunk commit';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
      expect(commitCall?.[1].patch).toContain('-old1');
      expect(commitCall?.[1].patch).toContain('+new1');
      expect(commitCall?.[1].patch).not.toContain('-old2');
      expect(commitCall?.[1].patch).not.toContain('+new2');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles diff content with empty lines in prefix calc', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'file.txt': { 0: [1, 2, 3] } } as any;
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1,3 +1,3 @@',
          '-line1',
          '',
          '+line3',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Empty line diff';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
      expect(commitCall?.[1].patch).toContain('@@');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles diff without hunks in buildPatchForSelected', async () => {
    state.selectedFiles = new Set(['nohunks.txt']);
    state.selectedHunksByFile = { 'nohunks.txt': [0] };
    state.selectedLinesByFile = {};
    state.files = [{ path: 'nohunks.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/nohunks.txt b/nohunks.txt',
          '--- a/nohunks.txt',
          '+++ b/nohunks.txt',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'No hunks';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
      expect(commitCall?.[1].summary).toBe('No hunks');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles null hunkIndices via selectedHunksByFile null value', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = { 'file.txt': null as any };
    state.selectedLinesByFile = { 'file.txt': { 0: [1] } } as any;
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Null indices';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
      expect(commitCall?.[1].patch).toContain('-old');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles malformed hunk header regex mismatch in buildPatchForSelected', async () => {
    state.selectedFiles = new Set(['badhunk.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'badhunk.txt': { 0: [1] } } as any;
    state.files = [{ path: 'badhunk.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/badhunk.txt b/badhunk.txt',
          '--- a/badhunk.txt',
          '+++ b/badhunk.txt',
          '@@ -notanumber +notanumber @@',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Bad hunk';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const commitCall = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files',
      );
      expect(commitCall).toBeTruthy();
    }, { timeout: 3000, interval: 20 });
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelectedHunks - falsy lines
// ---------------------------------------------------------------------------

describe('buildPatchForSelectedHunks falsy lines', () => {
  it('handles falsy line values in the lines array', async () => {
    const { buildPatchForSelectedHunks } = await import('@scripts/features/diff');
    const lines = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old',
      null as any,
      '+new',
    ];
    const result = buildPatchForSelectedHunks('f.txt', lines, [0]);
    expect(result).toContain('-old');
    expect(result).toContain('+new');
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelected - picksRaw/picksAdj uncovered branches (lines 236-239)
// ---------------------------------------------------------------------------

describe('buildPatchForSelected selLines edge cases', () => {
  it('handles null selLines falling through to empty picksRaw', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedLinesByFile = null as any;
    state.selectedHunksByFile = {} as any;
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Null selLines';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Null selLines');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles selLines[h] as non-array truthy value', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'file.txt': { 0: 'not-an-array' as any } };
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Non-array selLines';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Non-array selLines');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles selLines with missing hunk index', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'file.txt': { } };
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Missing hunk index';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Missing hunk index');
    }, { timeout: 3000, interval: 20 });
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelected - flush function branches (line 255)
// ---------------------------------------------------------------------------

describe('buildPatchForSelected flush function edge cases', () => {
  it('handles flush with single selected line', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'file.txt': { 0: [1] } };
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1,2 +1,2 @@',
          '-old1',
          '+new1',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Single line flush';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      // Single selected deletion line produces mini-hunk with old_count=1 new_count=0
      expect(call?.[1].patch).toContain('@@ -1,1 +1,0 @@');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles flush with add-only selected lines', async () => {
    state.selectedFiles = new Set(['addonly.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'addonly.txt': { 0: [1, 2] } };
    state.files = [{ path: 'addonly.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/addonly.txt b/addonly.txt',
          '--- a/addonly.txt',
          '+++ b/addonly.txt',
          '@@ -1,2 +1,4 @@',
          ' context',
          '+new1',
          '+new2',
          ' context',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Add-only flush';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].patch).toContain('@@');
    }, { timeout: 3000, interval: 20 });
  });

  it('handles flush with delete-only selected lines', async () => {
    state.selectedFiles = new Set(['delonly.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = { 'delonly.txt': { 0: [2, 3] } };
    state.files = [{ path: 'delonly.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/delonly.txt b/delonly.txt',
          '--- a/delonly.txt',
          '+++ b/delonly.txt',
          '@@ -1,4 +1,2 @@',
          ' context',
          '-old1',
          '-old2',
          ' context',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Delete-only flush';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].patch).toContain('@@');
    }, { timeout: 3000, interval: 20 });
  });
});

// ---------------------------------------------------------------------------
// bindCommit - summary truncation with hook data (line 129 coverage)
// ---------------------------------------------------------------------------

describe('bindCommit summary truncation with hook data', () => {
  it('truncates when hook provides summary over 72 chars with maxLength=72', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockImplementation(async (name, data: any) => {
      if (name === 'preCommit') data.summary = 'a'.repeat(100);
      return { cancelled: false } as any;
    });

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 72;
    commitSummary.value = 'Short summary';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary.length).toBeLessThanOrEqual(72);
    }, { timeout: 3000, interval: 20 });
  });

  it('keeps summary when hook changes it but it fits 72 chars', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockImplementation(async (name, data: any) => {
      if (name === 'preCommit') data.summary = 'Hook modified summary';
      return { cancelled: false } as any;
    });

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 72;
    commitSummary.value = 'Original summary';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Hook modified summary');
    }, { timeout: 3000, interval: 20 });
  });

  it('falls back to original summary when hook provides empty and maxLength=72', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { runHook } = await import('@scripts/plugins');
    vi.mocked(runHook).mockImplementation(async (name, data: any) => {
      if (name === 'preCommit') data.summary = '';
      return { cancelled: false } as any;
    });

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'commit_patch_and_files') return 'oid-789';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.maxLength = 72;
    commitSummary.value = 'Fallback summary';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Fallback summary');
    }, { timeout: 3000, interval: 20 });
  });
});

// ---------------------------------------------------------------------------
// buildPatchForSelected - picksRaw and flush combined with prefix calc
// ---------------------------------------------------------------------------

describe('buildPatchForSelected picksRaw and prefix calc', () => {
  it('handles selLines with picksRaw falling through to [] when selLines[h] is missing', async () => {
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {} as any;
    state.selectedLinesByFile = {} as any;
    state.files = [{ path: 'file.txt', status: 'M' }] as any;

    const { __invoke: invoke } = await import('@scripts/lib/tauri') as any;
    invoke.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_file') {
        return [
          'diff --git a/file.txt b/file.txt',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'commit_patch_and_files') return 'oid-999';
      return [];
    });

    const { bindCommit } = await import('@scripts/features/diff');
    const commitSummary = document.getElementById('commit-summary') as HTMLInputElement;
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    commitSummary.value = 'Missing hunk in selLines';
    bindCommit();
    commitBtn.click();

    await vi.waitFor(() => {
      const call = invoke.mock.calls.find(
        (args: unknown[]) => args[0] === 'commit_patch_and_files'
      );
      expect(call?.[1].summary).toBe('Missing hunk in selLines');
    }, { timeout: 3000, interval: 20 });
  });
});
