// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemePayload, ThemeSummary } from './types';

// ---------------------------------------------------------------------------
// Mock external dependencies (hoisted by Vitest)
// ---------------------------------------------------------------------------
vi.mock('./lib/tauri', () => ({ TAURI: { invoke: vi.fn() } }));
vi.mock('./lib/notify', () => ({ notify: vi.fn() }));
vi.mock('./plugins', () => ({
  getRegisteredThemePayload: vi.fn(),
  getRegisteredThemeSummaries: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mutable matchMedia mock so tests can switch between light/dark at runtime
// ---------------------------------------------------------------------------
function createMediaQuery(matches: boolean) {
  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  };
}

const mq = createMediaQuery(false);

beforeEach(() => {
  Object.assign(mq, createMediaQuery(false));
  (window as any).matchMedia = vi.fn(() => mq);
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme-pack');
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function load(): Promise<typeof import('./themes')> {
  return import('./themes');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('exports expected default theme IDs', async () => {
    const mod = await load();
    expect(mod.DEFAULT_THEME_ID).toBe('default');
    expect(mod.DEFAULT_LIGHT_THEME_ID).toBe('default-light');
    expect(mod.DEFAULT_DARK_THEME_ID).toBe('default-dark');
  });
});

// ---------------------------------------------------------------------------
// getAvailableThemes
// ---------------------------------------------------------------------------
describe('getAvailableThemes', () => {
  it('returns a fresh copy of the theme list', async () => {
    const mod = await load();
    const first = mod.getAvailableThemes();
    first.pop();
    const second = mod.getAvailableThemes();
    expect(second.length).toBeGreaterThan(first.length);
  });

  it('contains default light and dark themes initially', async () => {
    const mod = await load();
    const list = mod.getAvailableThemes();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('default-light');
    expect(list[1].id).toBe('default-dark');
  });
});

// ---------------------------------------------------------------------------
// getActiveThemeId
// ---------------------------------------------------------------------------
describe('getActiveThemeId', () => {
  it('returns default-light in light system mode', async () => {
    const mod = await load();
    expect(mod.getActiveThemeId()).toBe('default-light');
  });
});

// ---------------------------------------------------------------------------
// getCurrentMode
// ---------------------------------------------------------------------------
describe('getCurrentMode', () => {
  it('returns system by default', async () => {
    const mod = await load();
    expect(mod.getCurrentMode()).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// refreshAvailableThemes
// ---------------------------------------------------------------------------
describe('refreshAvailableThemes', () => {
  it('fetches themes from backend and combines with defaults', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'z-theme', name: 'Z Theme' },
      { id: 'a-theme', name: 'A Theme' },
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();

    expect(TAURI.invoke).toHaveBeenCalledWith('list_themes');
    expect(result).toHaveLength(4);
    // Results are sorted by name case-insensitively
    expect(result[0].id).toBe('default-light');
    expect(result[1].id).toBe('default-dark');
    expect(result[2].id).toBe('a-theme');
    expect(result[3].id).toBe('z-theme');
  });

  it('includes names from backend and plugins', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([
      { id: 'plugin-t', name: 'Plugin T' } as ThemeSummary,
    ]);
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'backend-t', name: 'Backend T' },
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();

    expect(result.find((t) => t.id === 'plugin-t')).toBeDefined();
    expect(result.find((t) => t.id === 'backend-t')).toBeDefined();
  });

  it('sorts themes by name case-insensitively', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'z-theme', name: 'Z Theme' },
      { id: 'a-theme', name: 'A Theme' },
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    expect(result[2].name).toBe('A Theme');
    expect(result[3].name).toBe('Z Theme');
  });

  it('deduplicates by id (case-insensitive)', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'default-light', name: 'Duplicate' },
      { id: 'my-theme', name: 'My Theme' },
      { id: 'MY-THEME', name: 'Case Dupe' },
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    // default-light skipped, MY-THEME skipped (collision with my-theme)
    expect(result).toHaveLength(3);
  });

  it('includes plugin-registered theme summaries', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([
      { id: 'plugin-theme', name: 'Plugin Theme' } as ThemeSummary,
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();

    expect(result.find((t) => t.id === 'plugin-theme')).toBeDefined();
  });

  it('falls back to only plugin summaries when backend fails', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('Network error'));
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([
      { id: 'offline-theme', name: 'Offline Theme' } as ThemeSummary,
    ]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await load();
    const result = await mod.refreshAvailableThemes();

    expect(result).toHaveLength(3);
    expect(result.find((t) => t.id === 'offline-theme')).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith('list_themes failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('handles empty/null backend response', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockResolvedValue(null);
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    expect(result).toHaveLength(2);
  });

  it('skips null items in backend response', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockResolvedValue([null, undefined, { id: 'valid', name: 'Valid' }]);
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    expect(result.find((t) => t.id === 'valid')).toBeDefined();
  });

  it('sets fetchedThemes = true after completion', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);

    const mod = await load();
    // ensureThemesLoaded will call refreshAvailableThemes since fetchedThemes=false
    await mod.refreshAvailableThemes();
    // Subsequent call to ensureThemesLoaded should return cached
    const result = await mod.ensureThemesLoaded();
    expect(TAURI.invoke).toHaveBeenCalledTimes(1); // not called again
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ensureThemesLoaded
// ---------------------------------------------------------------------------
describe('ensureThemesLoaded', () => {
  it('calls refreshAvailableThemes when themes not yet fetched', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);

    const mod = await load();
    await mod.ensureThemesLoaded();

    // refreshAvailableThemes was called because it invokes list_themes
    expect(TAURI.invoke).toHaveBeenCalledWith('list_themes');
  });

  it('returns cached themes when already fetched', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);

    const mod = await load();
    await mod.ensureThemesLoaded(); // fetches
    vi.mocked(TAURI.invoke).mockClear();
    const spy = vi.spyOn(mod, 'refreshAvailableThemes');

    const result = await mod.ensureThemesLoaded(); // cached
    expect(spy).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  it('re-fetches when force=true', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);

    const mod = await load();
    await mod.ensureThemesLoaded(); // cache it
    vi.mocked(TAURI.invoke).mockClear();
    vi.mocked(TAURI.invoke).mockResolvedValue([{ id: 'new', name: 'New' }]);

    await mod.ensureThemesLoaded(true); // force refetch
    expect(TAURI.invoke).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// selectThemePack
// ---------------------------------------------------------------------------
describe('selectThemePack', () => {
  it('resolves "default" to defaultThemeIdForMode (light)', async () => {
    const mod = await load();
    await mod.selectThemePack('default');
    expect(mod.getActiveThemeId()).toBe(mod.DEFAULT_LIGHT_THEME_ID);
  });

  it('sets built-in "default-light" directly and clears custom styles', async () => {
    const mod = await load();
    await mod.selectThemePack('default-light');
    expect(mod.getActiveThemeId()).toBe('default-light');

    // For default themes, no style tag is created (activeStyles is null)
    const styleEl = document.getElementById('openvcs-theme-global');
    expect(styleEl).toBeNull();
  });

  it('sets built-in "default-dark" directly', async () => {
    const mod = await load();
    await mod.selectThemePack('default-dark', { mode: 'dark' });
    expect(mod.getActiveThemeId()).toBe('default-dark');
  });

  it('handles "default-dark" in system mode (pairs to light)', async () => {
    const mod = await load();
    await mod.selectThemePack('default-dark', { mode: 'system' });
    // In light system mode, dark pairs to light
    expect(mod.getActiveThemeId()).toBe('default-light');
  });

  it('does NOT strip data-theme-pack for built-in defaults', async () => {
    const mod = await load();
    await mod.selectThemePack('default-dark');
    expect(document.documentElement.hasAttribute('data-theme-pack')).toBe(false);
  });

  it('applies registered plugin theme payload', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    const payload: ThemePayload = {
      summary: { id: 'plugin-theme', name: 'Plugin Theme', source: 'user' },
      styles: 'body { color: red; }',
      markup: { head: '<meta name="theme" content="test">', body: '<div id="plugin-el"></div>' },
      scripts: ['console.log("hello")'],
    };
    vi.mocked(getRegisteredThemePayload).mockReturnValue(payload);

    const mod = await load();
    await mod.selectThemePack('plugin-theme');

    expect(mod.getActiveThemeId()).toBe('plugin-theme');
    // Style tag should be created
    expect(document.getElementById('openvcs-theme-global')?.textContent).toBe('body { color: red; }');
    // Markup nodes should be appended
    expect(document.head.querySelector('meta[name="theme"]')).not.toBeNull();
    expect(document.body.querySelector('#plugin-el')).not.toBeNull();
    // Script node should be created
    const scriptNodes = document.head.querySelectorAll('script[data-theme-pack="plugin-theme"]');
    expect(scriptNodes.length).toBe(1);
    expect(scriptNodes[0].textContent).toBe('console.log("hello")');
  });

  it('loads theme from backend when no registered payload exists', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue(null);
    vi.mocked(TAURI.invoke).mockResolvedValue({
      summary: { id: 'backend-theme', name: 'Backend Theme' },
      styles: 'body { background: blue; }',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('backend-theme');

    expect(TAURI.invoke).toHaveBeenCalledWith('load_theme', { id: 'backend-theme' });
    expect(mod.getActiveThemeId()).toBe('backend-theme');
    expect(document.getElementById('openvcs-theme-global')?.textContent).toBe('body { background: blue; }');
  });

  it('handles invalid theme payload from backend with fallback', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemePayload } = await import('./plugins');
    const { notify } = await import('./lib/notify');
    vi.mocked(getRegisteredThemePayload).mockReturnValue(null);
    vi.mocked(TAURI.invoke).mockResolvedValue(null); // invalid payload

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await load();
    await expect(mod.selectThemePack('broken-theme')).rejects.toThrow();
    expect(notify).toHaveBeenCalledWith('Theme failed to load. Reverted to the default theme.');
    // Falls back to default-light (light mode)
    expect(mod.getActiveThemeId()).toBe('default-light');
    warnSpy.mockRestore();
  });

  it('handles backend load error with silent option (no notify)', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemePayload } = await import('./plugins');
    const { notify } = await import('./lib/notify');
    vi.mocked(getRegisteredThemePayload).mockReturnValue(null);
    vi.mocked(TAURI.invoke).mockRejectedValue(new Error('Backend error'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await load();
    await expect(mod.selectThemePack('broken-theme', { silent: true })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
    expect(mod.getActiveThemeId()).toBe('default-light');
    warnSpy.mockRestore();
  });

  it('respects mode option for default theme resolution', async () => {
    const mod = await load();
    await mod.selectThemePack('default', { mode: 'dark' });
    expect(mod.getActiveThemeId()).toBe('default-dark');
  });

  it('resolves paired theme in system mode', async () => {
    const mod = await load();
    // mq.matches = false → light mode, so pairing from dark-side-up
    // selectThemePack('default-dark', { mode: 'system' }) should pair to default-light
    await mod.selectThemePack('default-dark', { mode: 'system' });
    // In light system mode, default-dark should pair to default-light
    expect(mod.getActiveThemeId()).toBe('default-light');
  });

  it('dispatches theme-changed custom event after selection', async () => {
    const mod = await load();
    const handler = vi.fn();
    window.addEventListener('openvcs:theme-pack-changed', handler);
    await mod.selectThemePack('default-light');
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail.id).toBe('default-light');
    window.removeEventListener('openvcs:theme-pack-changed', handler);
  });

  it('sets data-theme-pack attribute for non-default themes', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'custom', name: 'Custom', source: 'user' },
      styles: '',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('custom');

    expect(document.documentElement.getAttribute('data-theme-pack')).toBe('custom');
  });

  it('trims whitespace from themeId', async () => {
    const mod = await load();
    await mod.selectThemePack('  default-dark  ', { mode: 'dark' });
    expect(mod.getActiveThemeId()).toBe('default-dark');
  });

  it('treats empty string as default', async () => {
    const mod = await load();
    await mod.selectThemePack('', { mode: 'light' });
    expect(mod.getActiveThemeId()).toBe('default-light');
  });
});

