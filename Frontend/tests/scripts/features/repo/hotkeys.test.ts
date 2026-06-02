// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies (hoisted by Vitest)
// ---------------------------------------------------------------------------
const mockFilterInput = document.createElement('input');
mockFilterInput.id = 'filter';

vi.mock('@scripts/features/repo/context', () => ({
  filterInput: mockFilterInput,
}));

const mockState = {
  selectedFiles: new Set<string>(),
  diffSelectedFiles: new Set<string>(),
};
vi.mock('@scripts/state/state', () => ({
  state: mockState,
  prefs: { tab: 'changes' },
  disableDefaultSelectAll: vi.fn(),
}));

const mockGetVisibleFiles = vi.fn();
vi.mock('@scripts/features/repo/selectionState', () => ({
  getVisibleFiles: mockGetVisibleFiles,
}));

const mockToggleSelectAll = vi.fn();
vi.mock('@scripts/features/repo/interactions', () => ({
  toggleSelectAll: mockToggleSelectAll,
}));

const mockRenderList = vi.fn();
vi.mock('@scripts/features/repo/list', () => ({
  renderList: mockRenderList,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadHotkeys() {
  return import('@scripts/features/repo/hotkeys');
}

function fireKeydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  mockFilterInput.value = '';

  // Clean up any modals from previous tests
  document.querySelectorAll('.modal').forEach((el) => {
    el.remove();
  });
  document.getElementById('about-modal')?.remove();

  // Mock document.activeElement
  Object.defineProperty(document, 'activeElement', {
    writable: true,
    configurable: true,
    value: document.body,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// bindRepoHotkeys
// ---------------------------------------------------------------------------
describe('bindRepoHotkeys', () => {
  it('calls fetchAction on F5', async () => {
    const fetchAction = vi.fn();
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn(), fetchAction);

    fireKeydown('F5');
    expect(fetchAction).toHaveBeenCalled();
  });

  it('handles F5 with no fetchAction (noop)', async () => {
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('F5');
    // Should not throw
  });

  it('prevents default on F5', async () => {
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn(), vi.fn());

    const event = fireKeydown('F5');
    // defaultPrevented should be true
    expect(event.defaultPrevented).toBe(true);
  });

  it('focuses filter input on Ctrl+F', async () => {
    const focusSpy = vi.spyOn(mockFilterInput, 'focus').mockImplementation(() => {});
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('f', { ctrlKey: true });
    expect(focusSpy).toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it('focuses filter input on Cmd+F', async () => {
    const focusSpy = vi.spyOn(mockFilterInput, 'focus').mockImplementation(() => {});
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('f', { metaKey: true });
    expect(focusSpy).toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it('calls openSwitchDrawer on Ctrl+R', async () => {
    const openSwitchDrawer = vi.fn();
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, openSwitchDrawer);

    fireKeydown('r', { ctrlKey: true });
    expect(openSwitchDrawer).toHaveBeenCalled();
  });

  it('calls openSwitchDrawer on Cmd+R', async () => {
    const openSwitchDrawer = vi.fn();
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, openSwitchDrawer);

    fireKeydown('r', { metaKey: true });
    expect(openSwitchDrawer).toHaveBeenCalled();
  });

  it('clicks commit button on Ctrl+Enter', async () => {
    const commitBtn = document.createElement('button');
    const clickSpy = vi.spyOn(commitBtn, 'click').mockImplementation(() => {});
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(commitBtn, vi.fn());

    fireKeydown('Enter', { ctrlKey: true });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('prevents default on Ctrl+Enter', async () => {
    const commitBtn = document.createElement('button');
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(commitBtn, vi.fn());

    const event = fireKeydown('Enter', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it('selects all files on Ctrl+A when not in editable', async () => {
    const { disableDefaultSelectAll, prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.selectedFiles = new Set(['a.js']);
    const visibleFiles = [{ path: 'a.js' as string }, { path: 'b.js' as string }];
    mockGetVisibleFiles.mockReturnValue(visibleFiles);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { ctrlKey: true });

    expect(disableDefaultSelectAll).toHaveBeenCalled();
    expect(mockToggleSelectAll).toHaveBeenCalledWith(true, visibleFiles);
    expect(mockRenderList).toHaveBeenCalled();
  });

  it('deselects all files on Ctrl+A when all are already selected', async () => {
    const { prefs, state } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    state.selectedFiles = new Set(['a.js', 'b.js']);
    const visibleFiles = [{ path: 'a.js' as string }, { path: 'b.js' as string }];
    mockGetVisibleFiles.mockReturnValue(visibleFiles);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { ctrlKey: true });

    expect(mockToggleSelectAll).toHaveBeenCalledWith(false, visibleFiles);
  });

  it('does nothing on Ctrl+A when inside editable element', async () => {
    const editable = document.createElement('input');
    Object.defineProperty(document, 'activeElement', {
      writable: true,
      configurable: true,
      value: editable,
    });

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { ctrlKey: true });

    expect(mockToggleSelectAll).not.toHaveBeenCalled();
  });

  it('does nothing on Ctrl+A when modal is open', async () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'false');
    document.body.appendChild(modal);

    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { ctrlKey: true });

    expect(mockToggleSelectAll).not.toHaveBeenCalled();
    document.body.removeChild(modal);
  });

  it('does nothing on Ctrl+A when tab is not changes', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { ctrlKey: true });

    expect(mockToggleSelectAll).not.toHaveBeenCalled();
  });

  it('does nothing on Ctrl+A when no visible files', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    mockGetVisibleFiles.mockReturnValue([]);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { ctrlKey: true });

    expect(mockToggleSelectAll).not.toHaveBeenCalled();
  });

  it('selects all files for diff viewing on Shift+A', async () => {
    mockState.diffSelectedFiles = new Set();
    const visibleFiles = [{ path: 'a.js' as string }, { path: 'b.js' as string }];
    mockGetVisibleFiles.mockReturnValue(visibleFiles);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    const event = fireKeydown('a', { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(mockRenderList).toHaveBeenCalled();
  });

  it('deselects all diff-selected files on Shift+A when all are selected', async () => {
    mockState.diffSelectedFiles = new Set(['a.js', 'b.js']);
    const visibleFiles = [{ path: 'a.js' as string }, { path: 'b.js' as string }];
    mockGetVisibleFiles.mockReturnValue(visibleFiles);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    const event = fireKeydown('a', { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(mockRenderList).toHaveBeenCalled();
  });

  it('does nothing on Shift+A when tab is not changes', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'history';

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { shiftKey: true });

    expect(mockRenderList).not.toHaveBeenCalled();
  });

  it('does nothing on Shift+A when no visible files', async () => {
    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    mockGetVisibleFiles.mockReturnValue([]);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('a', { shiftKey: true });

    expect(mockRenderList).not.toHaveBeenCalled();
  });

  it('does nothing on Shift+A when modal is open', async () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'false');
    document.body.appendChild(modal);

    const { prefs } = await import('@scripts/state/state');
    prefs.tab = 'changes';
    mockGetVisibleFiles.mockReturnValue([{ path: 'a.js' as string }]);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    const event = fireKeydown('a', { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(mockRenderList).not.toHaveBeenCalled();
    document.body.removeChild(modal);
  });

  it('dismisses about-modal on Escape', async () => {
    const aboutModal = document.createElement('div');
    aboutModal.id = 'about-modal';
    aboutModal.classList.add('show');
    document.body.appendChild(aboutModal);

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    fireKeydown('Escape');

    expect(aboutModal.classList.contains('show')).toBe(false);
    document.body.removeChild(aboutModal);
  });

  it('handles Escape when about-modal is not present', async () => {
    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());
    // Should not throw
    fireKeydown('Escape');
  });

  it('handles rejected fetchAction on F5 without unhandled promise', async () => {
    const mod = await loadHotkeys();
    const fetchAction = vi.fn().mockRejectedValue(new Error('fetch failed'));
    mod.bindRepoHotkeys(null, vi.fn(), fetchAction);

    await fireKeydown('F5');
    // The catch handler should swallow the rejection
  });

  it('handles null activeElement on keydown', async () => {
    mockGetVisibleFiles.mockReturnValue([]);
    Object.defineProperty(document, 'activeElement', {
      writable: true,
      configurable: true,
      value: null,
    });

    const mod = await loadHotkeys();
    mod.bindRepoHotkeys(null, vi.fn());

    expect(() => fireKeydown('a', { ctrlKey: true })).not.toThrow();
  });
});
