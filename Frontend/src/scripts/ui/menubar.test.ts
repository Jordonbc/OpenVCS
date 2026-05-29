// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/tauri', () => ({
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
    const { TAURI } = await import('../lib/tauri');
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

    const { refreshPluginMenubarMenus } = await import('./menubar');
    await refreshPluginMenubarMenus();

    const injected = document.querySelectorAll('[data-plugin-menubar="true"]');
    expect(injected).toHaveLength(2);
    const pluginButton = document.querySelector('[data-plugin-action="plugin-open"]') as HTMLButtonElement;
    expect(pluginButton.textContent).toBe('Plugin Open');
    expect(document.querySelectorAll('[data-plugin-action="open-repo"]')).toHaveLength(0);
    expect(document.querySelector('[data-plugin-action="settings-only"]')).toBeNull();
  });

  it('clears prior plugin menu entries before re-rendering', async () => {
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);
    document.querySelector('.menu-list')?.insertAdjacentHTML(
      'beforeend',
      '<button data-plugin-menubar="true">Old Plugin</button>',
    );

    const { refreshPluginMenubarMenus } = await import('./menubar');
    await refreshPluginMenubarMenus();

    expect(document.querySelector('[data-plugin-menubar="true"]')).toBeNull();
  });

  it('returns quietly when runtime is unavailable or invoke fails', async () => {
    const tauri = await import('../lib/tauri');
    vi.mocked(tauri.isTauriRuntimeAvailable).mockReturnValueOnce(false);

    const { refreshPluginMenubarMenus } = await import('./menubar');
    await expect(refreshPluginMenubarMenus()).resolves.toBeUndefined();

    vi.mocked(tauri.isTauriRuntimeAvailable).mockReturnValueOnce(true);
    vi.mocked(tauri.TAURI.invoke).mockRejectedValueOnce(new Error('boom'));
    await expect(refreshPluginMenubarMenus()).resolves.toBeUndefined();
  });
});

describe('initMenubar', () => {
  it('opens, dispatches menu actions, and closes on escape', async () => {
    const onAction = vi.fn();
    const { initMenubar } = await import('./menubar');
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
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      {
        plugin_id: 'plugin.alpha',
        id: 'file',
        label: 'File',
        surface: 'menubar',
        elements: [{ type: 'button', id: 'plugin-open', label: 'Plugin Open' }],
      },
    ]);
    const { initMenubar, refreshPluginMenubarMenus } = await import('./menubar');
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
    const { initMenubar } = await import('./menubar');
    initMenubar(vi.fn());

    const triggers = document.querySelectorAll('.menu-trigger');
    (triggers[0] as HTMLButtonElement).click();
    triggers[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    const lists = document.querySelectorAll('.menu-list');
    expect((lists[0] as HTMLElement).getAttribute('hidden')).toBe('');
    expect((lists[1] as HTMLElement).hasAttribute('hidden')).toBe(false);
  });

  it('toggles the same menu closed when its trigger is clicked twice', async () => {
    const { initMenubar } = await import('./menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    trigger.click();
    vi.runAllTimers();

    expect(document.querySelector('.menu-list')?.getAttribute('hidden')).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes an open menu when clicking outside the menubar', async () => {
    const { initMenubar } = await import('./menubar');
    initMenubar(vi.fn());

    const trigger = document.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();

    expect(document.querySelector('.menu-list')?.getAttribute('hidden')).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('cancels pending close animation when opening another menu', async () => {
    const { initMenubar } = await import('./menubar');
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
    const { initMenubar } = await import('./menubar');
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

    const { initMenubar } = await import('./menubar');
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

    const { initMenubar } = await import('./menubar');
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
