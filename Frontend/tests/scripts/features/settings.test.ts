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
// Mock all module dependencies
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();
const mockSetGlobalSettings = vi.fn();
const mockUpdateCommitButton = vi.fn();
const mockSyncFrontendMonitoring = vi.fn();
const mockSetTheme = vi.fn();
const mockApplyCommitSummaryRestriction = vi.fn();
const mockApplyGpuAccelerationPreference = vi.fn();
const mockSelectThemePack = vi.fn();
const mockGetActiveThemeId = vi.fn(() => 'default-light');
const mockApplyAnimationPreference = vi.fn();
const mockModeForTheme = vi.fn(() => 'light' as const);
const mockRebuildThemePackOptions = vi.fn();
const mockThemeTooltip = vi.fn(() => 'Tooltip');
const mockRenderPluginMenus = vi.fn();
const mockCollectPluginSettingsFromPanel = vi.fn(() => [] as Array<{ id: string; value: unknown }>);
const mockActivateSection = vi.fn();
const mockLoadPluginsIntoForm = vi.fn();
const mockCollectGeneralSettings = vi.fn(() => ({}));
const mockLoadGeneralSettingsIntoForm = vi.fn();
const mockCollectCommitSettings = vi.fn(() => ({}));
const mockCollectCommitTemplateSettings = vi.fn(() => ({}));
const mockLoadCommitSettingsIntoForm = vi.fn();
const mockApplyPluginSettingsSections = vi.fn();
const mockInvokePluginAction = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
    TAURI: { invoke: mockInvoke },
}));
vi.mock('@scripts/lib/monitoring', () => ({
    syncFrontendMonitoring: mockSyncFrontendMonitoring,
}));
vi.mock('@scripts/ui/modals', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
}));
vi.mock('@scripts/lib/dom', () => ({
    toKebab: (s: string) => String(s || '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase(),
}));
vi.mock('@scripts/lib/notify', () => ({
    notify: mockNotify,
}));
vi.mock('@scripts/ui/layout', () => ({
    setTheme: mockSetTheme,
    applyCommitSummaryRestriction: mockApplyCommitSummaryRestriction,
    applyGpuAccelerationPreference: mockApplyGpuAccelerationPreference,
}));
vi.mock('@scripts/features/settingsGeneral', () => ({
    collectGeneralSettings: mockCollectGeneralSettings,
    loadGeneralSettingsIntoForm: mockLoadGeneralSettingsIntoForm,
}));
vi.mock('@scripts/features/settingsCommit', () => ({
    collectCommitSettings: mockCollectCommitSettings,
    collectCommitTemplateSettings: mockCollectCommitTemplateSettings,
    DEFAULT_COMMIT_MESSAGE_CREATE: 'Create {file:name}',
    DEFAULT_COMMIT_MESSAGE_DELETE: 'Delete {file:name}',
    DEFAULT_COMMIT_MESSAGE_UPDATE: 'Update {file:name}',
    loadCommitSettingsIntoForm: mockLoadCommitSettingsIntoForm,
}));
vi.mock('@scripts/themes', () => ({
    DEFAULT_LIGHT_THEME_ID: 'default-light',
    DEFAULT_DARK_THEME_ID: 'default-dark',
    DEFAULT_THEME_ID: 'default',
    getActiveThemeId: mockGetActiveThemeId,
    selectThemePack: mockSelectThemePack,
}));
vi.mock('@scripts/plugins', () => ({
    invokePluginAction: mockInvokePluginAction,
    applyPluginSettingsSections: mockApplyPluginSettingsSections,
}));
vi.mock('@scripts/features/settingsTheme', () => ({
    applyAnimationPreference: mockApplyAnimationPreference,
    modeForTheme: mockModeForTheme,
    rebuildThemePackOptions: mockRebuildThemePackOptions,
    themeTooltip: mockThemeTooltip,
}));
vi.mock('@scripts/features/settingsPluginUI', () => ({
    renderPluginMenus: mockRenderPluginMenus,
    collectPluginSettingsFromPanel: mockCollectPluginSettingsFromPanel,
    activateSection: mockActivateSection,
}));
vi.mock('@scripts/features/settingsPlugins', () => ({
    loadPluginsIntoForm: mockLoadPluginsIntoForm,
}));
vi.mock('@scripts/state/state', () => ({
    setGlobalSettings: mockSetGlobalSettings,
}));
vi.mock('@scripts/features/repo/commit', () => ({
    updateCommitButton: mockUpdateCommitButton,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountSettingsModal(): HTMLElement {
    document.body.innerHTML = [
        '<div id="settings-modal">',
        '  <div class="backdrop"></div>',
        '  <nav id="settings-nav">',
        '    <button class="seg-btn" data-section="general">General</button>',
        '    <button class="seg-btn" data-section="plugins">Plugins</button>',
        '  </nav>',
        '  <div id="settings-panels">',
        '    <form class="panel-form" data-panel="general"></form>',
        '    <form class="panel-form hidden" data-panel="plugins"></form>',
        '  </div>',
        '  <div id="settings-panels-scroll"></div>',
        '  <div class="sheet-actions">',
        '    <button id="settings-save">Save</button>',
        '    <button id="settings-reset">Reset</button>',
        '  </div>',
        '</div>',
    ].join('\n');
    return document.getElementById('settings-modal')!;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockNotify.mockReset();
    mockOpenModal.mockReset();
    mockCloseModal.mockReset();
    mockSetGlobalSettings.mockReset();
    mockUpdateCommitButton.mockReset();
    mockSyncFrontendMonitoring.mockReset();
    mockSetTheme.mockReset();
    mockApplyCommitSummaryRestriction.mockReset();
    mockApplyGpuAccelerationPreference.mockReset();
    mockSelectThemePack.mockReset();
    mockGetActiveThemeId.mockReturnValue('default-light');
    mockApplyAnimationPreference.mockReset();
    mockModeForTheme.mockReturnValue('light');
    mockRebuildThemePackOptions.mockReset();
    mockThemeTooltip.mockReturnValue('Tooltip');
    mockRenderPluginMenus.mockReset();
    mockCollectPluginSettingsFromPanel.mockReturnValue([]);
    mockActivateSection.mockReset();
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockCollectGeneralSettings.mockReturnValue({});
    mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockLoadCommitSettingsIntoForm.mockReturnValue(undefined);
    mockApplyPluginSettingsSections.mockReset();
    mockInvokePluginAction.mockReset();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Re-exported symbols
// ---------------------------------------------------------------------------

describe('re-exported symbols', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('re-exports applyAnimationPreference', async () => {
        const mod = await load();
        expect(typeof mod.applyAnimationPreference).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// openSettings
// ---------------------------------------------------------------------------

describe('openSettings', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('opens the settings modal', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings();
        expect(mockOpenModal).toHaveBeenCalledWith('settings-modal');
    });

    it('no-ops when modal element is missing', async () => {
        mockRenderPluginMenus.mockResolvedValue(undefined);
        const { openSettings } = await load();
        expect(() => openSettings()).not.toThrow();
    });

    it('sets aria-busy during load', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings();
        const modal = document.getElementById('settings-modal')!;
        expect(modal.getAttribute('aria-busy')).toBe('true');
    });

    it('calls applyPluginSettingsSections on open', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings();
        expect(mockApplyPluginSettingsSections).toHaveBeenCalledWith(expect.any(HTMLElement));
    });

    it('calls renderPluginMenus', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings();
        expect(mockRenderPluginMenus).toHaveBeenCalled();
    });

    it('activates given section after renderPluginMenus resolves', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings('plugins');
        await vi.waitFor(() => {
            expect(mockActivateSection).toHaveBeenCalledWith(expect.any(HTMLElement), 'plugins');
        });
    });

    it('cleans up aria-busy after load', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings();
        await vi.waitFor(() => {
            const modal = document.getElementById('settings-modal')!;
            expect(modal.hasAttribute('aria-busy')).toBe(false);
        });
    });

    it('handles renderPluginMenus error and still activates section', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockRejectedValue(new Error('fail'));
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings('general');
        await vi.waitFor(() => {
            expect(mockActivateSection).toHaveBeenCalled();
        });
    });

    it('handles loadSettingsIntoForm rejection gracefully', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockRejectedValue(new Error('load failed'));
        const { openSettings } = await load();
        openSettings();
        await vi.waitFor(() => {
            const modal = document.getElementById('settings-modal')!;
            expect(modal.hasAttribute('aria-busy')).toBe(false);
        });
    });

    it('logs error when loadPluginsIntoForm rejects in openSettings', async () => {
        mountSettingsModal();
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        mockLoadPluginsIntoForm.mockRejectedValue(new Error('plugin form failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { openSettings } = await load();
        openSettings();
        await vi.waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to load settings into form:', expect.any(Error));
        });
        consoleSpy.mockRestore();
    });
});

