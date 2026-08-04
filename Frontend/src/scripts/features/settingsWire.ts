// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { syncFrontendMonitoring } from '../lib/monitoring';
import { openModal, closeModal } from '../ui/modals';
import { ModalController } from '../lib/modalController';
import { applyAppearanceCssVars } from '../lib/cssVars';
import { notify } from '../lib/notify';
import { setTheme, applyCommitSummaryRestriction, applyGpuAccelerationPreference } from '../ui/layout';
import {
    DEFAULT_LIGHT_THEME_ID,
    getActiveThemeId,
    selectThemePack,
} from '../themes';
import { invokePluginAction, applyPluginSettingsSections } from '../plugins';
import type { GlobalSettings } from '../types';
import { setGlobalSettings } from '../state/state';
import { updateCommitButton } from './repo/commit';
import {
    applyAnimationPreference,
    modeForTheme,
    rebuildThemePackOptions,
    themeTooltip,
} from './settingsTheme';
import { renderPluginMenus, collectPluginSettingsFromPanel, activateSection } from './settingsPluginUI';
import { collectSettingsFromForm } from './settingsCollect';
import { loadSettingsIntoForm } from './settingsApply';
import {
    DEFAULT_COMMIT_MESSAGE_CREATE,
    DEFAULT_COMMIT_MESSAGE_DELETE,
    DEFAULT_COMMIT_MESSAGE_UPDATE,
} from './settingsCommit';

/** Shows the "Saved!" state on a settings action button for two seconds. */
function flashSavedState(button: HTMLButtonElement, originalText = 'Save'): void {
    button.classList.add('saved-state');
    button.textContent = 'Saved!';
    setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('saved-state');
    }, 2000);
}

/** Opens the settings modal, optionally activating the given section. */
export function openSettings(section?: string) {
    openModal('settings-modal');
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (!modal) return;
    applyPluginSettingsSections(modal);
    renderPluginMenus(modal)
        .catch(() => {})
        .finally(() => {
            if (section) activateSection(modal, section);
        });

    // Prevent a "double-click to refresh" feel where the user opens the Theme dropdown
    // before the async settings/theme list has finished loading.
    modal.setAttribute('aria-busy', 'true');
    const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
    const setThemeSel = modal.querySelector<HTMLSelectElement>('#set-theme');
    if (setThemeAuto) setThemeAuto.disabled = true;
    if (setThemeSel) {
        setThemeSel.disabled = true;
        setThemeSel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = DEFAULT_LIGHT_THEME_ID;
        opt.textContent = 'Loading…';
        setThemeSel.appendChild(opt);
    }

    loadSettingsIntoForm(modal)
        .catch((err) => { console.error('Failed to load settings into form:', err); })
        .finally(() => {
            modal.removeAttribute('aria-busy');
            const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
            if (setThemeAuto) setThemeAuto.disabled = false;
        });
}

