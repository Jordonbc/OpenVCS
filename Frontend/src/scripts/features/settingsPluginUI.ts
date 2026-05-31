// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { toKebab } from '../lib/dom';
import type { PluginSummary } from '../plugins';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface PluginSettingOptionPayload {
    value: string;
    label: string;
}

interface PluginSettingFieldPayload {
    id: string;
    kind: 'bool' | 's32' | 'u32' | 'f64' | 'text' | string;
    label: string;
    description?: string | null;
    default_value: unknown;
    value: unknown;
    options?: PluginSettingOptionPayload[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pluginSectionId(pluginId: string, menuId: string): string {
    return `plugin-${toKebab(`${pluginId}-${menuId}`)}`;
}

// ---------------------------------------------------------------------------
// Plugin setting field rendering
// ---------------------------------------------------------------------------

function renderPluginSettingFields(
    fields: PluginSettingFieldPayload[],
): HTMLDivElement {
    const settingsWrap = document.createElement('div');
    settingsWrap.className = 'group';
    const heading = document.createElement('h4');
    heading.className = 'settings-section-title';
    heading.textContent = 'Settings';
    settingsWrap.appendChild(heading);

    const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const field of fields) {
        const settingId = String(field?.id || '').trim();
        if (!settingId) continue;
        const kind = String(field?.kind || '').trim().toLowerCase();

        const row = document.createElement('div');
        row.className = 'group';

        const hasOptions = Array.isArray(field.options) && field.options.length > 0;
        let control: HTMLInputElement | HTMLSelectElement;

        if (kind === 'bool') {
            const labelEl = document.createElement('label');
            labelEl.className = 'checkbox';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = Boolean(field.value);
            labelEl.appendChild(input);
            labelEl.append(` ${String(field?.label || settingId).trim() || settingId}`);
            control = input;
            row.appendChild(labelEl);
        } else if (kind === 'text' && hasOptions) {
            const labelEl = document.createElement('label');
            labelEl.textContent = String(field?.label || settingId).trim() || settingId;
            row.appendChild(labelEl);
            const select = document.createElement('select');
            for (const option of field.options || []) {
                const opt = document.createElement('option');
                opt.value = String(option?.value || '');
                opt.textContent = String(option?.label || option?.value || '').trim() || opt.value;
                select.appendChild(opt);
            }
            const value = String(field?.value ?? '');
            if (value && Array.from(select.options).some((opt) => opt.value === value)) {
                select.value = value;
            }
            control = select;
            row.appendChild(control);
        } else {
            const labelEl = document.createElement('label');
            labelEl.textContent = String(field?.label || settingId).trim() || settingId;
            row.appendChild(labelEl);
            const input = document.createElement('input');
            if (kind === 's32' || kind === 'u32' || kind === 'f64') {
                input.type = 'number';
                input.step = kind === 'f64' ? 'any' : '1';
                if (kind === 'u32') input.min = '0';
                const n = Number(field?.value ?? field?.default_value ?? 0);
                input.value = Number.isFinite(n) ? String(n) : '0';
            } else {
                input.type = 'text';
                input.value = String(field?.value ?? field?.default_value ?? '');
            }
            control = input;
            row.appendChild(control);
        }

        control.setAttribute('data-setting-id', settingId);
        control.setAttribute('data-setting-kind', kind);
        controls.set(settingId, control);

        const description = String(field?.description || '').trim();
        if (description) {
            const hint = document.createElement('small');
            hint.textContent = description;
            row.appendChild(hint);
        }

        settingsWrap.appendChild(row);
    }

    return settingsWrap;
}


async function ensurePluginSettingsLoaded(modal: HTMLElement, pluginId: string, section: string): Promise<boolean> {
    const panelsScroll = modal.querySelector('#settings-panels-scroll');
    if (!panelsScroll) return false;

    const panel = panelsScroll.querySelector<HTMLElement>(`.panel-form[data-panel="${CSS.escape(section)}"]`);
    if (!panel) return false;

    const loading = panel.querySelector('.plugin-settings-loading');
    if (loading) {
        (loading as HTMLElement).dataset.loading = 'true';
    }

    try {
        const fields = await TAURI.invoke<PluginSettingFieldPayload[]>('get_plugin_settings', { pluginId });

        const loadingEl = panel.querySelector('.plugin-settings-loading');
        if (loadingEl) loadingEl.remove();

        panel.querySelectorAll('.group').forEach((node) => {
            node.remove();
        });

        if (!Array.isArray(fields) || fields.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'group';
            empty.textContent = 'No settings available';
            panel.appendChild(empty);
            return true;
        }

        const settingsWrap = renderPluginSettingFields(fields);
        panel.appendChild(settingsWrap);
        return true;
    } catch {
        const loadingEl = panel.querySelector('.plugin-settings-loading');
        if (loadingEl) {
            (loadingEl as HTMLElement).dataset.loading = 'false';
            const error = document.createElement('div');
            error.className = 'group';
            error.textContent = 'Failed to load settings';
            loadingEl.appendChild(error);
        }
        return false;
    }
}

// ---------------------------------------------------------------------------
// Plugin menu rendering
// ---------------------------------------------------------------------------

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

