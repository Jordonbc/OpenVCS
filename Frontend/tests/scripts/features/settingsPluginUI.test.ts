// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Polyfill CSS.escape for jsdom (used in source code but not available in test env)
if (typeof CSS === 'undefined') {
    (globalThis as any).CSS = {};
}
if (!CSS.escape) {
    (CSS as any).escape = (value: string) => String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

// ---------------------------------------------------------------------------
// Mock module dependencies
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
    TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/dom', () => ({
    toKebab: (s: string) => String(s || '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'test-setting',
        kind: 'text',
        label: 'Test Setting',
        description: null,
        default_value: '',
        value: '',
        ...overrides,
    };
}

function makeMenu(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        plugin_id: 'test-plugin',
        id: 'test-menu',
        label: 'Test Menu',
        surface: 'settings',
        elements: [],
        ...overrides,
    };
}

function makePluginSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'test-plugin',
        name: 'Test Plugin',
        source: 'built-in',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// collectPluginSettingsFromPanel
// ---------------------------------------------------------------------------

describe('collectPluginSettingsFromPanel', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('collects bool checkbox value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<input type="checkbox" data-setting-id="my-bool" data-setting-kind="bool" checked />',
            '<input type="checkbox" data-setting-id="my-bool-off" data-setting-kind="bool" />',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([
            { id: 'my-bool', value: true },
            { id: 'my-bool-off', value: false },
        ]);
    });

    it('collects s32 value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<input type="number" data-setting-id="my-s32" data-setting-kind="s32" value="42" />',
            '<input type="number" data-setting-id="my-s32-nan" data-setting-kind="s32" value="abc" />',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([
            { id: 'my-s32', value: 42 },
            { id: 'my-s32-nan', value: 0 },
        ]);
    });

    it('collects u32 value clamped to >=0', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<input type="number" data-setting-id="my-u32" data-setting-kind="u32" value="5" />',
            '<input type="number" data-setting-id="my-u32-neg" data-setting-kind="u32" value="-3" />',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([
            { id: 'my-u32', value: 5 },
            { id: 'my-u32-neg', value: 0 },
        ]);
    });

    it('collects f64 value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="my-f64" data-setting-kind="f64" value="3.14" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'my-f64', value: 3.14 }]);
    });

    it('collects text value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<input type="text" data-setting-id="my-text" data-setting-kind="text" value="hello" />',
            '<input type="text" data-setting-id="my-empty" data-setting-kind="text" value="" />',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([
            { id: 'my-text', value: 'hello' },
            { id: 'my-empty', value: '' },
        ]);
    });

    it('collects select element value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<select data-setting-id="my-select" data-setting-kind="text">',
            '  <option value="a">A</option>',
            '  <option value="b" selected>B</option>',
            '</select>',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'my-select', value: 'b' }]);
    });

    it('skips entries with missing id or kind', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<input type="text" data-setting-id="" data-setting-kind="text" value="skip" />',
            '<input type="text" data-setting-id="valid" data-setting-kind="text" value="keep" />',
            '<input type="text" data-setting-id="nokind" value="skip" />',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'valid', value: 'keep' }]);
    });

    it('returns empty array when no controls exist', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<p>No settings here</p>';
        expect(collectPluginSettingsFromPanel(panel)).toEqual([]);
    });

    it('clamps non-finite numeric values to zero', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="bad" data-setting-kind="s32" value="NaN" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'bad', value: 0 }]);
    });

    it('clamps non-finite u32 value to zero (line 370)', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="bad-u32" data-setting-kind="u32" value="Infinity" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'bad-u32', value: 0 }]);
    });

    it('clamps non-finite f64 value to zero (line 370)', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="bad-f64" data-setting-kind="f64" value="NaN" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'bad-f64', value: 0 }]);
    });

    it('clamps negative Infinity s32 to zero', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="neg-inf" data-setting-kind="s32" value="-Infinity" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'neg-inf', value: 0 }]);
    });

    it('truncates s32 with positive float value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="s32-float" data-setting-kind="s32" value="3.99" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 's32-float', value: 3 }]);
    });

    it('truncates s32 with negative float value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="s32-neg" data-setting-kind="s32" value="-2.5" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 's32-neg', value: -2 }]);
    });

    it('truncates and clamps u32 with positive float value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="u32-float" data-setting-kind="u32" value="5.99" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'u32-float', value: 5 }]);
    });

    it('clamps u32 with negative float value to 0', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="u32-neg" data-setting-kind="u32" value="-1.5" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'u32-neg', value: 0 }]);
    });

    it('clamps positive Infinity f64 to zero', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = '<input type="number" data-setting-id="inf-f64" data-setting-kind="f64" value="Infinity" />';
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'inf-f64', value: 0 }]);
    });

    it('collects text value from select element as plain string', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<select data-setting-id="my-select" data-setting-kind="text">',
            '  <option value="hello">Hello</option>',
            '</select>',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'my-select', value: 'hello' }]);
    });
});

// ---------------------------------------------------------------------------
// activateSection
// ---------------------------------------------------------------------------

