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
const mockClearPluginSettingsCache = vi.fn();
const mockRenderPluginMenus = vi.fn();
const mockCollectPluginSettingsFromPanel = vi.fn(() => []);
const mockActivateSection = vi.fn();
const mockLoadPluginsIntoForm = vi.fn();
const mockCollectGeneralSettings = vi.fn(() => ({}));
const mockLoadGeneralSettingsIntoForm = vi.fn();
const mockCollectCommitSettings = vi.fn(() => ({}));
const mockCollectCommitTemplateSettings = vi.fn(() => ({}));
const mockLoadCommitSettingsIntoForm = vi.fn();
const mockApplyPluginSettingsSections = vi.fn();
const mockInvokePluginAction = vi.fn();

vi.mock('../lib/tauri', () => ({
    TAURI: { invoke: mockInvoke },
}));
vi.mock('../lib/monitoring', () => ({
    syncFrontendMonitoring: mockSyncFrontendMonitoring,
}));
vi.mock('../ui/modals', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
}));
vi.mock('../lib/dom', () => ({
    toKebab: (s: string) => String(s || '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase(),
}));
vi.mock('../lib/notify', () => ({
    notify: mockNotify,
}));
vi.mock('../ui/layout', () => ({
    setTheme: mockSetTheme,
    applyCommitSummaryRestriction: mockApplyCommitSummaryRestriction,
    applyGpuAccelerationPreference: mockApplyGpuAccelerationPreference,
}));
vi.mock('./settingsGeneral', () => ({
    collectGeneralSettings: mockCollectGeneralSettings,
    loadGeneralSettingsIntoForm: mockLoadGeneralSettingsIntoForm,
}));
vi.mock('./settingsCommit', () => ({
    collectCommitSettings: mockCollectCommitSettings,
    collectCommitTemplateSettings: mockCollectCommitTemplateSettings,
    DEFAULT_COMMIT_MESSAGE_CREATE: 'Create {file:name}',
    DEFAULT_COMMIT_MESSAGE_DELETE: 'Delete {file:name}',
    DEFAULT_COMMIT_MESSAGE_UPDATE: 'Update {file:name}',
    loadCommitSettingsIntoForm: mockLoadCommitSettingsIntoForm,
}));
vi.mock('../themes', () => ({
    DEFAULT_LIGHT_THEME_ID: 'default-light',
    DEFAULT_DARK_THEME_ID: 'default-dark',
    DEFAULT_THEME_ID: 'default',
    getActiveThemeId: mockGetActiveThemeId,
    selectThemePack: mockSelectThemePack,
}));
vi.mock('../plugins', () => ({
    invokePluginAction: mockInvokePluginAction,
    applyPluginSettingsSections: mockApplyPluginSettingsSections,
}));
vi.mock('./settingsTheme', () => ({
    applyAnimationPreference: mockApplyAnimationPreference,
    modeForTheme: mockModeForTheme,
    rebuildThemePackOptions: mockRebuildThemePackOptions,
    themeTooltip: mockThemeTooltip,
}));
vi.mock('./settingsPluginUI', () => ({
    clearPluginSettingsCache: mockClearPluginSettingsCache,
    renderPluginMenus: mockRenderPluginMenus,
    collectPluginSettingsFromPanel: mockCollectPluginSettingsFromPanel,
    activateSection: mockActivateSection,
}));
vi.mock('./settingsPlugins', () => ({
    loadPluginsIntoForm: mockLoadPluginsIntoForm,
}));
vi.mock('../state/state', () => ({
    setGlobalSettings: mockSetGlobalSettings,
}));
vi.mock('./repo/commit', () => ({
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
    mockClearPluginSettingsCache.mockReset();
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
        return import('./settings');
    }

    it('re-exports applyAnimationPreference', async () => {
        const mod = await load();
        expect(typeof mod.applyAnimationPreference).toBe('function');
    });

    it('re-exports clearPluginSettingsCache', async () => {
        const mod = await load();
        expect(typeof mod.clearPluginSettingsCache).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// openSettings
// ---------------------------------------------------------------------------

describe('openSettings', () => {
    async function load() {
        return import('./settings');
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
});

// ---------------------------------------------------------------------------
// loadSettingsIntoForm
// ---------------------------------------------------------------------------

describe('loadSettingsIntoForm', () => {
    async function load() {
        return import('./settings');
    }

    it('loads settings from backend and fills the form', async () => {
        mountSettingsModal();
        const cfg = {
            general: { theme: 'light', theme_pack: 'default-light', language: 'en' },
            commit: { restrict_commit_summary: true },
            diff: { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true },
            lfs: { enabled: true, concurrency: 4, require_lock_before_edit: false, background_fetch_on_checkout: true },
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
        return import('./settings');
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
        return import('./settings');
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
        return import('./settings');
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
        return import('./settings');
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
// wireSettings - LFS toggle
// ---------------------------------------------------------------------------

describe('wireSettings (LFS toggle)', () => {
    async function load() {
        return import('./settings');
    }

    function mountWithLfs() {
        const modal = mountSettingsModal();
        modal.insertAdjacentHTML('beforeend', [
            '<input id="set-lfs-enabled" type="checkbox" />',
            '<input id="set-lfs-concurrency" type="number" />',
            '<input id="set-lfs-require-lock" type="checkbox" />',
            '<input id="set-lfs-bg-fetch" type="checkbox" />',
        ].join('\n'));
        return modal;
    }

    it('disables LFS dependents when LFS is unchecked', async () => {
        mountWithLfs();
        const { wireSettings } = await load();
        wireSettings();
        const lfsToggle = document.getElementById('set-lfs-enabled') as HTMLInputElement;
        lfsToggle.checked = false;
        lfsToggle.dispatchEvent(new Event('change'));
        const concurrency = document.getElementById('set-lfs-concurrency') as HTMLInputElement;
        expect(concurrency.disabled).toBe(true);
    });

    it('enables LFS dependents when LFS is checked', async () => {
        mountWithLfs();
        const { wireSettings } = await load();
        wireSettings();
        const lfsToggle = document.getElementById('set-lfs-enabled') as HTMLInputElement;
        lfsToggle.checked = true;
        lfsToggle.dispatchEvent(new Event('change'));
        const concurrency = document.getElementById('set-lfs-concurrency') as HTMLInputElement;
        expect(concurrency.disabled).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// wireSettings - merge mode toggle
// ---------------------------------------------------------------------------

describe('wireSettings (merge mode toggle)', () => {
    async function load() {
        return import('./settings');
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
        return import('./settings');
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
        const modal = document.getElementById('settings-modal')!;
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
        return import('./settings');
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
            expect(mockClearPluginSettingsCache).toHaveBeenCalled();
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
        return import('./settings');
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
        return import('./settings');
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
});
