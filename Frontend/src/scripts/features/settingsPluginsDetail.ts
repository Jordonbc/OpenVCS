// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PluginSummary } from '../plugins';
import { pluginIsEnabled } from './settingsPluginsState';
import type { PluginsPanelCtx } from './settingsPluginsState';

/** Renders the plugin detail panel for the currently selected plugin. */
export function renderPluginDetails(ctx: PluginsPanelCtx, filtered: PluginSummary[]): void {
    const { detailEl, state } = ctx;
    detailEl.replaceChildren();
    const selectedId = state.selectedId ? String(state.selectedId).trim() : '';
    const plugin = state.list.find((p) => String(p?.id || '').trim() === selectedId) || null;
    if (!plugin) {
        detailEl.classList.add('empty');
        detailEl.textContent = filtered.length ? 'Select a plugin to view details.' : 'No plugins installed.';
        return;
    }
    detailEl.classList.remove('empty');

    const id = String(plugin.id).trim();
    const idLower = id.toLowerCase();
    const isEnabledNow = pluginIsEnabled(state, plugin);
    const pendingToggle = state.pendingToggleById.get(idLower);
    const hasButtonError = state.buttonErrorToggleById.has(idLower);
    const isDisablingAction = typeof pendingToggle === 'boolean' ? pendingToggle === false : isEnabledNow;
    const version = String(plugin.version || '').trim();
    const author = String(plugin.author || '').trim();
    const category = String(plugin.category || '').trim();
    const source = String(plugin.source || '').trim();
    const sourceKind = String(plugin.source_kind || '').trim();
    const sourceSpec = String(plugin.source_spec || '').trim();
    const tags = Array.isArray(plugin.tags)
        ? plugin.tags.map((t) => String(t || '').trim()).filter(Boolean)
        : [];

    const head = document.createElement('div');
    head.className = 'plugin-detail-head';

    const title = document.createElement('div');
    title.className = 'plugin-detail-title';
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = String(plugin.name || '').trim() || 'Unnamed plugin';
    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.textContent = [
        category || '',
        version ? `v${version}` : '',
        author || '',
    ].filter(Boolean).join(' • ') || ' ';
    title.appendChild(nameEl);
    title.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = 'plugin-detail-actions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `tbtn plugin-toggle-btn ${(hasButtonError || isDisablingAction) ? 'plugin-toggle-btn-disable' : 'plugin-toggle-btn-enable'}`;
    toggle.id = 'plugins-toggle-selected';
    toggle.disabled = typeof pendingToggle === 'boolean' || hasButtonError;
    toggle.textContent = hasButtonError
        ? 'Error'
        : pendingToggle === true
            ? 'Enabling...'
            : pendingToggle === false
                ? 'Disabling...'
                : isEnabledNow
                    ? 'Disable'
                    : 'Enable';
    toggle.dataset.pluginToggle = id;
    actions.appendChild(toggle);

    head.appendChild(title);
    head.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'plugin-detail-body';
    const descText = String(plugin.description || '').trim();
    if (descText) {
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = descText;
        body.appendChild(desc);
    }

    const kvRows: Array<[string, string]> = [];
    if (category) kvRows.push(['Category', category]);
    if (source) kvRows.push(['Source', sourceKind ? `${source} (${sourceKind})` : source]);
    if (sourceSpec) kvRows.push(['Specifier', sourceSpec]);
    if (tags.length) kvRows.push(['Tags', tags.join(', ')]);
    if (author) kvRows.push(['Author', author]);
    if (version) kvRows.push(['Version', version]);
    if (kvRows.length) {
        const kv = document.createElement('div');
        kv.className = 'plugin-detail-kv';
        const row = (k: string, v: string) => {
            const kEl = document.createElement('div');
            kEl.className = 'k';
            kEl.textContent = k;
            const vEl = document.createElement('div');
            vEl.className = 'v';
            vEl.textContent = v;
            kv.appendChild(kEl);
            kv.appendChild(vEl);
        };
        for (const [k, v] of kvRows) row(k, v);
        body.appendChild(kv);
    }

    detailEl.appendChild(head);
    detailEl.appendChild(body);
}
