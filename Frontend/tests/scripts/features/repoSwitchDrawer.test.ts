// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();
const mockHydrate = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));

vi.mock('@scripts/ui/modals', () => ({
  openModal: mockOpenModal,
  closeModal: mockCloseModal,
  hydrate: mockHydrate,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockInvoke.mockReset();
  mockNotify.mockReset();
  mockOpenModal.mockReset();
  mockCloseModal.mockReset();
  mockHydrate.mockReset();
  document.body.innerHTML = `
    <div id="app">
      <button id="repo-switch">Switch</button>
    </div>
  `;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountDrawerInBody() {
  document.body.innerHTML = `
    <div id="app">
      <button id="repo-switch">Switch</button>
    </div>
    <div id="repo-switch-drawer" class="modal">
      <div class="dialog drawer">
        <ul id="drawer-recent-list"></ul>
        <input id="drawer-filter" />
        <button id="drawer-add-trigger">Add</button>
      </div>
    </div>
  `;
}

describe('openSwitchDrawer', () => {
  it('hydrates and opens the drawer', async () => {
    mountDrawerInBody();

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    expect(mockHydrate).toHaveBeenCalledWith('repo-switch-drawer');
    expect(mockOpenModal).toHaveBeenCalledWith('repo-switch-drawer');
  });

  it('loads recents on open and renders them', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      { path: '/repo/one', name: 'One' },
      { path: '/repo/two' },
    ]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      const list = document.getElementById('drawer-recent-list')!;
      expect(list.children.length).toBe(2);
      expect(list.textContent).toContain('One');
      expect(list.textContent).toContain('/repo/two');
    });
  });

  it('filters recents by name', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      { path: '/repo/alpha' },
      { path: '/repo/beta' },
    ]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(2);
    });

    const filter = document.getElementById('drawer-filter') as HTMLInputElement;
    filter.value = 'alpha';
    filter.dispatchEvent(new Event('input'));

    expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    expect(document.getElementById('drawer-recent-list')!.textContent).toContain('alpha');
  });

  it('shows empty message when no recents match filter', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      { path: '/repo/alpha' },
    ]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });

    const filter = document.getElementById('drawer-filter') as HTMLInputElement;
    filter.value = 'nonexistent';
    filter.dispatchEvent(new Event('input'));

    const list = document.getElementById('drawer-recent-list')!;
    expect(list.children.length).toBe(1);
    expect(list.textContent).toContain('No matching repositories');
  });

  it('handles loadRecents rejection gracefully', async () => {
    mountDrawerInBody();
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      const list = document.getElementById('drawer-recent-list')!;
      expect(list.textContent).toContain('No matching repositories');
    });
  });

  it('filters out invalid recent entries', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      null,
      { path: '' },
      { path: '/valid' },
    ]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      const list = document.getElementById('drawer-recent-list')!;
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain('/valid');
    });
  });

  it('clicking a recent opens the repo', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      { path: '/repo/one' },
    ]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });

    const item = document.querySelector('[data-path]') as HTMLElement;
    item.click();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_repo', { path: '/repo/one' });
      expect(mockCloseModal).toHaveBeenCalled();
    });
  });

  it('clicking a recent that fails shows notify', async () => {
    mountDrawerInBody();
    mockInvoke
      .mockResolvedValueOnce([{ path: '/repo/one' }])
      .mockRejectedValueOnce(new Error('fail'));

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });

    const item = document.querySelector('[data-path]') as HTMLElement;
    item.click();

    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Open failed');
    });
  });

  it('pressing Enter or Space on a recent opens the repo', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      { path: '/repo/one' },
    ]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      const list = document.getElementById('drawer-recent-list')!;
      expect(list.children.length).toBe(1);
    });

    const item = document.querySelector('[data-path]') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_repo', { path: '/repo/one' });
    });
  });

  it('pressing other keys on a recent does nothing', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([{ path: '/repo/one' }]);

    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();

    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });

    const item = document.querySelector('[data-path]') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(mockInvoke).not.toHaveBeenCalledWith('open_repo', { path: '/repo/one' });
  });
});

describe('closeSwitchDrawer', () => {
  it('closes the drawer immediately with reduced motion', async () => {
    mountDrawerInBody();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
    } as any));

    const { openSwitchDrawer, closeSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    closeSwitchDrawer();

    expect(mockCloseModal).toHaveBeenCalledWith('repo-switch-drawer');
  });

  it('animates close without reduced motion', async () => {
    mountDrawerInBody();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
    } as any));

    const { openSwitchDrawer, closeSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    closeSwitchDrawer();

    const drawer = document.getElementById('repo-switch-drawer')!;
    expect(drawer.classList.contains('is-closing')).toBe(true);
    expect(mockCloseModal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(130);

    expect(drawer.classList.contains('is-closing')).toBe(false);
    expect(mockCloseModal).toHaveBeenCalledWith('repo-switch-drawer');
  });

  it('is a no-op when drawerRoot is null', async () => {
    const { closeSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    expect(() => closeSwitchDrawer()).not.toThrow();
  });
});