// ---------------------------------------------------------------------------
// setAppearanceMode
// ---------------------------------------------------------------------------
describe('setAppearanceMode', () => {
  it('applies mode styles for system', async () => {
    const mod = await load();
    mod.setAppearanceMode('system');
    expect(mod.getCurrentMode()).toBe('system');
  });

  it('applies mode styles for light', async () => {
    const mod = await load();
    mod.setAppearanceMode('light');
    expect(mod.getCurrentMode()).toBe('light');
  });

  it('applies mode styles for dark', async () => {
    const mod = await load();
    mod.setAppearanceMode('dark');
    expect(mod.getCurrentMode()).toBe('dark');
  });

  it('dispatches theme-changed event', async () => {
    const mod = await load();
    const handler = vi.fn();
    window.addEventListener('openvcs:theme-pack-changed', handler);
    mod.setAppearanceMode('dark');
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('openvcs:theme-pack-changed', handler);
  });
});

// ---------------------------------------------------------------------------
// DOM operations (setStyleContent)
// ---------------------------------------------------------------------------
describe('setStyleContent (via applyModeStyles)', () => {
  it('creates a style element when custom theme provides styles', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'stylish', name: 'Stylish', source: 'user' },
      styles: 'body { color: green; }',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    expect(document.getElementById('openvcs-theme-global')).toBeNull();
    await mod.selectThemePack('stylish');
    const styleEl = document.getElementById('openvcs-theme-global') as HTMLStyleElement;
    expect(styleEl).not.toBeNull();
    expect(styleEl.textContent).toBe('body { color: green; }');
  });

  it('updates existing style element with new content', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'stylish', name: 'Stylish', source: 'user' },
      styles: 'body { color: green; }',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('stylish');
    const styleEl = document.getElementById('openvcs-theme-global') as HTMLStyleElement;
    expect(styleEl.textContent).toBe('body { color: green; }');

    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'stylish', name: 'Stylish', source: 'user' },
      styles: 'body { color: blue; }',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);
    await mod.selectThemePack('stylish');
    expect(styleEl.textContent).toBe('body { color: blue; }');
  });

  it('removes mode-style element when null CSS is passed', async () => {
    const mod = await load();
    mod.setAppearanceMode('light');
    // Mode style should be empty string → removed
    const modeStyle = document.getElementById('openvcs-theme-mode');
    expect(modeStyle).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// syncThemePackAttr (via selectThemePack)
// ---------------------------------------------------------------------------
describe('syncThemePackAttr', () => {
  it('removes attribute for built-in themes', async () => {
    const mod = await load();
    document.documentElement.setAttribute('data-theme-pack', 'stale');
    await mod.selectThemePack('default-light');
    expect(document.documentElement.hasAttribute('data-theme-pack')).toBe(false);
  });

  it('sets attribute for non-default themes', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'custom-pack', name: 'Custom', source: 'user' },
      styles: '',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('custom-pack');
    expect(document.documentElement.getAttribute('data-theme-pack')).toBe('custom-pack');
  });
});

