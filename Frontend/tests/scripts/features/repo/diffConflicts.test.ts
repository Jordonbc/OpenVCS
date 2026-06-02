// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock('@scripts/lib/dom', () => ({
  escapeHtml: vi.fn((s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')),
}));
vi.mock('@scripts/lib/menu', () => ({ buildCtxMenu: vi.fn() }));
vi.mock('@scripts/lib/tauri', () => ({ TAURI: { invoke: mockInvoke } }));
vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));

const mockState = vi.hoisted(() => ({
  currentFile: '',
  currentDiff: [] as string[],
  selectedHunks: [] as number[],
  selectedHunksByFile: {} as Record<string, number[]>,
  selectedLinesByFile: {} as Record<string, Record<number, number[]>>,
}));
vi.mock('@scripts/state/state', () => ({ state: mockState }));

const mockDiffEl = document.createElement('div');
vi.mock('@scripts/features/repo/context', () => ({ diffEl: mockDiffEl }));
vi.mock('@scripts/features/repo/hydrate', () => ({ hydrateStatus: vi.fn() }));
vi.mock('@scripts/features/repo/diffBinary', () => ({ scrollDiffToTop: vi.fn() }));
vi.mock('@scripts/features/conflicts', () => ({
  openMergeModal: vi.fn(),
  hasExternalMergeTool: vi.fn(),
  launchExternalMergeTool: vi.fn(),
}));

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  mockDiffEl.innerHTML = '';
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
  mockState.currentFile = '';
  mockState.currentDiff = [];
  mockState.selectedHunks = [];
  mockState.selectedHunksByFile = {};
  mockState.selectedLinesByFile = {};
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('renderConflictView', () => {
  it('renders conflict view on success', async () => {
    mockInvoke.mockResolvedValue({
      path: 'conflict.txt',
      ours: 'my version\nline2',
      theirs: 'their version\nline2',
      base: 'base version',
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'conflict.txt', status: 'U' });

    const conflictView = mockDiffEl.querySelector('.conflict-view') as HTMLElement;
    expect(conflictView).toBeTruthy();
    expect(conflictView.dataset.conflictPath).toBe('conflict.txt');
    expect(conflictView.dataset.conflictBinary).toBe('0');

    const header = conflictView.querySelector('.conflict-header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.textContent).toContain('Merge conflict');

    const actions = conflictView.querySelector('.conflict-actions') as HTMLElement;
    expect(actions).toBeTruthy();
    expect(actions.querySelector('[data-conflict-action="ours"]')).toBeTruthy();
    expect(actions.querySelector('[data-conflict-action="theirs"]')).toBeTruthy();
    expect(actions.querySelector('[data-conflict-action="merge"]')).toBeTruthy();

    const panes = conflictView.querySelectorAll('.conflict-pane');
    expect(panes.length).toBe(2);
    expect(panes[0].querySelector('header')?.textContent).toBe('Mine');
    expect(panes[1].querySelector('header')?.textContent).toBe('Theirs');

    expect(mockState.currentFile).toBe('conflict.txt');
    expect(mockState.currentDiff).toEqual([]);
    expect(mockState.selectedHunks).toEqual([]);
  });

  it('renders error on invoke failure', async () => {
    mockInvoke.mockRejectedValue(new Error('network error'));
    console.error = vi.fn();

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'bad.txt', status: 'U' });

    expect(mockDiffEl.innerHTML).toContain('Failed to load conflict details');
    expect(console.error).toHaveBeenCalled();
  });

  it('shows loading state initially', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    renderConflictView({ path: 'f.txt', status: 'U' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockDiffEl.innerHTML).toContain('Loading conflict');
  });

  it('clears current file entry from selectedHunksByFile and selectedLinesByFile', async () => {
    mockInvoke.mockResolvedValue({ path: 'new.txt', ours: 'a', theirs: 'b' });

    mockState.selectedHunksByFile['new.txt'] = [0, 1];
    mockState.selectedLinesByFile['new.txt'] = { 0: [1, 2] };
    mockState.selectedHunksByFile['other.txt'] = [3];

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'new.txt', status: 'U' });

    expect(mockState.selectedHunksByFile['new.txt']).toBeUndefined();
    expect(mockState.selectedLinesByFile['new.txt']).toBeUndefined();
    expect(mockState.selectedHunksByFile['other.txt']).toEqual([3]);
  });
});

