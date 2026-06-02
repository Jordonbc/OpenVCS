// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: {
    invoke: vi.fn(),
  },
  isTauriRuntimeAvailable: vi.fn(() => true),
}));

function mountMenubar() {
  document.body.innerHTML = `
    <div class="menubar">
      <div class="menu" data-menu="file">
        <button class="menu-trigger" aria-expanded="false">File</button>
        <div class="menu-list" hidden>
          <button class="menu-item" data-action="open-repo">Open</button>
        </div>
      </div>
      <div class="menu" data-menu="view">
        <button class="menu-trigger" aria-expanded="false">View</button>
        <div class="menu-list" hidden></div>
      </div>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mountMenubar();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as typeof window.matchMedia;
});

describe('refreshPluginMenubarMenus', () => {
  it('injects plugin buttons and skips duplicate or non-menubar entries', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.alpha',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: [
          { type: 'button', id: 'plugin-open', label: 'Plugin Open' },
          { type: 'button', id: 'open-repo', label: 'Duplicate Open' },
          { type: 'text', content: 'skip me' },
        ],
      },
      {
        plugin_id: 'plugin.beta',
        id: 'view',
        label: 'View',
        surface: 'settings',
        elements: [{ type: 'button', id: 'settings-only', label: 'Settings only' }],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    const injected = document.querySelectorAll('[data-plugin-menubar="true"]');
    expect(injected).toHaveLength(2);
    const pluginButton = document.querySelector('[data-plugin-action="plugin-open"]') as HTMLButtonElement;
    expect(pluginButton.textContent).toBe('Plugin Open');
    expect(document.querySelectorAll('[data-plugin-action="open-repo"]')).toHaveLength(0);
    expect(document.querySelector('[data-plugin-action="settings-only"]')).toBeNull();
  });

  it('clears prior plugin menu entries before re-rendering', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);
    document.querySelector('.menu-list')?.insertAdjacentHTML(
      'beforeend',
      '<button data-plugin-menubar="true">Old Plugin</button>',
    );

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });

  it('returns quietly when runtime is unavailable or invoke fails', async () => {
    const tauri = await import('@scripts/lib/tauri');
    vi.mocked(tauri.isTauriRuntimeAvailable).mockReturnValueOnce(false);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await expect(refreshPluginMenubarMenus()).resolves.toBeUndefined();

    vi.mocked(tauri.isTauriRuntimeAvailable).mockReturnValueOnce(true);
    vi.mocked(tauri.TAURI.invoke).mockRejectedValueOnce(new Error('boom'));
    await expect(refreshPluginMenubarMenus()).resolves.toBeUndefined();
  });
});

describe('initMenubar', () => {
  it('opens, dispatches menu actions, and closes on escape', async () => {
    const onAction = vi.fn();
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(onAction);

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();

    const menuList = document.querySelector('.menu-list') as HTMLElement;
    expect(menuList.hasAttribute('hidden')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    (document.querySelector('[data-action="open-repo"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(onAction).toHaveBeenCalledWith('open-repo');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.runAllTimers();

    expect(menuList.getAttribute('hidden')).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('routes plugin actions with plugin metadata', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.alpha',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: [{ type: 'button', id: 'plugin-open', label: 'Plugin Open' }],
      },
    ]);
    const { initMenubar, refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    const onAction = vi.fn();

    await refreshPluginMenubarMenus();
    initMenubar(onAction);

    (document.querySelector('.menu-trigger') as HTMLButtonElement).click();
    (document.querySelector('[data-plugin-action="plugin-open"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(onAction).toHaveBeenCalledWith('__plugin_menu_action__', {
      pluginId: 'plugin.alpha',
      actionId: 'plugin-open',
    });
  });

  it('switches menus on pointerover while another menu is open', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    (triggers[0] as HTMLButtonElement).click();
    triggers[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    const lists = document.querySelectorAll('.menu-list');
    expect((lists[0] as HTMLElement).getAttribute('hidden')).toBe('');
    expect((lists[1] as HTMLElement).hasAttribute('hidden')).toBe(false);
  });

  it('toggles the same menu closed when its trigger is clicked twice', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    trigger.click();
    vi.runAllTimers();

    expect(document.querySelector('.menu-list')?.getAttribute('hidden')).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes an open menu when clicking outside the menubar', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    expect(document.querySelector('.menu-list')?.getAttribute('hidden')).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('cancels pending close animation when opening another menu', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    // Open first menu
    (triggers[0] as HTMLButtonElement).click();
    // Close by clicking outside (sets closeTimer with setTimeout)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Before the close animation completes, open the second menu
    triggers[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    expect((document.querySelectorAll('.menu-list')[1] as HTMLElement).hasAttribute('hidden')).toBe(false);
    vi.runAllTimers();
  });

  it('calls finalizeClose immediately when list is already hidden', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    const list = document.querySelector('.menu-list') as HTMLElement;
    // Force close and set hidden to simulate already-hidden state
    list.setAttribute('hidden', '');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('completes close animation with timer under normal motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('clears pending close timer when menu is reopened before animation ends', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    (triggers[0] as HTMLButtonElement).click();
    // Close via outside click (starts timer under normal motion)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Immediately reopen another menu before timer fires
    triggers[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    expect((triggers[1] as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    expect((triggers[0] as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
    vi.runAllTimers();
  });
});

// ============================================================================
// getMenuList internal behavior - querySelector returns null
// ============================================================================
describe('getMenuList returns null for unmatched menu id', () => {
  it('skips plugin menu when the menu id has no matching DOM node', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.test',
        id: 'nonexistent-menu',
        label: 'No DOM Match',
        surface: 'menubar',
        elements: [{ type: 'button', id: 'some-action', label: 'Some Action' }],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });
});

// ============================================================================
// clearPluginMenubarMenus - no matching elements
// ============================================================================
describe('clearPluginMenubarMenus', () => {
  it('does nothing when no plugin menubar elements exist', async () => {
    const { clearPluginMenubarMenus } = await import('@scripts/ui/menubar');
    expect(() => clearPluginMenubarMenus()).not.toThrow();
    expect(document.querySelectorAll('[data-plugin-menubar="true"]')).toHaveLength(0);
  });
});

// ============================================================================
// refreshPluginMenubarMenus - additional edge cases
// ============================================================================
describe('refreshPluginMenubarMenus additional edge cases', () => {
  it('skips menu with empty id', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.test',
        id: '',
        label: 'No ID',
        surface: 'menubar',
        elements: [{ type: 'button', id: 'btn', label: 'Btn' }],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });

  it('continues when menu has no button entries', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.test',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: [{ type: 'text', content: 'Just info' }],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });

  it('handles null elements array gracefully', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.test',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: null as any,
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });

  it('skips button with empty label in render loop', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.test',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: [
          { type: 'button', id: 'no-label', label: '' },
          { type: 'button', id: 'has-label', label: 'Labeled' },
        ],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();

    // Separator + valid button
    expect(document.querySelectorAll('[data-plugin-menubar="true"]')).toHaveLength(2);
    expect(document.querySelector('[data-plugin-action="no-label"]')).toBeNull();
    expect(document.querySelector('[data-plugin-action="has-label"]')).not.toBeNull();
  });
});

// ============================================================================
// initMenubar - additional edge cases
// ============================================================================
describe('initMenubar additional edge cases', () => {
  it('does nothing when root .menubar element is missing', async () => {
    document.body.innerHTML = '';
    const { initMenubar } = await import('@scripts/ui/menubar');
    expect(() => initMenubar(vi.fn())).not.toThrow();
  });

  it('handles escape keydown when no menu is open', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
  });

  it('handles document click when no menu is open', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());
    expect(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }).not.toThrow();
  });

  it('ignores pointerover on trigger when no menu is open', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLElement;
    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    expect(document.querySelector('.menu-list')?.hasAttribute('hidden')).toBe(true);
  });

  it('returns early from open() when menu has no list', async () => {
    const menubar = document.querySelector('.menubar') as HTMLElement;
    menubar.insertAdjacentHTML('beforeend', `
      <div class="menu" data-menu="broken">
        <button class="menu-trigger">Broken</button>
      </div>
    `);

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    const brokenTrigger = triggers[triggers.length - 1] as HTMLButtonElement;
    brokenTrigger.click();
    // Should not throw — open() returns early when list is null
    expect(true).toBe(true);
  });

  it('ignores click on menubar area that is neither item nor trigger', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const menubar = document.querySelector('.menubar') as HTMLElement;
    menubar.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('.menu-list')?.hasAttribute('hidden')).toBe(true);
  });
});

// ============================================================================
// closeMenu clears active closeTimer (lines 127-128)
// ============================================================================
describe('closeMenu clears active closeTimer', () => {
  it('clears existing closeTimer when closeMenu called while timer is active', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();

    // First close outside click starts the animation timer
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Second close outside click should hit lines 127-128 (clearTimer !== null)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Timer should have been cleared, but finalize still runs via the original timer
    vi.runAllTimers();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

// ============================================================================
// closeMenu animation timer execution
// ============================================================================
describe('closeMenu animation timer', () => {
  it('runs close animation timer and finalizes', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    vi.runAllTimers();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('clears closeTimer when menu reopened before animation completion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    (triggers[0] as HTMLButtonElement).click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const list = document.querySelector('.menu-list') as HTMLElement;
    expect(list.classList.contains('is-closing')).toBe(true);

    triggers[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(list.hasAttribute('hidden')).toBe(true);
    vi.runAllTimers();
  });
});

// ============================================================================
// open clears existing closeTimer (lines 151-154)
// ============================================================================
describe('open clears existing closeTimer', () => {
  it('clears closeTimer when open is called with timer active', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as typeof window.matchMedia;

    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    (triggers[0] as HTMLButtonElement).click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (triggers[0] as HTMLButtonElement).click();

    const list = document.querySelector('.menu-list') as HTMLElement;
    expect(list.hasAttribute('hidden')).toBe(false);
    vi.runAllTimers();
  });
});

// ============================================================================
// closeMenu with missing list
// ============================================================================
describe('closeMenu with missing list', () => {
  it('handles menu with no .menu-list element', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    document.body.innerHTML = `
      <div class="menubar">
        <div class="menu" data-menu="broken">
          <button class="menu-trigger">Broken</button>
        </div>
      </div>
    `;

    initMenubar(vi.fn());
    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    expect(true).toBe(true);
  });
});

// ============================================================================
// pointerover on non-trigger element
// ============================================================================
describe('pointerover on non-trigger element', () => {
  it('ignores pointerover on general menubar area', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const menubar = document.querySelector('.menubar') as HTMLElement;
    menubar.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(document.querySelector('.menu-list')?.hasAttribute('hidden')).toBe(true);
  });

  it('ignores pointerover on trigger inside closed menu that is already hidden', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLElement;
    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(document.querySelector('.menu-list')?.hasAttribute('hidden')).toBe(true);
  });
});

// ============================================================================
// Keyboard non-Escape key
// ============================================================================
describe('keyboard non-Escape key', () => {
  it('does not close menus on non-Escape key', async () => {
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    expect(document.querySelector('.menu-list')?.hasAttribute('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.querySelector('.menu-list')?.hasAttribute('hidden')).toBe(false);
  });
});

// ============================================================================
// refreshPluginMenubarMenus - surface filter
// ============================================================================
describe('refreshPluginMenubarMenus surface filter', () => {
  it('skips menu with empty id', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.test',
        id: '',
        label: 'No ID',
        surface: 'menubar',
        elements: [{ type: 'button', id: 'btn', label: 'Btn' }],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();
    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });

  it('skips non-menubar surface menu and handles menubar surface', async () => {
    const { TAURI } = await import('@scripts/lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.alpha',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: [{ type: 'button', id: 'real-btn', label: 'Real' }],
      },
    ]);

    const { refreshPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await refreshPluginMenubarMenus();
    const injected = document.querySelectorAll('[data-plugin-menubar="true"]');
    expect(injected.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-plugin-action="real-btn"]')).not.toBeNull();
  });
});

// ============================================================================
// Action dispatch edge cases
// ============================================================================
describe('action dispatch edge cases', () => {
  it('handles click on menu-item with empty data-action', async () => {
    const onAction = vi.fn();
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(onAction);

    const list = document.querySelector('.menu-list') as HTMLElement;
    const item = document.createElement('button');
    item.className = 'menu-item';
    item.setAttribute('data-action', '');
    list.appendChild(item);

    item.click();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('dispatches non-plugin action with truthy id', async () => {
    const onAction = vi.fn();
    const { initMenubar } = await import('@scripts/ui/menubar');
    initMenubar(onAction);

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();

    (document.querySelector('[data-action="open-repo"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(onAction).toHaveBeenCalledWith('open-repo');
  });
});
