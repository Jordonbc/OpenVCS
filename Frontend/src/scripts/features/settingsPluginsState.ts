// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import type { PluginSummary } from '../plugins';
import { parsePluginQuery, pluginSearchScore } from './settingsPluginSearch';

/** Key under which the plugins panel state is stored on the settings modal. */
export const PLUGINS_PANEL_STATE_KEY = '__pluginsPanelState';

/** Mutable state shared by the plugins panel modules. */
export interface PluginsPanelState {
    list: PluginSummary[];
    disabled: Set<string>;
    enabled: Set<string>;
    pendingToggleById: Map<string, boolean>;
    errorToggleById: Set<string>;
    buttonErrorToggleById: Set<string>;
    buttonErrorTimerById: Map<string, number>;
    query: string;
    selectedId: string | null;
}

/** Element references shared by the plugins panel modules. */
export interface PluginsPanelCtx {
    modal: HTMLElement;
    pane: HTMLElement;
    listEl: HTMLElement;
    detailEl: HTMLElement;
    groupLabelEl: HTMLElement;
    searchEl: HTMLInputElement;
    syncConfigBtn: HTMLButtonElement;
    enableAllBtn: HTMLButtonElement;
    disableAllBtn: HTMLButtonElement;
    state: PluginsPanelState;
}

/** Creates a fresh plugins panel state object. */
export function createPluginsPanelState(): PluginsPanelState {
    return {
        list: [],
        disabled: new Set<string>(),
        enabled: new Set<string>(),
        pendingToggleById: new Map<string, boolean>(),
        errorToggleById: new Set<string>(),
        buttonErrorToggleById: new Set<string>(),
        buttonErrorTimerById: new Map<string, number>(),
        query: '',
        selectedId: null,
    };
}

/** Determines whether a plugin is currently enabled according to panel state. */
export function pluginIsEnabled(state: PluginsPanelState, p: PluginSummary): boolean {
    const id = String(p?.id || '').trim().toLowerCase();
    if (state.disabled.has(id)) return false;
    if (state.enabled.has(id)) return true;
    return typeof p?.enabled === 'boolean' ? p.enabled : !!p?.default_enabled;
}

/** Counts enabled plugins in the current list. */
export function countEnabledPlugins(state: PluginsPanelState): number {
    return state.list.filter((p) => p?.id && pluginIsEnabled(state, p)).length;
}

/** Loads the set of plugin ids that failed to start into panel state. */
export async function syncStartFailures(state: PluginsPanelState): Promise<void> {
    try {
        const failed = await TAURI.invoke<string[]>('list_plugin_start_failures');
        state.errorToggleById = new Set(
            (Array.isArray(failed) ? failed : [])
                .map((id) => String(id || '').trim().toLowerCase())
                .filter(Boolean),
        );
    } catch (err) {
        console.warn('list_plugin_start_failures failed', err);
    }
}

/** Returns the plugins matching the current query, ranked by search score. */
export function getFilteredPlugins(state: PluginsPanelState): PluginSummary[] {
    const q = String(state.query || '').trim();
    const base = state.list.filter((p) => p && p.id && p.name);
    if (!q) return base;

    const parsed = parsePluginQuery(q);
    const hasParts = parsed.terms.length || parsed.authors.length || parsed.tags.length;
    if (!hasParts) return base;

    const scored: Array<{ plugin: PluginSummary; score: number }> = [];
    for (const p of base) {
        const s = pluginSearchScore(p, parsed);
        if (typeof s === 'number' && s > 0) scored.push({ plugin: p, score: s });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.plugin.name || '').localeCompare(String(b.plugin.name || ''), undefined, { sensitivity: 'base' });
    });
    return scored.map((x) => x.plugin);
}

/** Keeps the current selection valid when the filtered list changes. */
export function ensureSelection(state: PluginsPanelState, filtered: PluginSummary[]): void {
    const current = state.selectedId ? String(state.selectedId).trim() : '';
    if (current && filtered.some((p) => String(p.id).trim() === current)) return;
    state.selectedId = filtered.length ? String(filtered[0].id).trim() : null;
}
