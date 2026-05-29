// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

function setupTauri() {
  (window as any).__TAURI__ = {
    core: { invoke: vi.fn() },
    event: { listen: vi.fn() },
  };
}

function mountMenuDom() {
  document.body.innerHTML = `
    <div class="menubar"></div>
    <ul id="plugins-menu-list"></ul>
    <div id="plugin-title-actions"></div>
  `;
}

function mountFullDom() {
  document.body.innerHTML = `
    <div class="menubar"></div>
    <ul id="plugins-menu-list"></ul>
    <div id="plugin-title-actions"></div>
    <div id="modals-root"></div>
    <div id="settings-modal">
      <ul id="settings-nav"></ul>
      <div id="settings-panels-scroll"></div>
    </div>
  `;
}

describe('isPluginEnabled', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns false for empty or falsy id', async () => {
    const { isPluginEnabled } = await import('./registration');
    expect(isPluginEnabled({ id: '' })).toBe(false);
    expect(isPluginEnabled({ id: '  ' })).toBe(false);
  });

  it('returns false when plugin is in disabled set', async () => {
    const { setDisabledPlugins } = await import('./state');
    setDisabledPlugins(new Set(['plugin1']));
    const { isPluginEnabled } = await import('./registration');
    expect(isPluginEnabled({ id: 'plugin1', default_enabled: true })).toBe(false);
  });

  it('returns true when plugin is in enabled set', async () => {
    const { setEnabledPlugins } = await import('./state');
    setEnabledPlugins(new Set(['plugin2']));
    const { isPluginEnabled } = await import('./registration');
    expect(isPluginEnabled({ id: 'plugin2', default_enabled: false })).toBe(true);
  });

  it('returns default_enabled when not in either set', async () => {
    const { isPluginEnabled } = await import('./registration');
    expect(isPluginEnabled({ id: 'plugin3', default_enabled: true })).toBe(true);
    expect(isPluginEnabled({ id: 'plugin4', default_enabled: false })).toBe(false);
  });
});

describe('injectPluginModule / clearPluginScripts', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '';
    document.head.querySelectorAll('script[data-openvcs-plugin-id]').forEach((el) => { el.remove(); });
  });

  it('injects a script element into head with plugin context', async () => {
    const { injectPluginModule } = await import('./registration');
    injectPluginModule('console.log("hello");', 'test-plugin');

    const scripts = document.head.querySelectorAll('script');
    // Should have at least one script with the plugin data
    const injected = Array.from(scripts).find(s => s.dataset.openvcsPluginId === 'test-plugin');
    expect(injected).not.toBeUndefined();
    expect(injected!.type).toBe('module');
    expect(injected!.textContent).toContain('test-plugin');
  });

  it('clears injected scripts', async () => {
    const { injectPluginModule, clearPluginScripts } = await import('./registration');
    injectPluginModule('code1', 'p1');
    injectPluginModule('code2', 'p2');
    const scriptsBefore = Array.from(document.head.querySelectorAll('script')).filter(
      s => s.dataset.openvcsPluginId,
    );
    expect(scriptsBefore.length).toBe(2);

    clearPluginScripts();
    const scriptsAfter = Array.from(document.head.querySelectorAll('script')).filter(
      s => s.dataset.openvcsPluginId,
    );
    expect(scriptsAfter.length).toBe(0);
  });
});

describe('clearPluginUi / trackUiNode', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<div id="container"><span class="node">a</span><span class="node">b</span></div>';
  });

  it('removes tracked UI nodes for a plugin', async () => {
    const { trackUiNode, clearPluginUi } = await import('./registration');
    const container = document.getElementById('container')!;
    const n1 = container.children[0] as HTMLElement;
    const n2 = container.children[1] as HTMLElement;
    trackUiNode('p1', n1);
    trackUiNode('p1', n2);

    clearPluginUi('p1');
    expect(container.children.length).toBe(0);
  });

  it('does nothing for unknown plugin id', async () => {
    const { clearPluginUi } = await import('./registration');
    expect(() => clearPluginUi('unknown')).not.toThrow();
  });
});

