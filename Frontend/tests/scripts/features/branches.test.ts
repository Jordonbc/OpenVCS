// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockConfirmBool = vi.fn();
const mockPromptMergeStrategy = vi.fn();
const mockNotify = vi.fn();
const mockRefreshOverlayScrollbarsFor = vi.fn();
const mockOpenModal = vi.fn();
const mockOpenRenameBranch = vi.fn();
const mockOpenSetUpstream = vi.fn();
const mockConfirmDeleteBranch = vi.fn();
const mockBuildCtxMenu = vi.fn();
const mockRenderList = vi.fn();
const mockHydrateStatus = vi.fn();
const mockSetTab = vi.fn();
const mockOpenConflictsSummary = vi.fn();
const mockGetPluginContextMenuItems = vi.fn();
const mockRunHook = vi.fn();
const mockRunPluginAction = vi.fn();

const mockState: any = {
  branch: 'main',
  branchLabel: 'main',
  branches: [],
  files: [],
};

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/confirm', () => ({
  confirmBool: mockConfirmBool,
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));

vi.mock('@scripts/lib/scrollbars', () => ({
  refreshOverlayScrollbarsFor: mockRefreshOverlayScrollbarsFor,
}));

vi.mock('@scripts/state/state', () => ({
  state: mockState,
}));

vi.mock('@scripts/ui/modals', () => ({
  openModal: mockOpenModal,
  closeModal: vi.fn(),
  hydrate: vi.fn(),
}));

vi.mock('@scripts/features/mergeStrategy', () => ({
  promptMergeStrategy: mockPromptMergeStrategy,
}));

vi.mock('@scripts/features/renameBranch', () => ({
  openRenameBranch: mockOpenRenameBranch,
}));

vi.mock('@scripts/features/setUpstream', () => ({
  openSetUpstream: mockOpenSetUpstream,
}));

vi.mock('@scripts/features/deleteBranchConfirm', () => ({
  confirmDeleteBranch: mockConfirmDeleteBranch,
}));

vi.mock('@scripts/lib/menu', () => ({
  buildCtxMenu: mockBuildCtxMenu,
  CtxItem: class {},
}));

vi.mock('@scripts/features/repo', () => ({
  renderList: mockRenderList,
  hydrateStatus: mockHydrateStatus,
}));

vi.mock('@scripts/ui/layout', () => ({
  setTab: mockSetTab,
}));

vi.mock('@scripts/features/conflicts', () => ({
  openConflictsSummary: mockOpenConflictsSummary,
}));

vi.mock('@scripts/plugins', () => ({
  getPluginContextMenuItems: mockGetPluginContextMenuItems,
  runHook: mockRunHook,
  runPluginAction: mockRunPluginAction,
}));

function mountUI() {
  document.body.innerHTML = `
    <button id="branch-switch"></button>
    <span id="branch-name"></span>
    <div id="branch-pop" hidden>
      <input id="branch-filter" />
      <ul id="branch-list"></ul>
    </div>
    <span id="repo-branch"></span>
    <button id="branch-new">New</button>
  `;
}

