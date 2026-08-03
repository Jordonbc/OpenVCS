// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { syncFrontendMonitoring } from '../lib/monitoring';
import { openModal, closeModal } from '../ui/modals';
import { toKebab } from '../lib/dom';
import { notify } from '../lib/notify';
import { setTheme, applyCommitSummaryRestriction, applyGpuAccelerationPreference } from '../ui/layout';
import { collectGeneralSettings, loadGeneralSettingsIntoForm } from './settingsGeneral';
import {
    collectCommitSettings,
    collectCommitTemplateSettings,
    DEFAULT_COMMIT_MESSAGE_CREATE,
    DEFAULT_COMMIT_MESSAGE_DELETE,
    DEFAULT_COMMIT_MESSAGE_UPDATE,
    loadCommitSettingsIntoForm,
} from './settingsCommit';
import {
    DEFAULT_LIGHT_THEME_ID,
    getActiveThemeId,
    selectThemePack,
} from '../themes';
import { invokePluginAction } from '../plugins';
import type { PluginSummary } from '../plugins';
import { applyPluginSettingsSections } from '../plugins';
import type { GlobalSettings } from '../types';
import { setGlobalSettings } from '../state/state';
import { updateCommitButton } from './repo/commit';
import { applyAnimationPreference, modeForTheme, rebuildThemePackOptions, themeTooltip } from './settingsTheme';
import { renderPluginMenus, collectPluginSettingsFromPanel, activateSection } from './settingsPluginUI';
import { loadPluginsIntoForm } from './settingsPlugins';

// Re-export symbols that external consumers import from this module.
export { applyAnimationPreference };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flashSavedState(button: HTMLButtonElement, originalText = 'Save'): void {
    button.classList.add('saved-state');
    button.textContent = 'Saved!';
    setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('saved-state');
    }, 2000);
}

// ---------------------------------------------------------------------------
// Default backend options
// ---------------------------------------------------------------------------

async function refreshDefaultBackendOptions(modal: HTMLElement, cfg: GlobalSettings): Promise<void> {
    const el = modal.querySelector<HTMLSelectElement>('#set-default-backend');
    if (!el) return;

    const desired = String(cfg.general?.default_backend || '').trim();

    let available: Array<[string, string]> = [];
    let defaultBackendId = '';
    try {
        const res = await TAURI.invoke<{ backends: Array<[string, string]>; default_backend_id: string }>('list_vcs_backends_cmd');
        available = Array.isArray(res?.backends) ? res.backends : [];
        defaultBackendId = String(res?.default_backend_id || '').trim();
    } catch {}

    const backends = available
        .map(([id, name]) => [String(id || '').trim(), String(name || '').trim()] as const)
        .filter(([id]) => id.length > 0);

    el.innerHTML = '';
    for (const [id, name] of backends) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name || id;
        el.appendChild(opt);
    }

    el.disabled = backends.length === 0;
    if (!backends.length) {
        console.warn(
            'settings: no VCS backends are currently available; default backend selection is disabled',
        );
        return;
    }
    if (desired && backends.some(([id]) => id === desired)) {
        el.value = desired;
    } else if (defaultBackendId && backends.some(([id]) => id === defaultBackendId)) {
        el.value = defaultBackendId;
    } else {
        el.value = backends[0][0];
    }
}

// ---------------------------------------------------------------------------
// Open settings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Collect settings from form
// ---------------------------------------------------------------------------