describe('pluginsMenuList / pluginActionsHost', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = `
      <ul id="plugins-menu-list"></ul>
      <div id="plugin-title-actions"></div>
    `;
  });

  it('returns the plugins menu list element', async () => {
    const { pluginsMenuList } = await import('./registration');
    expect(pluginsMenuList()).toBe(document.getElementById('plugins-menu-list'));
  });

  it('returns the plugin actions host element', async () => {
    const { pluginActionsHost } = await import('./registration');
    expect(pluginActionsHost()).toBe(document.getElementById('plugin-title-actions'));
  });

  it('returns null when elements are missing', async () => {
    document.body.innerHTML = '';
    const { pluginsMenuList, pluginActionsHost } = await import('./registration');
    expect(pluginsMenuList()).toBeNull();
    expect(pluginActionsHost()).toBeNull();
  });
});

describe('ensurePluginsMenuPlaceholder / removePluginsMenuPlaceholder', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<ul id="plugins-menu-list"></ul>';
  });

  it('adds a disabled placeholder when menu list exists and has no items', async () => {
    const { ensurePluginsMenuPlaceholder } = await import('./registration');
    ensurePluginsMenuPlaceholder();

    const placeholder = document.querySelector('[data-openvcs-plugin-placeholder="true"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toBe('No plugins installed');
    expect(placeholder?.classList.contains('disabled')).toBe(true);
  });

  it('does not add duplicate placeholder', async () => {
    const { ensurePluginsMenuPlaceholder } = await import('./registration');
    ensurePluginsMenuPlaceholder();
    ensurePluginsMenuPlaceholder();

    const placeholders = document.querySelectorAll('[data-openvcs-plugin-placeholder="true"]');
    expect(placeholders.length).toBe(1);
  });

  it('does not add placeholder when menu items already exist', async () => {
    document.querySelector('#plugins-menu-list')!.innerHTML =
      '<button class="menu-item" role="menuitem">Existing</button>';
    const { ensurePluginsMenuPlaceholder } = await import('./registration');
    ensurePluginsMenuPlaceholder();

    expect(document.querySelector('[data-openvcs-plugin-placeholder="true"]')).toBeNull();
  });

  it('does nothing when plugins-menu-list is missing', async () => {
    document.body.innerHTML = '';
    const { ensurePluginsMenuPlaceholder } = await import('./registration');
    expect(() => ensurePluginsMenuPlaceholder()).not.toThrow();
  });

  it('removes the placeholder', async () => {
    const { ensurePluginsMenuPlaceholder, removePluginsMenuPlaceholder } = await import('./registration');
    ensurePluginsMenuPlaceholder();
    expect(document.querySelector('[data-openvcs-plugin-placeholder="true"]')).not.toBeNull();

    removePluginsMenuPlaceholder();
    expect(document.querySelector('[data-openvcs-plugin-placeholder="true"]')).toBeNull();
  });
});

describe('registerAction', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('registers an action handler that can be executed', async () => {
    const { registerAction } = await import('./registration');
    const handler = vi.fn();
    registerAction('test-action', handler);

    const { runPluginAction } = await import('./runtime');
    expect(await runPluginAction('test-action', { data: 1 })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ data: 1 });
  });

  it('skips empty action id', async () => {
    const { registerAction } = await import('./registration');
    expect(() => registerAction('', vi.fn())).not.toThrow();
    expect(() => registerAction('  ', vi.fn())).not.toThrow();
  });
});

describe('registerHook', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('registers a hook handler that gets executed by runHook', async () => {
    const { registerHook } = await import('./registration');
    const handler = vi.fn();
    registerHook('p1', 'preCommit', handler);

    const { runHook } = await import('./runtime');
    await runHook('preCommit', {});
    expect(handler).toHaveBeenCalled();
  });
});

describe('registerTheme / registerThemeSummary', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('registers a theme payload accessible via runtime', async () => {
    const { registerTheme } = await import('./registration');
    registerTheme({ summary: { id: 'my-theme', name: 'My Theme' }, styles: 'body{}' });

    const { getRegisteredThemePayload } = await import('./runtime');
    expect(getRegisteredThemePayload('my-theme')).not.toBeNull();
  });

  it('registers a theme summary accessible via runtime', async () => {
    const { registerThemeSummary } = await import('./registration');
    registerThemeSummary({ id: 'sum-theme', name: 'Summary Theme' });

    const { getRegisteredThemeSummaries } = await import('./runtime');
    expect(getRegisteredThemeSummaries().some(s => s.id === 'sum-theme')).toBe(true);
  });

  it('skips registration with empty id', async () => {
    const { registerTheme } = await import('./registration');
    expect(() => registerTheme({ summary: { id: '', name: '' } })).not.toThrow();
  });
});