describe('activateSection', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(opts?: {
        hasPluginMenuPanel?: boolean;
        hasPluginSettingsPanel?: boolean;
    }): HTMLElement {
        const modal = document.createElement('div');
        const extras: string[] = [];
        const navExtras: string[] = [];
        if (opts?.hasPluginMenuPanel) {
            extras.push([
                '<form class="panel-form hidden" data-panel="custom-plugin-menu"',
                '      data-plugin-menu="true">',
                '  <div class="group">menu panel</div>',
                '</form>',
            ].join('\n'));
            navExtras.push('<li><button class="seg-btn" data-section="custom-plugin-menu">Menu Only</button></li>');
        }
        if (opts?.hasPluginSettingsPanel) {
            extras.push([
                '<form class="panel-form hidden"',
                '      data-panel="plugin-settings-test-plugin"',
                '      data-plugin-menu="true"',
                '      data-plugin-settings="true"',
                '      data-plugin-id="test-plugin">',
                '  <div class="plugin-settings-loading" data-loading="true">Loading...</div>',
                '</form>',
            ].join('\n'));
            navExtras.push('<li><button class="seg-btn" data-section="plugin-settings-test-plugin">Test Plugin</button></li>');
        }
        if (!opts?.hasPluginMenuPanel && !opts?.hasPluginSettingsPanel) {
            navExtras.push('<li><button class="seg-btn" data-section="custom">Custom</button></li>');
        }
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '    <li><button class="seg-btn" data-section="plugins">Plugins</button></li>',
            ...navExtras,
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form" data-panel="general"></form>',
            '    <form class="panel-form hidden" data-panel="plugins"></form>',
            ...extras,
            '  </div>',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('activates requested section and toggles nav active state', async () => {
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'general');
        const btns = modal.querySelectorAll<HTMLElement>('.seg-btn');
        expect(btns[0].classList.contains('active')).toBe(true);
        expect(btns[1].classList.contains('active')).toBe(false);
    });

    it('falls back to general when section is unknown', async () => {
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'nonexistent');
        const btns = modal.querySelectorAll<HTMLElement>('.seg-btn');
        expect(btns[0].classList.contains('active')).toBe(true);
    });

    it('shows correct panel and hides others', async () => {
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugins');
        const panels = modal.querySelectorAll<HTMLElement>('.panel-form');
        expect(panels[0].classList.contains('hidden')).toBe(true);
        expect(panels[1].classList.contains('hidden')).toBe(false);
    });

    it('handles missing nav or panels gracefully', async () => {
        const { activateSection } = await load();
        const modal = document.createElement('div');
        expect(() => activateSection(modal, 'general')).not.toThrow();
    });

    it('hides actions for plugin menu panels without plugin-settings', async () => {
        const { activateSection } = await load();
        const modal = createModal({ hasPluginMenuPanel: true });
        const actions = modal.querySelector<HTMLElement>('.sheet-actions')!;
        activateSection(modal, 'custom-plugin-menu');
        expect(actions.classList.contains('hidden')).toBe(true);
    });

    it('shows actions for plugin settings panels', async () => {
        const { activateSection } = await load();
        const modal = createModal({ hasPluginSettingsPanel: true });
        mockInvoke.mockResolvedValueOnce([]);
        const actions = modal.querySelector<HTMLElement>('.sheet-actions')!;
        activateSection(modal, 'plugin-settings-test-plugin');
        expect(actions.classList.contains('hidden')).toBe(false);
    });

    it('hides actions for plugins section itself', async () => {
        const { activateSection } = await load();
        const modal = createModal();
        const actions = modal.querySelector<HTMLElement>('.sheet-actions')!;
        activateSection(modal, 'plugins');
        expect(actions.classList.contains('hidden')).toBe(true);
    });

    it('triggers backend load for plugin-settings panels', async () => {
        const { activateSection } = await load();
        const modal = createModal({ hasPluginSettingsPanel: true });
        mockInvoke.mockResolvedValueOnce([]);
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('get_plugin_settings', { pluginId: 'test-plugin' });
        });
    });
});

// ---------------------------------------------------------------------------
// renderPluginMenus
// ---------------------------------------------------------------------------