describe('openSettings with theme select', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('disables theme select and shows Loading placeholder', async () => {
        document.body.innerHTML = `
            <div id="settings-modal">
                <input id="set-theme-auto" type="checkbox" />
                <select id="set-theme"></select>
                <div class="backdrop"></div>
                <nav id="settings-nav"></nav>
                <div id="settings-panels"></div>
                <div id="settings-panels-scroll"></div>
                <div class="sheet-actions">
                    <button id="settings-save">Save</button>
                    <button id="settings-reset">Reset</button>
                </div>
            </div>
        `;
        mockRenderPluginMenus.mockResolvedValue(undefined);
        mockInvoke.mockResolvedValue({});
        const { openSettings } = await load();
        openSettings();
        const sel = document.getElementById('set-theme') as HTMLSelectElement;
        expect(sel.disabled).toBe(true);
        expect(sel.innerHTML).toContain('Loading');
    });
});

// ---------------------------------------------------------------------------
// loadSettingsIntoForm
// ---------------------------------------------------------------------------

describe('loadSettingsIntoForm', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('loads settings from backend and fills the form', async () => {
        mountSettingsModal();
        const cfg = {
            general: { theme: 'light', theme_pack: 'default-light', language: 'en' },
            commit: { restrict_commit_summary: true },
            diff: { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true },
            performance: { progressive_render: true, gpu_accel: true, animations: true },
            ux: { ui_scale: 1, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none', recents_limit: 10 },
            logging: { level: 'info', retain_archives: 10 },
        };
        mockInvoke.mockResolvedValue(cfg);
        mockLoadPluginsIntoForm.mockResolvedValue(undefined);
        mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
        const { loadSettingsIntoForm } = await load();
        await loadSettingsIntoForm();
        expect(mockLoadPluginsIntoForm).toHaveBeenCalled();
        expect(mockLoadGeneralSettingsIntoForm).toHaveBeenCalled();
        expect(mockLoadCommitSettingsIntoForm).toHaveBeenCalledWith(expect.any(HTMLElement), cfg);
    });

    it('no-ops when modal is missing', async () => {
        const { loadSettingsIntoForm } = await load();
        await expect(loadSettingsIntoForm()).resolves.toBeUndefined();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('sets dataset.currentCfg from backend response', async () => {
        mountSettingsModal();
        const cfg = { general: { theme: 'light' } };
        mockInvoke.mockResolvedValue(cfg);
        mockLoadPluginsIntoForm.mockResolvedValue(undefined);
        mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
        const { loadSettingsIntoForm } = await load();
        await loadSettingsIntoForm();
        const modal = document.getElementById('settings-modal')!;
        expect(modal.dataset.currentCfg).toBe(JSON.stringify(cfg));
    });

    it('handles backend error gracefully', async () => {
        mountSettingsModal();
        mockInvoke.mockRejectedValue(new Error('fail'));
        const { loadSettingsIntoForm } = await load();
        await expect(loadSettingsIntoForm()).resolves.toBeUndefined();
    });

    it('handles null backend response', async () => {
        mountSettingsModal();
        mockInvoke.mockResolvedValue(null);
        const { loadSettingsIntoForm } = await load();
        await expect(loadSettingsIntoForm()).resolves.toBeUndefined();
    });

    it('uses provided root element instead of querying modal', async () => {
        const root = document.createElement('div');
        root.id = 'custom-root';
        document.body.appendChild(root);
        mockInvoke.mockResolvedValue({});
        mockLoadPluginsIntoForm.mockResolvedValue(undefined);
        mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
        const { loadSettingsIntoForm } = await load();
        await loadSettingsIntoForm(root);
        expect(mockLoadPluginsIntoForm).toHaveBeenCalledWith(root, {});
    });
});

// ---------------------------------------------------------------------------
// wireSettings - side effects
// ---------------------------------------------------------------------------

describe('wireSettings (initialisation)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('sets __wired flag and prevents re-wiring', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const modal = document.getElementById('settings-modal')!;
        expect((modal as any).__wired).toBe(true);
        wireSettings();
        expect(mockApplyPluginSettingsSections).toHaveBeenCalledTimes(1);
    });

    it('no-ops when modal is missing', async () => {
        const { wireSettings } = await load();
        expect(() => wireSettings()).not.toThrow();
    });

    it('calls applyPluginSettingsSections', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        expect(mockApplyPluginSettingsSections).toHaveBeenCalledWith(expect.any(HTMLElement));
    });

    it('sets save button inline styles', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        expect(saveBtn.style.width).toBe('5rem');
        expect(saveBtn.style.textAlign).toBe('center');
    });
});

// ---------------------------------------------------------------------------
// wireSettings - close on backdrop / [data-close]
// ---------------------------------------------------------------------------

describe('wireSettings (close on backdrop)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('closes modal when clicking the backdrop', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const backdrop = document.querySelector('.backdrop')!;
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockCloseModal).toHaveBeenCalledWith('settings-modal');
    });

    it('closes modal when clicking a [data-close] element', async () => {
        mountSettingsModal();
        document.querySelector('.backdrop')!.setAttribute('data-close', 'true');
        const { wireSettings } = await load();
        wireSettings();
        const backdrop = document.querySelector('.backdrop')!;
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockCloseModal).toHaveBeenCalledWith('settings-modal');
    });
});

// ---------------------------------------------------------------------------
// wireSettings - sidebar switching
// ---------------------------------------------------------------------------

describe('wireSettings (sidebar switching)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('activates section when nav button is clicked', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const pluginsBtn = document.querySelector('[data-section="plugins"]') as HTMLElement;
        pluginsBtn.click();
        expect(mockActivateSection).toHaveBeenCalledWith(expect.any(HTMLElement), 'plugins');
    });

    it('ignores clicks on non-[data-section] elements', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const nav = document.querySelector('#settings-nav')!;
        nav.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockActivateSection).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// wireSettings - plugin action buttons
// ---------------------------------------------------------------------------

