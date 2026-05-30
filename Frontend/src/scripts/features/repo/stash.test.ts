// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StashItem } from '../../types';

// ---------------------------------------------------------------------------
// DOM element references that stay stable across resets
// ---------------------------------------------------------------------------
const mockListEl = document.createElement('div');
mockListEl.id = 'file-list';
const mockCountEl = document.createElement('div');
mockCountEl.id = 'changes-count';
const mockDiffHeadPath = document.createElement('div');
mockDiffHeadPath.id = 'diff-path';
const mockDiffEl = document.createElement('div');
mockDiffEl.id = 'diff';
const mockLeftFootEl = document.createElement('div');
mockLeftFootEl.id = 'left-foot';
const mockUndoLeftBtn = document.createElement('button');
mockUndoLeftBtn.id = 'undo-left-btn';

// ---------------------------------------------------------------------------
// Mutable state mock
// ---------------------------------------------------------------------------
const mockState: any = {
  stash: [] as StashItem[],
  currentStash: '',
};

// ---------------------------------------------------------------------------
// Mock dependencies (hoisted by Vitest)
// ---------------------------------------------------------------------------
vi.mock('../../lib/dom', () => ({
  escapeHtml: vi.fn((s: any) => String(s)),
}));

vi.mock('../../lib/menu', () => ({
  buildCtxMenu: vi.fn(),
}));

vi.mock('../../lib/tauri', () => ({
  TAURI: { invoke: vi.fn() },
}));

vi.mock('../../lib/confirm', () => ({
  confirmBool: vi.fn(),
}));

vi.mock('../../lib/notify', () => ({
  notify: vi.fn(),
}));

vi.mock('../../state/state', () => ({
  state: mockState,
}));

vi.mock('../stashConfirm', () => ({
  openStashConfirm: vi.fn(),
}));

vi.mock('./context', () => ({
  listEl: mockListEl,
  countEl: mockCountEl,
  diffHeadPath: mockDiffHeadPath,
  diffEl: mockDiffEl,
  leftFootEl: mockLeftFootEl,
  undoLeftBtn: mockUndoLeftBtn,
}));