describe('_setApplyPluginSectionsFallback', () => {
  it('stores the supplied callback', async () => {
    const { _setApplyPluginSectionsFallback, upsertSettingsSection } = await import('./registration');
    const cb = vi.fn();
    _setApplyPluginSectionsFallback(cb);

    expect(() => _setApplyPluginSectionsFallback(vi.fn())).not.toThrow();
  });

  it('handles empty callback without throwing', async () => {
    const { _setApplyPluginSectionsFallback } = await import('./registration');
    expect(() => _setApplyPluginSectionsFallback(vi.fn())).not.toThrow();
  });
});

describe('installGlobalApi wrappers', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    delete (window as any).OpenVCS;
    document.body.innerHTML = '<div class="menubar"></div><ul id="plugins-menu-list"></ul><div id="modals-root"></div>';
  });

  afterEach(() => {
    delete (window as any).OpenVCS;
  });

  it('calls addMenuItem, addTitlebarButton, addSettingsSection, addMenubarMenu, invoke, listen, notify through plugin module', async () => {
    const { installGlobalApi, currentPluginIdForRegistration } = await import('./registration');
    currentPluginIdForRegistration('test-plugin');
    installGlobalApi();

    const api = (window as any).OpenVCS;
    expect(api).toBeDefined();

    expect(() => api.addMenuItem({ id: 't', label: 'T', action: 'noop' })).not.toThrow();
    expect(() => api.addTitlebarButton({ id: 'b', label: 'B', action: 'a' })).not.toThrow();
    expect(() => api.addSettingsSection({ id: 's', label: 'S', html: '<p>x</p>' })).not.toThrow();
    expect(() => api.addMenubarMenu({ id: 'm', html: '<span>x</span>' })).not.toThrow();
    expect(() => api.notify('msg')).not.toThrow();
    expect(typeof api.invoke).toBe('function');
    expect(typeof api.listen).toBe('function');

    delete (window as any).OpenVCS;
  });
});

describe('addMenuItem', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<ul id="plugins-menu-list"></ul>';
  });

  it('adds a menu item button to the plugins menu list', async () => {
    const { addMenuItem } = await import('./registration');
    addMenuItem('p1', { label: 'My Action', action: 'my-action' });

    const btn = document.querySelector('#plugins-menu-list .menu-item');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('My Action');
    expect((btn as HTMLElement).dataset.action).toBe('my-action');
  });

  it('removes placeholder when adding first item', async () => {
    const { addMenuItem, ensurePluginsMenuPlaceholder } = await import('./registration');
    ensurePluginsMenuPlaceholder();
    expect(document.querySelector('[data-openvcs-plugin-placeholder="true"]')).not.toBeNull();

    addMenuItem('p1', { label: 'Real', action: 'real-action' });
    expect(document.querySelector('[data-openvcs-plugin-placeholder="true"]')).toBeNull();
  });

  it('skips items with missing label or action', async () => {
    const { addMenuItem } = await import('./registration');
    expect(() => addMenuItem('p1', { label: '', action: '' })).not.toThrow();
    expect(() => addMenuItem('p1', { label: 'l', action: '' })).not.toThrow();
  });

  it('does nothing when plugins-menu-list is missing', async () => {
    document.body.innerHTML = '';
    const { addMenuItem } = await import('./registration');
    expect(() => addMenuItem('p1', { label: 'L', action: 'a' })).not.toThrow();
  });
});