function mockLoadBranches(branches: any[] = []) {
  mockInvoke.mockResolvedValueOnce(branches);
  mockInvoke.mockResolvedValueOnce({ detached: false, branch: (mockState.branch || 'main'), commit: 'abc' });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockInvoke.mockReset();
  mockConfirmBool.mockReset();
  mockNotify.mockReset();
  mockRefreshOverlayScrollbarsFor.mockReset();
  mockOpenModal.mockReset();
  mockOpenRenameBranch.mockReset();
  mockOpenSetUpstream.mockReset();
  mockConfirmDeleteBranch.mockReset();
  mockBuildCtxMenu.mockReset();
  mockRenderList.mockReset();
  mockHydrateStatus.mockReset();
  mockSetTab.mockReset();
  mockOpenConflictsSummary.mockReset();
  mockGetPluginContextMenuItems.mockReset();
  mockRunHook.mockReset();
  mockRunPluginAction.mockReset();
  mockGetPluginContextMenuItems.mockReturnValue([]);
  mockRunHook.mockResolvedValue({ cancelled: false });
  mockState.branch = 'main';
  mockState.branchLabel = 'main';
  mockState.branches = [];
  mountUI();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function openPopover(expectedItems: number) {
  document.getElementById('branch-switch')!.click();
  await vi.waitFor(() => {
    expect(document.getElementById('branch-list')!.children.length).toBe(expectedItems);
  });
}

describe('bindBranchUI', () => {
  it('syncs branch labels on init with a branch set', async () => {
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    expect(document.getElementById('branch-name')!.textContent).toBe('main');
    expect(document.getElementById('repo-branch')!.textContent).toBe('main');
    expect((document.getElementById('branch-switch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('syncs branch labels with fallback when no branch', async () => {
    mockState.branch = '';
    mockState.branchLabel = '';
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    expect(document.getElementById('branch-name')!.textContent).toBe('\u2014');
    expect((document.getElementById('branch-switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles branch popover on branch button click', async () => {
    mockLoadBranches([]);
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    const btn = document.getElementById('branch-switch')!;
    const pop = document.getElementById('branch-pop')!;
    expect(pop.hidden).toBe(true);

    btn.click();
    await vi.waitFor(() => expect(pop.hidden).toBe(false));
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    btn.click();
    expect(pop.classList.contains('is-closing')).toBe(true);
  });

  it('loads branches and renders list on popover open', async () => {
    mockLoadBranches([
      { name: 'main', current: true, kind: { type: 'local' } },
      { name: 'dev', kind: { type: 'local' } },
      { name: 'origin/feature', kind: { type: 'remote', remote: 'origin' } },
    ]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();

    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.children.length).toBe(4);
      expect(list.textContent).toContain('main');
      expect(list.textContent).toContain('dev');
      expect(list.textContent).toContain('Remote branches');
      expect(list.textContent).toContain('origin/feature');
    });
  });

  it('handles loadBranches failure gracefully', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();

    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Failed to load branches');
    });
  });

  it('filters branches on input', async () => {
    mockLoadBranches([
      { name: 'main', kind: { type: 'local' } },
      { name: 'feature-x', kind: { type: 'local' } },
    ]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    await openPopover(2);

    const filter = document.getElementById('branch-filter') as HTMLInputElement;
    filter.value = 'feature';
    filter.dispatchEvent(new Event('input'));

    expect(document.getElementById('branch-list')!.children.length).toBe(1);
    expect(document.getElementById('branch-list')!.textContent).toContain('feature-x');
  });

  it('handles vcs_head_status returning detached head', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: true, commit: 'abc1234' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();

    await vi.waitFor(() => {
      expect(document.getElementById('branch-name')!.textContent).toContain('Detached HEAD');
    });
  });

  it('clicking a branch in the list checks it out', async () => {
    mockLoadBranches([
      { name: 'dev', kind: { type: 'local' } },
    ]);
    mockInvoke.mockResolvedValue(undefined);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();
    await openPopover(1);

    const item = document.querySelector('li[data-branch]')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('vcs_checkout_branch', { name: 'dev' });
      expect(mockNotify).toHaveBeenCalledWith('Switched to dev');
    });
  });

  it('clicking the document outside popover closes it', async () => {
    mockLoadBranches([]);
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      expect(document.getElementById('branch-pop')!.hidden).toBe(false);
    });

    document.dispatchEvent(new MouseEvent('click'));
    expect(document.getElementById('branch-pop')!.classList.contains('is-closing')).toBe(true);
  });

  it('resize event closes popover', async () => {
    mockLoadBranches([]);
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      expect(document.getElementById('branch-pop')!.hidden).toBe(false);
    });

    window.dispatchEvent(new Event('resize'));
    expect(document.getElementById('branch-pop')!.classList.contains('is-closing')).toBe(true);
  });

  it('app:branches-updated event syncs labels', async () => {
    mockState.branchLabel = 'updated-branch';
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    window.dispatchEvent(new CustomEvent('app:branches-updated'));

    expect(document.getElementById('branch-name')!.textContent).toBe('updated-branch');
  });

  it('new branch button opens the modal', async () => {
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-new')!.click();

    expect(mockOpenModal).toHaveBeenCalledWith('new-branch-modal');
  });

  it('closes popover with animation timer', async () => {
    mockLoadBranches([]);
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      expect(document.getElementById('branch-pop')!.hidden).toBe(false);
    });

    document.getElementById('branch-switch')!.click();
    expect(document.getElementById('branch-pop')!.classList.contains('is-closing')).toBe(true);

    vi.advanceTimersByTime(130);
    expect(document.getElementById('branch-pop')!.hidden).toBe(true);
    expect((document.getElementById('branch-filter') as HTMLInputElement).value).toBe('');
  });

  it('renderBranches handles empty branchList', async () => {
    document.querySelector('#branch-list')!.remove();
    mockLoadBranches([]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      expect(document.getElementById('branch-pop')!.hidden).toBe(false);
    });
  });

  it('handles remote branches identified by full_ref', async () => {
    mockLoadBranches([
      { name: 'main', full_ref: 'refs/heads/main', kind: { type: 'local' } },
      { name: 'origin/main', full_ref: 'refs/remotes/origin/main' },
    ]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();

    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.textContent).toContain('Remote branches');
    });
  });

  describe('context menu', () => {
    async function triggerContextMenu() {
      const li = document.querySelector('li[data-branch]')!;
      li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
      await vi.waitFor(() => {
        expect(mockBuildCtxMenu).toHaveBeenCalled();
      });
      return mockBuildCtxMenu.mock.calls[0][0];
    }

    it('shows checkout option', async () => {
      mockLoadBranches([{ name: 'dev', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'dev', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      expect(items[0].label).toBe('Checkout');
    });

    it('merge into current', async () => {
      mockPromptMergeStrategy.mockResolvedValue('merge');
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockResolvedValueOnce(true); // vcs_merge_strategy_supported
      mockInvoke.mockResolvedValueOnce(undefined); // vcs_merge_branch

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[1].action();

      expect(mockPromptMergeStrategy).toHaveBeenCalledWith('feature', 'main');
      expect(mockInvoke).toHaveBeenCalledWith('vcs_merge_branch', { name: 'feature', strategy: 'merge' });
      expect(mockNotify).toHaveBeenCalledWith("Merged branch 'feature' into 'main'");
    });

    it('merge cancelled by user', async () => {
      mockPromptMergeStrategy.mockResolvedValue(null);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockResolvedValueOnce(true); // vcs_merge_strategy_supported

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[1].action();

      expect(mockInvoke).not.toHaveBeenCalledWith('vcs_merge_branch', expect.anything());
    });

    it('merge into self shows notify', async () => {
      mockState.branch = 'feature';
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[1].action();

      expect(mockNotify).toHaveBeenCalledWith('Cannot merge a branch into itself');
    });

    it('merge detects conflicts', async () => {
      mockPromptMergeStrategy.mockResolvedValue('merge');
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockResolvedValueOnce(true); // vcs_merge_strategy_supported
      mockInvoke.mockRejectedValueOnce(new Error('Automatic merge failed; fix conflicts and then commit'));
      mockState.files = [{ path: 'file.txt' }];

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[1].action();

      expect(mockNotify).toHaveBeenCalledWith('Merge conflict detected');
      expect(mockSetTab).toHaveBeenCalledWith('changes');
    });

    it('merge shows generic error', async () => {
      mockPromptMergeStrategy.mockResolvedValue('merge');
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockResolvedValueOnce(true); // vcs_merge_strategy_supported
      mockInvoke.mockRejectedValueOnce(new Error('some other error'));

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[1].action();

      expect(mockNotify).toHaveBeenCalledWith('Merge failed: Error: some other error');
    });

    it('set upstream for local branch', async () => {
      mockLoadBranches([
        { name: 'feature', kind: { type: 'local' } },
        { name: 'origin/main', kind: { type: 'remote', remote: 'origin' } },
      ]);
      mockLoadBranches([
        { name: 'feature', kind: { type: 'local' } },
        { name: 'origin/main', kind: { type: 'remote', remote: 'origin' } },
      ]);
      mockLoadBranches([
        { name: 'feature', kind: { type: 'local' } },
        { name: 'origin/main', kind: { type: 'remote', remote: 'origin' } },
      ]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(3);

      const items = await triggerContextMenu();
      await items[3].action();

      expect(mockOpenSetUpstream).toHaveBeenCalledWith('feature', ['origin/main']);
    });

    it('set upstream with no remote branches shows notify', async () => {
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[3].action();

      expect(mockNotify).toHaveBeenCalledWith('No remote branches found (fetch first)');
    });

    it('rename opens rename modal', async () => {
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[4].action();

      expect(mockOpenRenameBranch).toHaveBeenCalledWith('feature');
    });

    it('delete current branch shows notify', async () => {
      mockLoadBranches([{ name: 'main', current: true, kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'main', current: true, kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[5].action();

      expect(mockNotify).toHaveBeenCalledWith('Cannot delete the current branch');
    });

    it('delete non-current branch with hooks', async () => {
      mockConfirmDeleteBranch.mockResolvedValue(true);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockResolvedValueOnce(undefined);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[5].action();

      expect(mockRunHook).toHaveBeenCalledWith('preBranchDelete', expect.any(Object));
      expect(mockInvoke).toHaveBeenCalledWith('vcs_delete_branch', { name: 'feature', force: false });
      expect(mockNotify).toHaveBeenCalledWith("Deleted 'feature'");
    });

    it('delete cancelled by hook', async () => {
      mockConfirmDeleteBranch.mockResolvedValue(true);
      mockRunHook.mockResolvedValue({ cancelled: true, reason: 'Not allowed' });
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[5].action();

      expect(mockNotify).toHaveBeenCalledWith('Not allowed');
    });

    it('delete with force delete fallback', async () => {
      mockConfirmDeleteBranch.mockResolvedValueOnce(true);
      mockConfirmDeleteBranch.mockResolvedValueOnce(true);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockRejectedValueOnce(new Error('not fully merged'));
      mockInvoke.mockResolvedValueOnce(undefined);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[5].action();

      expect(mockConfirmDeleteBranch).toHaveBeenCalledWith(expect.objectContaining({ name: 'feature', force: true }));
      expect(mockInvoke).toHaveBeenCalledWith('vcs_delete_branch', { name: 'feature', force: true });
    });

    it('delete with force delete fallback cancelled by user', async () => {
      mockConfirmDeleteBranch.mockResolvedValueOnce(true);
      mockConfirmDeleteBranch.mockResolvedValueOnce(false);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockRejectedValueOnce(new Error('not fully merged'));

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[5].action();

      expect(mockNotify).toHaveBeenCalledWith('Delete cancelled');
    });

    it('force delete with shift held', async () => {
      mockConfirmDeleteBranch.mockResolvedValue(true);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockResolvedValueOnce(undefined);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const li = document.querySelector('li[data-branch]')!;
      li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200, shiftKey: true }));
      await vi.waitFor(() => {
        expect(mockBuildCtxMenu).toHaveBeenCalled();
      });

      const items = mockBuildCtxMenu.mock.calls[0][0];
      expect(items[5].label).toBe('Force delete\u2026');
      await items[5].action();

      expect(mockInvoke).toHaveBeenCalledWith('vcs_delete_branch', { name: 'feature', force: true });
    });

    it('force delete failure shows error', async () => {
      mockConfirmDeleteBranch.mockResolvedValue(true);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockInvoke.mockRejectedValueOnce(new Error('fail'));

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const li = document.querySelector('li[data-branch]')!;
      li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200, shiftKey: true }));
      await vi.waitFor(() => {
        expect(mockBuildCtxMenu).toHaveBeenCalled();
      });

      const items = mockBuildCtxMenu.mock.calls[0][0];
      await items[5].action();

      expect(mockNotify).toHaveBeenCalledWith('Force delete failed: Error: fail');
    });

    it('delete cancelled by user at confirm', async () => {
      mockConfirmDeleteBranch.mockResolvedValue(false);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      const items = await triggerContextMenu();
      await items[5].action();

      expect(mockNotify).toHaveBeenCalledWith('Delete cancelled');
    });

    it('includes plugin items', async () => {
      mockGetPluginContextMenuItems.mockReturnValue([
        { label: 'Plugin Action', action: 'plugin:action' },
      ]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);
      mockLoadBranches([{ name: 'feature', kind: { type: 'local' } }]);

      const { bindBranchUI } = await import('@scripts/features/branches');
      bindBranchUI();
      await openPopover(1);

      document.querySelector('li[data-branch]')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
      await vi.waitFor(() => {
        expect(mockGetPluginContextMenuItems).toHaveBeenCalledWith('branches');
      });
    });
  });

  it('does not refetch branches for repo-open events with a path detail', async () => {
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path: '/repo' } }));

    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_list_branches');
    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_head_status');
  });

  it('refetches branches for app:repo-selected without path detail', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    window.dispatchEvent(new CustomEvent('app:repo-selected', {}));

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('vcs_list_branches');
    });
  });

  it('checkoutBranch cancelled by preSwitchBranch hook', async () => {
    mockRunHook.mockResolvedValue({ cancelled: true, reason: 'Not now' });
    mockLoadBranches([{ name: 'dev', kind: { type: 'local' } }]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();
    await openPopover(1);

    const item = document.querySelector('li[data-branch]')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Not now');
    });
    expect(mockInvoke).not.toHaveBeenCalledWith('vcs_checkout_branch', expect.anything());
  });

  it('checkoutBranch failure shows notification', async () => {
    mockLoadBranches([{ name: 'dev', kind: { type: 'local' } }]);
    mockInvoke.mockRejectedValue(new Error('checkout error'));

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();
    await openPopover(1);

    const item = document.querySelector('li[data-branch]')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Checkout failed');
    });
  });

  it('handles detached head without a commit string', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: true });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();

    await vi.waitFor(() => {
      expect(document.getElementById('branch-name')!.textContent).toContain('Detached HEAD');
    });
  });

  it('handles vcs_head_status setting branch from head.branch', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'feature-branch', commit: 'def5678' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();

    await vi.waitFor(() => {
      expect(document.getElementById('branch-name')!.textContent).toBe('feature-branch');
    });
  });

  it('closeBranchPopover with prefers-reduced-motion skips animation', async () => {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    window.matchMedia = matchMediaMock;

    mockLoadBranches([]);
    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      expect(document.getElementById('branch-pop')!.hidden).toBe(false);
    });

    document.getElementById('branch-switch')!.click();
    expect(document.getElementById('branch-pop')!.hidden).toBe(true);
    expect(document.getElementById('branch-pop')!.classList.contains('is-closing')).toBe(false);
  });

  it('openBranchPopover early return when branchBtn missing', async () => {
    document.getElementById('branch-switch')!.remove();

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.body.dispatchEvent(new MouseEvent('click'));
  });

  it('branchList click on non-LI element does nothing', async () => {
    mockLoadBranches([{ name: 'dev', kind: { type: 'local' } }]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();
    await openPopover(1);

    const list = document.getElementById('branch-list')!;
    const nonLi = document.createElement('div');
    nonLi.textContent = 'Click me';
    list.appendChild(nonLi);
    nonLi.click();
  });

  it('handles context menu on branch without name', async () => {
    mockLoadBranches([{ name: 'unnamed', kind: { type: 'local' } }]);
    mockLoadBranches([{ name: 'unnamed', kind: { type: 'local' } }]);

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();
    await openPopover(1);

    const li = document.querySelector('li[data-branch]') as HTMLElement;
    li.dataset.branch = '';
    li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));

    await vi.waitFor(() => {
      expect(mockBuildCtxMenu).not.toHaveBeenCalled();
    });
  });

  it('setBranchUIEnabled handles null branchBtn', async () => {
    document.getElementById('branch-switch')!.remove();

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    expect(() => {
      document.getElementById('repo-branch')!.textContent = 'test';
    }).not.toThrow();
  });

  it('closeBranchPopover handles null elements gracefully', async () => {
    document.getElementById('branch-switch')!.remove();
    document.getElementById('branch-pop')!.remove();

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.body.dispatchEvent(new MouseEvent('click'));
  });
});

