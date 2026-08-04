// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { reloadPlugins } from '../plugins';
import { DEFAULT_LIGHT_THEME_ID, refreshAvailableThemes, selectThemePack } from '../themes';
import { setTheme } from '../ui/layout';
import type { GlobalSettings } from '../types';
import { modeForTheme, rebuildThemePackOptions } from './settingsTheme';
import { renderPluginMenus, activateSection } from './settingsPluginUI';
import { getFilteredPlugins } from './settingsPluginsState';
import type { PluginsPanelCtx } from './settingsPluginsState';
import { renderPluginDetails } from './settingsPluginsDetail';
import { renderPluginList, updatePluginCounts } from './settingsPluginsList';

/** Persists the current disabled/enabled plugin sets to global settings. */
export async function persistPluginsDisabled(ctx: PluginsPanelCtx): Promise<void> {
    const { modal, state } = ctx;
    try {
        const cur = await TAURI.invoke<GlobalSettings>('get_global_settings');
        let next: GlobalSettings = { ...(cur || {}) };
        next.plugins = { ...(next.plugins || {}) };
        next.plugins.disabled = Array.from(state.disabled.values());
        next.plugins.enabled = Array.from(state.enabled.values());
        await TAURI.invoke('set_global_settings', { cfg: next });
        modal.dataset.currentCfg = JSON.stringify(next);
        await reloadPlugins();
        try {
            await refreshAvailableThemes();
            const themeSel = modal.querySelector<HTMLSelectElement>('#set-theme');
            const themeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
            if (themeSel && document.activeElement !== themeSel) {
                const before = String(themeSel.value || DEFAULT_LIGHT_THEME_ID).trim() || DEFAULT_LIGHT_THEME_ID;
                await rebuildThemePackOptions(themeSel, { desiredId: before, forceReload: false });

                const after = String(themeSel.value || DEFAULT_LIGHT_THEME_ID).trim() || DEFAULT_LIGHT_THEME_ID;
                if (after.toLowerCase() !== before.toLowerCase()) {
                    const auto = !!themeAuto?.checked;
                    const mode: 'system' | 'light' | 'dark' = auto ? 'system' : modeForTheme(after);
                    setTheme(mode);
                    try { await selectThemePack(after, { silent: true, mode }); } catch {}

                    next.general = { ...(next.general || {}) };
                    next.general.theme = mode;
                    next.general.theme_pack = after;
                    try {
                        await TAURI.invoke('set_global_settings', { cfg: next });
                        modal.dataset.currentCfg = JSON.stringify(next);
                    } catch {}
                }
            }
        } catch {}
    } catch (e) { console.error('Failed to update plugins:', e); notify('Failed to update plugins'); }
}

/** Persists a single plugin toggle and refreshes dependent UI. */
export async function persistSinglePluginToggle(ctx: PluginsPanelCtx, pluginId: string, enabled: boolean): Promise<void> {
    const { modal, state } = ctx;
    const idLower = pluginId.trim().toLowerCase();
    try {
        const activeSection = String(
            modal
                .querySelector<HTMLElement>('#settings-nav .seg-btn.active')
                ?.getAttribute('data-section') || '',
        ).trim();
        await TAURI.invoke('set_plugin_enabled', { pluginId, enabled });
        if (enabled) {
            state.disabled.delete(idLower);
            state.enabled.add(idLower);
        } else {
            state.enabled.delete(idLower);
            state.disabled.add(idLower);
        }
        console.debug(`Plugin '${pluginId}' ${enabled ? 'enabled' : 'disabled'}`);
        await reloadPlugins();
        await renderPluginMenus(modal);
        if (activeSection) activateSection(modal, activeSection);
        try {
            await refreshAvailableThemes();
        } catch (e) { console.warn('refreshAvailableThemes failed:', e); }
    } catch (e) {
        state.errorToggleById.add(idLower);
        const existingTimer = state.buttonErrorTimerById.get(idLower);
        if (typeof existingTimer === 'number') {
            window.clearTimeout(existingTimer);
        }
        state.buttonErrorToggleById.add(idLower);
        const timer = window.setTimeout(() => {
            state.buttonErrorToggleById.delete(idLower);
            state.buttonErrorTimerById.delete(idLower);
            renderPluginDetails(ctx, getFilteredPlugins(state));
        }, 2000);
        state.buttonErrorTimerById.set(idLower, timer);
        console.error('Failed to toggle plugin:', e);
        notify('Failed to toggle plugin');
    } finally {
        state.pendingToggleById.delete(idLower);
        updatePluginCounts(ctx);
        renderPluginList(ctx);
    }
}

/** Queues a plugin toggle, deduplicating rapid consecutive requests. */
export function queuePluginToggle(ctx: PluginsPanelCtx, pluginIdRaw: string, enabled: boolean): void {
    const { state } = ctx;
    const id = String(pluginIdRaw || '').trim().toLowerCase();
    if (!id) return;
    if (state.pendingToggleById.has(id)) return;
    const existingTimer = state.buttonErrorTimerById.get(id);
    if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer);
        state.buttonErrorTimerById.delete(id);
    }
    state.buttonErrorToggleById.delete(id);
    state.errorToggleById.delete(id);
    state.pendingToggleById.set(id, enabled);
    renderPluginList(ctx);
    void (async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await persistSinglePluginToggle(ctx, id, enabled);
    })();
}