describe('renderConflictMarkup (via full render)', () => {
  it('builds correct markup for text conflict', async () => {
    mockInvoke.mockResolvedValue({
      path: 'text.txt',
      ours: 'our code',
      theirs: 'their code',
      binary: false,
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'text.txt', status: 'U' });

    const view = mockDiffEl.querySelector('.conflict-view') as HTMLElement;
    expect(view.dataset.conflictBinary).toBe('0');
    expect(view.querySelector('.conflict-panels')).toBeTruthy();
    expect(view.querySelector('.conflict-note')).toBeFalsy();
  });

  it('builds correct markup for binary conflict', async () => {
    mockInvoke.mockResolvedValue({
      path: 'binary.bin',
      ours: null,
      theirs: null,
      binary: true,
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'binary.bin', status: 'U' });

    const view = mockDiffEl.querySelector('.conflict-view') as HTMLElement;
    expect(view.dataset.conflictBinary).toBe('1');
    expect(view.querySelector('.conflict-note')).toBeTruthy();
    expect(view.querySelector('.conflict-panels')).toBeFalsy();
    expect(view.querySelector('.conflict-note')?.textContent).toContain('binary');
  });

  it('escapes path using escapeHtml', async () => {
    const { escapeHtml } = await import('@scripts/lib/dom');
    mockInvoke.mockResolvedValue({
      path: '<script>alert(1)</script>',
      ours: 'a',
      theirs: 'b',
      binary: false,
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: '<script>alert(1)</script>', status: 'U' });

    expect(escapeHtml).toHaveBeenCalledWith('<script>alert(1)</script>');
  });
});

describe('bindConflictActions (ours/theirs)', () => {
  it('ours button resolves via vcs_resolve_conflict_side', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { notify } = await import('@scripts/lib/notify');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const oursBtn = mockDiffEl.querySelector('[data-conflict-action="ours"]') as HTMLButtonElement;
    oursBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_resolve_conflict_side', {
      path: 'f.txt',
      side: 'ours',
    });
    expect(notify).toHaveBeenCalledWith('Kept your version');
  });

  it('theirs button resolves via vcs_resolve_conflict_side', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { notify } = await import('@scripts/lib/notify');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const theirsBtn = mockDiffEl.querySelector('[data-conflict-action="theirs"]') as HTMLButtonElement;
    theirsBtn.click();
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith('vcs_resolve_conflict_side', {
      path: 'f.txt',
      side: 'theirs',
    });
    expect(notify).toHaveBeenCalledWith('Kept their version');
  });

  it('disables buttons during resolution and re-enables after', async () => {
    let resolvePromise: () => void = () => {};
    let callCount = 0;
    mockInvoke.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ path: 'f.txt', ours: 'a', theirs: 'b' });
      }
      return new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const oursBtn = mockDiffEl.querySelector('[data-conflict-action="ours"]') as HTMLButtonElement;
    const container = mockDiffEl.querySelector('.conflict-view') as HTMLElement;

    oursBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(oursBtn.disabled).toBe(true);
    expect(container.getAttribute('data-busy')).toBe('1');

    resolvePromise();
    await flushPromises();

    expect(oursBtn.disabled).toBe(false);
    expect(container.hasAttribute('data-busy')).toBe(false);
  });

  it('shows error on resolve failure', async () => {
    mockInvoke
      .mockResolvedValueOnce({ path: 'f.txt', ours: 'a', theirs: 'b' })
      .mockRejectedValueOnce(new Error('resolve failed'));
    console.error = vi.fn();
    const { notify } = await import('@scripts/lib/notify');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const oursBtn = mockDiffEl.querySelector('[data-conflict-action="ours"]') as HTMLButtonElement;
    oursBtn.click();
    await flushPromises();

    expect(console.error).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Failed to resolve conflict');
  });
});

describe('bindConflictActions (merge button)', () => {
  it('opens context menu with built-in merge tool option', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const mergeBtn = mockDiffEl.querySelector('[data-conflict-action="merge"]') as HTMLButtonElement;
    expect(mergeBtn).toBeTruthy();

    mergeBtn.click();
    await flushPromises();

    expect(buildCtxMenu).toHaveBeenCalledTimes(1);
    const ctxItems = (buildCtxMenu as any).mock.calls[0][0];
    expect(ctxItems[0].label).toBe('Open built-in merge tool');
  });

  it('includes external merge tool option when available', async () => {
    const { hasExternalMergeTool } = await import('@scripts/features/conflicts');
    (hasExternalMergeTool as any).mockResolvedValue(true);
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const mergeBtn = mockDiffEl.querySelector('[data-conflict-action="merge"]') as HTMLButtonElement;
    mergeBtn.click();
    await flushPromises();

    const ctxItems = (buildCtxMenu as any).mock.calls[0][0];
    expect(ctxItems.length).toBe(2);
    expect(ctxItems[1].label).toBe('Open custom merge tool');
  });

  it('does not include external tool when hasExternalMergeTool returns false', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { hasExternalMergeTool } = await import('@scripts/features/conflicts');
    (hasExternalMergeTool as any).mockResolvedValue(false);

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const mergeBtn = mockDiffEl.querySelector('[data-conflict-action="merge"]') as HTMLButtonElement;
    mergeBtn.click();
    await flushPromises();

    const ctxItems = (buildCtxMenu as any).mock.calls[0][0];
    expect(ctxItems.length).toBe(1);
  });
});

