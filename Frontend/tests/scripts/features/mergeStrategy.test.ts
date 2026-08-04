// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockConfirmBool = vi.fn();
const mockHydrateStatus = vi.fn();
const mockSetTab = vi.fn();
const mockOpenConflictsSummary = vi.fn();

const mockState: any = {
  files: [],
};

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: { invoke: mockInvoke },
}));
vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));
vi.mock('@scripts/lib/confirm', () => ({
  confirmBool: mockConfirmBool,
}));
vi.mock('@scripts/state/state', () => ({
  state: mockState,
}));
vi.mock('@scripts/features/repo', () => ({
  hydrateStatus: mockHydrateStatus,
}));
vi.mock('@scripts/ui/layout', () => ({
  setTab: mockSetTab,
}));
vi.mock('@scripts/features/conflicts', () => ({
  openConflictsSummary: mockOpenConflictsSummary,
}));
vi.mock('@scripts/ui/modals', () => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  hydrate: vi.fn(),
}));

/** Mounts the merge-strategy picker modal so the real controller can wire it. */
function mountMergeStrategyModal(): HTMLElement {
  document.body.innerHTML = `
    <div id="merge-strategy-modal">
      <button class="merge-strategy-option" data-strategy="merge">Merge</button>
      <button class="merge-strategy-option" data-strategy="squash">Squash</button>
      <button class="merge-strategy-option" data-strategy="rebase">Rebase</button>
    </div>
  `;
  return document.getElementById('merge-strategy-modal')!;
}

async function load() {
  return import('@scripts/features/mergeStrategy');
}

beforeEach(() => {
  vi.resetModules();
  mockInvoke.mockReset();
  mockNotify.mockReset();
  mockConfirmBool.mockReset();
  mockHydrateStatus.mockReset();
  mockSetTab.mockReset();
  mockOpenConflictsSummary.mockReset();
  mockState.files = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mergeBranchWithStrategy', () => {
  it('does not merge a branch into itself', async () => {
    const { mergeBranchWithStrategy } = await load();
    await mergeBranchWithStrategy('feature', 'feature', () => Promise.resolve());

    expect(mockNotify).toHaveBeenCalledWith('Cannot merge a branch into itself');
    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_merge_branch', expect.anything());
  });

  it('uses the strategy picker when advanced strategies are available', async () => {
    const modal = mountMergeStrategyModal();
    mockInvoke.mockResolvedValueOnce(['merge', 'squash', 'rebase']); // vcs_merge_strategies
    mockInvoke.mockResolvedValueOnce(undefined); // vcs_merge_branch
    const onMerged = vi.fn();

    const { mergeBranchWithStrategy } = await load();
    const pending = mergeBranchWithStrategy('feature', 'main', onMerged);

    // Wait until strategies were fetched, then flush the continuation so the
    // picker modal is wired and its options are clickable.
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_strategies');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    modal.querySelector<HTMLElement>('[data-strategy="squash"]')!.click();
    await pending;

    expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_branch', { name: 'feature', strategy: 'squash' });
    expect(mockNotify).toHaveBeenCalledWith("Merged branch 'feature' into 'main'");
    expect(onMerged).toHaveBeenCalled();
  });

  it('does not merge when the strategy picker is cancelled', async () => {
    const modal = mountMergeStrategyModal();
    mockInvoke.mockResolvedValueOnce(['merge', 'squash', 'rebase']); // vcs_merge_strategies

    const { mergeBranchWithStrategy } = await load();
    const pending = mergeBranchWithStrategy('feature', 'main', () => Promise.resolve());

    // Wait until strategies were fetched, then flush the continuation so the
    // picker modal is wired, then dismiss it.
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_strategies');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    modal.dispatchEvent(new CustomEvent('modal:closed'));
    await pending;

    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_merge_branch', expect.anything());
  });

  it('falls back to a plain confirm when only the default strategy is supported', async () => {
    mockInvoke.mockResolvedValueOnce(['merge']); // vcs_merge_strategies
    mockConfirmBool.mockResolvedValue(true);
    mockInvoke.mockResolvedValueOnce(undefined); // vcs_merge_branch

    const { mergeBranchWithStrategy } = await load();
    await mergeBranchWithStrategy('feature', 'main', () => Promise.resolve());

    expect(mockConfirmBool).toHaveBeenCalledWith("Merge 'feature' into 'main'?");
    expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_branch', { name: 'feature', strategy: 'merge' });
    expect(mockNotify).toHaveBeenCalledWith("Merged branch 'feature' into 'main'");
  });

  it('does not merge when the plain confirm is declined', async () => {
    mockInvoke.mockResolvedValueOnce(['merge']); // vcs_merge_strategies
    mockConfirmBool.mockResolvedValue(false);

    const { mergeBranchWithStrategy } = await load();
    await mergeBranchWithStrategy('feature', 'main', () => Promise.resolve());

    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_merge_branch', expect.anything());
  });

  it('surfaces a conflict and opens the conflicts summary', async () => {
    mockInvoke.mockResolvedValueOnce(['merge']); // vcs_merge_strategies
    mockConfirmBool.mockResolvedValue(true);
    mockInvoke.mockRejectedValueOnce(new Error('Automatic merge failed; fix conflicts and then commit'));
    mockState.files = [{ path: 'file.txt' }];

    const { mergeBranchWithStrategy } = await load();
    await mergeBranchWithStrategy('feature', 'main', () => Promise.resolve());

    expect(mockNotify).toHaveBeenCalledWith('Merge conflict detected');
    expect(mockHydrateStatus).toHaveBeenCalled();
    expect(mockSetTab).toHaveBeenCalledWith('changes');
    expect(mockOpenConflictsSummary).toHaveBeenCalledWith([{ path: 'file.txt' }]);
  });

  it('notifies a generic merge failure', async () => {
    mockInvoke.mockResolvedValueOnce(['merge']); // vcs_merge_strategies
    mockConfirmBool.mockResolvedValue(true);
    mockInvoke.mockRejectedValueOnce(new Error('some other error'));

    const { mergeBranchWithStrategy } = await load();
    await mergeBranchWithStrategy('feature', 'main', () => Promise.resolve());

    expect(mockNotify).toHaveBeenCalledWith('Merge failed: Error: some other error');
  });
});
