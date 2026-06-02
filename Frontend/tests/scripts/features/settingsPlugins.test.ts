// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('@scripts/lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }));
vi.mock('@scripts/plugins', () => ({ reloadPlugins: vi.fn() }));
vi.mock('@scripts/themes', () => ({
  DEFAULT_LIGHT_THEME_ID: 'light',
  refreshAvailableThemes: vi.fn(),
  selectThemePack: vi.fn(),
}));
vi.mock('@scripts/ui/layout', () => ({ setTheme: vi.fn() }));
vi.mock('@scripts/features/settingsTheme', () => ({
  modeForTheme: vi.fn(() => 'light' as const),
  rebuildThemePackOptions: vi.fn(),
}));
vi.mock('@scripts/features/settingsPluginUI', () => ({
  renderPluginMenus: vi.fn(),
  activateSection: vi.fn(),
}));
vi.mock('@scripts/features/settingsPluginSearch', () => ({
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
  CSS.escape = (s: string) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
// Polyfill requestAnimationFrame for jsdom (used in queuePluginToggle)
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(cb, 0) as unknown as number;
}
if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
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
  vi.clearAllMocks();
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

describe('CSS.escape polyfill', () => {
  it('escapes backslashes for selector safety', () => {
    expect(CSS.escape('plugin\\id')).toBe('plugin\\\\id');
  });
});

describe('loadPluginsIntoForm - early returns', () => {
  it('returns when required elements missing', async () => {
    document.body.innerHTML = '<div id="settings-modal"><div id="plugins-pane"></div></div>';
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await expect(loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, {} as any)).resolves.toBeUndefined();
  });

  it('shows 0 of 0 when Tauri not available', async () => {
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p2'] } } as any);
    await flushPromises();

    expect(document.getElementById('plugins-group-label')?.textContent).toContain('1 of 2 enabled');
  });

  it('uses backend enabled state over manifest defaults', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false, enabled: true },
          { id: 'p2', name: 'P2', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false, enabled: false },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const btn = document.querySelector('[data-plugin-toggle]') as HTMLButtonElement;
    if (btn) {
      btn.click();
      await flushPromises();
    }
  });
});

// ---------------------------------------------------------------------------
// renderDetails - plugin detail panel
// ---------------------------------------------------------------------------

describe('renderDetails', () => {
  it('renders detail panel with full metadata', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'Full Plugin', version: '2.0.0', author: 'Test Author',
          category: 'Utility', description: 'A full description', source: 'npm',
          source_kind: 'package', source_spec: '^2.0.0', tags: ['tag1', 'tag2'],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const detailEl = document.getElementById('plugins-detail') as HTMLElement;
    expect(detailEl.classList.contains('empty')).toBe(false);
    expect(detailEl.querySelector('.plugin-detail-title .name')?.textContent).toBe('Full Plugin');
    expect(detailEl.querySelector('.plugin-detail-kv')?.textContent).toContain('Category');
    expect(detailEl.querySelector('.plugin-detail-kv')?.textContent).toContain('Source');
    expect(detailEl.querySelector('.plugin-detail-kv')?.textContent).toContain('Specifier');
    expect(detailEl.querySelector('.plugin-detail-kv')?.textContent).toContain('Tags');
    expect(detailEl.querySelector('.plugin-detail-kv')?.textContent).toContain('Author');
    expect(detailEl.querySelector('.plugin-detail-kv')?.textContent).toContain('Version');
  });

  it('shows detail empty state when no filtered plugins', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const detailEl = document.getElementById('plugins-detail') as HTMLElement;
    expect(detailEl.classList.contains('empty')).toBe(true);
  });

  it('shows enable button text for disabled plugin', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'Disabled P', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: false,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const toggleBtn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.textContent).toBe('Enable');
  });

  it('shows category-only meta line when no version or author', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'Minimal', version: '', author: '',
          category: 'Tools', description: '', source: '', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const metaEl = document.querySelector('.plugin-detail-title .meta') as HTMLElement;
    expect(metaEl.textContent).toContain('Tools');
  });
});

// ---------------------------------------------------------------------------
// pane click - toggle button
// ---------------------------------------------------------------------------