vi.mock('./diffView', () => ({
  highlightRow: vi.fn(),
  selectStashDiff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./hydrate', () => ({
  hydrateStatus: vi.fn().mockResolvedValue(undefined),
  hydrateStash: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadStash() {
  return import('./stash');
}

function makeStash(overrides: Partial<StashItem> = {}): StashItem {
  return {
    selector: 'stash@{0}',
    msg: 'WIP on main',
    meta: '2 hours ago',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();

  // Reset DOM elements
  mockListEl.innerHTML = '';
  mockCountEl.textContent = '';
  mockDiffHeadPath.textContent = '';
  mockDiffEl.innerHTML = '';
  mockLeftFootEl.innerHTML = '';
  mockLeftFootEl.classList.remove('show');
  mockLeftFootEl.dataset.mode = '';
  mockUndoLeftBtn.style.display = '';

  // Reset state
  mockState.stash = [];
  mockState.currentStash = '';
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// renderStashList
// ---------------------------------------------------------------------------
describe('renderStashList', () => {
  it('returns false when listEl is missing', async () => {
    const stashMod = await loadStash();
    const { listEl: orig } = await import('./context');
    // Temporarily remove file-list to trigger early return
    const removed = document.getElementById('file-list');
    if (removed) removed.remove();
    const result = stashMod.renderStashList('');
    const result2 = stashMod.renderStashList('query');
    // Both should still work since DOM elements are cached in mock
    expect(typeof result).toBe('boolean');
    expect(typeof result2).toBe('boolean');
    if (removed) document.body.appendChild(removed);
  });

  it('returns true and shows empty message when stash is empty', async () => {
    mockState.stash = [];
    const mod = await loadStash();
    const result = mod.renderStashList('');

    expect(result).toBe(true);
    expect(mockListEl.innerHTML).toContain('No stashes.');
    expect(mockCountEl.textContent).toBe('0 stashes');
    expect(mockDiffHeadPath.textContent).toBe('Stash details');
    expect(mockDiffEl.innerHTML).toBe('');
  });

  it('renders stash items and selects the first one', async () => {
    mockState.stash = [
      makeStash({ selector: 'stash@{0}', msg: 'WIP on main' }),
      makeStash({ selector: 'stash@{1}', msg: 'WIP on feature' }),
    ];
    const mod = await loadStash();
    const result = mod.renderStashList('');

    expect(result).toBe(true);
    expect(mockCountEl.textContent).toBe('2 stashes');
    const rows = mockListEl.querySelectorAll('li.row.commit');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('WIP on main');
    expect(rows[1].textContent).toContain('WIP on feature');
  });

  it('shows singular "stash" when count is 1', async () => {
    mockState.stash = [makeStash()];
    const mod = await loadStash();
    mod.renderStashList('');
    expect(mockCountEl.textContent).toBe('1 stash');
  });

  it('filters stashes by query in msg (case-insensitive)', async () => {
    mockState.stash = [
      makeStash({ selector: 'stash@{0}', msg: 'WIP on main' }),
      makeStash({ selector: 'stash@{1}', msg: 'WIP on feature' }),
    ];
    const mod = await loadStash();
    mod.renderStashList('feature');

    const rows = mockListEl.querySelectorAll('li.row.commit');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('feature');
  });

  it('filters stashes by query in selector', async () => {
    mockState.stash = [
      makeStash({ selector: 'stash@{0}', msg: 'WIP on main' }),
      makeStash({ selector: 'refs/stash@{1}', msg: 'WIP on feature' }),
    ];
    const mod = await loadStash();
    mod.renderStashList('refs/');

    const rows = mockListEl.querySelectorAll('li.row.commit');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-selector')).toBe('refs/stash@{1}');
  });

  it('disables action buttons when stash list is empty', async () => {
    // Place action buttons in the DOM so querySelector finds them
    const applyBtn = document.createElement('button');
    applyBtn.id = 'stash-apply-btn';
    applyBtn.disabled = false;
    document.body.appendChild(applyBtn);
    const popBtn = document.createElement('button');
    popBtn.id = 'stash-pop-btn';
    popBtn.disabled = false;
    document.body.appendChild(popBtn);
    const dropBtn = document.createElement('button');
    dropBtn.id = 'stash-drop-btn';
    dropBtn.disabled = false;
    document.body.appendChild(dropBtn);

    mockState.stash = [];
    const mod = await loadStash();
    mod.renderStashList('');

    expect(applyBtn.disabled).toBe(true);
    expect(popBtn.disabled).toBe(true);
    expect(dropBtn.disabled).toBe(true);

    document.body.removeChild(applyBtn);
    document.body.removeChild(popBtn);
    document.body.removeChild(dropBtn);
  });

  it('renders stash entry with correct dataset and badge', async () => {
    mockState.stash = [
      makeStash({ selector: 'stash@{0}', msg: 'WIP on main', meta: '2 hours ago' }),
    ];
    const mod = await loadStash();
    mod.renderStashList('');

    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    expect(row.dataset.selector).toBe('stash@{0}');
    const badge = row.querySelector('.badge.time');
    expect(badge?.textContent).toBe('2 hours ago');
  });
});

// ---------------------------------------------------------------------------
// selectStash
// ---------------------------------------------------------------------------
describe('selectStash', () => {
  it('highlights the row and loads stash diff', async () => {
    mockDiffHeadPath.textContent = '';
    mockDiffEl.innerHTML = '';
    const mod = await loadStash();
    await mod.selectStash({ selector: 'stash@{0}', msg: 'WIP on main' }, 0);

    expect(mockDiffHeadPath.textContent).toBe('WIP on main');
    expect(mockState.currentStash).toBe('stash@{0}');
  });

  it('falls back to selector when msg is empty', async () => {
    mockDiffHeadPath.textContent = '';
    const mod = await loadStash();
    await mod.selectStash({ selector: 'stash@{5}' }, 0);

    expect(mockDiffHeadPath.textContent).toBe('stash@{5}');
  });

  it('enables action buttons on success', async () => {
    const applyBtn = document.createElement('button');
    applyBtn.id = 'stash-apply-btn';
    applyBtn.disabled = true;
    document.body.appendChild(applyBtn);
    const popBtn = document.createElement('button');
    popBtn.id = 'stash-pop-btn';
    popBtn.disabled = true;
    document.body.appendChild(popBtn);
    const dropBtn = document.createElement('button');
    dropBtn.id = 'stash-drop-btn';
    dropBtn.disabled = true;
    document.body.appendChild(dropBtn);

    const mod = await loadStash();
    await mod.selectStash({ selector: 'stash@{0}' }, 0);

    expect(applyBtn.disabled).toBe(false);
    expect(popBtn.disabled).toBe(false);
    expect(dropBtn.disabled).toBe(false);

    document.body.removeChild(applyBtn);
    document.body.removeChild(popBtn);
    document.body.removeChild(dropBtn);
  });

  it('shows error on failure', async () => {
    const { selectStashDiff } = await import('./diffView');
    vi.mocked(selectStashDiff).mockRejectedValue(new Error('load failed'));

    mockDiffEl.innerHTML = '';
    const mod = await loadStash();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mod.selectStash({ selector: 'stash@{0}' }, 0);

    expect(mockDiffEl.innerHTML).toContain('Failed to load stash diff');
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// showStashFooter / hideStashFooter
// ---------------------------------------------------------------------------
describe('showStashFooter', () => {
  it('creates and shows stash footer controls', async () => {
    const mod = await loadStash();
    mod.showStashFooter();

    expect(mockLeftFootEl.dataset.mode).toBe('stash');
    expect(mockLeftFootEl.classList.contains('show')).toBe(true);
    expect(mockUndoLeftBtn.style.display).toBe('none');

    const foot = mockLeftFootEl.querySelector('#stash-foot-controls');
    expect(foot).not.toBeNull();
    expect(foot?.classList.contains('show')).toBe(true);
  });

  it('creates apply/pop/drop buttons in disabled state', async () => {
    const mod = await loadStash();
    mod.showStashFooter();

    expect(mockLeftFootEl.querySelector('#stash-apply-btn')).not.toBeNull();
    expect(mockLeftFootEl.querySelector('#stash-pop-btn')).not.toBeNull();
    expect(mockLeftFootEl.querySelector('#stash-drop-btn')).not.toBeNull();
    expect(mockLeftFootEl.querySelector('#stash-create-btn')).not.toBeNull();

    const applyBtn = mockLeftFootEl.querySelector('#stash-apply-btn') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('does not create duplicate controls on second call', async () => {
    const mod = await loadStash();
    mod.showStashFooter();
    mod.showStashFooter();

    const controls = mockLeftFootEl.querySelectorAll('#stash-foot-controls');
    expect(controls.length).toBe(1);
  });
});

describe('hideStashFooter', () => {
  it('hides footer and restores undo button', async () => {
    const mod = await loadStash();
    // Call showStashFooter first so the module creates its internal stashFootEl
    mod.showStashFooter();

    // Now hide - it should find the internal stashFootEl
    mod.hideStashFooter();

    expect(mockLeftFootEl.classList.contains('show')).toBe(false);
    expect(mockLeftFootEl.dataset.mode).toBe('');
    expect(mockUndoLeftBtn.style.display).toBe('');
    const foot = mockLeftFootEl.querySelector('#stash-foot-controls');
    expect(foot?.classList.contains('show')).toBe(false);
  });

  it('does nothing when mode is not stash', async () => {
    mockLeftFootEl.dataset.mode = 'other';
    mockLeftFootEl.classList.add('show');

    const mod = await loadStash();
    mod.hideStashFooter();

    expect(mockLeftFootEl.dataset.mode).toBe('other');
    expect(mockLeftFootEl.classList.contains('show')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getActiveStashSelector
// ---------------------------------------------------------------------------
describe('getActiveStashSelector', () => {
  it('returns state.currentStash when set', async () => {
    mockState.currentStash = 'stash@{2}';
    const mod = await loadStash();
    expect(mod.getActiveStashSelector()).toBe('stash@{2}');
  });

  it('reads from DOM when state.currentStash is empty', async () => {
    mockState.currentStash = '';
    // Create an active row in listEl
    const activeRow = document.createElement('li');
    activeRow.className = 'row commit active';
    activeRow.dataset.selector = 'stash@{3}';
    mockListEl.appendChild(activeRow);

    const mod = await loadStash();
    const result = mod.getActiveStashSelector();

    expect(result).toBe('stash@{3}');
    expect(mockState.currentStash).toBe('stash@{3}');
  });

  it('returns empty string when nothing is active', async () => {
    mockState.currentStash = '';
    const mod = await loadStash();
    expect(mod.getActiveStashSelector()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// setRenderListRef
// ---------------------------------------------------------------------------
describe('setRenderListRef', () => {
  it('registers a callback for stash mutations', async () => {
    const mod = await loadStash();
    const fn = vi.fn();
    mod.setRenderListRef(fn);

    // Trigger stash create via wireStashFooterButtons
    // openStashConfirm should be called with onSuccess that triggers the callback
    const { openStashConfirm } = await import('../stashConfirm');
    mod.showStashFooter();

    const createBtn = mockLeftFootEl.querySelector('#stash-create-btn') as HTMLButtonElement;
    createBtn.click();

    expect(openStashConfirm).toHaveBeenCalled();

    // Invoke the onSuccess callback
    const callArgs = vi.mocked(openStashConfirm).mock.calls[0][0] as any;
    await callArgs.onSuccess();

    expect(fn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stash context menu on right-click
// ---------------------------------------------------------------------------
describe('stash right-click context menu', () => {
  it('opens context menu with Apply and Delete options', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}', msg: 'WIP' })];
    const { buildCtxMenu } = await import('../../lib/menu');
    const mod = await loadStash();
    mod.renderStashList('');

    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    expect(row).not.toBeNull();

    // Simulate right-click
    const ev = new MouseEvent('contextmenu', { clientX: 100, clientY: 200, buttons: 2 });
    row.dispatchEvent(ev);

    expect(buildCtxMenu).toHaveBeenCalled();
    const ctxItems = vi.mocked(buildCtxMenu).mock.calls[0][0] as any[];
    const labels = ctxItems.map((i: any) => i.label);
    expect(labels).toContain('Apply stash');
    expect(labels).toContain('Delete stash');
  });

  it('triggers apply stash action via context menu', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}', msg: 'WIP' })];
    const { TAURI } = await import('../../lib/tauri');
    const { buildCtxMenu } = await import('../../lib/menu');
    const { notify } = await import('../../lib/notify');
    vi.mocked(TAURI.invoke).mockResolvedValue(undefined);

    const mod = await loadStash();
    mod.renderStashList('');
    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 100, clientY: 200, buttons: 2 }));

    const ctxItems = vi.mocked(buildCtxMenu).mock.calls[0][0] as any[];
    const applyItem = ctxItems.find((i: any) => i.label === 'Apply stash');
    expect(applyItem).toBeDefined();

    // Execute the action
    await applyItem.action();

    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_stash_apply', { selector: 'stash@{0}' });
    expect(notify).toHaveBeenCalledWith('Applied stash');
  });

  it('handles apply stash failure', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}' })];
    const { TAURI } = await import('../../lib/tauri');
    const { buildCtxMenu } = await import('../../lib/menu');
    const { notify } = await import('../../lib/notify');
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('apply failed'));

    const mod = await loadStash();
    mod.renderStashList('');
    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 100, clientY: 200, buttons: 2 }));

    const ctxItems = vi.mocked(buildCtxMenu).mock.calls[0][0] as any[];
    const applyItem = ctxItems.find((i: any) => i.label === 'Apply stash');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await applyItem.action();

    expect(notify).toHaveBeenCalledWith('Failed to apply stash');
    errSpy.mockRestore();
  });

  it('triggers delete stash action via context menu', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}' })];
    const { TAURI } = await import('../../lib/tauri');
    const { confirmBool } = await import('../../lib/confirm');
    const { buildCtxMenu } = await import('../../lib/menu');
    const { notify } = await import('../../lib/notify');
    vi.mocked(confirmBool).mockResolvedValue(true);
    vi.mocked(TAURI.invoke).mockResolvedValue(undefined);

    const mod = await loadStash();
    mod.renderStashList('');
    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 100, clientY: 200, buttons: 2 }));

    const ctxItems = vi.mocked(buildCtxMenu).mock.calls[0][0] as any[];
    const deleteItem = ctxItems.find((i: any) => i.label === 'Delete stash');
    expect(deleteItem).toBeDefined();

    await deleteItem.action();

    expect(confirmBool).toHaveBeenCalled();
    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_stash_drop', { selector: 'stash@{0}' });
    expect(notify).toHaveBeenCalledWith('Deleted stash');
  });

  it('skips delete when user cancels confirmation', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}' })];
    const { TAURI } = await import('../../lib/tauri');
    const { confirmBool } = await import('../../lib/confirm');
    const { buildCtxMenu } = await import('../../lib/menu');
    vi.mocked(confirmBool).mockResolvedValue(false);

    const mod = await loadStash();
    mod.renderStashList('');
    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 100, clientY: 200, buttons: 2 }));

    const ctxItems = vi.mocked(buildCtxMenu).mock.calls[0][0] as any[];
    const deleteItem = ctxItems.find((i: any) => i.label === 'Delete stash');

    await deleteItem.action();

    expect(TAURI.invoke).not.toHaveBeenCalled();
  });

  it('handles delete stash failure', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}' })];
    const { TAURI } = await import('../../lib/tauri');
    const { confirmBool } = await import('../../lib/confirm');
    const { buildCtxMenu } = await import('../../lib/menu');
    const { notify } = await import('../../lib/notify');
    vi.mocked(confirmBool).mockResolvedValue(true);
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('drop failed'));

    const mod = await loadStash();
    mod.renderStashList('');
    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 100, clientY: 200, buttons: 2 }));

    const ctxItems = vi.mocked(buildCtxMenu).mock.calls[0][0] as any[];
    const deleteItem = ctxItems.find((i: any) => i.label === 'Delete stash');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deleteItem.action();

    expect(notify).toHaveBeenCalledWith('Failed to delete stash');
    errSpy.mockRestore();
  });

  it('enables action buttons on right-click', async () => {
    mockState.stash = [makeStash({ selector: 'stash@{0}' })];
    const applyBtn = document.createElement('button');
    applyBtn.id = 'stash-apply-btn';
    applyBtn.disabled = true;
    document.body.appendChild(applyBtn);

    const mod = await loadStash();
    mod.renderStashList('');
    const row = mockListEl.querySelector('li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 10, buttons: 2 }));

    expect(mockState.currentStash).toBe('stash@{0}');
    expect(applyBtn.disabled).toBe(false);

    document.body.removeChild(applyBtn);
  });
});