describe('wireSettings (plugin actions)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    function addPluginActionBtn(): HTMLButtonElement {
        const panels = document.querySelector('#settings-panels')!;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.pluginAction = 'do-thing';
        btn.dataset.pluginId = 'my-plugin';
        panels.appendChild(btn);
        return btn;
    }

    it('invokes plugin action when plugin-action button is clicked', async () => {
        mountSettingsModal();
        mockInvokePluginAction.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const btn = addPluginActionBtn();
        btn.click();
        await vi.waitFor(() => {
            expect(mockInvokePluginAction).toHaveBeenCalledWith('my-plugin', 'do-thing');
        });
    });

    it('notifies on plugin action failure', async () => {
        mountSettingsModal();
        mockInvokePluginAction.mockRejectedValue(new Error('fail'));
        const { wireSettings } = await load();
        wireSettings();
        const btn = addPluginActionBtn();
        btn.click();
        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Plugin action failed');
        });
    });
});

// ---------------------------------------------------------------------------
// wireSettings - merge mode toggle
// ---------------------------------------------------------------------------

describe('wireSettings (merge mode toggle)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    function mountWithMerge() {
        const modal = mountSettingsModal();
        modal.insertAdjacentHTML('beforeend', [
            '<select id="set-merge-mode"><option value="builtin">Built-in</option><option value="custom">Custom</option></select>',
            '<div data-merge-custom><input type="text" id="set-merge-path" /></div>',
            '<div data-merge-custom><input type="text" id="set-merge-args" /></div>',
        ].join('\n'));
        return modal;
    }

    it('disables custom merge fields when mode is builtin', async () => {
        mountWithMerge();
        const { wireSettings } = await load();
        wireSettings();
        const mergeSel = document.getElementById('set-merge-mode') as HTMLSelectElement;
        mergeSel.value = 'builtin';
        mergeSel.dispatchEvent(new Event('change'));
        const customGroups = document.querySelectorAll<HTMLElement>('[data-merge-custom]');
        expect(customGroups[0].classList.contains('disabled')).toBe(true);
        expect((customGroups[0].querySelector('input') as HTMLInputElement).disabled).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// wireSettings - save button
// ---------------------------------------------------------------------------

describe('wireSettings (save button)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    it('does not re-save when already in saving state', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.classList.add('saving-state');
        saveBtn.click();
        expect(mockInvoke).not.toHaveBeenCalledWith('set_global_settings', expect.anything());
    });

    it('does not re-save when already in saved state', async () => {
        mountSettingsModal();
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.classList.add('saved-state');
        saveBtn.click();
        expect(mockInvoke).not.toHaveBeenCalledWith('set_global_settings', expect.anything());
    });

    function mountPluginPanel(pluginId?: string): HTMLElement {
        const modal = mountSettingsModal();
        // Hide the general panel so `:not(.hidden)` finds the plugin panel
        const generalPanel = modal.querySelector<HTMLElement>('.panel-form[data-panel="general"]')!;
        generalPanel.classList.add('hidden');
        const panel = document.createElement('form');
        panel.className = 'panel-form';
        panel.setAttribute('data-plugin-settings', 'true');
        if (pluginId) panel.dataset.pluginId = pluginId;
        modal.querySelector('#settings-panels')!.appendChild(panel);
        return panel;
    }

    it('saves plugin settings when plugin-settings panel is active', async () => {
        const panel = mountPluginPanel('my-plugin');
        mockCollectPluginSettingsFromPanel.mockReturnValue([{ id: 'x', value: 'y' }]);
        mockInvoke.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(mockCollectPluginSettingsFromPanel).toHaveBeenCalledWith(panel);
            expect(mockInvoke).toHaveBeenCalledWith('save_plugin_settings', {
                pluginId: 'my-plugin',
                values: [{ id: 'x', value: 'y' }],
            });
            expect(mockNotify).toHaveBeenCalledWith('Plugin settings saved');
        });
    });

    it('saves plugin settings and shows saved state', async () => {
        mountPluginPanel('p1');
        mockCollectPluginSettingsFromPanel.mockReturnValue([]);
        mockInvoke.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(saveBtn.classList.contains('saved-state')).toBe(true);
        });
    });

    it('notifies when plugin save has no pluginId', async () => {
        mountPluginPanel(undefined); // No pluginId
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Failed to save plugin settings');
        });
    });

    it('saves global settings and notifies', async () => {
        const modal = mountSettingsModal();
        // Set currentCfg with matching gpu_accel to avoid GPU change message
        modal.dataset.currentCfg = JSON.stringify({ performance: { gpu_accel: false } });
        modal.insertAdjacentHTML('beforeend', '<input id="set-gpu-accel" type="checkbox" />');
        mockCollectGeneralSettings.mockReturnValue({ theme: 'light' });
        mockCollectCommitSettings.mockReturnValue({ restrict_commit_summary: true });
        mockCollectCommitTemplateSettings.mockReturnValue({});
        mockInvoke.mockResolvedValue(undefined);
        mockSyncFrontendMonitoring.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
                cfg: expect.objectContaining({ general: { theme: 'light' } }),
            }));
            expect(mockNotify).toHaveBeenCalledWith('Settings saved');
        });
    });

    it('notifies GPU change when gpu_accel differs from previous cfg', async () => {
        mountSettingsModal();
        const modal = document.getElementById('settings-modal')!;
        modal.dataset.currentCfg = JSON.stringify({ performance: { gpu_accel: false } });
        modal.insertAdjacentHTML('beforeend', '<input id="set-gpu-accel" type="checkbox" checked />');
        mockCollectGeneralSettings.mockReturnValue({});
        mockCollectCommitSettings.mockReturnValue({});
        mockCollectCommitTemplateSettings.mockReturnValue({});
        mockInvoke.mockResolvedValue(undefined);
        mockSyncFrontendMonitoring.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith(
                'Settings saved. GPU changes apply after restart.',
            );
        });
    });

    it('notifies failure when save backend call fails', async () => {
        mountSettingsModal();
        mockCollectGeneralSettings.mockReturnValue({});
        mockCollectCommitSettings.mockReturnValue({});
        mockCollectCommitTemplateSettings.mockReturnValue({});
        mockInvoke.mockRejectedValue(new Error('fail'));
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Failed to save settings');
        });
    });

    it('restores save button state after failure', async () => {
        mountSettingsModal();
        mockCollectGeneralSettings.mockReturnValue({});
        mockCollectCommitSettings.mockReturnValue({});
        mockCollectCommitTemplateSettings.mockReturnValue({});
        mockInvoke.mockRejectedValue(new Error('fail'));
        const { wireSettings } = await load();
        wireSettings();
        const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
        saveBtn.click();
        await vi.waitFor(() => {
            expect(saveBtn.classList.contains('saving-state')).toBe(false);
            expect(saveBtn.disabled).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// wireSettings - reset button
// ---------------------------------------------------------------------------

describe('wireSettings (reset button)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    function mountResetPluginPanel(pluginId?: string): HTMLElement {
        const modal = mountSettingsModal();
        // Hide general panel so `:not(.hidden)` targets plugin panel
        const generalPanel = modal.querySelector<HTMLElement>('.panel-form[data-panel="general"]')!;
        generalPanel.classList.add('hidden');
        const panel = document.createElement('form');
        panel.className = 'panel-form';
        panel.setAttribute('data-plugin-menu', 'true');
        panel.setAttribute('data-plugin-settings', 'true');
        if (pluginId) {
            panel.dataset.pluginId = pluginId;
            panel.setAttribute('data-panel', `plugin-settings-${pluginId}`);
        }
        modal.querySelector('#settings-panels')!.appendChild(panel);
        return modal;
    }

    it('resets plugin settings when plugin-settings panel is active', async () => {
        const modal = mountResetPluginPanel('reset-plugin');
        mockInvoke.mockResolvedValue(undefined);
        mockRenderPluginMenus.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;
        resetBtn.click();
        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('reset_plugin_settings', { pluginId: 'reset-plugin' });
            expect(mockNotify).toHaveBeenCalledWith('Plugin settings reset');
            expect(mockRenderPluginMenus).toHaveBeenCalledWith(modal);
        });
    });

    it('notifies when plugin reset has no pluginId', async () => {
        mountResetPluginPanel(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;
        resetBtn.click();
        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Failed to reset plugin settings');
        });
    });

    it('resets global settings to defaults', async () => {
        mountSettingsModal();
        mockInvoke.mockResolvedValueOnce({ general: { theme: 'dark' } });
        mockInvoke.mockResolvedValueOnce(undefined);
        mockSyncFrontendMonitoring.mockResolvedValue(undefined);
        mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;
        resetBtn.click();
        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', {
                cfg: expect.objectContaining({
                    general: expect.objectContaining({ theme: 'system' }),
                }),
            });
            expect(mockNotify).toHaveBeenCalledWith('Defaults restored');
        });
    });

    it('handles reset backend failure gracefully', async () => {
        mountSettingsModal();
        mockInvoke.mockRejectedValue(new Error('fail'));
        const { wireSettings } = await load();
        wireSettings();
        const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;
        resetBtn.click();
        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Failed to restore defaults');
        });
    });
});