// ---------------------------------------------------------------------------
// sanitizeThemeMarkup (via applyMarkupNodes)
// ---------------------------------------------------------------------------
describe('sanitizeThemeMarkup', () => {
  it('removes script tags from theme markup', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'xss-theme', name: 'XSS Theme', source: 'user' },
      styles: '',
      markup: { head: '<script>alert("xss")</script><meta charset="utf-8">' },
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('xss-theme');
    expect(document.head.querySelector('script')).toBeNull();
    expect(document.head.querySelector('meta[charset="utf-8"]')).not.toBeNull();
  });

  it('removes inline event handlers from theme markup', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'evil', name: 'Evil Theme', source: 'user' },
      styles: '',
      markup: { body: '<button onclick="alert(1)">Click</button>' },
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('evil');
    const btn = document.body.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('onclick')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveThemePackAttrId  (internal)
// ---------------------------------------------------------------------------
describe('resolveThemePackAttrId (via selectThemePack with plugin_id)', () => {
  it('strips plugin_id prefix from attribute id', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'myplugin.magic', name: 'Magic', source: 'user', plugin_id: 'myplugin' },
      styles: '',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('myplugin.magic');
    // Expect plugin_id prefix to be stripped: "myplugin." prefix removed → "magic"
    expect(document.documentElement.getAttribute('data-theme-pack')).toBe('magic');
  });

  it('keeps raw id when plugin_id prefix does not match (line 302)', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'unrelated', name: 'Unrelated', source: 'user', plugin_id: 'otherplugin' },
      styles: '',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('unrelated');
    // rawId = 'unrelated', plugin_id = 'otherplugin', prefix = 'otherplugin.'
    // rawId does NOT start with 'otherplugin.' so returns rawId as-is
    expect(document.documentElement.getAttribute('data-theme-pack')).toBe('unrelated');
  });
});