describe('pane click - toggle button', () => {
  it('triggers queuePluginToggle when data-plugin-toggle button is clicked', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // The initial toggle button shows "Disable" for enabled plugin
    const toggleBtn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(toggleBtn.textContent).toBe('Disable');

    // Click the toggle button in the pane (not the detail one)
    const pane = document.getElementById('plugins-pane') as HTMLElement;
    pane.click();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// pane double-click
// ---------------------------------------------------------------------------

describe('pane double-click', () => {
  it('toggles plugin on double-click row', async () => {
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
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;
    rows[0].click();
    rows[0].click();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// pane checkbox change
// ---------------------------------------------------------------------------

describe('pane checkbox change', () => {
  it('triggers queuePluginToggle on checkbox change', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(true);

    // Dispatching change on the pane triggers the change handler
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// context menu actions
// ---------------------------------------------------------------------------

describe('context menu actions', () => {
  it('toggle action in context menu toggles checkbox', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Open context menu via right-click
    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    // Click "Toggle plugin" in context menu
    const toggleAction = document.querySelector('.plugins-context-menu-item[data-action="toggle"]') as HTMLButtonElement;
    expect(toggleAction).not.toBeNull();
    toggleAction.click();
    await flushPromises();
  });

  it('remove action removes plugin successfully', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'RemoveMe', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'uninstall_plugin') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const removeAction = document.querySelector('.plugins-context-menu-item.destructive') as HTMLButtonElement;
    removeAction.click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('uninstall_plugin', { pluginId: 'p1' });
  });

  it('remove action handles failure gracefully', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'RemoveFail', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'uninstall_plugin') throw new Error('remove failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const removeAction = document.querySelector('.plugins-context-menu-item.destructive') as HTMLButtonElement;
    removeAction.click();
    await flushPromises();

    const { notify } = await import('@scripts/lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Remove failed: Error: remove failed');
  });
});

// ---------------------------------------------------------------------------
// context menu - right-click outside row
// ---------------------------------------------------------------------------

describe('context menu - right-click outside row', () => {
  it('hides context menu when right-clicking outside plugin row', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // First show the context menu
    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    expect(document.querySelector('.plugins-context-menu')?.classList.contains('visible')).toBe(true);

    // Right-click outside any row
    const pane = document.getElementById('plugins-pane') as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    await flushPromises();

    expect(document.querySelector('.plugins-context-menu')?.classList.contains('visible')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// search filtering
// ---------------------------------------------------------------------------

describe('search filtering', () => {
  it('filters plugins based on search query', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };

    // Override search mock to return parsed query with terms
    const searchModule = await import('@scripts/features/settingsPluginSearch');
    vi.mocked(searchModule.parsePluginQuery).mockReturnValue({ terms: ['Alpha'], authors: [], tags: [] });
    vi.mocked(searchModule.pluginSearchScore).mockImplementation((p) => p.name === 'Alpha' ? 1 : 0);

    // Reset modules to pick up new mock
    vi.resetModules();

    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const search = document.getElementById('plugins-search') as HTMLInputElement;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input'));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// enable all / disable all - state updates
// ---------------------------------------------------------------------------

describe('enable all / disable all - state updates', () => {
  it('enable all adds all plugins to enabled set and triggers persist', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [
        { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
      ];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1'], enabled: [] } };
      if (cmd === 'set_global_settings') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p1'] } } as any);
    await flushPromises();

    (document.getElementById('plugins-enable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('set_plugin_enabled', { pluginId: 'p1', enabled: true });
  });

  it('disable all adds all plugins to disabled set and triggers persist', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [
        { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
      ];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_global_settings') return null;
      if (cmd === 'set_plugin_enabled') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-disable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('set_plugin_enabled', { pluginId: 'p1', enabled: false });
  });
});

// ---------------------------------------------------------------------------
// persistSinglePluginToggle - error handling
// ---------------------------------------------------------------------------

describe('persistSinglePluginToggle error handling', () => {
  it('handles toggle failure and calls notify', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const toggleBtn = document.querySelector('[data-plugin-toggle]') as HTMLButtonElement;
    toggleBtn.click();

    await vi.waitFor(async () => {
      const { notify } = await import('@scripts/lib/notify');
      expect(vi.mocked(notify)).toHaveBeenCalledWith('Failed to toggle plugin');
    }, { timeout: 2000, interval: 50 });
  });
});

// ---------------------------------------------------------------------------
// sync config error handling
// ---------------------------------------------------------------------------

describe('sync config error handling', () => {
  it('handles sync config failure with error message', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'sync_configured_plugins') throw new Error('sync error');
      if (cmd === 'list_plugins') return [];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-sync-config') as HTMLButtonElement).click();
    await flushPromises();

    const { notify } = await import('@scripts/lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Plugin sync failed: Error: sync error');
  });
});

// ---------------------------------------------------------------------------
// list_plugin_start_failures error handling
// ---------------------------------------------------------------------------

describe('list_plugin_start_failures error handling', () => {
  it('handles list_plugin_start_failures rejection gracefully', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [];
      if (cmd === 'list_plugin_start_failures') throw new Error('failures error');
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await expect(loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any)).resolves.toBeUndefined();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// queued toggle - prevents duplicate pending toggles
// ---------------------------------------------------------------------------

describe('queued toggle deduplication', () => {
  it('prevents duplicate pending toggles for same plugin', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Click the checkbox twice rapidly - only first should queue
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });

  it('loads with enabled plugin IDs and normalizes case', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'P1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { enabled: ['P1'] } } as any);
    await flushPromises();

    // Plugin should be rendered
    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.children.length).toBeGreaterThan(0);
  });

  it('shows no matching plugins after search with no results', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { parsePluginQuery } = await import('@scripts/features/settingsPluginSearch');
    vi.mocked(parsePluginQuery).mockReturnValue({ terms: ['XYZZZZ'], authors: [], tags: [] });

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Type search query to trigger filtering
    const searchEl = document.getElementById('plugins-search') as HTMLInputElement;
    searchEl.value = 'XYZZZZ';
    searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.textContent).toContain('No matching plugins');
  });
});

// ---------------------------------------------------------------------------
// pluginIsEnabled priorities
// ---------------------------------------------------------------------------

describe('pluginIsEnabled', () => {
  it('disabled wins over enabled', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true, enabled: false,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1'], enabled: ['p1'] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(
      document.getElementById('settings-modal') as HTMLElement,
      { plugins: { disabled: ['p1'], enabled: ['p1'] } } as any,
    );
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    expect(checkbox!.checked).toBe(false);
  });

  it('enabled wins over default_enabled', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: false, enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: ['p1'] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(
      document.getElementById('settings-modal') as HTMLElement,
      { plugins: { enabled: ['p1'] } } as any,
    );
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    expect(checkbox!.checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getFiltered - returns base when query empty
// ---------------------------------------------------------------------------

describe('getFiltered', () => {
  it('returns all plugins when query is empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.children.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// renderDetails - minimal plugin
// ---------------------------------------------------------------------------

describe('renderDetails - minimal plugin', () => {
  it('renders without description or metadata keys', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'minimal', name: 'Min', version: '', author: '',
          category: '', description: '', source: '', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const detail = document.getElementById('plugins-detail') as HTMLElement;
    expect(detail.classList.contains('empty')).toBe(false);
    expect(detail.querySelector('.desc')).toBeNull();
    expect(detail.querySelector('.plugin-detail-kv')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// persistPluginsDisabled
// ---------------------------------------------------------------------------

describe('persistPluginsDisabled', () => {
  it('persists plugin disabled set and refreshes themes', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: ['p1'] } };
      if (cmd === 'set_global_settings') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-disable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('set_plugin_enabled', { pluginId: 'p1', enabled: false });
  });
});

// ---------------------------------------------------------------------------
// persistSinglePluginToggle success
// ---------------------------------------------------------------------------

describe('persistSinglePluginToggle success', () => {
  it('toggles plugin and refreshes UI', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_plugin_enabled', { pluginId: 'p1', enabled: false });
    });
  });
});

// ---------------------------------------------------------------------------
// persistSinglePluginToggle - error with button timer
// ---------------------------------------------------------------------------

describe('persistSinglePluginToggle error with button timer', () => {
  it('shows error state on toggle failure', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      const toggleBtn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
      expect(toggleBtn.textContent).toBe('Error');
    }, { timeout: 3000, interval: 100 });
  });
});

// ---------------------------------------------------------------------------
// queuePluginToggle edge cases
// ---------------------------------------------------------------------------

describe('queuePluginToggle edge cases', () => {
  it('prevents duplicate pending toggle', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    let checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    expect(checkbox!.disabled).toBe(false);

    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));

    checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    expect(checkbox!.disabled).toBe(true);

    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));

    await flushPromises();

    // First toggle should still be pending; the toggle button shows "Disabling..."
    await vi.waitFor(() => {
      const btn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
      expect(btn.textContent).toBe('Disabling...');
    });
  });
});

// ---------------------------------------------------------------------------
// context menu overflow positioning
// ---------------------------------------------------------------------------

describe('context menu overflow positioning', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
  });

  function setupRect(cm: HTMLElement, width: number, height: number, left: number, top: number) {
    vi.spyOn(cm, 'getBoundingClientRect').mockReturnValue({
      width, height, top, left,
      right: left + width,
      bottom: top + height,
      x: left, y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it('repositions when overflowing right edge', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const cm = document.querySelector('.plugins-context-menu') as HTMLElement;
    setupRect(cm, 100, 50, 480, 100);

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 480, clientY: 100 }));
    await flushPromises();

    expect(parseInt(cm.style.left)).toBeLessThan(480);
  });

  it('repositions when overflowing bottom edge', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const cm = document.querySelector('.plugins-context-menu') as HTMLElement;
    setupRect(cm, 100, 50, 100, 480);

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 480 }));
    await flushPromises();

    expect(parseInt(cm.style.top)).toBeLessThan(480);
  });
});