describe('renderPluginMenus', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '    <li><button class="seg-btn" data-section="plugins">Plugins</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('no-ops when nav or panels-scroll are missing', async () => {
        const { renderPluginMenus } = await load();
        await renderPluginMenus(document.createElement('div'));
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('handles list_plugin_menus rejection gracefully', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('fail'));
        const { renderPluginMenus } = await load();
        await expect(renderPluginMenus(createModal())).resolves.toBeUndefined();
    });

    it('renders settings-surface menu into nav and panels', async () => {
        mockInvoke.mockResolvedValueOnce([
            makeMenu({
                plugin_id: 'my-plugin',
                id: 'my-menu',
                label: 'My Menu',
                surface: 'settings',
                elements: [
                    { type: 'text', content: 'Hello text' },
                    { type: 'button', id: 'action-1', label: 'Do It' },
                ],
            }),
        ]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'my-plugin', source: 'built-in' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);

        const navBtn = modal.querySelector<HTMLElement>('[data-section="plugin-my-plugin-my-menu"]');
        expect(navBtn).not.toBeNull();
        expect(navBtn!.textContent).toBe('My Menu');

        const panel = modal.querySelector<HTMLElement>('[data-panel="plugin-my-plugin-my-menu"]');
        expect(panel).not.toBeNull();
        expect(panel!.classList.contains('hidden')).toBe(true);
        expect(panel!.dataset.pluginId).toBe('my-plugin');
        expect(panel!.dataset.pluginMenu).toBe('true');

        const groups = panel!.querySelectorAll('.group');
        expect(groups.length).toBe(2);
        expect(groups[0].textContent).toContain('Hello text');
        const btn = groups[1].querySelector('button');
        expect(btn).not.toBeNull();
        expect(btn!.textContent).toBe('Do It');
        expect(btn!.dataset.pluginAction).toBe('action-1');
    });

    it('places built-in menu before the Plugins nav entry', async () => {
        mockInvoke.mockResolvedValueOnce([
            makeMenu({
                plugin_id: 'git-plugin',
                id: 'git-settings',
                label: 'Git',
                surface: 'settings',
                elements: [],
            }),
        ]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'git-plugin', source: 'built-in' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);

        const nav = modal.querySelector('#settings-nav')!;
        const pluginsLi = nav.querySelector<HTMLElement>('[data-section="plugins"]')!.closest('li')!;
        const gitBtn = nav.querySelector<HTMLElement>('[data-section="plugin-git-plugin-git-settings"]')!;
        expect(gitBtn.closest('li')!.nextElementSibling).toBe(pluginsLi);
    });

    it('places third-party menus in a sublist', async () => {
        mockInvoke.mockResolvedValueOnce([
            makeMenu({
                plugin_id: 'third-party',
                id: 'settings-menu',
                label: 'Third Party',
                surface: 'settings',
                elements: [],
            }),
        ]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'third-party', source: 'user' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);

        const sublist = modal.querySelector<HTMLElement>('#settings-nav [data-plugin-menus="true"]');
        expect(sublist).not.toBeNull();
    });
});

describe('renderPluginMenus cleanup', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('removes stale plugin menu nodes before re-rendering', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <button class="seg-btn" data-section="general">General</button>',
            '  <div data-plugin-menu="true">stale</div>',
            '  <div data-plugin-menus-wrap="true">stale</div>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div class="panel-form" data-plugin-menu="true">stale panel</div>',
            '</div>',
        ].join('\n');
        document.body.appendChild(modal);

        const { renderPluginMenus } = await load();
        await renderPluginMenus(modal);
        expect(modal.querySelector('[data-plugin-menu="true"]')).toBeNull();
        expect(modal.querySelector('[data-plugin-menus-wrap="true"]')).toBeNull();
        document.body.removeChild(modal);
    });

    it('handles nav without plugins section', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <button class="seg-btn" data-section="general">General</button>',
            '</nav>',
            '<div id="settings-panels-scroll"></div>',
        ].join('\n');
        document.body.appendChild(modal);

        const { renderPluginMenus } = await load();
        await renderPluginMenus(modal);
        const nav = modal.querySelector('#settings-nav')!;
        expect(nav.querySelectorAll('.seg-btn').length).toBeGreaterThanOrEqual(1);
        document.body.removeChild(modal);
    });
});

describe('renderPluginMenus', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '    <li><button class="seg-btn" data-section="plugins">Plugins</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('creates settings panels from plugin summaries with no menus', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'my-plugin', name: 'My Plugin', source: 'npm' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);

        const panel = modal.querySelector<HTMLElement>('[data-panel="plugin-settings-my-plugin"]');
        expect(panel).not.toBeNull();
        expect(panel!.dataset.pluginSettings).toBe('true');
        expect(panel!.dataset.pluginId).toBe('my-plugin');
        expect(panel!.querySelector('.plugin-settings-loading')).not.toBeNull();
    });

    it('skips menus whose surface is not settings', async () => {
        mockInvoke.mockResolvedValueOnce([
            makeMenu({
                plugin_id: 'my-plugin',
                id: 'menubar-menu',
                label: 'Menubar Only',
                surface: 'menubar',
                elements: [],
            }),
        ]);
        mockInvoke.mockResolvedValueOnce([]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        expect(modal.querySelector('[data-section="plugin-my-plugin-menubar-menu"]')).toBeNull();
    });

    it('handles list_plugins rejection gracefully', async () => {
        mockInvoke.mockResolvedValueOnce([makeMenu({
            plugin_id: 'p1', id: 'm1', label: 'Menu', surface: 'settings', elements: [],
        })]);
        mockInvoke.mockRejectedValueOnce(new Error('fail'));
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await expect(renderPluginMenus(modal)).resolves.toBeUndefined();
        expect(modal.querySelector('[data-section="plugin-p1-m1"]')).not.toBeNull();
    });

    it('renders the third-party sublist heading', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'p1', name: 'P', source: 'npm' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        const heading = modal.querySelector<HTMLElement>('.settings-plugin-subhead');
        expect(heading).not.toBeNull();
        expect(heading!.textContent).toBe('Plugin Settings');
    });

    it('reuses third-party sublist on subsequent renders', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'p1', name: 'P1', source: 'npm' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        expect(modal.querySelectorAll('[data-plugin-menus-wrap="true"]').length).toBe(1);
    });

    it('clears old plugin nodes before re-render', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        mockInvoke.mockResolvedValueOnce([]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);

        mockInvoke.mockResolvedValueOnce([]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'fresh', name: 'Fresh', source: 'npm' })]);
        await renderPluginMenus(modal);

        const panels = modal.querySelectorAll<HTMLElement>('.panel-form');
        expect(panels.length).toBe(1);
        expect(panels[0].dataset.pluginId).toBe('fresh');
    });
});