describe('render markup helpers', () => {
  it('includes merge button for non-binary conflicts', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b', binary: false });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    expect(mockDiffEl.querySelector('[data-conflict-action="merge"]')).toBeTruthy();
    expect(mockDiffEl.querySelector('[data-conflict-action="ours"]')).toBeTruthy();
    expect(mockDiffEl.querySelector('[data-conflict-action="theirs"]')).toBeTruthy();
  });

  it('omits merge button for binary conflicts', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.bin', ours: null, theirs: null, binary: true });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.bin', status: 'U' });

    expect(mockDiffEl.querySelector('[data-conflict-action="merge"]')).toBeFalsy();
    expect(mockDiffEl.querySelector('[data-conflict-action="ours"]')).toBeTruthy();
    expect(mockDiffEl.querySelector('[data-conflict-action="theirs"]')).toBeTruthy();
  });

  it('renders side-by-side panes with content', async () => {
    mockInvoke.mockResolvedValue({
      path: 'f.txt',
      ours: 'line1\nline2',
      theirs: 'theirs1\ntheirs2\n',
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const preElements = mockDiffEl.querySelectorAll('.conflict-code');
    expect(preElements.length).toBe(2);
    expect(preElements[0].textContent).toBe('line1\nline2');
    expect(preElements[1].textContent).toBe('theirs1\ntheirs2\n');
  });

  it('shows empty placeholder when pane has no content', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: '', theirs: null });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const emptyElements = mockDiffEl.querySelectorAll('.conflict-empty');
    expect(emptyElements.length).toBe(2);
    expect(emptyElements[0].textContent).toBe('(empty)');
    expect(emptyElements[1].textContent).toBe('(empty)');
  });

  it('shows binary conflict note', async () => {
    mockInvoke.mockResolvedValue({ path: 'image.png', binary: true });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'image.png', status: 'U' });

    const note = mockDiffEl.querySelector('.conflict-note') as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.textContent).toContain('binary');
  });

  it('escapes HTML in pane content', async () => {
    mockInvoke.mockResolvedValue({
      path: 'f.txt',
      ours: '<script>alert("xss")</script>',
      theirs: 'safe content',
    });

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const preElements = mockDiffEl.querySelectorAll('.conflict-code');
    expect(preElements[0].innerHTML).not.toContain('<script>');
  });
});

describe('scrollDiffToTop', () => {
  it('is called during renderConflictView', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { scrollDiffToTop } = await import('@scripts/features/repo/diffBinary');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    expect(scrollDiffToTop).toHaveBeenCalledTimes(2);
  });

  it('is called on error', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'));
    console.error = vi.fn();
    const { scrollDiffToTop } = await import('@scripts/features/repo/diffBinary');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    expect(scrollDiffToTop).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Merge button context menu action execution
// ============================================================================
describe('merge button context menu actions', () => {
  it('executes openMergeModal action from context menu', async () => {
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const mergeBtn = mockDiffEl.querySelector('[data-conflict-action="merge"]') as HTMLButtonElement;
    mergeBtn.click();
    await flushPromises();

    const items = (buildCtxMenu as any).mock.calls[0][0];
    const builtInAction = items.find((i: any) => i.label === 'Open built-in merge tool');
    expect(builtInAction).toBeDefined();

    builtInAction.action();
    const { openMergeModal } = await import('@scripts/features/conflicts');
    expect(openMergeModal).toHaveBeenCalled();
  });

  it('executes launchExternalMergeTool action from context menu', async () => {
    const { hasExternalMergeTool } = await import('@scripts/features/conflicts');
    (hasExternalMergeTool as any).mockResolvedValue(true);
    mockInvoke.mockResolvedValue({ path: 'f.txt', ours: 'a', theirs: 'b' });
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    const { renderConflictView } = await import('@scripts/features/repo/diffConflicts');
    await renderConflictView({ path: 'f.txt', status: 'U' });

    const mergeBtn = mockDiffEl.querySelector('[data-conflict-action="merge"]') as HTMLButtonElement;
    mergeBtn.click();
    await flushPromises();

    const items = (buildCtxMenu as any).mock.calls[0][0];
    const customAction = items.find((i: any) => i.label === 'Open custom merge tool');
    expect(customAction).toBeDefined();

    customAction.action();
    const { launchExternalMergeTool } = await import('@scripts/features/conflicts');
    expect(launchExternalMergeTool).toHaveBeenCalledWith('f.txt');
  });
});