describe('registerDrawerActions', () => {
  it('stores openClone callback', async () => {
    const openClone = vi.fn();
    const openAdd = vi.fn();

    const { registerDrawerActions, openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    registerDrawerActions({ openClone, openAdd });

    mountDrawerInBody();
    mockInvoke.mockResolvedValue([]);

    openSwitchDrawer();
    const addBtn = document.getElementById('drawer-add-trigger') as HTMLButtonElement;
    addBtn.click();

    expect(openClone).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureDrawer - edge cases
// ---------------------------------------------------------------------------

describe('ensureDrawer edge cases', () => {
  it('handles missing drawer root gracefully', async () => {
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    document.body.innerHTML = '<div id="app"><button id="repo-switch">Switch</button></div>';
    openSwitchDrawer();
    // Should not throw despite missing drawer element
  });

  it('handles missing filter input', async () => {
    document.body.innerHTML = `
      <div id="app"><button id="repo-switch">Switch</button></div>
      <div id="repo-switch-drawer" class="modal">
        <div class="dialog drawer">
          <ul id="drawer-recent-list"></ul>
          <button id="drawer-add-trigger">Add</button>
        </div>
      </div>
    `;
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    // Should not throw despite missing filter input
  });
});

// ---------------------------------------------------------------------------
// openSwitchDrawer - clears closeTimer
// ---------------------------------------------------------------------------

describe('openSwitchDrawer clears closeTimer', () => {
  it('clears existing closeTimer', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([]);
    const { openSwitchDrawer, closeSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');

    // First close with animation to set the timer
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
    } as any));
    openSwitchDrawer();
    closeSwitchDrawer();

    // Now open while timer is active
    openSwitchDrawer();
    const drawer = document.getElementById('repo-switch-drawer')!;
    expect(drawer.classList.contains('is-closing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// closeSwitchDrawer - animate close clears timer
// ---------------------------------------------------------------------------

describe('closeSwitchDrawer animate close', () => {
  it('handles closeTimer already set during close', async () => {
    mountDrawerInBody();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
    } as any));

    const { openSwitchDrawer, closeSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    closeSwitchDrawer();
    closeSwitchDrawer(); // second call - should still work

    const drawer = document.getElementById('repo-switch-drawer')!;
    expect(drawer.classList.contains('is-closing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderRecents - edge cases
// ---------------------------------------------------------------------------

describe('renderRecents edge cases', () => {
  it('renders fallback when path split returns empty basename', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([{ path: '/' }]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    await vi.waitFor(() => {
      const list = document.getElementById('drawer-recent-list')!;
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain('/');
    });
  });

  it('filters recents by path when name does not match', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([
      { path: '/home/user/projects/secret-project', name: 'My Project' },
    ]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });
    const filter = document.getElementById('drawer-filter') as HTMLInputElement;
    filter.value = 'secret';
    filter.dispatchEvent(new Event('input'));
    // Item should still be visible because path includes 'secret'
    expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
  });

  it('click on list but not on item row does not open', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([{ path: '/repo/one' }]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });
    const list = document.getElementById('drawer-recent-list')!;
    list.click();
    expect(mockInvoke).not.toHaveBeenCalledWith('open_repo', expect.anything());
  });

  it('keyboard Enter on list but not on item row does not open', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([{ path: '/repo/one' }]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });
    const list = document.getElementById('drawer-recent-list')!;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mockInvoke).not.toHaveBeenCalledWith('open_repo', expect.anything());
  });

  it('keyboard Space on list but not on item row does not open', async () => {
    mountDrawerInBody();
    mockInvoke.mockResolvedValue([{ path: '/repo/one' }]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    openSwitchDrawer();
    await vi.waitFor(() => {
      expect(document.getElementById('drawer-recent-list')!.children.length).toBe(1);
    });
    const list = document.getElementById('drawer-recent-list')!;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(mockInvoke).not.toHaveBeenCalledWith('open_repo', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// positionDrawer - edge cases
// ---------------------------------------------------------------------------

describe('positionDrawer edge cases', () => {
  it('handles missing anchor element', async () => {
    mountDrawerInBody();
    document.getElementById('repo-switch')?.remove();
    mockInvoke.mockResolvedValue([]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    expect(() => openSwitchDrawer()).not.toThrow();
  });

  it('handles missing drawer dialog element', async () => {
    document.body.innerHTML = `
      <div id="app"><button id="repo-switch">Switch</button></div>
      <div id="repo-switch-drawer" class="modal"></div>
    `;
    mockInvoke.mockResolvedValue([]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    expect(() => openSwitchDrawer()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadRecents - missing recentList
// ---------------------------------------------------------------------------

describe('loadRecents with missing list', () => {
  it('handles missing recentList element', async () => {
    document.body.innerHTML = `
      <div id="app"><button id="repo-switch">Switch</button></div>
      <div id="repo-switch-drawer" class="modal">
        <div class="dialog drawer">
          <input id="drawer-filter" />
          <button id="drawer-add-trigger">Add</button>
        </div>
      </div>
    `;
    mockInvoke.mockResolvedValue([{ path: '/repo/one' }]);
    const { openSwitchDrawer } = await import('@scripts/features/repoSwitchDrawer');
    expect(() => openSwitchDrawer()).not.toThrow();
  });
});
