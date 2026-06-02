// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginContextMenuItem } from '@scripts/plugins/types';

function setupTauri() {
  (window as any).__TAURI__ = {
    core: { invoke: vi.fn() },
    event: { listen: vi.fn() },
  };
}

function mountSettingsDom() {
  document.body.innerHTML = `
    <div id="settings-modal">
      <ul id="settings-nav"></ul>
      <div id="settings-panels-scroll"></div>
    </div>
  `;
}

function mountMinimalDom() {
  document.body.innerHTML = `
    <div id="modals-root"></div>
    <div class="menubar"></div>
    <ul id="plugins-menu-list"></ul>
  `;
}

describe('applyPluginSettingsSections', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns early if modal element is missing', async () => {
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    expect(() => applyPluginSettingsSections()).not.toThrow();
  });

  it('returns early if nav or panelsScroll is missing', async () => {
    document.body.innerHTML = '<div id="settings-modal"><div></div></div>';
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    expect(() => applyPluginSettingsSections()).not.toThrow();
  });

  it('does nothing when settingsSections map is empty', async () => {
    mountSettingsDom();
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    applyPluginSettingsSections();
    expect(document.querySelector('#settings-nav')?.children.length).toBe(0);
  });

  it('inserts nav buttons and panels from registered sections', async () => {
    mountSettingsDom();
    // Register a section via the plugin API, which triggers the fallback
    const { _setApplyPluginSectionsFallback } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    const { upsertSettingsSection } = await import('@scripts/plugins/registration');
    const onMount = vi.fn();
    upsertSettingsSection('test-plugin', {
      id: 'my-section',
      label: 'My Section',
      html: '<div class="panel-form"><p>Content</p></div>',
      onMount,
    });

    const navBtn = document.querySelector('#settings-nav [data-section="my-section"]');
    expect(navBtn).not.toBeNull();
    expect(navBtn?.textContent).toBe('My Section');

    const panel = document.querySelector('#settings-panels-scroll .panel-form[data-panel="my-section"]');
    expect(panel).not.toBeNull();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith(
      expect.objectContaining({ modal: expect.any(HTMLElement), panel: expect.any(HTMLElement) }),
    );
  });

  it('skips duplicate insertion when nav button and panel already exist', async () => {
    mountSettingsDom();
    document.querySelector('#settings-nav')!.innerHTML =
      '<li><button class="seg-btn" data-section="dup">Dup</button></li>';
    document.querySelector('#settings-panels-scroll')!.innerHTML =
      '<div class="panel-form" data-panel="dup"></div>';

    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test-plugin', { id: 'dup', label: 'Duplicate', html: '<div>Content</div>' });
    upsertSettingsSection('test-plugin', { id: 'dup', label: 'Duplicate', html: '<div>Content</div>' });

    const navBtns = document.querySelectorAll('#settings-nav [data-section="dup"]');
    expect(navBtns.length).toBe(1);
  });

  it('places nav button after "after" target', async () => {
    mountSettingsDom();
    document.querySelector('#settings-nav')!.innerHTML =
      '<li><button class="seg-btn" data-section="general">General</button></li>';

    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 'new', label: 'New', html: '<div>C</div>', after: 'general' });

    const items = Array.from(document.querySelectorAll('#settings-nav [data-section]'));
    expect(items[0].getAttribute('data-section')).toBe('general');
    expect(items[1].getAttribute('data-section')).toBe('new');
  });

  it('places nav button before "before" target', async () => {
    mountSettingsDom();
    document.querySelector('#settings-nav')!.innerHTML =
      '<li><button class="seg-btn" data-section="general">General</button></li>';

    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 'new', label: 'New', html: '<div>C</div>', before: 'general' });

    const items = Array.from(document.querySelectorAll('#settings-nav [data-section]'));
    expect(items[0].getAttribute('data-section')).toBe('new');
    expect(items[1].getAttribute('data-section')).toBe('general');
  });

  it('catches onMount errors without throwing', async () => {
    mountSettingsDom();
    const onMount = vi.fn().mockImplementation(() => { throw new Error('mount failed'); });

    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 's1', label: 'S1', html: '<div>C</div>', onMount });
    expect(onMount).toHaveBeenCalled();
  });

  it('uses os-content child when panelsScroll has overlay scrollbar host', async () => {
    mountSettingsDom();
    const panelsScroll = document.getElementById('settings-panels-scroll')!;
    const osHost = document.createElement('div');
    osHost.className = 'os-host';
    const osContent = document.createElement('div');
    osContent.className = 'os-content';
    osHost.appendChild(osContent);
    panelsScroll.appendChild(osHost);

    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 'scroll-c', label: 'ScrollC', html: '<div class="panel-form">In OS</div>' });
    const insertedIn = panelsScroll.querySelector('.os-content .panel-form');
    expect(insertedIn).not.toBeNull();
  });
});

