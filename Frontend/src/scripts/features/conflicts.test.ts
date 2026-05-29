// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock('../lib/tauri', () => ({ TAURI: { invoke: mockInvoke } }));
vi.mock('../lib/confirm', () => ({ confirmBool: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../ui/modals', () => ({
  hydrate: vi.fn(),
  openModal: vi.fn(),
  closeModal: vi.fn(),
}));
vi.mock('./repo', () => ({ hydrateStatus: vi.fn() }));
vi.mock('../state/state', () => ({
  isConflictStatus: vi.fn((status: unknown) => {
    const s = String(status || '').trim().toUpperCase();
    return s === 'U' || s.includes('U') || s === 'AA' || s === 'DD';
  }),
}));

function mountMergeModal() {
  const div = document.createElement('div');
  div.id = 'merge-modal';
  div.innerHTML = `
    <span id="merge-path"></span>
    <pre id="merge-base"></pre>
    <pre id="merge-ours"></pre>
    <pre id="merge-theirs"></pre>
    <textarea id="merge-result"></textarea>
    <button id="merge-apply">Apply</button>
  `;
  document.body.appendChild(div);
}

function mountConflictsSummaryModal() {
  if (!document.getElementById('merge-modal')) {
    mountMergeModal();
  }
  const summary = document.createElement('div');
  summary.id = 'conflicts-summary-modal';
  summary.innerHTML = `
    <span id="conflicts-summary-count"></span>
    <span id="conflicts-summary-subtitle"></span>
    <div id="conflicts-summary-list"></div>
    <button id="conflicts-abort">Abort</button>
    <button id="conflicts-continue">Continue</button>
  `;
  document.body.appendChild(summary);
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ensureMergeModal', () => {
  it('wires merge-apply button and saves result', async () => {
    mountMergeModal();
    const modals = await import('../ui/modals');

    const { openMergeModal } = await import('./conflicts');
    await openMergeModal(
      { path: 'conflict.txt', status: 'U' },
      { path: 'conflict.txt', ours: 'version a', theirs: 'version b' },
    );

    const textarea = document.getElementById('merge-result') as HTMLTextAreaElement;
    textarea.value = 'resolved content';

    const applyBtn = document.getElementById('merge-apply') as HTMLButtonElement;
    applyBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_save_merge_result', {
      path: 'conflict.txt',
      content: 'resolved content',
    });
    expect(modals.closeModal).toHaveBeenCalledWith('merge-modal');
  });

  it('wires only once', async () => {
    mountMergeModal();

    const { openMergeModal } = await import('./conflicts');
    await openMergeModal(
      { path: 'a.txt', status: 'U' },
      { path: 'a.txt', ours: 'a', theirs: 'b' },
    );
    await openMergeModal(
      { path: 'b.txt', status: 'U' },
      { path: 'b.txt', ours: 'c', theirs: 'd' },
    );

    const applyBtn = document.getElementById('merge-apply') as HTMLButtonElement;
    applyBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_save_merge_result', {
      path: 'b.txt',
      content: 'c',
    });
  });

  it('merge-apply shows error on failure', async () => {
    mountMergeModal();
    mockInvoke.mockRejectedValue(new Error('save failed'));
    const { notify } = await import('../lib/notify');

    const { openMergeModal } = await import('./conflicts');
    await openMergeModal(
      { path: 'f.txt', status: 'U' },
      { path: 'f.txt', ours: 'a', theirs: 'b' },
    );

    const applyBtn = document.getElementById('merge-apply') as HTMLButtonElement;
    applyBtn.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Failed to save merge result');
  });
});