// ---------------------------------------------------------------------------
// wireSettings - SSH binary toggle
// ---------------------------------------------------------------------------

describe('wireSettings (SSH binary toggle)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    function mountWithSsh() {
        const modal = mountSettingsModal();
        modal.insertAdjacentHTML('beforeend', [
            '<select id="set-git-ssh-binary"><option value="auto">Auto</option><option value="custom">Custom</option></select>',
            '<input id="set-git-ssh-path" type="text" />',
        ].join('\n'));
        return modal;
    }

    it('disables ssh path when mode is auto', async () => {
        mountWithSsh();
        const { wireSettings } = await load();
        wireSettings();
        const select = document.getElementById('set-git-ssh-binary') as HTMLSelectElement;
        select.value = 'auto';
        select.dispatchEvent(new Event('change'));
        const pathInput = document.getElementById('set-git-ssh-path') as HTMLInputElement;
        expect(pathInput.disabled).toBe(true);
        expect(pathInput.value).toBe('');
    });

    it('enables ssh path when mode is custom', async () => {
        mountWithSsh();
        const { wireSettings } = await load();
        wireSettings();
        const select = document.getElementById('set-git-ssh-binary') as HTMLSelectElement;
        select.value = 'custom';
        select.dispatchEvent(new Event('change'));
        const pathInput = document.getElementById('set-git-ssh-path') as HTMLInputElement;
        expect(pathInput.disabled).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// wireSettings - theme controls
// ---------------------------------------------------------------------------

describe('wireSettings (theme controls)', () => {
    async function load() {
        return import('@scripts/features/settings');
    }

    function mountWithTheme() {
        const modal = mountSettingsModal();
        modal.insertAdjacentHTML('beforeend', [
            '<input id="set-theme-auto" type="checkbox" />',
            '<select id="set-theme">',
            '  <option value="default-light">Light</option>',
            '  <option value="dark-theme">Dark</option>',
            '</select>',
        ].join('\n'));
        return modal;
    }

    it('syncs theme pack title on pointerdown', async () => {
        mountWithTheme();
        mockRebuildThemePackOptions.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
        themeSel.dispatchEvent(new Event('pointerdown'));
        expect(mockRebuildThemePackOptions).toHaveBeenCalled();
    });

    it('applies theme on select change', async () => {
        mountWithTheme();
        mockSelectThemePack.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
        themeSel.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            expect(mockSelectThemePack).toHaveBeenCalled();
        });
    });

    it('applies theme on auto-toggle change', async () => {
        mountWithTheme();
        mockSelectThemePack.mockResolvedValue(undefined);
        const { wireSettings } = await load();
        wireSettings();
        const auto = document.getElementById('set-theme-auto') as HTMLInputElement;
        auto.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            expect(mockSelectThemePack).toHaveBeenCalled();
        });
    });

  it('responds to openvcs:theme-pack-changed event when auto is checked', async () => {
    mountWithTheme();
    document.getElementById('set-theme-auto')!.setAttribute('checked', '');
    (document.getElementById('set-theme-auto') as HTMLInputElement).checked = true;
    mockGetActiveThemeId.mockReturnValue('dark-theme');
    const { wireSettings } = await load();
    wireSettings();
    window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed'));
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    expect(themeSel.value).toBe('dark-theme');
    expect(themeSel.disabled).toBe(true);
  });

  it('ignores openvcs:theme-pack-changed event when auto is not checked', async () => {
    mountWithTheme();
    (document.getElementById('set-theme-auto') as HTMLInputElement).checked = false;
    (document.getElementById('set-theme') as HTMLSelectElement).value = 'default-light';
    const { wireSettings } = await load();
    wireSettings();
    window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed'));
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    // Should remain unchanged because auto is not checked
    expect(themeSel.value).toBe('default-light');
  });

  it('rebuilds theme options on pointerdown when auto is checked (no-op)', async () => {
    mountWithTheme();
    (document.getElementById('set-theme-auto') as HTMLInputElement).checked = true;
    const { wireSettings } = await load();
    wireSettings();
    // pointerdown with auto checked returns early before rebuildThemePackOptions
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    themeSel.dispatchEvent(new Event('pointerdown'));
    expect(mockRebuildThemePackOptions).not.toHaveBeenCalled();
  });

  it('sets theme select disabled when auto is checked via applyThemeFromControls', async () => {
    mountWithTheme();
    (document.getElementById('set-theme-auto') as HTMLInputElement).checked = true;
    mockSelectThemePack.mockResolvedValue(undefined);
    const { wireSettings } = await load();
    wireSettings();
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    themeSel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSelectThemePack).toHaveBeenCalled();
      expect(themeSel.disabled).toBe(true);
    });
  });
});

/** Waits for queued promise work to settle. */
async function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// wireSettings - SSH binary toggle (additional)
// ---------------------------------------------------------------------------