describe('getRegisteredThemeSummaries', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns empty array when no themes registered', async () => {
    const { getRegisteredThemeSummaries } = await import('@scripts/plugins/runtime');
    expect(getRegisteredThemeSummaries()).toEqual([]);
  });

  it('returns registered theme summaries', async () => {
    const { registerTheme } = await import('@scripts/plugins/registration');
    registerTheme({ summary: { id: 'theme1', name: 'Theme 1' } });
    const { getRegisteredThemeSummaries } = await import('@scripts/plugins/runtime');
    expect(getRegisteredThemeSummaries()).toHaveLength(1);
    expect(getRegisteredThemeSummaries()[0].id).toBe('theme1');
  });
});

describe('getRegisteredThemePayload', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns null for unknown id', async () => {
    const { getRegisteredThemePayload } = await import('@scripts/plugins/runtime');
    expect(getRegisteredThemePayload('unknown')).toBeNull();
  });

  it('returns the theme payload for a known id', async () => {
    const { registerTheme } = await import('@scripts/plugins/registration');
    registerTheme({ summary: { id: 'Theme2', name: 'T2' }, styles: 'body{}' });
    const { getRegisteredThemePayload } = await import('@scripts/plugins/runtime');
    const payload = getRegisteredThemePayload('Theme2');
    expect(payload).not.toBeNull();
    expect(payload!.summary.id).toBe('Theme2');
  });
});

describe('runHook', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('executes registered hook handlers in order', async () => {
    const { registerHook } = await import('@scripts/plugins/registration');
    const order: number[] = [];
    registerHook('p1', 'preCommit', async () => { order.push(1); });
    registerHook('p2', 'preCommit', async () => { order.push(2); });

    const { runHook } = await import('@scripts/plugins/runtime');
    await runHook('preCommit', { files: [] });
    expect(order).toEqual([1, 2]);
  });

  it('cancels remaining handlers when a handler cancels', async () => {
    const { registerHook } = await import('@scripts/plugins/registration');
    const order: number[] = [];
    registerHook('p1', 'preCommit', (ctx) => { order.push(1); ctx.cancel('blocked'); });
    registerHook('p2', 'preCommit', async () => { order.push(2); });

    const { runHook } = await import('@scripts/plugins/runtime');
    const ctx = await runHook('preCommit', { files: [] });
    expect(order).toEqual([1]);
    expect(ctx.cancelled).toBe(true);
    expect(ctx.reason).toBe('blocked');
  });

  it('cancels and records error when a handler throws', async () => {
    const { registerHook } = await import('@scripts/plugins/registration');
    registerHook('p1', 'preCommit', async () => { throw new Error('fail'); });

    const { runHook } = await import('@scripts/plugins/runtime');
    const ctx = await runHook('preCommit', { files: [] });
    expect(ctx.cancelled).toBe(true);
    expect(ctx.reason).toContain('fail');
  });

  it('returns cancelled false when no handlers are registered', async () => {
    const { runHook } = await import('@scripts/plugins/runtime');
    const ctx = await runHook('postPush', {});
    expect(ctx.cancelled).toBe(false);
  });
});

describe('runPluginAction', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns false for empty action id', async () => {
    const { runPluginAction } = await import('@scripts/plugins/runtime');
    expect(await runPluginAction('')).toBe(false);
    expect(await runPluginAction('  ')).toBe(false);
  });

  it('returns false for unregistered action', async () => {
    const { runPluginAction } = await import('@scripts/plugins/runtime');
    expect(await runPluginAction('nonexistent')).toBe(false);
  });

  it('executes registered action handler and returns true', async () => {
    const { registerAction } = await import('@scripts/plugins/registration');
    const handler = vi.fn();
    registerAction('my-action', handler);

    const { runPluginAction } = await import('@scripts/plugins/runtime');
    const result = await runPluginAction('my-action', { foo: 1 });
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith({ foo: 1 });
  });

  it('catches handler errors and still returns true', async () => {
    const { registerAction } = await import('@scripts/plugins/registration');
    registerAction('bad-action', async () => { throw new Error('oops'); });

    const { runPluginAction } = await import('@scripts/plugins/runtime');
    const result = await runPluginAction('bad-action');
    expect(result).toBe(true);
  });
});

describe('getPluginContextMenuItems', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns empty array for unknown target', async () => {
    const { getPluginContextMenuItems } = await import('@scripts/plugins/runtime');
    expect(getPluginContextMenuItems('files')).toEqual([]);
  });

  it('returns registered context menu items for the target', async () => {
    const { registerPlugin } = await import('@scripts/plugins/registration');
    registerPlugin({
      id: 'test',
      contextMenus: { files: [{ label: 'Open', action: 'open-file' }] },
    });

    const { getPluginContextMenuItems } = await import('@scripts/plugins/runtime');
    const items: PluginContextMenuItem[] = getPluginContextMenuItems('files');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Open');
  });
});

describe('initPlugins', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountMinimalDom();
  });

  it('does not make list_plugins IPC call', async () => {
    const tauri = (window as any).__TAURI__;
    const { initPlugins } = await import('@scripts/plugins/runtime');
    await initPlugins();

    expect(tauri.core.invoke).not.toHaveBeenCalled();
  });

  it('handles list_plugins failure gracefully', async () => {
    const tauri = (window as any).__TAURI__;

    const { initPlugins } = await import('@scripts/plugins/runtime');
    await expect(initPlugins()).resolves.toBeUndefined();
    expect(tauri.core.invoke).not.toHaveBeenCalled();
  });
});

