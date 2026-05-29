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

vi.mock('../lib/tauri', () => ({
    TAURI: { invoke: mockInvoke },
}));

vi.mock('../lib/dom', () => ({
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
// clearPluginSettingsCache
// ---------------------------------------------------------------------------

describe('clearPluginSettingsCache', () => {
    async function load() {
        return import('./settingsPluginUI');
    }

    it('clears the plugin settings cache', async () => {
        const { clearPluginSettingsCache } = await load();
        expect(() => clearPluginSettingsCache()).not.toThrow();
        clearPluginSettingsCache();
        expect(() => clearPluginSettingsCache()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// collectPluginSettingsFromPanel
// ---------------------------------------------------------------------------

describe('collectPluginSettingsFromPanel', () => {
    async function load() {
        return import('./settingsPluginUI');
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
});

// ---------------------------------------------------------------------------
// activateSection
// ---------------------------------------------------------------------------

describe('activateSection', () => {
    async function load() {
        return import('./settingsPluginUI');
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
        return import('./settingsPluginUI');
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
        mockInvoke.mockResolvedValueOnce([makePluginSummary({ id: 'third-party', source: 'npm' })]);
        const { renderPluginMenus } = await load();
        const modal = createModal();
        await renderPluginMenus(modal);

        const sublist = modal.querySelector<HTMLElement>('[data-plugin-menus]');
        expect(sublist).not.toBeNull();
        expect(sublist!.querySelector('[data-section="plugin-third-party-settings-menu"]')).not.toBeNull();
    });

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
        return import('./settingsPluginUI');
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

    it('uses cached settings on re-activate without re-fetching', async () => {
        mockInvoke.mockResolvedValueOnce([makeField({ id: 'x', kind: 'text', value: 'first' })]);
        const { activateSection } = await load();
        const modal = createModal();
        // First activation fetches from backend
        activateSection(modal, 'plugin-settings-test-plugin');
        await vi.waitFor(() => {
            expect(modal.querySelector('[data-setting-id="x"]')).not.toBeNull();
        });
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // Second activation of same modal uses cache (does not re-fetch)
        activateSection(modal, 'plugin-settings-test-plugin');
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
});