describe('wireSettings (SSH binary custom path)', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  function mountWithSsh() {
    const modal = mountSettingsModal();
    modal.insertAdjacentHTML('beforeend', [
      '<select id="set-git-ssh-binary"><option value="auto">Auto</option><option value="custom">Custom</option></select>',
      '<input id="set-git-ssh-path" type="text" value="/usr/bin/ssh" />',
    ].join('\n'));
    return modal;
  }

  it('clears path when switching from custom to auto', async () => {
    mountWithSsh();
    const { wireSettings } = await load();
    wireSettings();
    const select = document.getElementById('set-git-ssh-binary') as HTMLSelectElement;
    select.value = 'auto';
    select.dispatchEvent(new Event('change'));
    const pathInput = document.getElementById('set-git-ssh-path') as HTMLInputElement;
    expect(pathInput.disabled).toBe(true);
    expect(pathInput.value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// collectSettingsFromForm
// ---------------------------------------------------------------------------

describe('collectSettingsFromForm', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  function mountCollectDom(extra?: string) {
    const modal = mountSettingsModal();
    modal.dataset.currentCfg = JSON.stringify({
      general: { theme: 'light' },
      commit: {},
      diff: { external_merge: { enabled: false, path: '', args: '' } },
    });
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" checked />',
      '<input id="set-animations" type="checkbox" checked />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" value="monospace" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" type="number" value="10" />',
      '<input id="set-tab-width" type="number" value="4" />',
      '<select id="set-ignore-whitespace"><option value="none">None</option></select>',
      '<input id="set-max-file-size-mb" type="number" value="10" />',
      '<input id="set-intraline" type="checkbox" checked />',
      '<input id="set-binary-placeholders" type="checkbox" checked />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option><option value="custom">Custom</option></select>',
      '<input id="set-merge-path" type="text" value="" />',
      '<input id="set-merge-args" type="text" value="" />',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
      '<input id="set-restrict-commit-summary" type="checkbox" checked />',
      extra || '',
    ].join('\n'));
    return modal;
  }

  it('collects settings from form with plugins state', async () => {
    const modal = mountCollectDom();
    (modal as any).__pluginsPanelState = {
      list: [{ id: 'p1', name: 'P1' }],
      disabled: new Set<string>(),
      enabled: new Set<string>(['p1']),
    };
    mockCollectGeneralSettings.mockReturnValue({ theme: 'light' });
    mockCollectCommitSettings.mockReturnValue({ restrict_commit_summary: true });
    mockCollectCommitTemplateSettings.mockReturnValue({});

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          plugins: expect.objectContaining({ enabled: ['p1'] }),
        }),
      }));
    });
  });

  it('collects plugins from DOM toggles when no plugins state', async () => {
    const modal = mountCollectDom('<input type="checkbox" data-plugin-id="p1" checked />');
    delete (modal as any).__pluginsPanelState;
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          plugins: expect.objectContaining({ enabled: ['p1'] }),
        }),
      }));
    });
  });
});

// ---------------------------------------------------------------------------
// refreshDefaultBackendOptions
// ---------------------------------------------------------------------------

describe('refreshDefaultBackendOptions', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('populates backend options when backends are available', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.insertAdjacentHTML('beforeend', '<select id="set-default-backend"></select>');
    mockInvoke.mockResolvedValue([['git', 'Git'], ['hg', 'Mercurial']]);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockImplementation(async (_m: HTMLElement, _c: any, _k: any, refreshBackends: any) => {
      await refreshBackends(_m, { general: { default_backend: 'git' } });
    });

    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    await flushPromises();

    const sel = document.getElementById('set-default-backend') as HTMLSelectElement;
    expect(sel.options.length).toBe(2);
    expect(sel.value).toBe('git');
    expect(sel.disabled).toBe(false);
  });

  it('disables backend selector when no backends available', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.insertAdjacentHTML('beforeend', '<select id="set-default-backend"></select>');
    mockInvoke.mockResolvedValue([]);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockImplementation(async (_m: HTMLElement, _c: any, _k: any, refreshBackends: any) => {
      await refreshBackends(_m, {});
    });

    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();

    const sel = document.getElementById('set-default-backend') as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
    expect(sel.options.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('collectSettingsFromForm - edge cases', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  function mountBaseForm(): HTMLElement {
    const modal = mountSettingsModal();
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" type="number" value="" />',
      '<input id="set-tab-width" type="number" value="0" />',
      '<input id="set-max-file-size-mb" type="number" value="0" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="custom">Custom</option></select>',
      '<input id="set-merge-path" type="text" value="/usr/bin/merge" />',
      '<input id="set-merge-args" type="text" value="" />',
      '<select id="set-log-level"><option value="info">Info</option></select>',
      '<input id="set-log-keep" value="" />',
    ].join('\n'));
    return modal;
  }

  it('handles empty recents limit and log keep values', async () => {
    mountBaseForm();
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it('enables external merge when mode is custom with path', async () => {
    mountBaseForm();
    // Set custom merge path
    (document.getElementById('set-merge-path') as HTMLInputElement).value = '/usr/bin/merge';
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          diff: expect.objectContaining({
            external_merge: expect.objectContaining({ enabled: true, path: '/usr/bin/merge' }),
          }),
        }),
      }));
    });
  });

  it('maps unknown disabled plugin ids through byLower fallback', async () => {
    const modal = mountBaseForm();
    (modal as any).__pluginsPanelState = {
      list: [{ id: 'p1', name: 'P1' }],
      disabled: new Set<string>(['p1', 'unknown-id']),
      enabled: new Set<string>([]),
    };
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          plugins: expect.objectContaining({
            disabled: expect.arrayContaining(['unknown-id', 'p1']),
          }),
        }),
      }));
    });
  });

  it('collects disabled plugins from unchecked DOM toggles', async () => {
    const modal = mountBaseForm();
    delete (modal as any).__pluginsPanelState;
    modal.insertAdjacentHTML('beforeend', [
      '<input type="checkbox" data-plugin-id="p1" checked />',
      '<input type="checkbox" data-plugin-id="p2" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          plugins: expect.objectContaining({
            disabled: ['p2'],
            enabled: ['p1'],
          }),
        }),
      }));
    });
  });
});

// ---------------------------------------------------------------------------
// wireSettings - save button with theme and CSS props
// ---------------------------------------------------------------------------

describe('wireSettings (save applies CSS props)', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('sets CSS custom properties on save', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({
      performance: { gpu_accel: false },
      general: { theme: 'dark', theme_pack: 'dark-theme' },
      diff: { tab_width: 8 },
      ux: { ui_scale: 1.25, font_mono: 'Fira Code' },
      commit: { restrict_commit_summary: false },
    });
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" checked />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1.25" />',
      '<input id="set-font-mono" type="text" value="Fira Code" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="8" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" checked />',
      '<input id="set-binary-placeholders" type="checkbox" checked />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({ theme: 'dark', theme_pack: 'dark-theme' });
    mockCollectCommitSettings.mockReturnValue({ restrict_commit_summary: false });
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);
    mockSelectThemePack.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--tab-size')).toBe('8');
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25');
      expect(document.documentElement.style.getPropertyValue('--mono')).toBe('Fira Code');
      expect(mockApplyAnimationPreference).toHaveBeenCalled();
      expect(mockApplyGpuAccelerationPreference).toHaveBeenCalled();
      expect(mockApplyCommitSummaryRestriction).toHaveBeenCalled();
      expect(mockUpdateCommitButton).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith('Settings saved. GPU changes apply after restart.');
    });
  });
});

// ---------------------------------------------------------------------------
// flashSavedState
// ---------------------------------------------------------------------------

