// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';

/** A selectable value for a plugin setting field. */
interface PluginSettingOptionPayload {
    value: string;
    label: string;
}

/** A backend-declared plugin setting field. */
interface PluginSettingFieldPayload {
    id: string;
    kind: 'bool' | 's32' | 'u32' | 'f64' | 'text' | string;
    label: string;
    description?: string | null;
    default_value: unknown;
    value: unknown;
    options?: PluginSettingOptionPayload[];
}

/** Renders a group of plugin setting field controls into a container div. */
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

/** Loads a plugin's declared settings into its panel on first activation. */
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

export { renderPluginSettingFields, ensurePluginSettingsLoaded };
export type { PluginSettingFieldPayload, PluginSettingOptionPayload };