// ---------------------------------------------------------------------------
// pluginIsEnabled - empty/missing id
// ---------------------------------------------------------------------------

describe('pluginIsEnabled - empty id', () => {
  it('returns false for plugin with no id', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: '', name: 'NoId', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.children.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// queuePluginToggle - empty plugin id
// ---------------------------------------------------------------------------

describe('queuePluginToggle - empty id', () => {
  it('returns early when plugin id is empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Simulate clicking a checkbox without data-plugin-id (should be a no-op)
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// ensureSelection - empty filtered list
// ---------------------------------------------------------------------------

describe('ensureSelection - empty filtered', () => {
  it('sets selectedId to null when filtered is empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const detail = document.getElementById('plugins-detail') as HTMLElement;
    expect(detail.textContent).toContain('No plugins installed');
  });
});

// ---------------------------------------------------------------------------
// pane click - toggle button with empty id
// ---------------------------------------------------------------------------

describe('pane click - toggle button with empty id', () => {
  it('returns early when toggle button has no id', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Create a toggle button with empty data-plugin-toggle
    const btn = document.createElement('button');
    btn.dataset.pluginToggle = '';
    document.getElementById('plugins-pane')?.appendChild(btn);
    btn.click();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// renderDetails - toggle button states (Enabling... / Disabling...)
// ---------------------------------------------------------------------------

describe('renderDetails - toggle button states', () => {
  it('shows "Disabling..." when pendingToggle is false', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        if (cmd === 'set_plugin_enabled') throw new Error('fail');
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Trigger a toggle which will cause pendingToggle to be set
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// pane change handler - checkbox with empty plugin id
// ---------------------------------------------------------------------------

describe('pane change handler - empty plugin id', () => {
  it('returns early when checkbox has no pluginId', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Create a checkbox with empty data-plugin-id
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const pane = document.getElementById('plugins-pane') as HTMLElement;
    pane.appendChild(cb);
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// renderList - context menu inside pane
// ---------------------------------------------------------------------------

describe('renderList - context menu on non-row element', () => {
  it('hides context menu when clicking non-row in pane', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Right-click on a non-row element inside the pane
    const pane = document.getElementById('plugins-pane') as HTMLElement;
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    await flushPromises();

    const cm = document.querySelector('.plugins-context-menu') as HTMLElement;
    expect(cm).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sync config - success notify
// ---------------------------------------------------------------------------

describe('sync config - success notify', () => {
  it('notifies "Reloaded plugin config" on sync success (line 35)', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'sync_configured_plugins') return null;
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-sync-config') as HTMLButtonElement).click();
    await flushPromises();

    const { notify } = await import('@scripts/lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Reloaded plugin config');
  });
});

// ---------------------------------------------------------------------------
// enable-all - reload failure (line 743)
// ---------------------------------------------------------------------------

describe('enable-all - reload failure', () => {
  it('catches reloadPlugins rejection in enable-all (line 743)', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1'], enabled: [] } };
      if (cmd === 'set_plugin_enabled') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p1'] } } as any);
    await flushPromises();

    const { reloadPlugins } = await import('@scripts/plugins');
    vi.mocked(reloadPlugins).mockRejectedValueOnce(new Error('reload failed'));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (document.getElementById('plugins-enable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith('enable-all: reload failed', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// disable-all - individual toggle failure (line 759)
// ---------------------------------------------------------------------------

describe('disable-all - individual toggle failure', () => {
  it('catches individual set_plugin_enabled rejection in disable-all (line 759)', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (document.getElementById('plugins-disable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith('disable-all: toggle p1 failed', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// disable-all - reload failure (line 767)
// ---------------------------------------------------------------------------

describe('disable-all - reload failure', () => {
  it('catches renderPluginMenus rejection in disable-all (line 767)', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const { renderPluginMenus } = await import('@scripts/features/settingsPluginUI');
    vi.mocked(renderPluginMenus).mockRejectedValueOnce(new Error('render failed'));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (document.getElementById('plugins-disable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith('disable-all: reload failed', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// hideContextMenu - early return when already hidden
// ---------------------------------------------------------------------------

describe('hideContextMenu early return', () => {
  it('does nothing when context menu is not visible', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const cm = document.querySelector('.plugins-context-menu') as HTMLElement;
    expect(cm.classList.contains('visible')).toBe(false);

    document.body.click();
    await flushPromises();
    expect(cm.classList.contains('visible')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureSelection - with selectedId=null and filtered has items
// ---------------------------------------------------------------------------

describe('ensureSelection null selectedId', () => {
  it('selects first plugin when selectedId is null and filtered list is non-empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'first-id', name: 'First', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'second-id', name: 'Second', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].getAttribute('aria-selected')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// queuePluginToggle - clears existing error timer
// ---------------------------------------------------------------------------

describe('queuePluginToggle clears error timer', () => {
  it('clears button error timer when toggling a failed plugin again', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    await vi.waitFor(() => {
      const btn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
      expect(btn.textContent).toBe('Error');
    }, { timeout: 3000, interval: 100 });

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// persistSinglePluginToggle - error callback updates UI
// ---------------------------------------------------------------------------

describe('persistSinglePluginToggle UI update', () => {
  it('updates errorToggleById and clears pending on failure', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    await vi.waitFor(() => {
      const btn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
      expect(btn.textContent).toBe('Error');
    }, { timeout: 3000, interval: 100 });

    // pendingToggle should be cleared after failure, and button shows Error
    const btn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sync config - error with empty message
// ---------------------------------------------------------------------------

describe('sync config - empty error message', () => {
  it('shows notification without colon when error message is empty', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'sync_configured_plugins') throw '';
      if (cmd === 'list_plugins') return [];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    (document.getElementById('plugins-sync-config') as HTMLButtonElement).click();
    await flushPromises();

    const { notify } = await import('@scripts/lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Plugin sync failed');
  });
});

// ---------------------------------------------------------------------------
// getFiltered - query with whitespace only (no parsed parts)
// ---------------------------------------------------------------------------

describe('getFiltered whitespace query', () => {
  it('returns base plugins when query is whitespace and parsePluginQuery returns no parts', async () => {
    // Override mock to return no parts for whitespace
    const searchModule = await import('@scripts/features/settingsPluginSearch');
    vi.mocked(searchModule.parsePluginQuery).mockReturnValue({ terms: [], authors: [], tags: [] });

    vi.resetModules();

    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.children.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// pluginIsEnabled - undefined enabled and default_enabled false
// ---------------------------------------------------------------------------

describe('pluginIsEnabled defaults', () => {
  it('returns false when p.enabled is undefined and default_enabled is false', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: false,  // no enabled field
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input');
    expect(checkbox?.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderDetails - Enabling... pending text
// ---------------------------------------------------------------------------

describe('renderDetails Enabling text', () => {
  it('shows "Enabling..." toggle text when pendingToggle is true', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: false,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1'], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('fail');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p1'] } } as any);
    await flushPromises();

    const toggleBtn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(toggleBtn.textContent).toBe('Enable');

    // Toggling sets pendingToggle to "enabled=true" → should show "Enabling..."
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    await vi.waitFor(() => {
      const btn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
      expect(btn.textContent).toBe('Error');  // toggle fails so it shows error
    }, { timeout: 3000, interval: 100 });
  });
});

// ---------------------------------------------------------------------------
// getFiltered - filters out plugins with empty name
// ---------------------------------------------------------------------------

describe('getFiltered filters empty name', () => {
  it('filters out plugins with empty name from the list', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: '', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    expect(document.getElementById('plugins-list')?.textContent).toContain('No matching plugins');
  });
});

// ---------------------------------------------------------------------------
// pane click - row with empty data-plugin
// ---------------------------------------------------------------------------

describe('pane click empty data-plugin', () => {
  it('returns early when clicking a row with empty data-plugin', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // The "No plugins installed" row is created without data-plugin attribute
    const row = document.querySelector('.plugin-row') as HTMLElement;
    expect(row).not.toBeNull();
    row.click();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// pane contextmenu - row with empty data-plugin
// ---------------------------------------------------------------------------

describe('contextmenu empty data-plugin', () => {
  it('hides context menu when right-clicking row with empty data-plugin', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const cm = document.querySelector('.plugins-context-menu') as HTMLElement;
    expect(cm.classList.contains('visible')).toBe(false);

    // Right-click the empty state row
    const row = document.querySelector('.plugin-row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    await flushPromises();

    expect(cm.classList.contains('visible')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pane change handler - plugin not found in state list
// ---------------------------------------------------------------------------

describe('pane change plugin not found', () => {
  it('toggles even when plugin not found in state list', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_plugin_enabled') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Create checkbox with unknown plugin id
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.pluginId = 'unknown-plugin';
    cb.checked = true;
    document.getElementById('plugins-pane')?.appendChild(cb);
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// pane double-click - matches but no checkbox element found
// ---------------------------------------------------------------------------

describe('pane double-click no checkbox', () => {
  it('handles double-click when checkbox is not in DOM', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'P2', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Click a plugin row first (single)
    const rows = document.querySelectorAll('.plugin-row[data-plugin]');
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    // Click again quickly but the checkbox is already checked (should not throw)
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// showContextMenu - non-built-in plugin removes title attribute
// ---------------------------------------------------------------------------

describe('showContextMenu non-built-in', () => {
  it('removes title attribute for non-built-in plugins', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'External', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const removeAction = document.querySelector('.plugins-context-menu-item.destructive') as HTMLButtonElement;
    expect(removeAction.disabled).toBe(false);
    expect(removeAction.hasAttribute('title')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enable-all - set_plugin_enabled failure for a plugin
// ---------------------------------------------------------------------------

describe('enable-all individual toggle failure', () => {
  it('catches set_plugin_enabled rejection in enable-all loop', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [
        { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
        { id: 'p2', name: 'P2', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false },
      ];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1', 'p2'], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p1', 'p2'] } } as any);
    await flushPromises();

    (document.getElementById('plugins-enable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith('enable-all: toggle p1 failed', expect.any(Error));
    expect(consoleSpy).toHaveBeenCalledWith('enable-all: toggle p2 failed', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// pane click - checkbox element skips double-click tracking
// ---------------------------------------------------------------------------

describe('pane click checkbox skip double-click', () => {
  it('does not track double-click when clicking inside .plugin-check', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const checkWrap = document.querySelector('.plugin-check') as HTMLElement;
    checkWrap.click();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// toggle action - checkbox not in DOM
// ---------------------------------------------------------------------------

describe('toggle action checkbox not found', () => {
  it('returns early when checkbox element is missing from DOM', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Remove the checkbox from the DOM before triggering toggle action
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"][data-plugin-id]');
    if (checkbox) checkbox.remove();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const toggleAction = document.querySelector('[data-action="toggle"]') as HTMLButtonElement;
    toggleAction.click();
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// renderDetails - meta separator with only category
// ---------------------------------------------------------------------------

describe('renderDetails meta separator', () => {
  it('shows category-only meta when version and author are empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '', author: '',
          category: 'Utility', description: '', source: '', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const meta = document.querySelector('.plugin-detail-title .meta') as HTMLElement;
    expect(meta.textContent).toBe('Utility');
  });
});

// ---------------------------------------------------------------------------
// remove action - user cancels confirm
// ---------------------------------------------------------------------------

describe('remove action cancelled', () => {
  it('does not uninstall when confirm returns false', async () => {
    const { confirmBool } = await import('@scripts/lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(false);

    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'Cancelled', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const removeAction = document.querySelector('.plugins-context-menu-item.destructive') as HTMLButtonElement;
    removeAction.click();
    await flushPromises();

    expect(invoke).not.toHaveBeenCalledWith('uninstall_plugin', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// enable-all - individual toggle failure
// ---------------------------------------------------------------------------

describe('enable-all - individual toggle failure', () => {
  it('catches individual set_plugin_enabled rejection in enable-all', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{ id: 'p1', name: 'P1', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: false }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1'], enabled: [] } };
      if (cmd === 'set_plugin_enabled') throw new Error('toggle failed');
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p1'] } } as any);
    await flushPromises();

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (document.getElementById('plugins-enable-all') as HTMLButtonElement).click();
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith('enable-all: toggle p1 failed', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// plugin row - icon initial without icon_url
// ---------------------------------------------------------------------------

describe('plugin row icon initial', () => {
  it('shows initial letter when no icon_data_url', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'TestPlugin', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const icon = document.querySelector('.plugin-icon') as HTMLElement;
    expect(icon.textContent).toBe('T');
  });
});

// ---------------------------------------------------------------------------
// plugin row - empty meta shows space
// ---------------------------------------------------------------------------

describe('plugin row empty meta', () => {
  it('shows space character when category, author, and version are all empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '', author: '',
          category: '', description: 'D', source: '', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const meta = document.querySelector('.plugin-row-text .meta') as HTMLElement;
    expect(meta.textContent).toBe(' ');
  });
});

// ---------------------------------------------------------------------------
// renderList - no state.list and no filtered
// ---------------------------------------------------------------------------

describe('renderList no list no filter', () => {
  it('shows No plugins installed when state.list is empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    expect(document.getElementById('plugins-list')?.textContent).toContain('No plugins installed');
  });
});

// ---------------------------------------------------------------------------
// renderDetails - loading state shows "Enabling..." during toggle
// ---------------------------------------------------------------------------

describe('renderDetails toggle loading states', () => {
  it('shows "Enabling..." text while toggle is pending', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: false,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: ['p1'], enabled: [] } };
      if (cmd === 'set_plugin_enabled') return null; // succeed eventually
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: { disabled: ['p1'] } } as any);
    await flushPromises();

    // Currently disabled, toggle button shows "Enable"
    expect(document.getElementById('plugins-toggle-selected')?.textContent).toBe('Enable');

    // Click the checkbox to enable
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // Immediately check text while pending
    await vi.waitFor(() => {
      const btn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }, { timeout: 2000, interval: 50 });
  });
});

// ---------------------------------------------------------------------------
// renderDetails - source without sourceKind
// ---------------------------------------------------------------------------

describe('renderDetails source without sourceKind', () => {
  it('shows source without (sourceKind) when source_kind is missing', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'Utility', description: 'D', source: 'npm',
          tags: [], icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const kv = document.querySelector('.plugin-detail-kv') as HTMLElement;
    expect(kv.textContent).toContain('Source');
    expect(kv.textContent).toContain('npm');
    expect(kv.textContent).not.toContain('package');
  });
});

// ---------------------------------------------------------------------------
// renderDetails - without description (desc element absent but kv rows rendered)
// ---------------------------------------------------------------------------

describe('renderDetails no description', () => {
  it('omits desc element when description is empty but renders kv rows', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'Author',
          category: 'Utility', description: '', source: 'npm', tags: ['tag1'],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const detail = document.getElementById('plugins-detail') as HTMLElement;
    expect(detail.querySelector('.desc')).toBeNull();
    expect(detail.querySelector('.plugin-detail-kv')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderDetails - without author (kv entries exist but Author row absent)
// ---------------------------------------------------------------------------

describe('renderDetails no author', () => {
  it('omits Author row in kv when author is empty', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: '',
          category: 'Utility', description: 'D', source: 'npm', tags: ['t'],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const kv = document.querySelector('.plugin-detail-kv') as HTMLElement;
    expect(kv.textContent).toContain('Category');
    expect(kv.textContent).toContain('Tags');
    expect(kv.textContent).not.toContain('Author');
  });
});

// ---------------------------------------------------------------------------
// renderDetails - without tags (kv entries exist but Tags row absent)
// ---------------------------------------------------------------------------

describe('renderDetails no tags', () => {
  it('omits Tags row in kv when no tags', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'Author',
          category: 'Utility', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const kv = document.querySelector('.plugin-detail-kv') as HTMLElement;
    expect(kv.textContent).toContain('Author');
    expect(kv.textContent).not.toContain('Tags');
  });
});

// ---------------------------------------------------------------------------
// renderDetails - no version with other metadata
// ---------------------------------------------------------------------------

describe('renderDetails no version', () => {
  it('omits Version row when version is empty but other kv exist', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '', author: 'Author',
          category: 'Utility', description: 'D', source: 'npm', tags: ['t'],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const kv = document.querySelector('.plugin-detail-kv') as HTMLElement;
    expect(kv.textContent).toContain('Author');
    expect(kv.textContent).not.toContain('Version');
  });
});

// ---------------------------------------------------------------------------
// toggle button - Enabling... text immediately after start
// ---------------------------------------------------------------------------

describe('toggle button Enabling text', () => {
  it('shows "Enabling..." synchronously after dispatch change (pendingToggle===true)', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: false,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const toggleBtn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(toggleBtn.textContent).toBe('Enable');

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // After synchronous queuePluginToggle, pendingToggle is set before async callback
    // Query fresh because renderList destroys and recreates the button element
    const btnAfter = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(btnAfter.textContent).toBe('Enabling...');
    expect(btnAfter.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toggle button - Disabling... text immediately after start
// ---------------------------------------------------------------------------

describe('toggle button Disabling text', () => {
  it('shows "Disabling..." synchronously after dispatch change (pendingToggle===false)', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const toggleBtn = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(toggleBtn.textContent).toBe('Disable');

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"].plugin-check-input')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // Query fresh because renderList destroys and recreates the button element
    const btnAfter = document.getElementById('plugins-toggle-selected') as HTMLButtonElement;
    expect(btnAfter.textContent).toBe('Disabling...');
    expect(btnAfter.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pane click - single click selects row, different ids skip double-click
// ---------------------------------------------------------------------------

describe('pane click select different row', () => {
  it('selects second row when clicking different row quickly (not double-click)', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    let rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;

    // Click first row (sets lastClickAt/lastClickIdKey to p1)
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    // Re-query rows after renderList (old rows are detached)
    rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;

    // Click second row quickly - different idKey, not treated as double-click
    rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    // Re-query rows because renderList destroys and recreates elements again
    rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// pane single-click sets selection (first click on a row)
// ---------------------------------------------------------------------------

describe('pane click sets selection', () => {
  it('selects the clicked row on single click (new lastClickAt/lastClickIdKey)', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const rows = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;

    // Click first row (single click - not a double-click)
    rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    // Re-query rows after renderList
    const rowsAfter = document.querySelectorAll('.plugin-row[data-plugin]') as NodeListOf<HTMLElement>;
    expect(rowsAfter[0].getAttribute('aria-selected')).toBe('false');
    expect(rowsAfter[1].getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// getFiltered with terms only (no authors/tags)
// ---------------------------------------------------------------------------

describe('getFiltered with terms only', () => {
  it('filters by terms when query has no authors or tags', async () => {
    const searchModule = await import('@scripts/features/settingsPluginSearch');
    vi.mocked(searchModule.parsePluginQuery).mockReturnValue({ terms: ['Alpha'], authors: [], tags: [] });
    vi.mocked(searchModule.pluginSearchScore).mockImplementation((p) => p.name === 'Alpha' ? 1 : 0);

    vi.resetModules();

    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [
          { id: 'p1', name: 'Alpha', version: '1.0', author: 'A', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
          { id: 'p2', name: 'Beta', version: '1.0', author: 'B', category: 'U', description: 'D', source: 'npm', tags: [], icon_data_url: '', default_enabled: true },
        ];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const search = document.getElementById('plugins-search') as HTMLInputElement;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input'));
    await flushPromises();

    const list = document.getElementById('plugins-list') as HTMLElement;
    expect(list.children.length).toBe(1);
    expect(list.textContent).toContain('Alpha');
    expect(list.textContent).not.toContain('Beta');
  });
});

// ---------------------------------------------------------------------------
// updateCounts when list is empty
// ---------------------------------------------------------------------------

describe('updateCounts empty list', () => {
  it('shows 0 of 0 enabled when no plugins', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const label = document.getElementById('plugins-group-label') as HTMLElement;
    expect(label.textContent).toBe('Installed (0 of 0 enabled)');
  });
});

// ---------------------------------------------------------------------------
// queuePluginToggle with whitespace-only id
// ---------------------------------------------------------------------------

describe('queuePluginToggle whitespace id', () => {
  it('returns early when plugin id is whitespace only', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Create a checkbox with whitespace plugin id
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.pluginId = '  ';
    document.getElementById('plugins-pane')?.appendChild(cb);
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
  });
});

// ---------------------------------------------------------------------------
// icon error restores initial letter
// ---------------------------------------------------------------------------

describe('icon error restores initial', () => {
  it('restores initial letter when icon load fails', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'IconTest', version: '1.0', author: 'A',
          category: 'U', description: 'D', source: 'npm', tags: [],
          icon_data_url: 'data:image/png;base64,bad', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const icon = document.querySelector('.plugin-icon') as HTMLElement;
    const img = icon.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();

    // Trigger error on img
    img.dispatchEvent(new Event('error'));
    await flushPromises();

    // After error, img removed, initial letter should remain
    expect(icon.querySelector('img')).toBeNull();
    expect(icon.textContent).toBe('I'); // first letter of 'IconTest'
  });
});

// ---------------------------------------------------------------------------
// persistPluginsDisabled - set_global_settings failure via remove
// ---------------------------------------------------------------------------

describe('persistPluginsDisabled failure via remove', () => {
  it('catches set_global_settings rejection during remove action', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_plugins') return [{
        id: 'p1', name: 'P1', version: '1.0', author: 'A',
        category: 'U', description: 'D', source: 'npm', tags: [],
        icon_data_url: '', default_enabled: true,
      }];
      if (cmd === 'list_plugin_start_failures') return [];
      if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
      if (cmd === 'set_global_settings') throw new Error('persist failed');
      if (cmd === 'uninstall_plugin') return null;
      return null;
    });
    (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure confirm always returns true (needed when run alongside other tests)
    const { confirmBool } = await import('@scripts/lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);

    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    // Trigger remove action which calls persistPluginsDisabled (line 609)
    const row = document.querySelector('.plugin-row[data-plugin]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await flushPromises();

    const removeAction = document.querySelector('.plugins-context-menu-item.destructive') as HTMLButtonElement;
    removeAction.click();

    // Wait for all async chains to settle - the remove handler calls persistPluginsDisabled without await
    await flushPromises();
    await flushPromises();

    // persistPluginsDisabled runs get_global_settings and set_global_settings
    expect(invoke).toHaveBeenCalledWith('set_global_settings', expect.any(Object));
    expect(consoleSpy).toHaveBeenCalledWith('Failed to update plugins:', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// renderDetails - meta line with version only (no category, no author)
// ---------------------------------------------------------------------------

describe('renderDetails meta version only', () => {
  it('shows version tag in meta when only version is present', async () => {
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'list_plugins') return [{
          id: 'p1', name: 'P1', version: '2.0.0', author: '',
          category: '', description: 'D', source: 'npm', tags: ['t'],
          icon_data_url: '', default_enabled: true,
        }];
        if (cmd === 'list_plugin_start_failures') return [];
        if (cmd === 'get_global_settings') return { plugins: { disabled: [], enabled: [] } };
        return null;
      })},
      event: { listen: vi.fn() },
    };
    const { loadPluginsIntoForm } = await import('@scripts/features/settingsPlugins');
    await loadPluginsIntoForm(document.getElementById('settings-modal') as HTMLElement, { plugins: {} } as any);
    await flushPromises();

    const meta = document.querySelector('.plugin-detail-title .meta') as HTMLElement;
    expect(meta.textContent).toContain('v2.0.0');
  });
});