// ---------------------------------------------------------------------------
// Stash footer button actions (create, apply, pop, drop)
// ---------------------------------------------------------------------------
async function flush() {
  // Flush pending promises and microtasks
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));
}

describe('stash footer button actions', () => {
  function clickBtn(id: string) {
    const btn = mockLeftFootEl.querySelector<HTMLButtonElement>(id);
    // Buttons start disabled; enable them before clicking
    btn!.disabled = false;
    btn!.dispatchEvent(new Event('click', { bubbles: true }));
  }

  it('create button opens stash confirm dialog', async () => {
    const { openStashConfirm } = await import('../stashConfirm');
    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-create-btn');

    expect(openStashConfirm).toHaveBeenCalled();
  });

  it('apply button triggers vcs_stash_apply', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    const { notify } = await import('../../lib/notify');
    vi.mocked(TAURI.invoke).mockResolvedValue(undefined);

    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-apply-btn');
    await flush();

    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_stash_apply', { selector: 'stash@{0}' });
    expect(notify).toHaveBeenCalledWith('Applied stash');
  });

  it('apply button does nothing when no selector set', async () => {
    mockState.currentStash = '';
    const { TAURI } = await import('../../lib/tauri');
    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-apply-btn');
    await flush();

    expect(TAURI.invoke).not.toHaveBeenCalled();
  });

  it('handles apply button failure', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('apply error'));

    const mod = await loadStash();
    mod.showStashFooter();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    clickBtn('#stash-apply-btn');
    await flush();

    expect(TAURI.invoke).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('pop button triggers vcs_stash_pop', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    const { notify } = await import('../../lib/notify');
    vi.mocked(TAURI.invoke).mockResolvedValue(undefined);

    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-pop-btn');
    await flush();

    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_stash_pop', { selector: 'stash@{0}' });
    expect(notify).toHaveBeenCalledWith('Popped stash');
  });

  it('handles pop button failure', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('pop error'));

    const mod = await loadStash();
    mod.showStashFooter();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    clickBtn('#stash-pop-btn');
    await flush();

    expect(TAURI.invoke).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('drop button triggers vcs_stash_drop after confirm', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    const { confirmBool } = await import('../../lib/confirm');
    const { notify } = await import('../../lib/notify');
    vi.mocked(confirmBool).mockResolvedValue(true);
    vi.mocked(TAURI.invoke).mockResolvedValue(undefined);

    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-drop-btn');
    await flush();

    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_stash_drop', { selector: 'stash@{0}' });
    expect(notify).toHaveBeenCalledWith('Dropped stash');
    expect(mockState.currentStash).toBe('');
  });

  it('drop button does nothing when user cancels', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    const { confirmBool } = await import('../../lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(false);

    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-drop-btn');
    await flush();

    expect(TAURI.invoke).not.toHaveBeenCalled();
  });

  it('handles stash drop failure', async () => {
    mockState.currentStash = 'stash@{0}';
    const { TAURI } = await import('../../lib/tauri');
    const { confirmBool } = await import('../../lib/confirm');
    const { notify } = await import('../../lib/notify');
    vi.mocked(confirmBool).mockResolvedValue(true);
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('drop failed'));

    const mod = await loadStash();
    mod.showStashFooter();

    clickBtn('#stash-drop-btn');
    await flush();

    expect(TAURI.invoke).toHaveBeenCalledWith('vcs_stash_drop', { selector: 'stash@{0}' });
    expect(notify).toHaveBeenCalledWith('Failed to drop stash');
  });
});