// ---------------------------------------------------------------------------
// renderItem - kind='remote' type without explicit remote name
// ---------------------------------------------------------------------------

describe('renderItem kind remote without remote name', () => {
  it('falls back to "remote" label when kind.remote is missing', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'feature', kind: { type: 'remote' } }]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.textContent).toContain('Remote:remote');
    });
  });
});

// ---------------------------------------------------------------------------
// renderItem - kind='remote' type with explicit remote name
// ---------------------------------------------------------------------------

describe('renderItem kind remote with explicit remote', () => {
  it('shows remote label from kind.remote property', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'upstream/feature', kind: { type: 'remote', remote: 'upstream' } }]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.textContent).toContain('Remote:upstream');
    });
  });
});

// ---------------------------------------------------------------------------
// renderItem - no kind type, remote derived from branch name
// ---------------------------------------------------------------------------

describe('renderItem remote from name', () => {
  it('derives remote from name when no kind but name contains /', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'origin/feature' }]); // no kind property
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.textContent).toContain('Remote:origin');
    });
  });
});

// ---------------------------------------------------------------------------
// renderItem - no kind and no badge (local with no kind metadata)
// ---------------------------------------------------------------------------

describe('renderItem local no kind', () => {
  it('renders no badge when branch has no kind and no remote in name', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'local-branch' }]); // no kind at all
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      const item = list.querySelector('li[data-branch]')!;
      // No badge span with class "kind" since all kind conditions are false
      expect(item.querySelector('.badge.kind')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// closeBranchPopover - early return when branchFilter is null
// ---------------------------------------------------------------------------

describe('closeBranchPopover null branchFilter', () => {
  it('returns early without error when branchFilter is null', async () => {
    document.getElementById('branch-filter')!.remove();
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    // Open popover first – loadBranches runs, renderBranches is called but
    // branchFilter is null so filter value defaults to ''
    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      expect(document.getElementById('branch-pop')!.hidden).toBe(false);
    });

    // Click outside to trigger closeBranchPopover – should early-return on !branchFilter
    document.body.dispatchEvent(new MouseEvent('click'));
    // No crash expected, popup stays open because close was skipped
  });
});

