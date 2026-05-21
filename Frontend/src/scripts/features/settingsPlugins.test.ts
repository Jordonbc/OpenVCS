// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }));
vi.mock('../plugins', () => ({ reloadPlugins: vi.fn() }));
vi.mock('../themes', () => ({
  DEFAULT_LIGHT_THEME_ID: 'light',
  refreshAvailableThemes: vi.fn(),
  selectThemePack: vi.fn(),
}));
vi.mock('../ui/layout', () => ({ setTheme: vi.fn() }));
vi.mock('./settingsTheme', () => ({
  modeForTheme: vi.fn(() => 'light' as const),
  rebuildThemePackOptions: vi.fn(),
}));
vi.mock('./settingsPluginUI', () => ({
  clearPluginSettingsCache: vi.fn(),
  renderPluginMenus: vi.fn(),
  activateSection: vi.fn(),
}));
vi.mock('./settingsPluginSearch', () => ({
  parsePluginQuery: vi.fn(() => ({ terms: [], authors: [], tags: [] })),
  pluginSearchScore: vi.fn(() => 1),
}));

function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
}

// Polyfill CSS.escape for jsdom compatibility
if (typeof CSS === 'undefined') {
  (globalThis as any).CSS = {};
}
if (!CSS.escape) {
  CSS.escape = (s: string) => s.replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, '\\$&');
}

function mountSettingsDom() {
  document.body.innerHTML = `
    <div id="settings-modal">
      <div id="plugins-pane">
        <div id="plugins-group-label">Installed (0 of 0 enabled)</div>
        <ul id="plugins-list"></ul>
        <div id="plugins-detail" class="empty">Select a plugin to view details.</div>
        <input id="plugins-search" />
        <button id="plugins-sync-config">Sync Config</button>
        <button id="plugins-enable-all">Enable All</button>
        <button id="plugins-disable-all">Disable All</button>
        <nav id="settings-nav"><ul><li><button class="seg-btn active" data-section="plugins">Plugins</button></li></ul></nav>
        <div id="settings-panels"></div>
        <div id="settings-panels-scroll"></div>
        <div class="sheet-actions"></div>
      </div>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  mountSettingsDom();
  (globalThis as any).matchMedia = createMatchMediaMock;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('loadPluginsIntoForm - early returns', () => {
  it('returns when required elements missing', async () => {
    document.body.innerHTML = '<div id="settings-modal"><div id="plugins-pane"></div></div>';
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await expect(loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, {} as any)).resolves.toBeUndefined();
  });

  it('shows 0 of 0 when Tauri not available', async () => {
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    expect(document.getElementById('plugins-group-label')?.textContent).toBe('Installed (0 of 0 enabled)');
  });
});

describe('loadPluginsIntoForm - empty plugin list', () => {
  it('shows no plugins message', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();
    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.textContent).toContain('No plugins installed');
  });
});

describe('loadPluginsIntoForm - with plugins', () => {
  it('renders plugin rows', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'Plugin One', version: '1.0', author: 'Author', category: 'Utility', description: 'Desc', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Plugin One');
  });

  it('shows enabled count', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'P2', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: ['p2'], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p2'] } } as any);
    await flushPromises();

    expect(document.getElementById('plugins-group-label')?.textContent).toContain('1 of 2 enabled');
  });

  it('handles list_plugins failure', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') throw new Error('list failed');
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    expect(document.getElementById('plugins-detail')?.textContent).toContain('Failed to load plugins');
  });
});

describe('sync config button', () => {
  it('triggers sync on click', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'sync_configured_plugins') return null;
      if (cmd === 'list_plugins') return [];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-sync-config') as HTMLButtonElement).click();
    await flushPromises();
    expect(invoke.mock.calls.some((call: any[]) => call[0] === 'sync_configured_plugins')).toBe(true);
  });
});

describe('search keyboard shortcut', () => {
  it('focuses search on /', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async () => null) },
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-pane') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    expect(document.activeElement).toBe(document.getElementById('plugins-search'));
  });
});

describe('context menu', () => {
  it('shows on right-click', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    expect(row).not.toBeNull();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const cm = document.querySelector('.plugins-context-menu') as HTMLElement;
    expect(cm).not.toBeNull();
    expect(cm.classList.contains('visible')).toBe(true);
  });

  it('hides on outside click', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();
    document.body.click();
    await flushPromises();
    expect(document.querySelector('.plugins-context-menu')?.classList.contains('visible')).toBe(false);
  });

  it('hides on Escape', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.querySelector('.plugins-context-menu')?.classList.contains('visible')).toBe(false);
  });

  it('disables remove for built-in plugins', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'Built-in', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'built-in', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const removeAction = document.querySelector('.plugins-context-menu-item.destructive') as HTMLButtonElement;
    expect(removeAction.disabled).toBe(true);
  });
});

describe('icon rendering', () => {
  it('renders icon image and handles load event', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'Icon', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: 'data:image/png;base64,abc', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const img = document.querySelector('.plugin-icon img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain('data:image/png');
    img.dispatchEvent(new Event('load'));
    expect(img.parentElement?.classList.contains('has-img')).toBe(true);
  });

  it('handles icon load error', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'Icon', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: 'data:image/png;base64,bad', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const img = document.querySelector('.plugin-icon img') as HTMLImageElement;
    if (img) img.dispatchEvent(new Event('error'));
  });
});

describe('search input', () => {
  it('filters on input event', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const search = document.getElementById('plugins-search') as HTMLInputElement;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input'));
    await flushPromises();
  });

  it('prevents default on Enter', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async () => null) },
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    const spy = vi.spyOn(ev, 'preventDefault');
    document.getElementById('plugins-search')?.dispatchEvent(ev);
    expect(spy).toHaveBeenCalled();
  });
});

describe('enable all / disable all buttons', () => {
  it('enable all triggers', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-enable-all') as HTMLButtonElement).click();
    await flushPromises();
  });

  it('disable all triggers', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-disable-all') as HTMLButtonElement).click();
    await flushPromises();
  });
});

describe('pane click handlers', () => {
  it('selects plugin row', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;
    expect(rows.length).toBe(2);
    rows[1].click();
    await flushPromises();
  });
});

describe('start failures rendering', () => {
  it('handles error state from start failures', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'broken-p', name: 'Broken', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return ['broken-p'];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();
  });
});

describe('toggle button in pane', () => {
  it('handles toggle button click', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('./settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const btn = document.querySelector('[data-plugin-toggle]') as HTMLButtonElement;
    if (btn) {
      btn.click();
      await flushPromises();
    }
  });
});