describe('openMergeModal', () => {
  it('sets conflict details and opens modal', async () => {
    mountMergeModal();
    const modals = await import('../ui/modals');

    const { openMergeModal } = await import('./conflicts');
    await openMergeModal(
      { path: 'src/main.ts', status: 'U' },
      { path: 'src/main.ts', ours: 'our version', theirs: 'their version', base: 'base version' },
    );

    const pathEl = document.getElementById('merge-path') as HTMLElement;
    const baseEl = document.getElementById('merge-base') as HTMLElement;
    const oursEl = document.getElementById('merge-ours') as HTMLElement;
    const theirsEl = document.getElementById('merge-theirs') as HTMLElement;
    const textarea = document.getElementById('merge-result') as HTMLTextAreaElement;

    expect(pathEl.textContent).toBe('src/main.ts');
    expect(baseEl.textContent).toBe('base version');
    expect(oursEl.textContent).toBe('our version');
    expect(theirsEl.textContent).toBe('their version');
    expect(textarea.value).toBe('our version');
    expect(modals.openModal).toHaveBeenCalledWith('merge-modal');
  });

  it('handles missing modal gracefully', async () => {
    const { openMergeModal } = await import('./conflicts');
    await expect(
      openMergeModal(
        { path: 'f.txt', status: 'U' },
        { path: 'f.txt', ours: 'a', theirs: 'b' },
      ),
    ).resolves.toBeUndefined();
  });

  it('falls back to theirs then base when ours empty', async () => {
    mountMergeModal();

    const { openMergeModal } = await import('./conflicts');
    await openMergeModal(
      { path: 'f.txt', status: 'U' },
      { path: 'f.txt', ours: '', theirs: 'their text', base: 'base text' },
    );

    const textarea = document.getElementById('merge-result') as HTMLTextAreaElement;
    expect(textarea.value).toBe('their text');
  });

  it('handles null details gracefully', async () => {
    mountMergeModal();

    const { openMergeModal } = await import('./conflicts');
    await openMergeModal(
      { path: 'f.txt', status: 'U' },
      { path: 'f.txt', ours: null, theirs: null, base: null } as any,
    );

    const baseEl = document.getElementById('merge-base') as HTMLElement;
    const oursEl = document.getElementById('merge-ours') as HTMLElement;
    const theirsEl = document.getElementById('merge-theirs') as HTMLElement;

    expect(baseEl.textContent).toBe('');
    expect(oursEl.textContent).toBe('');
    expect(theirsEl.textContent).toBe('');
  });
});

describe('openConflictsSummary', () => {
  it('renders conflict list with correct count', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([
      { path: 'file1.txt', status: 'U' },
      { path: 'file2.txt', status: 'M' },
      { path: 'file3.txt', status: 'DD' },
    ]);

    const countEl = document.getElementById('conflicts-summary-count') as HTMLElement;
    const listEl = document.getElementById('conflicts-summary-list') as HTMLElement;

    expect(countEl.textContent).toBe('2 conflicted files');
    const rows = listEl.querySelectorAll('.row');
    expect(rows.length).toBe(2);
  });

  it('shows singular "file" for single conflict', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'only.txt', status: 'U' }]);

    const countEl = document.getElementById('conflicts-summary-count') as HTMLElement;
    expect(countEl.textContent).toBe('1 conflicted file');
  });

  it('shows abort/continue buttons when merge in progress', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: true });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const abortBtn = document.getElementById('conflicts-abort') as HTMLButtonElement;
    const contBtn = document.getElementById('conflicts-continue') as HTMLButtonElement;
    expect(abortBtn.hidden).toBe(false);
    expect(contBtn.hidden).toBe(false);
  });

  it('hides abort/continue buttons when not in merge', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const abortBtn = document.getElementById('conflicts-abort') as HTMLButtonElement;
    const contBtn = document.getElementById('conflicts-continue') as HTMLButtonElement;
    expect(abortBtn.hidden).toBe(true);
    expect(contBtn.hidden).toBe(true);
  });

  it('resolve button opens merge modal', async () => {
    mountConflictsSummaryModal();
    mockInvoke
      .mockResolvedValueOnce({ in_progress: false })
      .mockResolvedValueOnce({ path: 'f.txt', ours: 'our', theirs: 'their' });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const listEl = document.getElementById('conflicts-summary-list') as HTMLElement;
    const resolveBtn = listEl.querySelector('button') as HTMLButtonElement;
    expect(resolveBtn.textContent).toBe('Resolve…');

    resolveBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_conflict_details', { path: 'f.txt' });
  });

  it('handles resolve button error', async () => {
    mountConflictsSummaryModal();
    mockInvoke
      .mockResolvedValueOnce({ in_progress: false })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('not found'));

    const { notify } = await import('../lib/notify');

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const listEl = document.getElementById('conflicts-summary-list') as HTMLElement;
    const resolveBtn = listEl.querySelector('button') as HTMLButtonElement;
    resolveBtn.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Failed to open conflict: Error: not found');
  });

  it('handles missing listEl gracefully', async () => {
    const modal = document.createElement('div');
    modal.id = 'conflicts-summary-modal';
    document.body.appendChild(modal);
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { openConflictsSummary } = await import('./conflicts');
    await expect(
      openConflictsSummary([{ path: 'f.txt', status: 'U' }]),
    ).resolves.toBeUndefined();
  });

  it('handles non-array files gracefully', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { openConflictsSummary } = await import('./conflicts');
    await expect(
      openConflictsSummary(null as any),
    ).resolves.toBeUndefined();
  });

  it('shows correct subtitle for in-progress merge', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: true });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const subEl = document.getElementById('conflicts-summary-subtitle') as HTMLElement;
    expect(subEl.textContent).toBe('Resolve conflicts before committing the merge');
  });

  it('shows correct subtitle for non-merge conflict', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const subEl = document.getElementById('conflicts-summary-subtitle') as HTMLElement;
    expect(subEl.textContent).toBe('Resolve conflicts in your working tree');
  });

  it('handles invoke failure for vcs_merge_context', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockRejectedValue(new Error('offline'));

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const subEl = document.getElementById('conflicts-summary-subtitle') as HTMLElement;
    expect(subEl.textContent).toBe('Resolve conflicts in your working tree');
  });

  it('open tool button is disabled when no external tool', async () => {
    mountConflictsSummaryModal();
    mockInvoke
      .mockResolvedValueOnce({ in_progress: false })
      .mockResolvedValueOnce(null);

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const listEl = document.getElementById('conflicts-summary-list') as HTMLElement;
    const buttons = listEl.querySelectorAll('button');
    const toolBtn = buttons[1] as HTMLButtonElement;
    expect(toolBtn.textContent).toBe('Open tool');
    expect(toolBtn.disabled).toBe(true);
  });

  it('open tool button shows notification when configured tool fails', async () => {
    mountConflictsSummaryModal();
    mockInvoke
      .mockResolvedValueOnce({ in_progress: false })
      .mockResolvedValueOnce({
        diff: { external_merge: { enabled: true, path: '/usr/bin/meld', args: '' } },
      })
      .mockRejectedValueOnce(new Error('tool error'));

    const { notify } = await import('../lib/notify');

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f.txt', status: 'U' }]);

    const listEl = document.getElementById('conflicts-summary-list') as HTMLElement;
    const buttons = listEl.querySelectorAll('button');
    const toolBtn = buttons[1] as HTMLButtonElement;
    expect(toolBtn.disabled).toBe(false);
    toolBtn.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Failed to open merge tool');
  });
});