// ---------------------------------------------------------------------------
// openBranchPopover - early return when branchPop is null
// ---------------------------------------------------------------------------

describe('openBranchPopover null branchPop', () => {
  it('returns early without error when branchPop is null', async () => {
    document.getElementById('branch-pop')!.remove();
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    // Click branch button – openBranchPopover checks !branchPop and returns early
    document.getElementById('branch-switch')!.click();
    // No crash expected
  });
});

// ---------------------------------------------------------------------------
// renderBranches - only local branches (no divider)
// ---------------------------------------------------------------------------

describe('renderBranches only local', () => {
  it('does not render Remote branches divider when there are no remotes', async () => {
    mockInvoke.mockResolvedValueOnce([
      { name: 'main', current: true, kind: { type: 'local' } },
      { name: 'dev', kind: { type: 'local' } },
    ]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.textContent).toContain('main');
      expect(list.textContent).toContain('dev');
      expect(list.textContent).not.toContain('Remote branches');
    });
  });
});

// ---------------------------------------------------------------------------
// renderBranches - only remote branches (no divider)
// ---------------------------------------------------------------------------

describe('renderBranches only remote', () => {
  it('renders remote branches without Remote branches header', async () => {
    mockInvoke.mockResolvedValueOnce([
      { name: 'origin/main', kind: { type: 'remote', remote: 'origin' } },
      { name: 'origin/feature', kind: { type: 'remote', remote: 'origin' } },
    ]);
    mockInvoke.mockResolvedValueOnce({ detached: false, branch: 'main', commit: 'abc' });

    const { bindBranchUI } = await import('@scripts/features/branches');
    bindBranchUI();

    document.getElementById('branch-switch')!.click();
    await vi.waitFor(() => {
      const list = document.getElementById('branch-list')!;
      expect(list.textContent).toContain('origin/main');
      expect(list.textContent).toContain('origin/feature');
      // No divider because there are no local branches
      expect(list.textContent).not.toContain('Remote branches');
    });
  });
});