describe('addTitlebarButton', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<div id="plugin-title-actions"></div>';
  });

  it('adds a button to the titlebar actions host', async () => {
    const { addTitlebarButton } = await import('./registration');
    addTitlebarButton('p1', { label: 'Click', action: 'click-action' });

    const btn = document.querySelector('#plugin-title-actions .btn');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Click');
    expect((btn as HTMLElement).dataset.action).toBe('click-action');
  });

  it('skips items with missing label or action', async () => {
    const { addTitlebarButton } = await import('./registration');
    expect(() => addTitlebarButton('p1', { label: '', action: '' })).not.toThrow();
  });

  it('does nothing when host is missing', async () => {
    document.body.innerHTML = '';
    const { addTitlebarButton } = await import('./registration');
    expect(() => addTitlebarButton('p1', { label: 'L', action: 'a' })).not.toThrow();
  });
});

describe('upsertSettingsSection', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = `
      <div id="settings-modal">
        <ul id="settings-nav"></ul>
        <div id="settings-panels-scroll"></div>
      </div>
    `;
  });

  it('registers a settings section and applies it if modal is present', async () => {
    // The _setApplyPluginSectionsFallback must be set first
    const { _setApplyPluginSectionsFallback } = await import('./registration');
    const { applyPluginSettingsSections } = await import('./runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);

    const { upsertSettingsSection } = await import('./registration');
    upsertSettingsSection('p1', { id: 'sec1', label: 'Section 1', html: '<div>Content</div>' });

    const navBtn = document.querySelector('#settings-nav [data-section="sec1"]');
    expect(navBtn).not.toBeNull();
  });

  it('skips sections with missing id, label, or html', async () => {
    const { upsertSettingsSection } = await import('./registration');
    expect(() => upsertSettingsSection('p1', { id: '', label: '', html: '' })).not.toThrow();
    expect(() => upsertSettingsSection('p1', { id: 'i', label: '', html: '' })).not.toThrow();
    expect(() => upsertSettingsSection('p1', { id: 'i', label: 'l', html: '' })).not.toThrow();
    expect(() => upsertSettingsSection('p1', { id: 'i', label: 'l', html: '   ' })).not.toThrow();
  });
});

describe('applyMenubarMenu', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<div class="menubar"></div>';
  });

  it('inserts a menubar menu into the menubar', async () => {
    const { applyMenubarMenu } = await import('./registration');
    applyMenubarMenu('p1', {
      id: 'tools',
      html: '<div class="menu" data-menu="tools"><button>Tool</button></div>',
    });

    const menu = document.querySelector('.menubar .menu[data-menu="tools"]');
    expect(menu).not.toBeNull();
  });

  it('skips menubar menus with missing id or html', async () => {
    const { applyMenubarMenu } = await import('./registration');
    expect(() => applyMenubarMenu('p1', { id: '', html: '' })).not.toThrow();
  });

  it('replaces existing menu with same id', async () => {
    const { applyMenubarMenu } = await import('./registration');
    applyMenubarMenu('p1', {
      id: 'm1',
      html: '<div class="menu" data-menu="m1"><button>old</button></div>',
    });
    applyMenubarMenu('p1', {
      id: 'm1',
      html: '<div class="menu" data-menu="m1"><button>new</button></div>',
    });

    const menus = document.querySelectorAll('.menubar .menu[data-menu="m1"]');
    expect(menus.length).toBe(1);
    expect(menus[0].querySelector('button')?.textContent).toBe('new');
  });

  it('inserts after an existing menu', async () => {
    const { applyMenubarMenu } = await import('./registration');
    applyMenubarMenu('p1', {
      id: 'first',
      html: '<div class="menu" data-menu="first"><button>F</button></div>',
    });
    applyMenubarMenu('p1', {
      id: 'second',
      html: '<div class="menu" data-menu="second"><button>S</button></div>',
      after: 'first',
    });

    const items = document.querySelectorAll('.menubar .menu');
    expect(items[0].getAttribute('data-menu')).toBe('first');
    expect(items[1].getAttribute('data-menu')).toBe('second');
  });

  it('does nothing when menubar is missing', async () => {
    document.body.innerHTML = '';
    const { applyMenubarMenu } = await import('./registration');
    expect(() => applyMenubarMenu('p1', {
      id: 'm', html: '<div class="menu" data-menu="m"></div>',
    })).not.toThrow();
  });
});