function collectSettingsFromForm(root: HTMLElement): GlobalSettings {
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

    let base: Partial<GlobalSettings> = {};
    try {
        base = JSON.parse(root?.dataset.currentCfg || '{}');
    } catch {
        // Corrupted or missing config — fall back to defaults.
    }

    const o: GlobalSettings = { ...base };

    o.general = collectGeneralSettings(root, o, modeForTheme);
    o.commit = {
        ...o.commit,
        ...collectCommitSettings(root),
        commit_templates: {
            ...(o.commit?.commit_templates || {}),
            ...collectCommitTemplateSettings(root),
        },
    };

    o.diff = {
        ...o.diff,
        tab_width: Number(get<HTMLInputElement>('#set-tab-width')?.value ?? 0),
        ignore_whitespace: get<HTMLSelectElement>('#set-ignore-whitespace')?.value,
        max_file_size_mb: Number(get<HTMLInputElement>('#set-max-file-size-mb')?.value ?? 0),
        intraline: !!get<HTMLInputElement>('#set-intraline')?.checked,
        show_binary_placeholders: !!get<HTMLInputElement>('#set-binary-placeholders')?.checked,
        external_merge: (() => {
            const mode = get<HTMLSelectElement>('#set-merge-mode')?.value || 'builtin';
            const path = (get<HTMLInputElement>('#set-merge-path')?.value || '').trim();
            const args = get<HTMLInputElement>('#set-merge-args')?.value || '';
            return {
                enabled: mode === 'custom' && path.length > 0,
                path,
                args,
            };
        })(),
    };

    o.performance = {
        ...o.performance,
        animations: !!get<HTMLInputElement>('#set-animations')?.checked,
        progressive_render: !!get<HTMLInputElement>('#set-progressive-render')?.checked,
        gpu_accel: !!get<HTMLInputElement>('#set-gpu-accel')?.checked,
    };

    const rlRaw = get<HTMLInputElement>('#set-recents-limit')?.value ?? '';
    const recentsLimit = rlRaw.trim() === '' ? 10 : Math.max(1, Math.min(100, Number(rlRaw)));
    o.ux = {
        ...o.ux,
        ui_scale: Number(get<HTMLInputElement>('#set-ui-scale')?.value ?? 1),
        font_mono: get<HTMLInputElement>('#set-font-mono')?.value,
        vim_nav: !!get<HTMLInputElement>('#set-vim-nav')?.checked,
        color_blind_mode: get<HTMLSelectElement>('#set-cb-mode')?.value,
        recents_limit: recentsLimit,
    };

    // Logging
    const keepRaw = get<HTMLInputElement>('#set-log-keep')?.value ?? '';
    const keep = keepRaw.trim() === '' ? 10 : Math.max(1, Math.min(100, Number(keepRaw)));
    o.logging = {
        ...o.logging,
        level: (get<HTMLSelectElement>('#set-log-level')?.value || 'info') as any,
        retain_archives: keep,
    };

    const pluginsStateKey = '__pluginsPanelState';
    const pluginsState = (root as any)[pluginsStateKey] as { disabled?: Set<string>; enabled?: Set<string>; list?: PluginSummary[] } | undefined;
    if (pluginsState?.disabled instanceof Set && pluginsState?.enabled instanceof Set) {
        const byLower = new Map<string, string>();
        for (const plugin of Array.isArray(pluginsState.list) ? pluginsState.list : []) {
            const id = String(plugin?.id || '').trim();
            if (!id) continue;
            byLower.set(id.toLowerCase(), id);
        }

        const disabled = Array.from(pluginsState.disabled.values())
            .map((id) => String(id || '').trim().toLowerCase())
            .filter(Boolean)
            .map((id) => byLower.get(id) || id);

        const enabled = Array.from(pluginsState.enabled.values())
            .map((id) => String(id || '').trim().toLowerCase())
            .filter(Boolean)
            .map((id) => byLower.get(id) || id);

        o.plugins = { ...(o.plugins || {}), disabled, enabled };
    } else {
        const pluginToggles = Array.from(root.querySelectorAll<HTMLInputElement>('[data-plugin-id]'));
        if (pluginToggles.length) {
            const disabled: string[] = [];
            const enabled: string[] = [];
            for (const toggle of pluginToggles) {
                const id = String(toggle.dataset.pluginId || '').trim();
                if (!id) continue;
                if (toggle.checked) enabled.push(id);
                else disabled.push(id);
            }
            o.plugins = { ...(o.plugins || {}), disabled, enabled };
        }
    }

    return o;
}

// ---------------------------------------------------------------------------
// Load settings into form
// ---------------------------------------------------------------------------

