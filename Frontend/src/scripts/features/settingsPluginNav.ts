// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { toKebab } from '../lib/dom';
import type { PluginSummary } from '../plugins';

/** Payload describing a plugin-declared menu surfaced in the settings modal. */
interface PluginMenuPayload {
    plugin_id: string;
    id: string;
    label: string;
    surface: 'menubar' | 'settings';
    elements: Array<{
        type: 'text' | 'button' | string;
        id?: string;
        content?: string;
        label?: string;
    }>;
}

/** Builds the settings section id for a plugin menu. */
function pluginSectionId(pluginId: string, menuId: string): string {
    return `plugin-${toKebab(`${pluginId}-${menuId}`)}`;
}

/** Renders plugin menu items into the settings navigation and forms into the panels scroll area. */
export async function renderPluginMenus(modal: HTMLElement): Promise<void> {
    const nav = modal.querySelector('#settings-nav');
    const panelsScroll = modal.querySelector('#settings-panels-scroll');
    if (!nav || !panelsScroll) return;

    nav.querySelectorAll<HTMLElement>('[data-plugin-menu="true"]').forEach((node) => {
        node.remove();
    });
    nav.querySelectorAll<HTMLElement>('[data-plugin-menus-wrap="true"]').forEach((node) => {
        node.remove();
    });
    panelsScroll
        .querySelectorAll<HTMLElement>('.panel-form[data-plugin-menu="true"]')
        .forEach((node) => {
            node.remove();
        });

    let menus: PluginMenuPayload[] = [];
    let pluginSummaries: PluginSummary[] = [];
    try {
        menus = await TAURI.invoke<PluginMenuPayload[]>('list_plugin_menus');
    } catch {
        return;
    }
    try {
        pluginSummaries = await TAURI.invoke<PluginSummary[]>('list_plugins');
    } catch {
        pluginSummaries = [];
    }

    const pluginSources = new Map<string, string>();
    const pluginNames = new Map<string, string>();
    for (const summary of Array.isArray(pluginSummaries) ? pluginSummaries : []) {
        const id = String(summary?.id || '').trim().toLowerCase();
        if (!id) continue;
        pluginSources.set(id, String(summary?.source || '').trim().toLowerCase());
        pluginNames.set(id, String(summary?.name || summary?.id || '').trim() || id);
    }

    const pluginsNavBtn = nav.querySelector<HTMLElement>('[data-section="plugins"]');
    const pluginsNavLi = pluginsNavBtn?.closest('li') || null;

    let thirdPartySublist: HTMLElement | null = null;
    const ensureThirdPartySublist = (): HTMLElement => {
        if (thirdPartySublist) return thirdPartySublist;

        const wrap = document.createElement('div');
        wrap.setAttribute('data-plugin-menus-wrap', 'true');

        const heading = document.createElement('div');
        heading.className = 'settings-plugin-subhead';
        heading.textContent = 'Plugin Settings';
        wrap.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'settings-plugin-sublist';
        list.setAttribute('data-plugin-menus', 'true');
        wrap.appendChild(list);

        if (pluginsNavLi) {
            pluginsNavLi.appendChild(wrap);
        } else {
            nav.appendChild(wrap);
        }

        thirdPartySublist = list;
        return list;
    };

    for (const menu of menus) {
        // Only render settings-surface menus in the settings modal.
        const surface = String(menu.surface || 'menubar').toLowerCase();
        if (surface !== 'settings') continue;

        const section = pluginSectionId(menu.plugin_id, menu.id);
        const navLi = document.createElement('li');
        navLi.dataset.pluginMenu = 'true';
        const navBtn = document.createElement('button');
        const source = pluginSources.get(String(menu.plugin_id || '').trim().toLowerCase()) || '';
        const isBuiltIn = source === 'built-in';
        navBtn.className = 'seg-btn';
        navBtn.setAttribute('data-section', section);
        navBtn.textContent = menu.label || menu.id;
        navLi.appendChild(navBtn);

        if (isBuiltIn) {
            if (pluginsNavLi?.parentElement) {
                pluginsNavLi.parentElement.insertBefore(navLi, pluginsNavLi);
            } else {
                nav.appendChild(navLi);
            }
        } else {
            ensureThirdPartySublist().appendChild(navLi);
        }

        const panel = document.createElement('form');
        panel.className = 'panel-form hidden';
        panel.setAttribute('data-panel', section);
        panel.setAttribute('data-plugin-menu', 'true');
        panel.dataset.pluginId = menu.plugin_id;
        panel.dataset.menuId = menu.id;

        for (const element of menu.elements || []) {
            const group = document.createElement('div');
            group.className = 'group';
            if (element.type === 'text') {
                const text = document.createElement('div');
                text.textContent = String(element.content || '');
                group.appendChild(text);
            } else if (element.type === 'button') {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'tbtn';
                button.textContent = String(element.label || 'Action');
                button.dataset.pluginAction = String(element.id || '');
                button.dataset.pluginId = menu.plugin_id;
                group.appendChild(button);
            }
            panel.appendChild(group);
        }
        panelsScroll.appendChild(panel);
    }

    // Fetch which plugins have backend-declared settings so we can skip
    // plugins that have no configurable settings at all.
    let pluginsWithSettings: Set<string> | null = null;
    try {
        const ids = await TAURI.invoke<string[]>('list_plugins_with_settings');
        pluginsWithSettings = new Set(ids.map((id) => id.toLowerCase()));
    } catch {
        // If the endpoint is unavailable, fall back to showing all plugins.
    }

    for (const summary of Array.isArray(pluginSummaries) ? pluginSummaries : []) {
        const pluginId = String(summary?.id || '').trim();
        const pluginKey = pluginId.toLowerCase();
        if (!pluginId) continue;

        // Skip plugins that have no backend-declared settings (they would
        // only show a "No settings available" placeholder).
        if (pluginsWithSettings !== null && !pluginsWithSettings.has(pluginKey)) {
            continue;
        }

        const section = `plugin-settings-${toKebab(pluginId)}`;
        const navLi = document.createElement('li');
        navLi.dataset.pluginMenu = 'true';
        const navBtn = document.createElement('button');
        navBtn.className = 'seg-btn';
        navBtn.setAttribute('data-section', section);
        navBtn.textContent = pluginNames.get(pluginKey) || pluginId;
        navLi.appendChild(navBtn);
        ensureThirdPartySublist().appendChild(navLi);

        const panel = document.createElement('form');
        panel.className = 'panel-form hidden';
        panel.setAttribute('data-panel', section);
        panel.setAttribute('data-plugin-menu', 'true');
        panel.dataset.pluginId = pluginId;
        panel.dataset.pluginSettings = 'true';

        const loading = document.createElement('div');
        loading.className = 'plugin-settings-loading group';
        loading.dataset.loading = 'true';
        loading.textContent = 'Loading settings...';
        panel.appendChild(loading);

        panelsScroll.appendChild(panel);
    }
}