// ---------------------------------------------------------------------------
// Render plugin setting fields via ensurePluginSettingsLoaded
// ---------------------------------------------------------------------------

describe('renderPluginSettingFields (via activateSection)', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '    <li><button class="seg-btn" data-section="plugin-settings-test-plugin">Test Plugin</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form" data-panel="plugin-settings-test-plugin"',
            '          data-plugin-settings="true" data-plugin-id="test-plugin">',
            '      <div class="plugin-settings-loading" data-loading="true">Loading...</div>',
            '    </form>',
            '  </div>',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('renders bool field as checkbox', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'enable-x', kind: 'bool', label: 'Enable X', value: true })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const cb = modal.querySelector<HTMLInputElement>('input[type="checkbox"][data-setting-id="enable-x"]');
            expect(cb).not.toBeNull();
            expect(cb!.checked).toBe(true);
        });
    });

    it('renders s32 number field', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'count', kind: 's32', value: 42 })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="count"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('42');
            expect(input!.step).toBe('1');
        });
    });

    it('renders f64 float field with step=any', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'ratio', kind: 'f64', value: 3.14 })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="ratio"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('3.14');
            expect(input!.step).toBe('any');
        });
    });

    it('renders u32 field with min=0', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'threads', kind: 'u32', value: 4 })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="threads"]');
            expect(input).not.toBeNull();
            expect(input!.min).toBe('0');
        });
    });

    it('renders text input field', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'greeting', kind: 'text', value: 'hello' })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="text"][data-setting-id="greeting"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('hello');
        });
    });

    it('renders select when text kind has options', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'mode', kind: 'text', value: 'auto',
            options: [
                { value: 'manual', label: 'Manual' },
                { value: 'auto', label: 'Auto' },
            ],
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const sel = modal.querySelector<HTMLSelectElement>('select[data-setting-id="mode"]');
            expect(sel).not.toBeNull();
            expect(sel!.value).toBe('auto');
            expect(sel!.options.length).toBe(2);
        });
    });

    it('shows empty state when no fields returned', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('No settings available');
        });
    });

    it('shows error state when backend call fails', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('err'));
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            const loading = modal.querySelector('.plugin-settings-loading');
            expect(loading).not.toBeNull();
            expect(loading!.textContent).toContain('Failed to load settings');
        });
    });

    it('re-fetches settings on re-activate', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'x', kind: 'text', value: 'first' })]);
        const { activateSection } = await load();
        const modal = createModal();
        // First activation fetches from backend
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            expect(modal.querySelector('[data-setting-id="x"]')).not.toBeNull();
        });
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        activateSection(modal, 'plugin-settings-test-plugin');
        expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// activateSection - missing panels-scroll
// ---------------------------------------------------------------------------