describe('summary abort and continue', () => {
  it('abort button calls vcs_merge_abort on confirm', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: true });
    const { confirmBool } = await import('../lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);
    const { notify } = await import('../lib/notify');

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f1.txt', status: 'U' }]);

    const abortBtn = document.getElementById('conflicts-abort') as HTMLButtonElement;
    abortBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_abort');
    expect(notify).toHaveBeenCalledWith('Merge aborted');
  });

  it('abort does nothing when user declines confirm', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: true });
    const { confirmBool } = await import('../lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(false);

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f1.txt', status: 'U' }]);

    const abortBtn = document.getElementById('conflicts-abort') as HTMLButtonElement;
    abortBtn.click();
    await flushPromises();

    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_merge_abort');
  });

  it('abort shows error on failure', async () => {
    mountConflictsSummaryModal();
    mockInvoke
      .mockResolvedValueOnce({ in_progress: true })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('cannot abort'));

    const { confirmBool } = await import('../lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);
    const { notify } = await import('../lib/notify');

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f1.txt', status: 'U' }]);

    const abortBtn = document.getElementById('conflicts-abort') as HTMLButtonElement;
    abortBtn.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Abort failed: Error: cannot abort');
  });

  it('continue button calls vcs_merge_continue', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: true });
    const { notify } = await import('../lib/notify');

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f1.txt', status: 'U' }]);

    const contBtn = document.getElementById('conflicts-continue') as HTMLButtonElement;
    contBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_continue');
    expect(notify).toHaveBeenCalledWith('Merge committed');
  });

  it('continue shows error on failure', async () => {
    mountConflictsSummaryModal();
    mockInvoke
      .mockResolvedValueOnce({ in_progress: true })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('merge failed'));

    const { notify } = await import('../lib/notify');

    const { openConflictsSummary } = await import('./conflicts');
    await openConflictsSummary([{ path: 'f1.txt', status: 'U' }]);

    const contBtn = document.getElementById('conflicts-continue') as HTMLButtonElement;
    contBtn.click();
    await flushPromises();

    expect(notify).toHaveBeenCalledWith('Commit merge failed: Error: merge failed');
  });
});

