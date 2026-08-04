// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI, isTauriRuntimeAvailable } from '../lib/tauri';
import { notify } from '../lib/notify';
import type { PluginSummary } from '../plugins';
import type { GlobalSettings } from '../types';
import {
    PLUGINS_PANEL_STATE_KEY,
    createPluginsPanelState,
    ensureSelection,
    getFilteredPlugins,
    syncStartFailures,
} from './settingsPluginsState';
import type { PluginsPanelCtx, PluginsPanelState } from './settingsPluginsState';
import { reloadPluginSummaries, renderPluginList, updatePluginCounts } from './settingsPluginsList';
import { wirePluginsPane } from './settingsPluginsMenu';

// ---------------------------------------------------------------------------
// Plugins management panel facade.
//
// The panel responsibilities live in dedicated modules:
//   - settingsPluginsState.ts — panel state, enablement, search scoring
//   - settingsPluginsList.ts  — plugin list + counts + reload
//   - settingsPluginsDetail.ts — plugin detail view
//   - settingsPluginsToggle.ts — toggle queue + persistence + theme rebuild
//   - settingsPluginsMenu.ts  — context menu + pane event wiring
// ---------------------------------------------------------------------------

/** Loads plugin data and renders the full plugins management panel into the settings modal. */
export async function loadPluginsIntoForm(modal: HTMLElement, cfg: GlobalSettings): Promise<void> {
    const pane = modal.querySelector<HTMLElement>('#plugins-pane');
    const listEl = modal.querySelector<HTMLElement>('#plugins-list');
    const detailEl = modal.querySelector<HTMLElement>('#plugins-detail');
    const groupLabelEl = modal.querySelector<HTMLElement>('#plugins-group-label');
    const searchEl = modal.querySelector<HTMLInputElement>('#plugins-search');
    const syncConfigBtn = modal.querySelector<HTMLButtonElement>('#plugins-sync-config');
    const enableAllBtn = modal.querySelector<HTMLButtonElement>('#plugins-enable-all');
    const disableAllBtn = modal.querySelector<HTMLButtonElement>('#plugins-disable-all');

    if (!pane || !listEl || !detailEl || !groupLabelEl || !searchEl || !syncConfigBtn || !enableAllBtn || !disableAllBtn) return;

    const state: PluginsPanelState = (modal as any)[PLUGINS_PANEL_STATE_KEY] || createPluginsPanelState();
    const ctx: PluginsPanelCtx = {
        modal,
        pane,
        listEl,
        detailEl,
        groupLabelEl,
        searchEl,
        syncConfigBtn,
        enableAllBtn,
        disableAllBtn,
        state,
    };

    // This settings pane can be initialized multiple times during navigation/rerender.
    // Avoid stacking duplicate click handlers which would open many dialogs.
    if (!(syncConfigBtn as any).dataset?.bound) {
        (syncConfigBtn as any).dataset.bound = '1';
        syncConfigBtn.addEventListener('click', async () => {
            try {
                await TAURI.invoke('sync_configured_plugins');
                notify('Reloaded plugin config');
                await reloadPluginSummaries(ctx);
            } catch (err) {
                const msg = String(err || '').trim();
                notify(msg ? `Plugin sync failed: ${msg}` : 'Plugin sync failed');
            }
        });
    }

    listEl.replaceChildren();
    detailEl.replaceChildren();
    detailEl.classList.add('empty');
    detailEl.textContent = 'Select a plugin to view details.';

    if (!isTauriRuntimeAvailable()) {
        groupLabelEl.textContent = 'Installed (0 of 0 enabled)';
        listEl.replaceChildren();
        return;
    }

    let list: PluginSummary[] = [];
    try {
        list = await TAURI.invoke<PluginSummary[]>('list_plugins');
    } catch {
        groupLabelEl.textContent = 'Installed (0 of 0 enabled)';
        listEl.replaceChildren();
        detailEl.classList.add('empty');
        detailEl.textContent = 'Failed to load plugins.';
        return;
    }

    const disabled = new Set(
        (Array.isArray(cfg.plugins?.disabled) ? cfg.plugins!.disabled! : [])
            .map((s) => String(s || '').trim().toLowerCase())
            .filter(Boolean),
    );
    const enabled = new Set(
        (Array.isArray(cfg.plugins?.enabled) ? cfg.plugins!.enabled! : [])
            .map((s) => String(s || '').trim().toLowerCase())
            .filter(Boolean),
    );

    state.list = Array.isArray(list) ? list : [];
    state.disabled = disabled;
    state.enabled = enabled;
    state.query = String(searchEl.value || '').trim();

    await syncStartFailures(state);
    ensureSelection(state, getFilteredPlugins(state));
    (modal as any)[PLUGINS_PANEL_STATE_KEY] = state;
    renderPluginList(ctx);
    updatePluginCounts(ctx);

    wirePluginsPane(ctx);
}