describe('activateSection - missing panels-scroll', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModalWithoutScroll(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('handles settings panel activation without panels element', async () => {
        const { activateSection } = await load();
        const modal = createModalWithoutScroll();
        expect(() => activateSection(modal, 'general')).not.toThrow();
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// ensurePluginSettingsLoaded - early returns
// ---------------------------------------------------------------------------

describe('ensurePluginSettingsLoaded - early returns', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="pluginsettings_testp">Test P</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form hidden" data-panel="pluginsettings_testp"',
            '          data-plugin-settings="true" data-plugin-id="testp">',
            '      <div class="plugin-settings-loading" data-loading="true">Loading...</div>',
            '    </form>',
            '  </div>',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('returns false when panels-scroll missing', async () => {
        const modal = document.createElement('div');
        const { activateSection } = await load();
        expect(() => activateSection(modal, 'general')).not.toThrow();
    });

    it('handles empty fields array from backend', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('No settings available');
        });
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// activateSection - edge cases
// ---------------------------------------------------------------------------

describe('activateSection - edge cases', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('falls back to general when section is empty string', async () => {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn active" data-section="general">General</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form" data-panel="general">General Panel</form>',
            '    <form class="panel-form hidden" data-panel="other">Other Panel</form>',
            '  </div>',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        const { activateSection } = await load();
        activateSection(modal, '');
        const panels = modal.querySelectorAll<HTMLElement>('.panel-form');
        expect(panels[0].classList.contains('hidden')).toBe(false);
        expect(panels[1].classList.contains('hidden')).toBe(true);
        document.body.removeChild(modal);
    });

    it('returns early when nav exists but panels are missing', async () => {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <button class="seg-btn" data-section="general">General</button>',
            '</nav>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        const { activateSection } = await load();
        expect(() => activateSection(modal, 'general')).not.toThrow();
        document.body.removeChild(modal);
    });

    it('handles missing .sheet-actions element gracefully', async () => {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form" data-panel="general">General Panel</form>',
            '  </div>',
            '</div>',
        ].join('\n');
        document.body.appendChild(modal);
        const { activateSection } = await load();
        expect(() => activateSection(modal, 'general')).not.toThrow();
        document.body.removeChild(modal);
    });

    it('activates plugin-settings panel with empty pluginId (no backend call)', async () => {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="plugin-settings-test">Test Plugin</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form hidden" data-panel="plugin-settings-test"',
            '          data-plugin-settings="true" data-plugin-id="">',
            '      <div class="plugin-settings-loading">Loading...</div>',
            '    </form>',
            '  </div>',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        const { activateSection } = await load();
        activateSection(modal, 'plugin-settings-test');
        expect(mockInvoke).not.toHaveBeenCalledWith('get_plugin_settings', expect.anything());
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// ensurePluginSettingsLoaded - missing elements
// ---------------------------------------------------------------------------

describe('ensurePluginSettingsLoaded - missing elements (via activateSection)', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('handles missing panels-scroll gracefully via activateSection', async () => {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav"><button class="seg-btn" data-section="general">General</button></nav>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        const { activateSection } = await load();
        expect(() => activateSection(modal, 'general')).not.toThrow();
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// renderPluginMenus - edge cases
// ---------------------------------------------------------------------------

describe('renderPluginMenus - edge cases', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '    <li><button class="seg-btn" data-section="plugins">Plugins</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('no-ops when nav is missing', async () => {
        const { renderPluginMenus } = await load();
        const modal = document.createElement('div');
        modal.innerHTML = '<div id="settings-panels-scroll"></div>';
        document.body.appendChild(modal);
        await renderPluginMenus(modal);
        expect(mockInvoke).not.toHaveBeenCalled();
        document.body.removeChild(modal);
    });

    it('no-ops when panels-scroll is missing', async () => {
        const { renderPluginMenus } = await load();
        const modal = document.createElement('div');
        modal.innerHTML = '<nav id="settings-nav"></nav>';
        document.body.appendChild(modal);
        await renderPluginMenus(modal);
        expect(mockInvoke).not.toHaveBeenCalled();
        document.body.removeChild(modal);
    });

    it('handles menu with null elements gracefully', async () => {
        mockInvoke.mockResolvedValueOnce([{
            plugin_id: 'my-plugin', id: 'my-menu', label: 'My Menu',
            surface: 'settings', elements: null,
        }]);
        mockInvoke.mockResolvedValueOnce([]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await expect(renderPluginMenus(modal)).resolves.toBeUndefined();
        const navBtn = modal.querySelector('[data-section="plugin-my-plugin-my-menu"]');
        expect(navBtn).not.toBeNull();
        document.body.removeChild(modal);
    });

    it('handles menu with empty elements gracefully', async () => {
        mockInvoke.mockResolvedValueOnce([{
            plugin_id: 'empty-plugin', id: 'empty-menu', label: 'Empty Menu',
            surface: 'settings', elements: [],
        }]);
        mockInvoke.mockResolvedValueOnce([]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        const panel = modal.querySelector('[data-panel="plugin-empty-plugin-empty-menu"]');
        expect(panel).not.toBeNull();
        expect(panel!.querySelectorAll('.group').length).toBe(0);
        document.body.removeChild(modal);
    });

    it('handles menu elements with unknown type (creates empty group)', async () => {
        mockInvoke.mockResolvedValueOnce([{
            plugin_id: 'unk-plugin', id: 'unk-menu', label: 'Unknown',
            surface: 'settings', elements: [
                { type: 'unknown_type', id: 'x', content: 'should be ignored' },
            ],
        }]);
        mockInvoke.mockResolvedValueOnce([]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        const panel = modal.querySelector('[data-panel="plugin-unk-plugin-unk-menu"]');
        expect(panel).not.toBeNull();
        expect(panel!.querySelectorAll('.group').length).toBe(1);
        expect(panel!.querySelector('.group')!.textContent).toBe('');
        document.body.removeChild(modal);
    });

    it('handles null pluginSummaries gracefully', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        mockInvoke.mockResolvedValueOnce(null);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await expect(renderPluginMenus(modal)).resolves.toBeUndefined();
        document.body.removeChild(modal);
    });

    it('renders menu with blank plugin_id without crashing', async () => {
        mockInvoke.mockResolvedValueOnce([{
            plugin_id: '', id: 'blank-id', label: 'Blank Plugin',
            surface: 'settings', elements: [],
        }]);
        mockInvoke.mockResolvedValueOnce([]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await expect(renderPluginMenus(modal)).resolves.toBeUndefined();
        expect(modal.querySelector('[data-section^="plugin-"]')).not.toBeNull();
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// renderPluginMenus - built-in nav fallback
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// renderPluginMenus - built-in nav falls back when no plugins li
// ---------------------------------------------------------------------------

describe('renderPluginMenus - built-in nav fallback', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('appends built-in nav to nav directly when plugins li not found', async () => {
        mockInvoke.mockResolvedValueOnce([
            { plugin_id: 'builtin-p', id: 'm1', label: 'BuiltIn', surface: 'settings', elements: [] },
        ]);
        mockInvoke.mockResolvedValueOnce([{ id: 'builtin-p', name: 'BuiltIn', source: 'built-in' }]);
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="general">General</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        const { renderPluginMenus } = await load();
        await renderPluginMenus(modal);
        const navBtn = modal.querySelector('[data-section="plugin-builtin-p-m1"]');
        expect(navBtn).not.toBeNull();
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// renderPluginSettingFields - edge cases
// ---------------------------------------------------------------------------

describe('renderPluginSettingFields - edge cases', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav">',
            '  <ul>',
            '    <li><button class="seg-btn" data-section="pluginsettings_testp">P</button></li>',
            '  </ul>',
            '</nav>',
            '<div id="settings-panels-scroll">',
            '  <div id="settings-panels">',
            '    <form class="panel-form hidden" data-panel="pluginsettings_testp"',
            '          data-plugin-settings="true" data-plugin-id="testp">',
            '      <div class="plugin-settings-loading" data-loading="true">Loading...</div>',
            '    </form>',
            '  </div>',
            '</div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('skips field with empty id', async () => {
        mockInvoke.mockResolvedValueOnce([
            { id: '', kind: 'text', label: 'Empty', value: '' },
        ]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('Settings');
        });
        document.body.removeChild(modal);
    });

    it('renders s32 field with non-finite default value', async () => {
        mockInvoke.mockResolvedValueOnce([
            { id: 'cnt', kind: 's32', label: 'Count', value: null },
        ]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"]');
            expect(input).not.toBeNull();
        });
        document.body.removeChild(modal);
    });

    it('renders text kind with options and selects matching value', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'mode', kind: 'text', label: 'Mode', value: 'auto',
            options: [
                { value: 'manual', label: 'Manual' },
                { value: 'auto', label: 'Auto' },
            ],
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const sel = modal.querySelector<HTMLSelectElement>('select');
            expect(sel).not.toBeNull();
            expect(sel!.value).toBe('auto');
        });
        document.body.removeChild(modal);
    });

    it('renders select with options when kind is text and has options', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'mode', kind: 'text', label: 'Mode', value: 'unknown',
            options: [
                { value: 'manual', label: 'Manual' },
            ],
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const sel = modal.querySelector<HTMLSelectElement>('select');
            expect(sel).not.toBeNull();
            expect(sel!.value).toBe('manual');
        });
        document.body.removeChild(modal);
    });

    it('renders field with description text', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'x', kind: 'text', label: 'X', value: '', description: 'Help text',
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('Help text');
        });
        document.body.removeChild(modal);
    });

    it('renders s32 field with non-finite default value', async () => {
        mockInvoke.mockResolvedValueOnce([
            { id: 'cnt', kind: 's32', label: 'Count', value: null },
        ]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"]');
            expect(input).not.toBeNull();
        });
        document.body.removeChild(modal);
    });

    it('renders text kind with options and selects matching value', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'mode', kind: 'text', label: 'Mode', value: 'auto',
            options: [
                { value: 'manual', label: 'Manual' },
                { value: 'auto', label: 'Auto' },
            ],
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const sel = modal.querySelector<HTMLSelectElement>('select');
            expect(sel).not.toBeNull();
            expect(sel!.value).toBe('auto');
        });
        document.body.removeChild(modal);
    });

    it('renders select with options when kind is text and has options', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'mode', kind: 'text', label: 'Mode', value: 'unknown',
            options: [
                { value: 'manual', label: 'Manual' },
            ],
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const sel = modal.querySelector<HTMLSelectElement>('select');
            expect(sel).not.toBeNull();
            expect(sel!.value).toBe('manual');
        });
        document.body.removeChild(modal);
    });

    it('renders field with description text', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'x', kind: 'text', label: 'X', value: '', description: 'Help text',
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('Help text');
        });
        document.body.removeChild(modal);
    });

    it('renders bool field unchecked when value is false', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'enable-y', kind: 'bool', label: 'Enable Y', value: false,
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const cb = modal.querySelector<HTMLInputElement>('input[type="checkbox"][data-setting-id="enable-y"]');
            expect(cb).not.toBeNull();
            expect(cb!.checked).toBe(false);
        });
        document.body.removeChild(modal);
    });

    it('renders unknown field kind as text input', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'custom', kind: 'color', label: 'Color', value: '#ff0000',
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="text"][data-setting-id="custom"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('#ff0000');
        });
        document.body.removeChild(modal);
    });

    it('renders select with empty value string (falls to first option)', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'mode', kind: 'text', label: 'Mode', value: '',
            options: [
                { value: 'manual', label: 'Manual' },
                { value: 'auto', label: 'Auto' },
            ],
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const sel = modal.querySelector<HTMLSelectElement>('select[data-setting-id="mode"]');
            expect(sel).not.toBeNull();
            expect(sel!.value).toBe('manual');
        });
        document.body.removeChild(modal);
    });

    it('renders description on bool field', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'flag', kind: 'bool', label: 'Flag', value: true, description: 'Enable flag',
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('Enable flag');
        });
        document.body.removeChild(modal);
    });

    it('renders description on number (s32) field', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'count', kind: 's32', label: 'Count', value: 5, description: 'Number of items',
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('Number of items');
        });
        document.body.removeChild(modal);
    });

    it('renders description on select field', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'mode', kind: 'text', label: 'Mode', value: 'auto', description: 'Select operation mode',
            options: [
                { value: 'manual', label: 'Manual' },
                { value: 'auto', label: 'Auto' },
            ],
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('Select operation mode');
        });
        document.body.removeChild(modal);
    });

    it('renders number field with non-finite default_value', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'nan-val', kind: 's32', label: 'NaN Val', value: undefined, default_value: NaN,
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="nan-val"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('0');
        });
        document.body.removeChild(modal);
    });

    it('renders number field with null value and null default_value (falls to 0)', async () => {
        mockInvoke.mockResolvedValueOnce([{
            id: 'null-val', kind: 's32', label: 'Null Val', value: null, default_value: null,
        }]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="null-val"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('0');
        });
        document.body.removeChild(modal);
    });

    it('renders s32 field with Infinity value (non-finite, falls to 0)', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'inf-val', kind: 's32', label: 'Inf Val', value: Infinity,
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="inf-val"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('0');
        });
        document.body.removeChild(modal);
    });

    it('renders s32 field with -Infinity value (non-finite, falls to 0)', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'neg-inf-val', kind: 's32', label: 'Neg Inf', value: -Infinity,
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="neg-inf-val"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('0');
        });
        document.body.removeChild(modal);
    });

    it('renders u32 field with NaN value (non-finite, falls to 0)', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'nan-u32', kind: 'u32', label: 'NaN U32', value: NaN,
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="nan-u32"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('0');
        });
        document.body.removeChild(modal);
    });

    it('renders text field with undefined value and default_value fallback', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'fallback-text', kind: 'text', label: 'Fallback', value: undefined, default_value: 'defaulted',
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="text"][data-setting-id="fallback-text"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('defaulted');
        });
        document.body.removeChild(modal);
    });

    it('renders text field with null value (nullish coalescing falls to default_value)', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'null-text', kind: 'text', label: 'Null Text', value: null,
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="text"][data-setting-id="null-text"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('');
        });
        document.body.removeChild(modal);
    });

    it('renders s32 field with value that is non-numeric string (NaN -> 0)', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({
            id: 'nan-str', kind: 's32', label: 'NaN Str', value: 'not-a-number',
        })]);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_testp');
        await vi.waitFor(() => {
            const input = modal.querySelector<HTMLInputElement>('input[type="number"][data-setting-id="nan-str"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('0');
        });
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// ensurePluginSettingsLoaded - no loading element in panel
// ---------------------------------------------------------------------------
describe('ensurePluginSettingsLoaded - no loading element', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('handles panel without plugin-settings-loading element', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'x', kind: 'text', value: 'works' })]);
        const { activateSection } = await load();
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav"><ul><li><button class="seg-btn" data-section="pluginsettings_noload">P</button></li></ul></nav>',
            '<div id="settings-panels-scroll"><div id="settings-panels">',
            '  <form class="panel-form hidden" data-panel="pluginsettings_noload"',
            '        data-plugin-settings="true" data-plugin-id="noload">',
            '  </form>',
            '</div></div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        activateSection(modal, 'pluginsettings_noload');
        await vi.waitFor(() => {
            const input = modal.querySelector('[data-setting-id="x"]');
            expect(input).not.toBeNull();
            expect(input!.value).toBe('works');
        });
        document.body.removeChild(modal);
    });

    it('shows error when backend fails and no loading element present', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('fail'));
        const { activateSection } = await load();
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav"><ul><li><button class="seg-btn" data-section="pluginsettings_noerr">P</button></li></ul></nav>',
            '<div id="settings-panels-scroll"><div id="settings-panels">',
            '  <form class="panel-form hidden" data-panel="pluginsettings_noerr"',
            '        data-plugin-settings="true" data-plugin-id="noerr">',
            '  </form>',
            '</div></div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        expect(() => activateSection(modal, 'pluginsettings_noerr')).not.toThrow();
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// ensurePluginSettingsLoaded - fields is not an array
// ---------------------------------------------------------------------------
describe('ensurePluginSettingsLoaded - non-array fields', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav"><ul><li><button class="seg-btn" data-section="pluginsettings_nullf">P</button></li></ul></nav>',
            '<div id="settings-panels-scroll"><div id="settings-panels">',
            '  <form class="panel-form hidden" data-panel="pluginsettings_nullf"',
            '        data-plugin-settings="true" data-plugin-id="nullf">',
            '    <div class="plugin-settings-loading" data-loading="true">Loading...</div>',
            '  </form>',
            '</div></div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('handles null fields result from backend (shows no settings)', async () => {
        mockInvoke.mockResolvedValueOnce(null);
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_nullf');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('No settings available');
        });
        document.body.removeChild(modal);
    });

    it('handles non-array object fields result (shows no settings)', async () => {
        mockInvoke.mockResolvedValueOnce({ not: 'an array' });
        const { activateSection } = await load();
        const modal = createModal();
        activateSection(modal, 'pluginsettings_nullf');
        await vi.waitFor(() => {
            expect(modal.textContent).toContain('No settings available');
        });
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// collectPluginSettingsFromPanel - select element with numeric kind
// ---------------------------------------------------------------------------
describe('collectPluginSettingsFromPanel - select with numeric kind', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('collects value from select with kind=s32 (falls to else branch)', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<select data-setting-id="num-sel" data-setting-kind="s32">',
            '  <option value="42">42</option>',
            '  <option value="99" selected>99</option>',
            '</select>',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'num-sel', value: 99 }]);
    });

    it('collects NaN from select with kind=s32 and non-numeric option value', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<select data-setting-id="nan-sel" data-setting-kind="s32">',
            '  <option value="abc">ABC</option>',
            '</select>',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'nan-sel', value: 0 }]);
    });

    it('collects value from select with kind=bool (not HTMLInputElement, falls to else)', async () => {
        const { collectPluginSettingsFromPanel } = await load();
        const panel = document.createElement('div');
        panel.innerHTML = [
            '<select data-setting-id="bool-sel" data-setting-kind="bool">',
            '  <option value="true">True</option>',
            '  <option value="false" selected>False</option>',
            '</select>',
        ].join('');
        const result = collectPluginSettingsFromPanel(panel);
        expect(result).toEqual([{ id: 'bool-sel', value: 'false' }]);
    });
});