/** Loads all settings into the settings modal form controls. */
export async function loadSettingsIntoForm(root?: HTMLElement) {
    const m = root || (document.getElementById('settings-modal') as HTMLElement | null);
    if (!m) return;
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => m.querySelector<T>(sel);
    let cfg: GlobalSettings | null = null;
    try {
        cfg = await TAURI.invoke<GlobalSettings>('get_global_settings');
    } catch { /* ignore */ }
    if (!cfg) return;

    m.dataset.currentCfg = JSON.stringify(cfg);

    await loadPluginsIntoForm(m, cfg);

    await loadGeneralSettingsIntoForm(m, cfg, toKebab, refreshDefaultBackendOptions, rebuildThemePackOptions);
    loadCommitSettingsIntoForm(m, cfg);
    const elRl = get<HTMLInputElement>('#set-recents-limit'); if (elRl) elRl.value = String(cfg.ux?.recents_limit ?? 10);

    const elTw = get<HTMLInputElement>('#set-tab-width'); if (elTw) elTw.value = String(cfg.diff?.tab_width ?? 0);
    const elIw = get<HTMLSelectElement>('#set-ignore-whitespace'); if (elIw) elIw.value = toKebab(cfg.diff?.ignore_whitespace);
    const elMx = get<HTMLInputElement>('#set-max-file-size-mb'); if (elMx) elMx.value = String(cfg.diff?.max_file_size_mb ?? 0);
    const elIn = get<HTMLInputElement>('#set-intraline'); if (elIn) elIn.checked = !!cfg.diff?.intraline;
    const elBp = get<HTMLInputElement>('#set-binary-placeholders'); if (elBp) elBp.checked = !!cfg.diff?.show_binary_placeholders;
    const elRestrict = get<HTMLInputElement>('#set-restrict-commit-summary'); if (elRestrict) elRestrict.checked = cfg.commit?.restrict_commit_summary !== false;
    const elMm = get<HTMLSelectElement>('#set-merge-mode');
    const elMp = get<HTMLInputElement>('#set-merge-path');
    const elMa = get<HTMLInputElement>('#set-merge-args');
    if (elMp) elMp.value = cfg.diff?.external_merge?.path ?? '';
    if (elMa) elMa.value = cfg.diff?.external_merge?.args ?? '';
    if (elMm) {
        const ext = cfg.diff?.external_merge;
        elMm.value = ext && ext.enabled && (ext.path || '').trim().length > 0 ? 'custom' : 'builtin';
        elMm.dispatchEvent(new Event('change'));
    }

    const elAni= get<HTMLInputElement>('#set-animations'); if (elAni) elAni.checked = cfg.performance?.animations !== false;
    const elPrg= get<HTMLInputElement>('#set-progressive-render'); if (elPrg) elPrg.checked = !!cfg.performance?.progressive_render;
    const elGpu= get<HTMLInputElement>('#set-gpu-accel'); if (elGpu) elGpu.checked = !!cfg.performance?.gpu_accel;

    const elUi = get<HTMLInputElement>('#set-ui-scale'); if (elUi) elUi.value = String(cfg.ux?.ui_scale ?? 1.0);
    const elFm = get<HTMLInputElement>('#set-font-mono'); if (elFm) elFm.value = cfg.ux?.font_mono ?? 'monospace';
    const elVn = get<HTMLInputElement>('#set-vim-nav'); if (elVn) elVn.checked = !!cfg.ux?.vim_nav;
    const elCb = get<HTMLSelectElement>('#set-cb-mode'); if (elCb) elCb.value = toKebab(cfg.ux?.color_blind_mode);

    // Logging
    const elLvl = get<HTMLSelectElement>('#set-log-level'); if (elLvl) elLvl.value = toKebab(cfg.logging?.level || 'info');
    const elKeep= get<HTMLInputElement>('#set-log-keep'); if (elKeep) elKeep.value = String(cfg.logging?.retain_archives ?? 10);
}

// ---------------------------------------------------------------------------
// Wire settings (event wiring)
// ---------------------------------------------------------------------------

/** Wires all event handlers on the settings modal. Called once after the modal markup is injected. */
export function wireSettings() {
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

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
                const root = document.documentElement;
                const tabw = Number(next?.diff?.tab_width ?? 4);
                if (tabw && isFinite(tabw)) root.style.setProperty('--tab-size', String(tabw));
                const uiScale = Number(next?.ux?.ui_scale ?? 1);
                if (uiScale && isFinite(uiScale)) root.style.setProperty('--ui-scale', String(uiScale));
                const mono = String(next?.ux?.font_mono || '').trim();
                if (mono) root.style.setProperty('--mono', mono);
                else root.style.removeProperty('--mono');
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
}
