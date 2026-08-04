// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import type { PluginSummary } from '../plugins';
import {
    countEnabledPlugins,
    ensureSelection,
    getFilteredPlugins,
    pluginIsEnabled,
    syncStartFailures,
} from './settingsPluginsState';
import type { PluginsPanelCtx } from './settingsPluginsState';
import { renderPluginDetails } from './settingsPluginsDetail';

/** Renders the plugin rows into the list element. */
export function renderPluginList(ctx: PluginsPanelCtx): void {
    const { listEl, detailEl, state } = ctx;
    const filtered = getFilteredPlugins(state);
    listEl.replaceChildren();
    if (!state.list.length) {
        const li = document.createElement('li');
        li.className = 'plugin-row';
        li.setAttribute('aria-selected', 'false');
        li.textContent = 'No plugins installed.';
        listEl.appendChild(li);
        renderPluginDetails(ctx, filtered);
        return;
    }

    if (!filtered.length) {
        const li = document.createElement('li');
        li.className = 'plugin-row';
        li.setAttribute('aria-selected', 'false');
        li.textContent = 'No matching plugins.';
        listEl.appendChild(li);
        renderPluginDetails(ctx, filtered);
        return;
    }

    for (const plugin of filtered) {
        const id = String(plugin.id).trim();
        const idLower = id.toLowerCase();
        const isEnabledNow = pluginIsEnabled(state, plugin);
        const pendingToggle = state.pendingToggleById.get(idLower);
        const hasToggleError = state.errorToggleById.has(idLower);

        const li = document.createElement('li');
        li.className = 'plugin-row';
        li.dataset.plugin = id;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', state.selectedId === id ? 'true' : 'false');

        const main = document.createElement('div');
        main.className = 'plugin-row-main';

        const icon = document.createElement('div');
        icon.className = 'plugin-icon';
        const initial = (String(plugin.name || '').trim() || 'Plugin').slice(0, 1).toUpperCase() || 'P';
        icon.textContent = initial;
        const iconUrl = String(plugin.icon_data_url || '').trim();
        if (iconUrl) {
            const img = document.createElement('img');
            img.className = 'plugin-icon-img';
            img.alt = `${String(plugin.name || '').trim() || 'Plugin'} icon`;
            img.decoding = 'async';
            img.loading = 'lazy';
            img.addEventListener('load', () => {
                icon.classList.add('has-img');
                icon.replaceChildren(img);
            });
            img.addEventListener('error', () => {
                img.remove();
                icon.classList.remove('has-img');
                if (!icon.textContent?.trim()) icon.textContent = initial;
            });
            img.src = iconUrl;
            icon.appendChild(img);
        }

        const text = document.createElement('div');
        text.className = 'plugin-row-text';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = String(plugin.name || '').trim() || 'Unnamed plugin';
        const meta = document.createElement('div');
        meta.className = 'meta';
        const version = String(plugin.version || '').trim();
        const author = String(plugin.author || '').trim();
        const category = String(plugin.category || '').trim();
        meta.textContent = [category, author, version ? `v${version}` : ''].filter(Boolean).join(' • ') || ' ';
        text.appendChild(name);
        text.appendChild(meta);

        main.appendChild(icon);
        main.appendChild(text);

        const checkboxWrap = document.createElement('label');
        checkboxWrap.className = 'plugin-check';
        checkboxWrap.dataset.state = hasToggleError
            ? 'error'
            : pendingToggle === true
                ? 'enabling'
                : isEnabledNow
                    ? 'enabled'
                    : 'disabled';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'plugin-check-input';
        checkbox.checked = isEnabledNow;
        checkbox.disabled = typeof pendingToggle === 'boolean';
        checkbox.dataset.pluginId = id;
        checkbox.setAttribute('aria-label', `Enable ${String(plugin.name || '').trim() || 'plugin'}`);

        const checkboxUi = document.createElement('span');
        checkboxUi.className = 'plugin-check-ui';
        checkboxUi.setAttribute('aria-hidden', 'true');

        checkboxWrap.appendChild(checkbox);
        checkboxWrap.appendChild(checkboxUi);

        li.appendChild(main);
        li.appendChild(checkboxWrap);
        listEl.appendChild(li);
    }

    renderPluginDetails(ctx, filtered);
}

/** Refreshes the enabled/disabled group label in the plugins pane header. */
export function updatePluginCounts(ctx: PluginsPanelCtx): void {
    const { groupLabelEl, state } = ctx;
    const enabledNow = countEnabledPlugins(state);
    groupLabelEl.textContent = `Installed (${enabledNow} of ${state.list.length} enabled)`;
}

/** Reloads plugin summaries from the backend and re-renders the panel. */
export async function reloadPluginSummaries(ctx: PluginsPanelCtx): Promise<void> {
    const { state } = ctx;
    let list: PluginSummary[] = [];
    try {
        list = await TAURI.invoke<PluginSummary[]>('list_plugins');
    } catch (err) {
        console.warn('reload list_plugins failed', err);
        return;
    }

    state.list = Array.isArray(list) ? list : [];
    await syncStartFailures(state);
    ensureSelection(state, getFilteredPlugins(state));
    renderPluginList(ctx);
    updatePluginCounts(ctx);
}