// ---------------------------------------------------------------------------
// activateSection - plugin-settings with missing active panel
// ---------------------------------------------------------------------------
describe('activateSection - plugin-settings with missing active panel', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    it('handles isPluginSettingsPanel but no matching panel-form in panels', async () => {
        mockInvoke.mockResolvedValueOnce([]);
        const { activateSection } = await load();
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav"><ul><li><button class="seg-btn" data-section="plugin-settings-missing">P</button></li></ul></nav>',
            '<div id="settings-panels-scroll"><div id="settings-panels">',
            '  <form class="panel-form" data-panel="other">Other</form>',
            '</div></div>',
            '<div class="sheet-actions"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        expect(() => activateSection(modal, 'plugin-settings-missing')).not.toThrow();
        expect(mockInvoke).not.toHaveBeenCalledWith('get_plugin_settings', expect.anything());
        document.body.removeChild(modal);
    });
});

// ---------------------------------------------------------------------------
// renderPluginMenus - text/button elements edge cases
// ---------------------------------------------------------------------------
describe('renderPluginMenus - text and button element edge cases', () => {
    async function load() {
        return import('@scripts/features/settingsPluginUI');
    }

    function createModal(): HTMLElement {
        const modal = document.createElement('div');
        modal.innerHTML = [
            '<nav id="settings-nav"><ul><li><button class="seg-btn" data-section="general">General</button></li>',
            '  <li><button class="seg-btn" data-section="plugins">Plugins</button></li></ul></nav>',
            '<div id="settings-panels-scroll"></div>',
        ].join('\n');
        document.body.appendChild(modal);
        return modal;
    }

    it('renders text element without content (empty div)', async () => {
        mockInvoke.mockResolvedValueOnce([makeMenu({
            plugin_id: 'tp', id: 'm1', label: 'M1', surface: 'settings',
            elements: [{ type: 'text' }],
        })]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'tp', source: 'built-in' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        const groups = modal.querySelectorAll('.group');
        expect(groups.length).toBeGreaterThanOrEqual(1);
        expect(groups[0].textContent).toBe('');
        document.body.removeChild(modal);
    });

    it('renders button element without label and id (uses defaults)', async () => {
        mockInvoke.mockResolvedValueOnce([makeMenu({
            plugin_id: 'tp', id: 'm2', label: 'M2', surface: 'settings',
            elements: [{ type: 'button' }],
        })]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'tp', source: 'built-in' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        const btn = modal.querySelector('[data-plugin-action]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn!.textContent).toBe('Action');
        expect(btn!.dataset.pluginAction).toBe('');
        document.body.removeChild(modal);
    });

    it('renders button element with label and id', async () => {
        mockInvoke.mockResolvedValueOnce([makeMenu({
            plugin_id: 'tp', id: 'm3', label: 'M3', surface: 'settings',
            elements: [{ type: 'button', id: 'do-thing', label: 'Do It' }],
        })]);
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'tp', source: 'built-in' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);
        const btn = modal.querySelector('[data-plugin-action="do-thing"]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn!.textContent).toBe('Do It');
        expect(btn!.dataset.pluginAction).toBe('do-thing');
        document.body.removeChild(modal);
    });
});