// ---------------------------------------------------------------------------
// Plugin summaries
// ---------------------------------------------------------------------------
describe('sanitizeSummary (via refreshAvailableThemes)', () => {
  it('sanitizes theme summary fields', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: '  messy  ', name: '  Messy  ', description: '  desc  ', version: '1.0', author: '  Author  ' },
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    const messy = result.find((t) => t.id === 'messy');
    expect(messy).toBeDefined();
    expect(messy!.name).toBe('Messy');
    expect(messy!.description).toBe('desc');
    expect(messy!.version).toBe('1.0');
    expect(messy!.author).toBe('Author');
  });
});

// ---------------------------------------------------------------------------
// resolvePairedThemeId (tested via selectThemePack in system mode)
// ---------------------------------------------------------------------------
describe('paired theme resolution', () => {
  it('pairs registered themes with paired_with field', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'custom-dark', name: 'Custom Dark', appearance: 'dark', paired_with: 'custom-light' },
      { id: 'custom-light', name: 'Custom Light', appearance: 'light', paired_with: 'custom-dark' },
    ]);
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);

    const mod = await load();
    await mod.refreshAvailableThemes();

    // In light system mode, selecting 'custom-dark' should pair to 'custom-light'
    await mod.selectThemePack('custom-dark', { mode: 'system' });
    expect(mod.getActiveThemeId()).toBe('custom-light');
  });

  it('uses heuristic -dark/-light swap when no explicit paired_with', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'my-dark', name: 'My Dark', appearance: 'dark' },
      { id: 'my-light', name: 'My Light', appearance: 'light' },
    ]);

    const mod = await load();
    await mod.refreshAvailableThemes();

    // In light system mode, selecting 'my-dark' should heuristically find 'my-light'
    await mod.selectThemePack('my-dark', { mode: 'system' });
    expect(mod.getActiveThemeId()).toBe('my-light');
  });

  it('uses heuristic _dark/_light swap', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'my_dark', name: 'My Dark', appearance: 'dark' },
      { id: 'my_light', name: 'My Light', appearance: 'light' },
    ]);

    const mod = await load();
    await mod.refreshAvailableThemes();

    await mod.selectThemePack('my_dark', { mode: 'system' });
    expect(mod.getActiveThemeId()).toBe('my_light');
  });

  it('does not pair when appearance already matches system mode (line 73)', async () => {
    // mq.matches = false → light system mode
    // A theme with appearance='light' should NOT pair because it matches
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'my-light', name: 'My Light', appearance: 'light', paired_with: 'my-dark' },
      styles: '',
      markup: null,
      scripts: [],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('my-light', { mode: 'system' });
    // appearance ('light') === target ('light') → returns null from resolvePairedThemeId
    expect(mod.getActiveThemeId()).toBe('my-light');
  });
});

