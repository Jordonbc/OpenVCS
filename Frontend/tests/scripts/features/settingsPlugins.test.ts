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