describe('flashSavedState', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('shows saved state then restores after timeout', async () => {
    vi.useFakeTimers();
    mountSettingsModal();
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();

    await vi.advanceTimersByTimeAsync(100);

    expect(saveBtn.classList.contains('saved-state')).toBe(true);
    expect(saveBtn.textContent).toBe('Saved!');

    await vi.advanceTimersByTimeAsync(2000);

    expect(saveBtn.textContent).toBe('Save');
    expect(saveBtn.classList.contains('saved-state')).toBe(false);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// refreshDefaultBackendOptions - error handling
// ---------------------------------------------------------------------------

describe('refreshDefaultBackendOptions error handling', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('handles invoke rejection gracefully', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.insertAdjacentHTML('beforeend', '<select id="set-default-backend"></select>');
    mockInvoke
      .mockResolvedValueOnce({}) // get_global_settings succeeds
      .mockRejectedValueOnce(new Error('vcs backends failed')); // list_vcs_backends_cmd fails
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockImplementation(
      async (_m: HTMLElement, _c: any, _k: any, refreshBackends: any) => {
        await refreshBackends(_m, { general: { default_backend: 'git' } });
      },
    );

    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    await flushPromises();

    const sel = document.getElementById('set-default-backend') as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
    expect(sel.options.length).toBe(0);
  });

  it('selects first backend when desired is empty', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.insertAdjacentHTML('beforeend', '<select id="set-default-backend"></select>');
    mockInvoke.mockResolvedValue([['git', 'Git'], ['hg', 'Mercurial']]);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockImplementation(
      async (_m: HTMLElement, _c: any, _k: any, refreshBackends: any) => {
        await refreshBackends(_m, {});
      },
    );

    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    await flushPromises();

    const sel = document.getElementById('set-default-backend') as HTMLSelectElement;
    expect(sel.value).toBe('git');
  });
});

// collectSettingsFromForm - edge cases
// ---------------------------------------------------------------------------