// ---------------------------------------------------------------------------
// ensureSystemListener (via setAppearanceMode & mode changes)
// ---------------------------------------------------------------------------
describe('ensureSystemListener', () => {
  it('only installs the system listener once', async () => {
    const mod = await load();
    mod.setAppearanceMode('system');
    mod.setAppearanceMode('system');
    // addEventListener should have been called only once
    expect(mq.addEventListener).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Clean-up of previous theme assets when switching
// ---------------------------------------------------------------------------
describe('theme switching cleans up old assets', () => {
  it('removes previous head markup when switching to default', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'with-markup', name: 'With Markup', source: 'user' },
      styles: '',
      markup: { head: '<meta name="from-plugin" content="yes">' },
      scripts: ['console.log("old")'],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('with-markup');
    expect(document.head.querySelector('meta[name="from-plugin"]')).not.toBeNull();

    // Switch to default - previous markup should be cleaned
    await mod.selectThemePack('default-light');
    expect(document.head.querySelector('meta[name="from-plugin"]')).toBeNull();
  });

  it('removes previous script nodes when switching themes', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'with-scripts', name: 'With Scripts', source: 'user' },
      styles: '',
      markup: null,
      scripts: ['console.log("first")'],
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('with-scripts');
    const scripts1 = document.head.querySelectorAll('script[data-theme-pack="with-scripts"]');
    expect(scripts1.length).toBe(1);

    // Switch to a different theme
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'other-scripts', name: 'Other', source: 'user' },
      styles: '',
      markup: null,
      scripts: ['console.log("second")'],
    } satisfies ThemePayload);
    await mod.selectThemePack('other-scripts');

    const scriptsV1 = document.head.querySelectorAll('script[data-theme-pack="with-scripts"]');
    expect(scriptsV1.length).toBe(0);
    const scriptsV2 = document.head.querySelectorAll('script[data-theme-pack="other-scripts"]');
    expect(scriptsV2.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge handling for sanitizeSummary
// ---------------------------------------------------------------------------
describe('edge handling', () => {
  it('assigns source "user" for non-default themes without explicit source', async () => {
    const { TAURI } = await import('./lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValue([
      { id: 'user-theme', name: 'User Theme' },
    ]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    const t = result.find((x) => x.id === 'user-theme');
    expect(t?.source).toBe('user');
  });

  it('handles empty plugin summaries array', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue([]);

    const mod = await load();
    const result = await mod.refreshAvailableThemes();
    expect(result).toHaveLength(2);
  });

  it('handles non-array plugin summaries', async () => {
    const { TAURI } = await import('./lib/tauri');
    const { getRegisteredThemeSummaries } = await import('./plugins');
    vi.mocked(TAURI.invoke).mockResolvedValue([]);
    vi.mocked(getRegisteredThemeSummaries).mockReturnValue(null as any);

    const mod = await load();
    // Should not throw
    const result = await mod.refreshAvailableThemes();
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// applyScriptNodes - empty/null scripts
// ---------------------------------------------------------------------------
describe('applyScriptNodes safety', () => {
  it('handles null/undefined scripts in payload gracefully', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'no-scripts', name: 'No Scripts', source: 'user' },
      styles: '',
      markup: null,
      scripts: undefined as any,
    } satisfies ThemePayload);

    const mod = await load();
    await expect(mod.selectThemePack('no-scripts')).resolves.not.toThrow();
  });

  it('filters out non-string scripts', async () => {
    const { getRegisteredThemePayload } = await import('./plugins');
    vi.mocked(getRegisteredThemePayload).mockReturnValue({
      summary: { id: 'bad-scripts', name: 'Bad Scripts', source: 'user' },
      styles: '',
      markup: null,
      scripts: [null, undefined, '' as any, '  ' as any, 'console.log("ok")'] as any,
    } satisfies ThemePayload);

    const mod = await load();
    await mod.selectThemePack('bad-scripts');
    const scripts = document.head.querySelectorAll('script[data-theme-pack="bad-scripts"]');
    expect(scripts.length).toBe(1);
  });
});