    for (const summary of Array.isArray(pluginSummaries) ? pluginSummaries : []) {
        const pluginId = String(summary?.id || '').trim();
        const pluginKey = pluginId.toLowerCase();
        if (!pluginId) continue;

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

// ---------------------------------------------------------------------------
// Plugin settings collection
// ---------------------------------------------------------------------------

/** Collects typed plugin setting values from a plugin-settings panel. */
export function collectPluginSettingsFromPanel(
    panel: HTMLElement,
): Array<{ id: string; value: unknown }> {
    const entries: Array<{ id: string; value: unknown }> = [];
    const controls = panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        '[data-setting-id][data-setting-kind]',
    );

    for (const control of controls) {
        const settingId = String(control.getAttribute('data-setting-id') || '').trim();
        const kind = String(control.getAttribute('data-setting-kind') || '')
            .trim()
            .toLowerCase();
        if (!settingId || !kind) continue;

        let value: unknown;
        if (kind === 'bool' && control instanceof HTMLInputElement) {
            value = control.checked;
        } else if (kind === 's32' || kind === 'u32' || kind === 'f64') {
            const n = Number(control.value);
            if (!Number.isFinite(n)) {
                value = 0;
            } else if (kind === 's32') {
                value = Math.trunc(n);
            } else if (kind === 'u32') {
                value = Math.max(0, Math.trunc(n));
            } else {
                value = n;
            }
        } else {
            value = control.value ?? '';
        }

        entries.push({ id: settingId, value });
    }

    return entries;
}

// ---------------------------------------------------------------------------
// Section activation
// ---------------------------------------------------------------------------

/** Activates a settings section by its data-section identifier, showing/hiding nav and panels. */
export function activateSection(modal: HTMLElement, section: string): void {
    const nav = modal.querySelector('#settings-nav');
    const panels = modal.querySelector('#settings-panels');
    if (!nav || !panels) return;

    const safeSection = (() => {
        const requested = String(section || '').trim();
        if (requested && nav.querySelector<HTMLElement>(`[data-section="${requested}"]`)) return requested;
        return 'general';
    })();

    const btn = nav.querySelector<HTMLElement>(`[data-section="${safeSection}"]`);
    nav.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
    });
    panels.querySelectorAll<HTMLElement>('.panel-form').forEach((p) => {
        p.classList.toggle('hidden', p.getAttribute('data-panel') !== safeSection);
    });

    // Keep footer actions hidden for action-only plugin menu panels.
    const actions = modal.querySelector<HTMLElement>('.sheet-actions');
    const activePanel = panels.querySelector<HTMLElement>(
        `.panel-form[data-panel="${CSS.escape(safeSection)}"]`,
    );
    const isPluginMenuPanel = activePanel?.getAttribute('data-plugin-menu') === 'true';
    const isPluginSettingsPanel = activePanel?.getAttribute('data-plugin-settings') === 'true';
    const hideActions = safeSection === 'plugins' || (isPluginMenuPanel && !isPluginSettingsPanel);
    if (actions) actions.classList.toggle('hidden', hideActions);

    if (isPluginSettingsPanel && activePanel) {
        const pluginId = String(activePanel.dataset.pluginId || '').trim();
        if (pluginId) {
            ensurePluginSettingsLoaded(modal, pluginId, safeSection).catch(() => {});
        }
    }
}