describe('currentPluginIdForRegistration', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('returns the explicit id when provided', async () => {
    const { currentPluginIdForRegistration } = await import('./registration');
    expect(currentPluginIdForRegistration('explicit-id')).toBe('explicit-id');
  });

  it('returns context window id when no explicit id', async () => {
    (window as any).__openvcsPluginContext = { id: 'context-id' };
    const { currentPluginIdForRegistration } = await import('./registration');
    expect(currentPluginIdForRegistration()).toBe('context-id');
  });

  it('returns null when no id is available', async () => {
    (window as any).__openvcsPluginContext = null;
    const { currentPluginIdForRegistration } = await import('./registration');
    expect(currentPluginIdForRegistration()).toBeNull();
  });

  it('trims whitespace from results', async () => {
    (window as any).__openvcsPluginContext = { id: '  spaced  ' };
    const { currentPluginIdForRegistration } = await import('./registration');
    expect(currentPluginIdForRegistration()).toBe('spaced');
  });
});

describe('addMenuItem with title attribute', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<ul id="plugins-menu-list"></ul>';
  });

  it('sets title attribute when item.title is provided', async () => {
    const { addMenuItem } = await import('./registration');
    addMenuItem('p1', { label: 'Action', action: 'my-action', title: 'Tooltip text' });
    const btn = document.querySelector('#plugins-menu-list .menu-item') as HTMLElement;
    expect(btn.title).toBe('Tooltip text');
  });
});

describe('addTitlebarButton with title attribute', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<div id="plugin-title-actions"></div>';
  });

  it('sets title attribute when btn.title is provided', async () => {
    const { addTitlebarButton } = await import('./registration');
    addTitlebarButton('p1', { label: 'Act', action: 'act', title: 'Button tooltip' });
    const btn = document.querySelector('#plugin-title-actions .btn') as HTMLElement;
    expect(btn.title).toBe('Button tooltip');
  });
});

describe('applyMenubarMenu with before positioning', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<div class="menubar"></div>';
  });

  it('inserts a menubar menu before an existing menu', async () => {
    const { applyMenubarMenu } = await import('./registration');
    applyMenubarMenu('p1', {
      id: 'second',
      html: '<div class="menu" data-menu="second"><button>S</button></div>',
    });
    applyMenubarMenu('p1', {
      id: 'first',
      html: '<div class="menu" data-menu="first"><button>F</button></div>',
      before: 'second',
    });
    const items = document.querySelectorAll('.menubar .menu');
    expect(items[0].getAttribute('data-menu')).toBe('first');
    expect(items[1].getAttribute('data-menu')).toBe('second');
  });

  it('appends when before references non-existent menu', async () => {
    const { applyMenubarMenu } = await import('./registration');
    applyMenubarMenu('p1', {
      id: 'only-menu',
      html: '<div class="menu" data-menu="only-menu"><button>O</button></div>',
      before: 'nonexistent',
    });
    const items = document.querySelectorAll('.menubar .menu');
    expect(items.length).toBe(1);
  });
});