/** Wires all event handlers on the settings modal. Called once after the modal markup is injected. */
export const settingsModalController = new ModalController<void>("settings-modal", {
  wire: (modal) => {

    applyPluginSettingsSections(modal);

    // Close on backdrop / [data-close]
    modal.addEventListener('click', (e) => {
        const backdrop = modal.querySelector('.backdrop');
        if ((e.target as Element).matches?.('[data-close]') || e.target === backdrop) {
            closeModal('settings-modal');
        }
    });

    // Sidebar switching
    const nav = modal.querySelector('#settings-nav') as HTMLElement | null;
    const panels = modal.querySelector('#settings-panels') as HTMLElement | null;
    if (nav && panels) {
        nav.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('[data-section]') as HTMLElement | null;
            if (!btn) return;
            const target = btn.getAttribute('data-section') || undefined;
            if (!target) return;
            activateSection(modal, target);
        });

        panels.addEventListener('click', async (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-plugin-action][data-plugin-id]');
            if (!btn) return;
            const pluginId = btn.dataset.pluginId || '';
            const actionId = btn.dataset.pluginAction || '';
            if (!pluginId || !actionId) return;
            try {
                await invokePluginAction(pluginId, actionId);
            } catch (err) {
                console.error('Failed to invoke plugin action', err);
                notify('Plugin action failed');
            }
        });
    }

    const mergeModeSel = modal.querySelector('#set-merge-mode') as HTMLSelectElement | null;
    const mergeCustomGroups = Array.from(modal.querySelectorAll<HTMLElement>('[data-merge-custom]'));

    const updateMergeCustomState = () => {
        const custom = (mergeModeSel?.value || 'builtin') === 'custom';
        mergeCustomGroups.forEach((group) => {
            group.classList.toggle('disabled', !custom);
            group.querySelectorAll('input, textarea, select').forEach((field) => {
                (field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled = !custom;
            });
        });
    };
    updateMergeCustomState();
    mergeModeSel?.addEventListener('change', updateMergeCustomState);

    const sshBinSel = modal.querySelector('#set-ssh-binary') as HTMLSelectElement | null;
    const sshPathInput = modal.querySelector('#set-ssh-path') as HTMLInputElement | null;
    const updateSshPathState = () => {
        if (!sshPathInput) return;
        const mode = (sshBinSel?.value || 'auto').toLowerCase();
        const enabled = mode === 'custom';
        sshPathInput.disabled = !enabled;
        if (!enabled) sshPathInput.value = '';
    };
    updateSshPathState();
    sshBinSel?.addEventListener('change', updateSshPathState);

    const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
    const setThemeSel = modal.querySelector<HTMLSelectElement>('#set-theme');

    const syncThemeTitle = () => {
        if (!setThemeSel) return;
        setThemeSel.title = themeTooltip(setThemeSel.value || DEFAULT_LIGHT_THEME_ID);
    };

    const applyThemeFromControls = async (opts: { silent?: boolean } = {}) => {
        if (!setThemeSel) return;
        const auto = !!setThemeAuto?.checked;
        setThemeSel.disabled = auto;

        const themeId = setThemeSel.value || DEFAULT_LIGHT_THEME_ID;
        const mode: 'system' | 'light' | 'dark' = auto ? 'system' : modeForTheme(themeId);
        setTheme(mode);
        await selectThemePack(themeId, { silent: opts.silent, mode });
        if (auto) {
            setThemeSel.value = getActiveThemeId() || DEFAULT_LIGHT_THEME_ID;
        }
        syncThemeTitle();
    };

    setThemeSel?.addEventListener('pointerdown', () => {
        if (setThemeAuto?.checked) return;

        // Keep the options list in sync with the already-cached theme list without
        // kicking off an async refresh during the same user gesture (which makes the
        // native picker look stale until it's opened again).
        rebuildThemePackOptions(setThemeSel, {
            desiredId: setThemeSel.value,
            forceReload: false,
        }).catch(() => {});
    });

    setThemeSel?.addEventListener('change', () => {
        applyThemeFromControls({ silent: true }).catch(() => {});
    });

    setThemeAuto?.addEventListener('change', () => {
        applyThemeFromControls({ silent: true }).catch(() => {});
    });

    window.addEventListener('openvcs:theme-pack-changed', () => {
        if (!setThemeAuto?.checked || !setThemeSel) return;
        setThemeSel.value = getActiveThemeId() || DEFAULT_LIGHT_THEME_ID;
        setThemeSel.disabled = true;
        syncThemeTitle();
    });

    const settingsSave  = modal.querySelector('#settings-save')  as HTMLButtonElement | null;
    const settingsReset = modal.querySelector('#settings-reset') as HTMLButtonElement | null;

    if (settingsSave) {
        settingsSave.style.width = '5rem';
        settingsSave.style.textAlign = 'center';
    }

    settingsSave?.addEventListener('click', async () => {
        if (!settingsSave) return;
        if (settingsSave.classList.contains('saved-state') || settingsSave.classList.contains('saving-state')) return;

        settingsSave.classList.add('saving-state');
        settingsSave.disabled = true;

        try {
            const activePanel = modal.querySelector<HTMLElement>('#settings-panels .panel-form:not(.hidden)');
            if (activePanel?.getAttribute('data-plugin-settings') === 'true') {
                const pluginId = String(activePanel.dataset.pluginId || '').trim();
                if (!pluginId) {
                    notify('Failed to save plugin settings');
                    return;
                }
                await TAURI.invoke('save_plugin_settings', {
                    pluginId,
                    values: collectPluginSettingsFromPanel(activePanel),
                });
                notify('Plugin settings saved');
                flashSavedState(settingsSave);
                return;
            }

            const next = collectSettingsFromForm(modal);
            const previousCfg = (() => {
                try {
                    return JSON.parse(String(modal.dataset.currentCfg || '{}')) as GlobalSettings;
                } catch {
                    return {} as GlobalSettings;
                }
            })();
            const gpuChanged = previousCfg.performance?.gpu_accel !== next.performance?.gpu_accel;

            await TAURI.invoke('set_global_settings', { cfg: next });
            setGlobalSettings(next);
            await syncFrontendMonitoring(next);

            modal.dataset.currentCfg = JSON.stringify(next);

            const theme = (next.general?.theme || 'system') as 'system' | 'light' | 'dark';
            const pack = String(next.general?.theme_pack || DEFAULT_LIGHT_THEME_ID);
            setTheme(theme);
            try { await selectThemePack(pack, { silent: true, mode: theme }); } catch {}
            try {
                applyAppearanceCssVars({
                    tabWidth: next?.diff?.tab_width,
                    uiScale: next?.ux?.ui_scale,
                    fontMono: next?.ux?.font_mono,
                }, true);
                applyAnimationPreference(next?.performance?.animations);
                applyGpuAccelerationPreference(next?.performance?.gpu_accel);
                applyCommitSummaryRestriction(next?.commit?.restrict_commit_summary !== false);
                updateCommitButton();
            } catch {}

            notify(gpuChanged ? 'Settings saved. GPU changes apply after restart.' : 'Settings saved');
            flashSavedState(settingsSave);
        } catch (e) {
            console.error('Failed to save settings:', e);
            notify('Failed to save settings');
        } finally {
            settingsSave.classList.remove('saving-state');
            settingsSave.disabled = false;
        }
    });

    settingsReset?.addEventListener('click', async () => {
        try {
            const activePanel = modal.querySelector<HTMLElement>('#settings-panels .panel-form:not(.hidden)');
            if (activePanel?.getAttribute('data-plugin-settings') === 'true') {
                const pluginId = String(activePanel.dataset.pluginId || '').trim();
                const section = String(activePanel.getAttribute('data-panel') || '').trim();
                if (!pluginId) {
                    notify('Failed to reset plugin settings');
                    return;
                }
                await TAURI.invoke('reset_plugin_settings', { pluginId });
                notify('Plugin settings reset');
                await renderPluginMenus(modal);
                if (section) activateSection(modal, section);
                return;
            }

            const cur = await TAURI.invoke<GlobalSettings>('get_global_settings');

            cur.general = {
                theme: 'system',
                theme_pack: DEFAULT_LIGHT_THEME_ID,
                language: 'system',
                default_backend: '',
                update_channel: 'stable',
                reopen_last_repos: true,
                checks_on_launch: true,
                telemetry: false,
                crash_reports: true,
            };
            cur.commit = {
                commit_message_template_enabled: true,
                restrict_commit_summary: true,
                commit_templates: {
                    commit_message_template_create: DEFAULT_COMMIT_MESSAGE_CREATE,
                    commit_message_template_update: DEFAULT_COMMIT_MESSAGE_UPDATE,
                    commit_message_template_delete: DEFAULT_COMMIT_MESSAGE_DELETE,
                },
            };
            cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
            cur.performance = { progressive_render: true, gpu_accel: true, animations: true };
            cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none', recents_limit: 10 };
            cur.logging = { level: 'info', live_viewer: false, retain_archives: 10 };
            cur.plugins = { disabled: [], enabled: [] };

            await TAURI.invoke('set_global_settings', { cfg: cur });
            setGlobalSettings(cur);
            await syncFrontendMonitoring(cur);
            applyAnimationPreference(cur.performance?.animations);
            applyGpuAccelerationPreference(cur.performance?.gpu_accel);
            applyCommitSummaryRestriction(cur.commit?.restrict_commit_summary !== false);
            updateCommitButton();
            await loadSettingsIntoForm(modal);
            setTheme('system');
            try { await selectThemePack(DEFAULT_LIGHT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
            notify('Defaults restored');
        } catch (e) { console.error('Failed to restore defaults:', e); notify('Failed to restore defaults'); }
    });
    // Settings are loaded by `openSettings()` on open.
  },
});

/** Wires all event handlers on the settings modal. Called once after the modal markup is injected. */
export function wireSettings() {
    settingsModalController.initOnce();
}