describe('autoOpenFirstConflict', () => {
  it('does nothing for empty files array', async () => {
    const { autoOpenFirstConflict } = await import('./conflicts');
    await expect(autoOpenFirstConflict([])).resolves.toBeUndefined();
  });

  it('does nothing for non-array input', async () => {
    const { autoOpenFirstConflict } = await import('./conflicts');
    await expect(autoOpenFirstConflict(null as any)).resolves.toBeUndefined();
  });

  it('does nothing for files without conflicts', async () => {
    const { autoOpenFirstConflict } = await import('./conflicts');
    await expect(
      autoOpenFirstConflict([{ path: 'clean.txt', status: 'M' }]),
    ).resolves.toBeUndefined();
  });

  it('opens summary for new conflicts', async () => {
    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { autoOpenFirstConflict } = await import('./conflicts');
    await autoOpenFirstConflict([
      { path: 'f1.txt', status: 'U' },
      { path: 'f2.txt', status: 'DD' },
    ]);

    const countEl = document.getElementById('conflicts-summary-count') as HTMLElement;
    expect(countEl.textContent).toBe('2 conflicted files');
  });

  it('does nothing when merge modal is already open', async () => {
    mountMergeModal();
    const mergeModal = document.getElementById('merge-modal') as HTMLElement;
    mergeModal.setAttribute('aria-hidden', 'false');

    mountConflictsSummaryModal();
    mockInvoke.mockResolvedValue({ in_progress: false });

    const { autoOpenFirstConflict } = await import('./conflicts');
    await autoOpenFirstConflict([
      { path: 'f1.txt', status: 'U' },
    ]);

    const listEl = document.getElementById('conflicts-summary-list') as HTMLElement;
    expect(listEl.children.length).toBe(0);
  });
});

describe('hasExternalMergeTool', () => {
  it('returns true when merge tool is configured and enabled', async () => {
    mockInvoke.mockResolvedValue({
      diff: {
        external_merge: { enabled: true, path: '/usr/bin/meld', args: '' },
      },
    });

    const { hasExternalMergeTool } = await import('./conflicts');
    const result = await hasExternalMergeTool();
    expect(result).toBe(true);
  });

  it('returns false when merge tool is disabled', async () => {
    mockInvoke.mockResolvedValue({
      diff: {
        external_merge: { enabled: false, path: '/usr/bin/meld', args: '' },
      },
    });

    const { hasExternalMergeTool } = await import('./conflicts');
    const result = await hasExternalMergeTool();
    expect(result).toBe(false);
  });

  it('returns false when merge tool path is empty', async () => {
    mockInvoke.mockResolvedValue({
      diff: {
        external_merge: { enabled: true, path: '', args: '' },
      },
    });

    const { hasExternalMergeTool } = await import('./conflicts');
    const result = await hasExternalMergeTool();
    expect(result).toBe(false);
  });

  it('returns false on invoke error', async () => {
    mockInvoke.mockRejectedValue(new Error('config error'));

    const { hasExternalMergeTool } = await import('./conflicts');
    const result = await hasExternalMergeTool();
    expect(result).toBe(false);
  });

  it('returns false when config has no diff section', async () => {
    mockInvoke.mockResolvedValue({});

    const { hasExternalMergeTool } = await import('./conflicts');
    const result = await hasExternalMergeTool();
    expect(result).toBe(false);
  });
});

describe('launchExternalMergeTool', () => {
  it('launches tool when configured', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        diff: { external_merge: { enabled: true, path: '/usr/bin/meld', args: '' } },
      })
      .mockResolvedValueOnce(null);

    const { notify } = await import('../lib/notify');

    const { launchExternalMergeTool } = await import('./conflicts');
    await launchExternalMergeTool('/path/to/file.txt');

    expect(mockInvoke).toHaveBeenCalledWith('vcs_launch_merge_tool', { path: '/path/to/file.txt' });
    expect(notify).toHaveBeenCalledWith('Opened custom merge tool');
  });

  it('skips launch when no tool configured', async () => {
    mockInvoke.mockResolvedValue({});

    const { notify } = await import('../lib/notify');

    const { launchExternalMergeTool } = await import('./conflicts');
    await launchExternalMergeTool('/path/to/file.txt');

    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_launch_merge_tool');
    expect(notify).toHaveBeenCalledWith('No custom merge tool configured');
  });

  it('shows error on launch failure', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        diff: { external_merge: { enabled: true, path: '/usr/bin/meld', args: '' } },
      })
      .mockRejectedValueOnce(new Error('tool not found'));

    const { notify } = await import('../lib/notify');

    const { launchExternalMergeTool } = await import('./conflicts');
    await launchExternalMergeTool('/path/to/file.txt');

    expect(notify).toHaveBeenCalledWith('Failed to open merge tool');
  });
});

describe('autoOpenFirstConflict', () => {
  it('catches error when openConflictsSummary fails', async () => {
    const modals = await import('../ui/modals');
    const hydrateMock = vi.mocked(modals.hydrate);
    hydrateMock.mockImplementationOnce(() => { throw new Error('hydrate failure'); });

    const { autoOpenFirstConflict } = await import('./conflicts');

    await expect(autoOpenFirstConflict([{ path: 'err.txt', status: 'U' }] as any)).resolves.toBeUndefined();
  });
});