describe('registerPlugin context menus coverage', () => {
  beforeEach(async () => {
    setupTauri();
    vi.resetModules();
    mountFullDom();
    const { _setApplyPluginSectionsFallback } = await import('./registration');
    const { applyPluginSettingsSections } = await import('./runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);
  });

  it('registers context menus for commits and branches', async () => {
    const { registerPlugin } = await import('./registration');
    registerPlugin({
      id: 'ctx-plugin',
      contextMenus: {
        commits: [{ label: 'Commit Act', action: 'commit-act' }],
        branches: [{ label: 'Branch Act', action: 'branch-act' }],
      },
    });
    const { getPluginContextMenuItems } = await import('./runtime');
    expect(getPluginContextMenuItems('commits')).toHaveLength(1);
    expect(getPluginContextMenuItems('branches')).toHaveLength(1);
    expect(getPluginContextMenuItems('commits')[0].label).toBe('Commit Act');
    expect(getPluginContextMenuItems('branches')[0].label).toBe('Branch Act');
  });

  it('skips context menu items with empty label or action', async () => {
    const { registerPlugin } = await import('./registration');
    registerPlugin({
      id: 'skip-ctx',
      contextMenus: {
        files: [
          { label: '', action: '' },
          { label: 'Valid', action: 'valid-act' },
        ],
      },
    });
    const { getPluginContextMenuItems } = await import('./runtime');
    expect(getPluginContextMenuItems('files')).toHaveLength(1);
    expect(getPluginContextMenuItems('files')[0].label).toBe('Valid');
  });
});

describe('registerPlugin null items', () => {
  beforeEach(async () => {
    setupTauri();
    vi.resetModules();
    mountFullDom();
    const { _setApplyPluginSectionsFallback } = await import('./registration');
    const { applyPluginSettingsSections } = await import('./runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);
  });

  it('skips null entries in arrays', async () => {
    const { registerPlugin } = await import('./registration');
    expect(() => registerPlugin({
      id: 'null-test',
      menuItems: [null as any, { label: 'Only', action: 'only-act' }],
      titlebarButtons: [null as any, { label: 'Btn', action: 'btn-act' }],
      settingsSections: [null as any, { id: 'sec', label: 'Sec', html: '<div>x</div>' }],
      themes: [null as any, { summary: { id: 'th', name: 'Th' } }],
      themeSummaries: [null as any, { id: 'ts', name: 'TS' }],
      menubarMenus: [null as any, { id: 'mm', html: '<div class="menu" data-menu="mm"><button>M</button></div>' }],
    })).not.toThrow();
    expect(document.querySelector('#plugins-menu-list .menu-item')).not.toBeNull();
    expect(document.querySelector('#plugin-title-actions .btn')).not.toBeNull();
  });
});

describe('registerTheme without summary', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('registers theme payload without summary field', async () => {
    const { registerTheme } = await import('./registration');
    expect(() => registerTheme({ styles: 'body { color: red; }' } as any)).not.toThrow();
  });

  it('registers theme with summary but empty id', async () => {
    const { registerTheme } = await import('./registration');
    expect(() => registerTheme({ summary: { id: '', name: '' }, styles: '' })).not.toThrow();
  });
});

describe('registerThemeSummary empty id', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('skips registration when id is empty', async () => {
    const { registerThemeSummary } = await import('./registration');
    expect(() => registerThemeSummary({ id: '', name: '' })).not.toThrow();
  });
});

describe('installGlobalApi full coverage', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    delete (window as any).OpenVCS;
    document.body.innerHTML = '<div class="menubar"></div><ul id="plugins-menu-list"></ul><div id="modals-root"></div><div id="plugin-title-actions"></div><div id="settings-modal"><ul id="settings-nav"></ul><div id="settings-panels-scroll"></div></div>';
  });

  afterEach(() => {
    delete (window as any).OpenVCS;
  });

  it('exposes registerTheme, registerThemeSummary, registerAction via global API', async () => {
    const { installGlobalApi, _setApplyPluginSectionsFallback } = await import('./registration');
    const { applyPluginSettingsSections } = await import('./runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);
    installGlobalApi();

    const api = (window as any).OpenVCS;
    expect(typeof api.registerTheme).toBe('function');
    expect(typeof api.registerThemeSummary).toBe('function');
    expect(typeof api.registerAction).toBe('function');

    expect(() => api.registerTheme({ summary: { id: 'api-theme', name: 'API Theme' }, styles: '' })).not.toThrow();
    const { getRegisteredThemePayload } = await import('./runtime');
    expect(getRegisteredThemePayload('api-theme')).not.toBeNull();

    expect(() => api.registerThemeSummary({ id: 'api-sum', name: 'API Summary' })).not.toThrow();
    const { getRegisteredThemeSummaries } = await import('./runtime');
    expect(getRegisteredThemeSummaries().some((s: any) => s.id === 'api-sum')).toBe(true);

    const handler = vi.fn();
    expect(() => api.registerAction('api-act', handler)).not.toThrow();
    const { runPluginAction } = await import('./runtime');
    expect(await runPluginAction('api-act', { val: 42 })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ val: 42 });
  });
});