describe('collectSettingsFromForm - edge cases', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('handles invalid JSON in currentCfg', async () => {
    const modal = mountSettingsModal();
    modal.dataset.currentCfg = 'not-valid-json';
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" type="number" value="10" />',
      '<input id="set-tab-width" type="number" value="4" />',
      '<input id="set-max-file-size-mb" type="number" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it('skips plugins sections when elements absent', async () => {
    document.body.innerHTML = [
      '<div id="settings-modal">',
      '  <div class="backdrop"></div>',
      '  <nav id="settings-nav">',
      '    <button class="seg-btn" data-section="general">General</button>',
      '  </nav>',
      '  <div id="settings-panels">',
      '    <form class="panel-form" data-panel="general"></form>',
      '  </div>',
      '  <div class="sheet-actions">',
      '    <button id="settings-save">Save</button>',
      '    <button id="settings-reset">Reset</button>',
      '  </div>',
      '  <input id="set-tab-width" value="4" />',
      '  <input id="set-intraline" type="checkbox" />',
      '  <input id="set-binary-placeholders" type="checkbox" />',
      '  <select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '</div>',
    ].join('\n');
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({});
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// loadSettingsIntoForm - form element filling
// ---------------------------------------------------------------------------

describe('loadSettingsIntoForm - element filling', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('fills all form elements from settings', async () => {
    document.body.innerHTML = [
      '<div id="settings-modal">',
      '  <input id="set-recents-limit" />',
      '  <input id="set-tab-width" />',
      '  <select id="set-ignore-whitespace"><option value="none">None</option><option value="all">All</option></select>',
      '  <input id="set-max-file-size-mb" />',
      '  <input id="set-intraline" type="checkbox" />',
      '  <input id="set-binary-placeholders" type="checkbox" />',
       '  <input id="set-restrict-commit-summary" type="checkbox" />',
       '  <select id="set-merge-mode"><option value="builtin">Built-in</option><option value="custom">Custom</option></select>',
       '  <input id="set-merge-path" />',
       '  <input id="set-merge-args" />',
       '  <input id="set-animations" type="checkbox" />',
       '  <input id="set-progressive-render" type="checkbox" />',
       '  <input id="set-gpu-accel" type="checkbox" />',
      '  <input id="set-ui-scale" />',
      '  <input id="set-font-mono" />',
      '  <input id="set-vim-nav" type="checkbox" />',
      '  <select id="set-cb-mode"><option value="none">None</option><option value="deuteranopia">Deuteranopia</option></select>',
      '  <select id="set-log-level"><option value="info">Info</option><option value="debug">Debug</option></select>',
      '  <input id="set-log-keep" />',
      '  <div class="backdrop"></div>',
      '  <nav id="settings-nav"></nav>',
      '  <div id="settings-panels"></div>',
      '  <div class="sheet-actions">',
      '    <button id="settings-save">Save</button>',
      '    <button id="settings-reset">Reset</button>',
      '  </div>',
      '</div>',
    ].join('\n');
    const cfg = {
      general: { theme: 'system', theme_pack: 'default', language: 'en' },
      commit: { restrict_commit_summary: true },
      diff: {
        tab_width: 8,
        ignore_whitespace: 'all' as const,
        max_file_size_mb: 20,
        intraline: true,
        show_binary_placeholders: false,
        external_merge: { enabled: true, path: '/usr/bin/merge', args: '--diff3' },
      },
      performance: { progressive_render: false, gpu_accel: true, animations: false },
      ux: { ui_scale: 1.5, font_mono: 'Fira Code', vim_nav: true, color_blind_mode: 'deuteranopia' as const, recents_limit: 25 },
      logging: { level: 'debug' as const, retain_archives: 50 },
    };
    mockInvoke.mockResolvedValue(cfg);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();

    expect((document.getElementById('set-recents-limit') as HTMLInputElement).value).toBe('25');
    expect((document.getElementById('set-tab-width') as HTMLInputElement).value).toBe('8');
    expect((document.getElementById('set-ignore-whitespace') as HTMLSelectElement).value).toBe('all');
    expect((document.getElementById('set-max-file-size-mb') as HTMLInputElement).value).toBe('20');
    expect((document.getElementById('set-intraline') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('set-binary-placeholders') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('set-restrict-commit-summary') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('set-merge-mode') as HTMLSelectElement).value).toBe('custom');
    expect((document.getElementById('set-merge-path') as HTMLInputElement).value).toBe('/usr/bin/merge');
    expect((document.getElementById('set-merge-args') as HTMLInputElement).value).toBe('--diff3');
    expect((document.getElementById('set-animations') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('set-progressive-render') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('set-gpu-accel') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('set-ui-scale') as HTMLInputElement).value).toBe('1.5');
    expect((document.getElementById('set-font-mono') as HTMLInputElement).value).toBe('Fira Code');
    expect((document.getElementById('set-vim-nav') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('set-cb-mode') as HTMLSelectElement).value).toBe('deuteranopia');
    expect((document.getElementById('set-log-level') as HTMLSelectElement).value).toBe('debug');
    expect((document.getElementById('set-log-keep') as HTMLInputElement).value).toBe('50');
  });
});

// ---------------------------------------------------------------------------
// wireSettings - backdrop click no-op
// ---------------------------------------------------------------------------

describe('wireSettings - backdrop click no-op', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('does not close when clicking non-close element', async () => {
    mountSettingsModal();
    const { wireSettings } = await load();
    wireSettings();
    const modal = document.getElementById('settings-modal')!;
    modal.querySelector('#settings-nav')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mockCloseModal).not.toHaveBeenCalled();
  });

  it('does not close when clicking on modal content (not backdrop)', async () => {
    const modal = mountSettingsModal();
    const { wireSettings } = await load();
    wireSettings();
    const nav = modal.querySelector('#settings-nav')!;
    nav.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mockCloseModal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// wireSettings - openvcs:theme-pack-changed event
// ---------------------------------------------------------------------------

describe('wireSettings - theme-pack-changed auto update', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('applies active theme on theme-pack-changed when auto is checked', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <input id="set-theme-auto" type="checkbox" checked />
        <select id="set-theme">
          <option value="default-light">Light</option>
          <option value="dark-theme">Dark</option>
        </select>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    mockGetActiveThemeId.mockReturnValue('dark-theme');
    mockThemeTooltip.mockReturnValue('Dark Theme');
    const { wireSettings } = await load();
    wireSettings();
    window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed'));
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    expect(themeSel.value).toBe('dark-theme');
    expect(themeSel.disabled).toBe(true);
  });

  it('does not update theme select when auto is unchecked', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme">
          <option value="default-light" selected>Light</option>
          <option value="dark-theme">Dark</option>
        </select>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    mockGetActiveThemeId.mockReturnValue('dark-theme');
    const { wireSettings } = await load();
    wireSettings();
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    const initial = themeSel.value;
    window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed'));
    expect(themeSel.value).toBe(initial);
  });

  it('handles missing theme select on theme-pack-changed', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <input id="set-theme-auto" type="checkbox" checked />
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    wireSettings();
    expect(() => window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// wireSettings - missing nav/panels
// ---------------------------------------------------------------------------

describe('wireSettings - missing nav/panels', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('handles missing nav gracefully', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <div id="settings-panels">
          <form class="panel-form" data-panel="general"></form>
        </div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    expect(() => wireSettings()).not.toThrow();
  });

  it('handles missing panels gracefully', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <nav id="settings-nav">
          <button class="seg-btn" data-section="general">General</button>
        </nav>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    expect(() => wireSettings()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// syncThemeTitle
// ---------------------------------------------------------------------------

describe('syncThemeTitle', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('updates theme select title on theme change', async () => {
    mockThemeTooltip.mockReturnValue('My Tooltip');
    mockSelectThemePack.mockResolvedValue(undefined);
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <select id="set-theme">
          <option value="my-theme" selected>My Theme</option>
        </select>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    wireSettings();
    const themeSel = document.getElementById('set-theme') as HTMLSelectElement;
    themeSel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(themeSel.title).toBe('My Tooltip');
    });
  });

  it('does not throw when theme select is missing', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    expect(() => wireSettings()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyThemeFromControls - auto mode
// ---------------------------------------------------------------------------

describe('applyThemeFromControls', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('handles theme controls with both auto and select present', async () => {
    mockModeForTheme.mockReturnValue('light');
    mockGetActiveThemeId.mockReturnValue('dark-theme');
    mockSelectThemePack.mockResolvedValue(undefined);
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <input id="set-theme-auto" type="checkbox" checked />
        <select id="set-theme">
          <option value="default-light">Light</option>
        </select>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    wireSettings();
    const autoCheck = document.getElementById('set-theme-auto') as HTMLInputElement;
    autoCheck.checked = true;
    autoCheck.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith('system');
    });
  });

  it('sets system mode when auto is checked', async () => {
    mockModeForTheme.mockReturnValue('light');
    mockGetActiveThemeId.mockReturnValue('dark-theme');
    mockSelectThemePack.mockResolvedValue(undefined);
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <input id="set-theme-auto" type="checkbox" checked />
        <select id="set-theme">
          <option value="default-light">Light</option>
          <option value="dark-theme">Dark</option>
        </select>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const { wireSettings } = await load();
    wireSettings();
    const autoCheck = document.getElementById('set-theme-auto') as HTMLInputElement;
    autoCheck.checked = true;
    autoCheck.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith('system');
    });
  });
});

// ---------------------------------------------------------------------------
// flashSavedState - custom button text
// ---------------------------------------------------------------------------

describe('flashSavedState custom text', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('uses custom original text for restore', async () => {
    vi.useFakeTimers();
    const modal = mountSettingsModal();
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="4" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();

    await vi.advanceTimersByTimeAsync(100);
    expect(saveBtn.textContent).toBe('Saved!');

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveBtn.textContent).toBe('Save');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// SSH binary toggle - custom mode with specific path
// ---------------------------------------------------------------------------

describe('wireSettings (SSH binary custom mode path)', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('clears path when switching to auto', async () => {
    const modal = mountSettingsModal();
    modal.insertAdjacentHTML('beforeend', [
      '<select id="set-git-ssh-binary"><option value="auto">Auto</option><option value="custom">Custom</option></select>',
      '<input id="set-git-ssh-path" type="text" value="/usr/bin/ssh" />',
    ].join('\n'));
    const { wireSettings } = await load();
    wireSettings();
    const select = document.getElementById('set-git-ssh-binary') as HTMLSelectElement;
    select.value = 'auto';
    select.dispatchEvent(new Event('change'));
    const pathInput = document.getElementById('set-git-ssh-path') as HTMLInputElement;
    expect(pathInput.value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// loadSettingsIntoForm - log level and merge mode change events
// ---------------------------------------------------------------------------

describe('loadSettingsIntoForm - merge mode change event', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('dispatches change event on merge mode select', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <select id="set-merge-mode"><option value="builtin">Built-in</option><option value="custom">Custom</option></select>
        <div id="settings-panels-scroll"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
      </div>
    `;
    const cfg = {
      diff: { external_merge: { enabled: true, path: '/usr/bin/merge', args: '' } },
    };
    mockInvoke.mockResolvedValue(cfg);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    const mergeSel = document.getElementById('set-merge-mode') as HTMLSelectElement;
    expect(mergeSel.value).toBe('custom');
  });
});

// ---------------------------------------------------------------------------
// collectSettingsFromForm - clamping edge cases
// ---------------------------------------------------------------------------

describe('collectSettingsFromForm - clamping edge cases', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  function mountWithClamping() {
    const modal = mountSettingsModal();
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" type="number" value="0" />',
      '<input id="set-tab-width" type="number" value="4" />',
      '<input id="set-max-file-size-mb" type="number" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="0" />',
      '<input id="set-restrict-commit-summary" type="checkbox" />',
    ].join('\n'));
    return modal;
  }

  it('clamps recents_limit value 0 to 1', async () => {
    mountWithClamping();
    const modal = document.getElementById('settings-modal')!;
    (document.getElementById('set-recents-limit') as HTMLInputElement).value = '0';
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          ux: expect.objectContaining({ recents_limit: 1 }),
        }),
      }));
    });
  });

  it('clamps recents_limit value 150 to 100', async () => {
    mountWithClamping();
    (document.getElementById('set-recents-limit') as HTMLInputElement).value = '150';
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          ux: expect.objectContaining({ recents_limit: 100 }),
        }),
      }));
    });
  });

  it('clamps log_keep value 0 to 1', async () => {
    mountWithClamping();
    (document.getElementById('set-log-keep') as HTMLInputElement).value = '0';
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          logging: expect.objectContaining({ retain_archives: 1 }),
        }),
      }));
    });
  });

  it('clamps log_keep value 200 to 100', async () => {
    mountWithClamping();
    (document.getElementById('set-log-keep') as HTMLInputElement).value = '200';
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          logging: expect.objectContaining({ retain_archives: 100 }),
        }),
      }));
    });
  });

  it('collects merge mode as builtin (disabled) when mode is builtin', async () => {
    const modal = mountSettingsModal();
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="4" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin" selected>Built-in</option></select>',
      '<input id="set-merge-path" value="" />',
      '<input id="set-merge-args" value="" />',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          diff: expect.objectContaining({
            external_merge: expect.objectContaining({ enabled: false }),
          }),
        }),
      }));
    });
  });

  it('collects ui_scale and font_mono from form inputs', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1.5" />',
      '<input id="set-font-mono" type="text" value="Fira Code" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="deuteranopia">Deuteranopia</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="4" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          ux: expect.objectContaining({
            ui_scale: 1.5,
            font_mono: 'Fira Code',
            color_blind_mode: 'deuteranopia',
          }),
        }),
      }));
    });
  });

  it('collects gpu_accel checked and animations unchecked', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" checked />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="4" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          performance: expect.objectContaining({
            gpu_accel: true,
            animations: false,
            progressive_render: false,
          }),
        }),
      }));
    });
  });

  it('collects intraline and binary_placeholders checkbox values', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({});
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="8" />',
      '<input id="set-max-file-size-mb" value="20" />',
      '<input id="set-intraline" type="checkbox" checked />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValueOnce(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_global_settings', expect.objectContaining({
        cfg: expect.objectContaining({
          diff: expect.objectContaining({
            intraline: true,
            show_binary_placeholders: false,
          }),
        }),
      }));
    });
  });
});

// ---------------------------------------------------------------------------
// loadSettingsIntoForm - false boolean branches
// ---------------------------------------------------------------------------

describe('loadSettingsIntoForm - false boolean branches', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('sets restrict_commit_summary checkbox unchecked when false in config', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <input id="set-restrict-commit-summary" type="checkbox" checked />
        <input id="set-recents-limit" />
        <input id="set-tab-width" />
        <input id="set-max-file-size-mb" />
        <select id="set-merge-mode"><option value="builtin">Built-in</option></select>
        <input id="set-log-level" />
        <input id="set-log-keep" />
        <div class="backdrop"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const cfg = {
      general: { theme: 'light' },
      commit: { restrict_commit_summary: false },
      diff: {},
      performance: {},
      ux: { recents_limit: 10 },
      logging: { level: 'info', retain_archives: 10 },
    };
    mockInvoke.mockResolvedValue(cfg);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    const el = document.getElementById('set-restrict-commit-summary') as HTMLInputElement;
    expect(el.checked).toBe(false);
  });

  it('sets animations checkbox unchecked when false in config', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <input id="set-animations" type="checkbox" checked />
        <input id="set-gpu-accel" type="checkbox" />
        <input id="set-progressive-render" type="checkbox" />
        <input id="set-recents-limit" />
        <input id="set-tab-width" />
        <input id="set-max-file-size-mb" />
        <select id="set-merge-mode"><option value="builtin">Built-in</option></select>
        <input id="set-log-level" />
        <input id="set-log-keep" />
        <div class="backdrop"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const cfg = {
      general: { theme: 'light' },
      performance: { animations: false, progressive_render: true, gpu_accel: true },
      diff: {},
      ux: { recents_limit: 10 },
      logging: { level: 'info', retain_archives: 10 },
    };
    mockInvoke.mockResolvedValue(cfg);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    const el = document.getElementById('set-animations') as HTMLInputElement;
    expect(el.checked).toBe(false);
  });

  it('sets merge mode to builtin when external_merge is disabled', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <select id="set-merge-mode"><option value="builtin">Built-in</option><option value="custom">Custom</option></select>
        <input id="set-merge-path" />
        <input id="set-merge-args" />
        <input id="set-recents-limit" />
        <input id="set-tab-width" />
        <input id="set-max-file-size-mb" />
        <input id="set-log-level" />
        <input id="set-log-keep" />
        <div class="backdrop"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
          <button id="settings-reset">Reset</button>
        </div>
      </div>
    `;
    const cfg = {
      general: { theme: 'light' },
      diff: { external_merge: { enabled: false, path: '', args: '' } },
      performance: {},
      ux: { recents_limit: 10 },
      logging: { level: 'info', retain_archives: 10 },
    };
    mockInvoke.mockResolvedValue(cfg);
    mockLoadPluginsIntoForm.mockResolvedValue(undefined);
    mockLoadGeneralSettingsIntoForm.mockResolvedValue(undefined);
    const { loadSettingsIntoForm } = await load();
    await loadSettingsIntoForm();
    const el = document.getElementById('set-merge-mode') as HTMLSelectElement;
    expect(el.value).toBe('builtin');
  });
});

// ---------------------------------------------------------------------------
// wireSettings - save handler edge cases
// ---------------------------------------------------------------------------

describe('wireSettings - save handler edge cases', () => {
  async function load() {
    return import('@scripts/features/settings');
  }

  it('saves gpu_accel unchanged (no GPU change notification)', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({
      performance: { gpu_accel: false },
    });
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" />',
      '<input id="set-animations" type="checkbox" />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="4" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Settings saved');
    });
  });

  it('handles missing save button gracefully in save handler', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions"></div>
      </div>
    `;
    const { wireSettings } = await load();
    expect(() => wireSettings()).not.toThrow();
  });

  it('handles missing reset button gracefully', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="backdrop"></div>
        <nav id="settings-nav"></nav>
        <div id="settings-panels"></div>
        <div class="sheet-actions">
          <button id="settings-save">Save</button>
        </div>
      </div>
    `;
    mockCollectGeneralSettings.mockReturnValue({});
    mockCollectCommitSettings.mockReturnValue({});
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    expect(() => wireSettings()).not.toThrow();
  });

  it('sets theme CSS custom properties on save with tab_width and ui_scale', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({
      performance: { gpu_accel: false },
    });
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" checked />',
      '<input id="set-animations" type="checkbox" checked />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1.25" />',
      '<input id="set-font-mono" type="text" value="Fira Code" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="8" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" checked />',
      '<input id="set-binary-placeholders" type="checkbox" checked />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({ theme: 'light', theme_pack: 'default-light' });
    mockCollectCommitSettings.mockReturnValue({ restrict_commit_summary: true });
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);
    mockSelectThemePack.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--tab-size')).toBe('8');
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25');
      expect(document.documentElement.style.getPropertyValue('--mono')).toBe('Fira Code');
    });
  });

  it('removes --mono CSS prop when font_mono is empty', async () => {
    mountSettingsModal();
    const modal = document.getElementById('settings-modal')!;
    modal.dataset.currentCfg = JSON.stringify({
      performance: { gpu_accel: false },
    });
    modal.insertAdjacentHTML('beforeend', [
      '<input id="set-gpu-accel" type="checkbox" checked />',
      '<input id="set-animations" type="checkbox" checked />',
      '<input id="set-progressive-render" type="checkbox" />',
      '<input id="set-ui-scale" type="range" value="1" />',
      '<input id="set-font-mono" type="text" value="" />',
      '<input id="set-vim-nav" type="checkbox" />',
      '<select id="set-cb-mode"><option value="none">None</option></select>',
      '<input id="set-recents-limit" value="10" />',
      '<input id="set-tab-width" value="4" />',
      '<input id="set-max-file-size-mb" value="10" />',
      '<input id="set-intraline" type="checkbox" />',
      '<input id="set-binary-placeholders" type="checkbox" />',
      '<select id="set-merge-mode"><option value="builtin">Built-in</option></select>',
      '<input id="set-log-level" value="info" />',
      '<input id="set-log-keep" value="10" />',
    ].join('\n'));
    mockCollectGeneralSettings.mockReturnValue({ theme: 'light', theme_pack: 'default-light' });
    mockCollectCommitSettings.mockReturnValue({ restrict_commit_summary: true });
    mockCollectCommitTemplateSettings.mockReturnValue({});
    mockInvoke.mockResolvedValue(undefined);
    mockSyncFrontendMonitoring.mockResolvedValue(undefined);
    mockSelectThemePack.mockResolvedValue(undefined);

    const { wireSettings } = await load();
    wireSettings();
    const saveBtn = document.getElementById('settings-save') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--mono')).toBe('');
    });
  });
});