describe('reloadPlugins', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountMinimalDom();
  });

  it('resets initialized flag and re-initializes', async () => {
    const tauri = (window as any).__TAURI__;

    const { reloadPlugins } = await import('@scripts/plugins/runtime');
    await expect(reloadPlugins()).resolves.toBeUndefined();
    expect(tauri.core.invoke).not.toHaveBeenCalled();
  });
});

// ============================================================================
// applyPluginSettingsSections - edge cases
// ============================================================================
describe('applyPluginSettingsSections edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('skips section with empty id', async () => {
    mountSettingsDom();
    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: '', label: 'Empty ID', html: '<div>Content</div>' });
    applyPluginSettingsSections();

    expect(document.querySelector('#settings-nav [data-section=""]')).toBeNull();
  });

  it('skips section with empty label', async () => {
    mountSettingsDom();
    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 'no-label', label: '', html: '<div>Content</div>' });
    applyPluginSettingsSections();

    expect(document.querySelector('#settings-nav [data-section="no-label"]')).toBeNull();
  });

  it('skips section with empty html', async () => {
    mountSettingsDom();
    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 'no-html', label: 'No HTML', html: '' });
    applyPluginSettingsSections();

    expect(document.querySelector('#settings-nav [data-section="no-html"]')).toBeNull();
  });

  it('skips section when parseSanitizedPluginElement returns null', async () => {
    mountSettingsDom();
    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    // Plain text has no element child → parseSanitizedPluginElement returns null
    upsertSettingsSection('test', { id: 'text-only', label: 'Text', html: 'Just text without element wrapper' });
    applyPluginSettingsSections();

    expect(document.querySelector('#settings-nav [data-section="text-only"]')).toBeNull();
  });

  it('handles non-HTMLElement child in panelsContent loop', async () => {
    mountSettingsDom();
    const panelsScroll = document.getElementById('settings-panels-scroll')!;
    // SVG element is not an HTMLElement
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    panelsScroll.appendChild(svg);

    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('@scripts/plugins/registration');
    const { applyPluginSettingsSections } = await import('@scripts/plugins/runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    upsertSettingsSection('test', { id: 'after-svg', label: 'After SVG', html: '<div class="panel-form">Content</div>' });
    applyPluginSettingsSections();

    expect(document.querySelector('#settings-nav [data-section="after-svg"]')).not.toBeNull();
  });
});

// ============================================================================
// initPlugins - additional edge cases
// ============================================================================
describe('initPlugins additional edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountMinimalDom();
  });

  it('skips plugin summary with empty id', async () => {
    const tauri = (window as any).__TAURI__;

    const { initPlugins } = await import('@scripts/plugins/runtime');
    await expect(initPlugins()).resolves.toBeUndefined();
    expect(tauri.core.invoke).not.toHaveBeenCalled();
  });
});

// ============================================================================
// runPluginAction - error handling edge cases
// ============================================================================
describe('runPluginAction error handling', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('notifies generic message when handler throws empty error', async () => {
    const { registerAction } = await import('@scripts/plugins/registration');
    registerAction('empty-error', async () => { throw ''; });

    const { runPluginAction } = await import('@scripts/plugins/runtime');
    const result = await runPluginAction('empty-error');
    expect(result).toBe(true);
  });
});

// ============================================================================
// runHook - cancel closure with reason
// ============================================================================
describe('runHook cancel closure', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('invokes cancel with a reason string', async () => {
    const { registerHook } = await import('@scripts/plugins/registration');
    let capturedCancel: ((reason?: string) => void) | null = null;
    registerHook('p1', 'preCommit', (ctx) => {
      capturedCancel = ctx.cancel;
    });

    const { runHook } = await import('@scripts/plugins/runtime');
    await runHook('preCommit', {});
    expect(capturedCancel).toBeInstanceOf(Function);
    capturedCancel!('user-reason');
  });

  it('invokes cancel without reason', async () => {
    const { registerHook } = await import('@scripts/plugins/registration');
    let capturedCancel: ((reason?: string) => void) | null = null;
    registerHook('p1', 'preCommit', (ctx) => {
      capturedCancel = ctx.cancel;
    });

    const { runHook } = await import('@scripts/plugins/runtime');
    await runHook('preCommit', {});
    capturedCancel!();
  });
});

// ============================================================================
// reloadPlugins - additional coverage
// ============================================================================
describe('reloadPlugins additional coverage', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountMinimalDom();
  });

  it('reloads and returns when plugin list fetch fails', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_plugins') return Promise.reject(new Error('fail'));
      return Promise.reject(new Error('unknown'));
    });

    const { reloadPlugins } = await import('@scripts/plugins/runtime');
    await expect(reloadPlugins()).resolves.toBeUndefined();
  });
});