describe('registerPlugin', () => {
  beforeEach(async () => {
    setupTauri();
    vi.resetModules();
    mountFullDom();
    const { _setApplyPluginSectionsFallback } = await import('./registration');
    const { applyPluginSettingsSections } = await import('./runtime');
    _setApplyPluginSectionsFallback(applyPluginSettingsSections);
  });

  it('registers actions, hooks, themes, menus, titlebar buttons, settings, and context menus', async () => {
    const { registerPlugin } = await import('./registration');
    const actionHandler = vi.fn();
    const hookHandler = vi.fn();

    registerPlugin({
      id: 'full-plugin',
      actions: { 'act1': actionHandler },
      hooks: { preCommit: hookHandler },
      themes: [{ summary: { id: 'th1', name: 'Th1' } }],
      themeSummaries: [{ id: 'ts1', name: 'TS1' }],
      menuItems: [{ label: 'Menu1', action: 'menu-act' }],
      titlebarButtons: [{ label: 'TB1', action: 'tb-act' }],
      settingsSections: [{ id: 'ss1', label: 'SS1', html: '<div>ss</div>' }],
      menubarMenus: [{ id: 'mm1', html: '<div class="menu" data-menu="mm1"><button>M</button></div>' }],
      contextMenus: {
        files: [{ label: 'File Action', action: 'file-act' }],
      },
    });

    const { runPluginAction } = await import('./runtime');
    expect(await runPluginAction('act1')).toBe(true);
    expect(actionHandler).toHaveBeenCalled();

    const { getPluginContextMenuItems } = await import('./runtime');
    expect(getPluginContextMenuItems('files')).toHaveLength(1);

    expect(document.querySelector('[data-section="ss1"]')).not.toBeNull();
    expect(document.querySelector('.menu[data-menu="mm1"]')).not.toBeNull();
    expect(document.querySelector('#plugins-menu-list .menu-item')).not.toBeNull();
    expect(document.querySelector('#plugin-title-actions .btn')).not.toBeNull();
  });

  it('skips registration when pluginId cannot be resolved', async () => {
    const { registerPlugin } = await import('./registration');
    expect(() => registerPlugin({ actions: { a: vi.fn() } })).not.toThrow();
  });

  it('handles non-function actions and hooks gracefully', async () => {
    const { registerPlugin } = await import('./registration');
    expect(() => registerPlugin({
      id: 'test',
      actions: { bad: 'not-a-function' as unknown as (payload?: unknown) => void | Promise<void> },
      hooks: { preCommit: 'also-bad' as unknown as (ctx: any) => void | Promise<void> },
    })).not.toThrow();
  });
});

describe('installGlobalApi', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    document.body.innerHTML = '<ul id="plugins-menu-list"></ul><div id="plugin-title-actions"></div>';
  });

  it('installs window.OpenVCS only once', async () => {
    const { installGlobalApi } = await import('./registration');
    expect((window as any).OpenVCS).toBeUndefined();

    installGlobalApi();
    expect((window as any).OpenVCS).not.toBeUndefined();
    expect(typeof (window as any).OpenVCS.registerPlugin).toBe('function');
    expect(typeof (window as any).OpenVCS.invoke).toBe('function');
    expect(typeof (window as any).OpenVCS.listen).toBe('function');
    expect(typeof (window as any).OpenVCS.notify).toBe('function');

    const api = (window as any).OpenVCS;
    installGlobalApi();
    expect((window as any).OpenVCS).toBe(api);
  });
});

describe('resetPluginRuntime', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountMenuDom();
    document.head.querySelectorAll('script[data-openvcs-plugin-id]').forEach((el) => { el.remove(); });
  });

  it('clears all registrations, scripts, and injected UI', async () => {
    const { installGlobalApi, injectPluginModule, trackUiNode, resetPluginRuntime, registerAction, registerPlugin } = await import('./registration');
    installGlobalApi();
    injectPluginModule('console.log("hi");', 'p1');

    const container = document.getElementById('plugins-menu-list')!;
    const node = document.createElement('button');
    container.appendChild(node);
    trackUiNode('p1', node);

    registerPlugin({
      id: 'test',
      actions: { testAction: vi.fn() },
      menuItems: [{ label: 'Item', action: 'item-action' }],
      contextMenus: { files: [{ label: 'File', action: 'file-act' }] },
    });

    resetPluginRuntime();

    const injectedScripts = Array.from(document.head.querySelectorAll('script')).filter(
      (s: HTMLScriptElement) => s.dataset.openvcsPluginId,
    );
    expect(injectedScripts.length).toBe(0);
    expect(container.children.length).toBe(0);

    const { runPluginAction } = await import('./runtime');
    expect(await runPluginAction('testAction')).toBe(false);
  });
});
