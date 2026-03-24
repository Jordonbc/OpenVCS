// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { toKebab } from '../lib/dom';
import { confirmBool } from '../lib/confirm';
import { notify } from '../lib/notify';
import { setTheme } from '../ui/layout';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID, getActiveThemeId, getAvailableThemes, refreshAvailableThemes, selectThemePack } from '../themes';
import { reloadPlugins } from '../plugins';
import type { PluginSummary } from '../plugins';
import { applyPluginSettingsSections } from '../plugins';
import type { GlobalSettings, ThemeSummary } from '../types';

const THEME_PACK_HINT = 'Install a theme ZIP into the themes folder, or install a plugin that provides themes.';
const SYSTEM_DARK_MQ = matchMedia('(prefers-color-scheme: dark)');

interface PluginMenuPayload {
    plugin_id: string;
    id: string;
    label: string;
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

function pluginSectionId(pluginId: string, menuId: string): string {
    return `plugin-${toKebab(`${pluginId}-${menuId}`)}`;
}

function flashSavedState(button: HTMLButtonElement, originalText = 'Save') {
    button.classList.add('saved-state');
    button.textContent = 'Saved!';
    setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('saved-state');
    }, 2000);
}

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

const loadedPluginSettings = new Map<string, PluginSettingFieldPayload[]>();

export function clearPluginSettingsCache(): void {
    loadedPluginSettings.clear();
}

async function ensurePluginSettingsLoaded(modal: HTMLElement, pluginId: string, section: string): Promise<boolean> {
    const panelsScroll = modal.querySelector('#settings-panels-scroll');
    if (!panelsScroll) return false;

    const panel = panelsScroll.querySelector<HTMLElement>(`.panel-form[data-panel="${CSS.escape(section)}"]`);
    if (!panel) return false;

    const cacheKey = pluginId.toLowerCase();
    if (loadedPluginSettings.has(cacheKey)) {
        const existing = panel.querySelector('.group');
        if (existing) return true;
        const fields = loadedPluginSettings.get(cacheKey)!;
        const settingsWrap = renderPluginSettingFields(fields);
        panel.appendChild(settingsWrap);
        return true;
    }

    const loading = panel.querySelector('.plugin-settings-loading');
    if (loading) {
        (loading as HTMLElement).dataset.loading = 'true';
    }

    try {
        const fields = await TAURI.invoke<PluginSettingFieldPayload[]>('get_plugin_settings', { pluginId });
        loadedPluginSettings.set(cacheKey, Array.isArray(fields) ? fields : []);

        const loadingEl = panel.querySelector('.plugin-settings-loading');
        if (loadingEl) loadingEl.remove();

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

export function applyAnimationPreference(enabled: boolean | undefined | null) {
    document.documentElement.dataset.animations = enabled === false ? 'off' : 'on';
}

function normalizeAppearance(value: unknown): 'light' | 'dark' | 'both' | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'light' || raw === 'dark' || raw === 'both') return raw;
    return null;
}

function modeForTheme(themeId: string): 'light' | 'dark' {
    const desired = (themeId || DEFAULT_LIGHT_THEME_ID).trim().toLowerCase() || DEFAULT_LIGHT_THEME_ID;
    const summary = getAvailableThemes().find((t) => (t.id || '').toLowerCase() === desired);
    const appearance = normalizeAppearance(summary?.appearance);
    if (appearance === 'light') return 'light';
    if (appearance === 'dark') return 'dark';
    return SYSTEM_DARK_MQ.matches ? 'dark' : 'light';
}

function themeOptionLabel(theme: ThemeSummary): string {
    const version = theme.version?.trim();
    return version ? `${theme.name} (${version})` : theme.name;
}

function themeTooltip(id: string): string {
    const theme = getAvailableThemes().find((t) => t.id.toLowerCase() === id.toLowerCase());
    if (!theme) return THEME_PACK_HINT;
    const details: string[] = [];
    if (theme.description) details.push(theme.description);
    const meta = [theme.author, theme.version].filter(Boolean).join(' • ');
    if (meta) details.push(meta);
    return details.join('\n') || THEME_PACK_HINT;
}

async function renderPluginMenus(modal: HTMLElement): Promise<void> {
    const nav = modal.querySelector('#settings-nav');
    const panelsScroll = modal.querySelector('#settings-panels-scroll');
    if (!nav || !panelsScroll) return;

    nav.querySelectorAll<HTMLElement>('[data-plugin-menu="true"]').forEach((node) => node.remove());
    nav.querySelectorAll<HTMLElement>('[data-plugin-menus-wrap="true"]').forEach((node) => node.remove());
    panelsScroll
        .querySelectorAll<HTMLElement>('.panel-form[data-plugin-menu="true"]')
        .forEach((node) => node.remove());

    if (!TAURI.has) return;
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

async function rebuildThemePackOptions(
    selectEl: HTMLSelectElement,
    opts: { desiredId?: string | null; forceReload?: boolean } = {},
) {
    const { desiredId, forceReload } = opts;
    if (forceReload) {
        try {
            await refreshAvailableThemes();
        } catch {
            // ignore refresh errors; fallback to whatever themes are cached
        }
    }

    const themes = getAvailableThemes();
    const desiredLower = String(desiredId ?? selectEl.value ?? DEFAULT_LIGHT_THEME_ID).trim().toLowerCase() || DEFAULT_LIGHT_THEME_ID;

    selectEl.innerHTML = '';
    for (const theme of themes) {
        const opt = document.createElement('option');
        opt.value = theme.id;
        opt.textContent = themeOptionLabel(theme);
        opt.title = themeTooltip(theme.id);
        selectEl.appendChild(opt);
    }

    const match = themes.find((t) => t.id.toLowerCase() === desiredLower);
    selectEl.value = match ? match.id : DEFAULT_LIGHT_THEME_ID;
    selectEl.title = themeTooltip(selectEl.value || DEFAULT_LIGHT_THEME_ID);
}

export function openSettings(section?: string){
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
    if (TAURI.has) {
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
    }

    loadSettingsIntoForm(modal)
        .catch(console.error)
        .finally(() => {
            modal.removeAttribute('aria-busy');
            const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
            if (setThemeAuto) setThemeAuto.disabled = false;
        });
}

function activateSection(modal: HTMLElement, section: string) {
    const nav = modal.querySelector('#settings-nav');
    const panels = modal.querySelector('#settings-panels');
    if (!nav || !panels) return;

    const safeSection = (() => {
        const requested = String(section || '').trim();
        if (requested && nav.querySelector<HTMLElement>(`[data-section="${requested}"]`)) return requested;
        return 'general';
    })();

    const btn = nav.querySelector<HTMLElement>(`[data-section="${safeSection}"]`);
    nav.querySelectorAll<HTMLElement>('.seg-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
    });
    panels.querySelectorAll<HTMLElement>('.panel-form').forEach(p => {
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

/** Collects typed plugin setting values from a plugin-settings panel. */
function collectPluginSettingsFromPanel(
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
            if (!btn || !TAURI.has) return;
            const pluginId = btn.dataset.pluginId || '';
            const actionId = btn.dataset.pluginAction || '';
            if (!pluginId || !actionId) return;
            try {
                await TAURI.invoke('invoke_plugin_action', { pluginId, actionId });
            } catch (err) {
                console.error('Failed to invoke plugin action', err);
                notify('Plugin action failed');
            }
        });
    }

    const lfsToggle = modal.querySelector<HTMLInputElement>('#set-lfs-enabled');
    const lfsDependents = ['#set-lfs-concurrency', '#set-lfs-require-lock', '#set-lfs-bg-fetch']
        .map(sel => modal.querySelector<HTMLInputElement>(sel))
        .filter((el): el is HTMLInputElement => !!el);
    const updateLfsDependentState = () => {
        const enabled = !!lfsToggle?.checked;
        lfsDependents.forEach(input => input.disabled = !enabled);
    };
    updateLfsDependentState();
    lfsToggle?.addEventListener('change', updateLfsDependentState);

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

    const sshBinSel = modal.querySelector('#set-git-ssh-binary') as HTMLSelectElement | null;
    const sshPathInput = modal.querySelector('#set-git-ssh-path') as HTMLInputElement | null;
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
                if (!TAURI.has) return;
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

            if (TAURI.has) {
                await TAURI.invoke('set_global_settings', { cfg: next });
            }

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
            } catch {}

            notify('Settings saved');
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
                if (!TAURI.has) return;
                const pluginId = String(activePanel.dataset.pluginId || '').trim();
                const section = String(activePanel.getAttribute('data-panel') || '').trim();
                if (!pluginId) {
                    notify('Failed to reset plugin settings');
                    return;
                }
                await TAURI.invoke('reset_plugin_settings', { pluginId });
                notify('Plugin settings reset');
                clearPluginSettingsCache();
                await renderPluginMenus(modal);
                if (section) activateSection(modal, section);
                return;
            }

            if (!TAURI.has) return;
            const cur = await TAURI.invoke<GlobalSettings>('get_global_settings');

            cur.general = {
                theme: 'system',
                theme_pack: DEFAULT_LIGHT_THEME_ID,
                language: 'system',
                default_backend: 'git',
                update_channel: 'stable',
                reopen_last_repos: true,
                checks_on_launch: true,
                telemetry: false,
                crash_reports: false,
            };
            cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
            cur.lfs = { enabled: true, concurrency: 4, require_lock_before_edit: false, background_fetch_on_checkout: true };
            cur.performance = { progressive_render: true, gpu_accel: true, animations: true };
            cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none', recents_limit: 10 };
            cur.logging = { level: 'info', live_viewer: false, retain_archives: 10 };
            cur.plugins = { disabled: [], enabled: [] };

            await TAURI.invoke('set_global_settings', { cfg: cur });
            applyAnimationPreference(cur.performance?.animations);
            await loadSettingsIntoForm(modal);
            setTheme('system');
            try { await selectThemePack(DEFAULT_LIGHT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
            notify('Defaults restored');
        } catch (e) { console.error('Failed to restore defaults:', e); notify('Failed to restore defaults'); }
    });

    // Settings are loaded by `openSettings()` on open.
}

function collectSettingsFromForm(root: HTMLElement): GlobalSettings {
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

    const base = JSON.parse(root?.dataset.currentCfg || '{}');

    const o: GlobalSettings = { ...base };

    const autoTheme = !!get<HTMLInputElement>('#set-theme-auto')?.checked;
    const themePack = get<HTMLSelectElement>('#set-theme')?.value || DEFAULT_LIGHT_THEME_ID;
    const theme = autoTheme ? 'system' : modeForTheme(themePack);

    o.general = {
        ...o.general,
        theme,
        theme_pack: themePack || DEFAULT_LIGHT_THEME_ID,
        language: get<HTMLSelectElement>('#set-language')?.value,
        default_backend: (get<HTMLSelectElement>('#set-default-backend')?.value || 'git') as any,
        update_channel: get<HTMLSelectElement>('#set-update-channel')?.value || 'stable',
        reopen_last_repos: !!get<HTMLInputElement>('#set-reopen-last')?.checked,
        checks_on_launch: !!get<HTMLInputElement>('#set-checks-on-launch')?.checked,
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

    if (get('#set-lfs-enabled') || get('#set-lfs-concurrency') || get('#set-lfs-require-lock')) {
        const rawConc = Number(get<HTMLInputElement>('#set-lfs-concurrency')?.value ?? 0);
        const conc = rawConc && isFinite(rawConc) ? Math.max(1, Math.min(16, rawConc)) : 4;
        o.lfs = {
            ...o.lfs,
            enabled: !!get<HTMLInputElement>('#set-lfs-enabled')?.checked,
            concurrency: conc,
            require_lock_before_edit: !!get<HTMLInputElement>('#set-lfs-require-lock')?.checked,
            background_fetch_on_checkout: !!get<HTMLInputElement>('#set-lfs-bg-fetch')?.checked,
        };
    }

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

export async function loadSettingsIntoForm(root?: HTMLElement) {
    const m = root || (document.getElementById('settings-modal') as HTMLElement | null);
    if (!m) return;
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => m.querySelector<T>(sel);
    const cfg = TAURI.has ? await TAURI.invoke<GlobalSettings>('get_global_settings') : null;
    if (!cfg) return;

    m.dataset.currentCfg = JSON.stringify(cfg);

    await loadPluginsIntoForm(m, cfg);

    const themeSel = get<HTMLSelectElement>('#set-theme');
    const elAuto = get<HTMLInputElement>('#set-theme-auto');
    const themePref = (cfg.general?.theme || 'system') as 'system'|'light'|'dark';

    if (elAuto) elAuto.checked = themePref === 'system';

    if (themeSel) {
        let desiredId = String(cfg.general?.theme_pack || DEFAULT_LIGHT_THEME_ID);
        if (desiredId.trim().toLowerCase() === DEFAULT_THEME_ID) {
            desiredId = themePref === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
        }
        await rebuildThemePackOptions(themeSel, {
            desiredId,
            forceReload: true,
        });
        themeSel.disabled = themePref === 'system';
        if (themePref === 'system') {
            themeSel.value = getActiveThemeId() || themeSel.value;
        }
    }

    const elLang  = get<HTMLSelectElement>('#set-language'); if (elLang) elLang.value = toKebab(cfg.general?.language);
    await refreshDefaultBackendOptions(m, cfg);
    const elChan  = get<HTMLSelectElement>('#set-update-channel'); if (elChan) {
        const v = toKebab(cfg.general?.update_channel);
        elChan.value = (v === 'beta') ? 'nightly' : v;
    }
    const elReo   = get<HTMLInputElement>('#set-reopen-last'); if (elReo) elReo.checked = !!cfg.general?.reopen_last_repos;
    const elChk   = get<HTMLInputElement>('#set-checks-on-launch'); if (elChk) elChk.checked = !!cfg.general?.checks_on_launch;
    const elRl    = get<HTMLInputElement>('#set-recents-limit'); if (elRl) elRl.value = String(cfg.ux?.recents_limit ?? 10);

    const elTw = get<HTMLInputElement>('#set-tab-width'); if (elTw) elTw.value = String(cfg.diff?.tab_width ?? 0);
    const elIw = get<HTMLSelectElement>('#set-ignore-whitespace'); if (elIw) elIw.value = toKebab(cfg.diff?.ignore_whitespace);
    const elMx = get<HTMLInputElement>('#set-max-file-size-mb'); if (elMx) elMx.value = String(cfg.diff?.max_file_size_mb ?? 0);
    const elIn = get<HTMLInputElement>('#set-intraline'); if (elIn) elIn.checked = !!cfg.diff?.intraline;
    const elBp = get<HTMLInputElement>('#set-binary-placeholders'); if (elBp) elBp.checked = !!cfg.diff?.show_binary_placeholders;
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

    const elLe = get<HTMLInputElement>('#set-lfs-enabled'); if (elLe) elLe.checked = !!cfg.lfs?.enabled;
    const elLc = get<HTMLInputElement>('#set-lfs-concurrency'); if (elLc) elLc.value = String(cfg.lfs?.concurrency ?? 0);

    const elLl = get<HTMLInputElement>('#set-lfs-require-lock'); if (elLl) elLl.checked = !!cfg.lfs?.require_lock_before_edit;
    const elBg = get<HTMLInputElement>('#set-lfs-bg-fetch'); if (elBg) elBg.checked = !!cfg.lfs?.background_fetch_on_checkout;
    elLe?.dispatchEvent(new Event('change'));

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

async function refreshDefaultBackendOptions(modal: HTMLElement, cfg: GlobalSettings) {
    const el = modal.querySelector<HTMLSelectElement>('#set-default-backend');
    if (!el) return;

    const desired = String(cfg.general?.default_backend || '').trim();

    let available: Array<[string, string]> = [];
    if (TAURI.has) {
        try {
            available = await TAURI.invoke<Array<[string, string]>>('list_vcs_backends_cmd');
        } catch {}
    }

    const backends = (Array.isArray(available) ? available : [])
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
    if (!backends.length) return;
    if (desired && backends.some(([id]) => id === desired)) {
        el.value = desired;
    } else {
        el.value = backends[0][0];
    }
}

async function loadPluginsIntoForm(modal: HTMLElement, cfg: GlobalSettings) {
    const pane = modal.querySelector<HTMLElement>('#plugins-pane');
    const listEl = modal.querySelector<HTMLElement>('#plugins-list');
    const detailEl = modal.querySelector<HTMLElement>('#plugins-detail');
    const groupLabelEl = modal.querySelector<HTMLElement>('#plugins-group-label');
    const searchEl = modal.querySelector<HTMLInputElement>('#plugins-search');
    const installBundleBtn = modal.querySelector<HTMLButtonElement>('#plugins-install-bundle');
    const enableAllBtn = modal.querySelector<HTMLButtonElement>('#plugins-enable-all');
    const disableAllBtn = modal.querySelector<HTMLButtonElement>('#plugins-disable-all');

    if (!pane || !listEl || !detailEl || !groupLabelEl || !searchEl || !installBundleBtn || !enableAllBtn || !disableAllBtn) return;

    // This settings pane can be initialized multiple times during navigation/rerender.
    // Avoid stacking duplicate click handlers which would open many dialogs.
    if (!(installBundleBtn as any).dataset?.bound) {
        (installBundleBtn as any).dataset.bound = '1';
        installBundleBtn.addEventListener('click', async () => {
            if (!TAURI.has) return;
            try {
                const bundlePath = await TAURI.invoke<string | null>('browse_file', { purpose: 'install_plugin' });
                if (!bundlePath) return;

                const installed = await TAURI.invoke<any>('install_ovcsp', { bundlePath });
                notify(`Installed ${installed?.plugin_id || 'plugin'} ${installed?.version || ''}`.trim());

                const pluginId = String(installed?.plugin_id || '').trim();
                const version = String(installed?.version || '').trim();
                if (pluginId && version) {
                    const trusted = await confirmBool(
                        'Trust this plugin and allow it to run?\n\n'
                        + 'Only approve plugins from sources you trust.'
                    );
                    await TAURI.invoke('set_plugin_approval', {
                        pluginId,
                        version,
                        approved: trusted,
                    });
                    if (trusted) {
                        notify('Plugin approved');
                    } else {
                        notify('Plugin installed but not approved to run');
                    }
                }

                await reloadPluginSummaries();
            } catch (err) {
                const msg = String(err || '').trim();
                notify(msg ? `Install failed: ${msg}` : 'Install failed');
            }
        });
    }

    type ParsedPluginQuery = {
        terms: string[];
        authors: string[];
        tags: string[];
    };

    const tokenize = (value: string): string[] => String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9._-]+/g)
        .map((s) => s.trim())
        .filter(Boolean);

    const normalizeQueryToken = (value: string): string => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^[,.;:!?]+/g, '')
        .replace(/[,.;:!?]+$/g, '');

    const parsePluginQuery = (raw: string): ParsedPluginQuery => {
        const parsed: ParsedPluginQuery = { terms: [], authors: [], tags: [] };
        const input = String(raw || '').trim();
        if (!input) return parsed;

        const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
        for (const match of input.matchAll(re)) {
            const token = normalizeQueryToken(match[1] ?? match[2] ?? match[3] ?? '');
            if (!token) continue;
            if (token.startsWith('@')) {
                const author = normalizeQueryToken(token.slice(1));
                if (author) parsed.authors.push(author);
                continue;
            }
            if (token.startsWith('#')) {
                const tag = normalizeQueryToken(token.slice(1));
                if (tag) parsed.tags.push(tag);
                continue;
            }
            parsed.terms.push(token);
        }
        return parsed;
    };

    const damerauLevenshtein = (aRaw: string, bRaw: string): number => {
        const a = String(aRaw || '');
        const b = String(bRaw || '');
        if (a === b) return 0;
        const aLen = a.length;
        const bLen = b.length;
        if (!aLen) return bLen;
        if (!bLen) return aLen;

        const da: Record<string, number> = {};
        const maxDist = aLen + bLen;
        const score: number[][] = Array.from({ length: aLen + 2 }, () => new Array(bLen + 2).fill(0));
        score[0][0] = maxDist;
        for (let i = 0; i <= aLen; i++) {
            score[i + 1][0] = maxDist;
            score[i + 1][1] = i;
        }
        for (let j = 0; j <= bLen; j++) {
            score[0][j + 1] = maxDist;
            score[1][j + 1] = j;
        }

        for (let i = 1; i <= aLen; i++) {
            let db = 0;
            for (let j = 1; j <= bLen; j++) {
                const i1 = da[b[j - 1]] ?? 0;
                const j1 = db;
                let cost = 1;
                if (a[i - 1] === b[j - 1]) {
                    cost = 0;
                    db = j;
                }

                score[i + 1][j + 1] = Math.min(
                    score[i][j] + cost, // substitution
                    score[i + 1][j] + 1, // insertion
                    score[i][j + 1] + 1, // deletion
                    score[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1), // transposition
                );
            }
            da[a[i - 1]] = i;
        }
        return score[aLen + 1][bLen + 1];
    };

    const maxDistanceFor = (len: number): number => {
        if (len <= 3) return 0;
        if (len <= 5) return 1;
        if (len <= 9) return 2;
        return 3;
    };

    const bestTokenScore = (needleRaw: string, hayTokens: string[]): number => {
        const needle = normalizeQueryToken(needleRaw);
        if (!needle) return 0;
        if (!hayTokens.length) return 0;
        if (needle.length <= 3) {
            for (const tok of hayTokens) {
                if (tok.includes(needle)) return 1;
            }
            return 0;
        }

        let best = 0;
        for (const tok of hayTokens) {
            if (!tok) continue;
            if (tok.includes(needle)) return 1;
            const maxLen = Math.max(needle.length, tok.length);
            const maxDist = maxDistanceFor(Math.min(maxLen, 64));
            if (maxDist <= 0) continue;
            const dist = damerauLevenshtein(needle.slice(0, 64), tok.slice(0, 64));
            if (dist > maxDist) continue;
            const sim = 1 - dist / maxLen;
            if (sim > best) best = sim;
        }
        return best;
    };

    const pluginSearchScore = (plugin: PluginSummary, parsed: ParsedPluginQuery): number | null => {
        const id = String(plugin?.id || '').trim();
        const name = String(plugin?.name || '').trim();
        if (!id || !name) return null;

        const author = String(plugin?.author || '').trim();
        const category = String(plugin?.category || '').trim();
        const description = String(plugin?.description || '').trim();
        const tags = Array.isArray(plugin?.tags) ? plugin.tags.map((t) => String(t || '').trim()).filter(Boolean) : [];

        const authorTokens = tokenize(author);
        const tagTokens = tags.flatMap((t) => tokenize(t));
        const fields: Array<{ weight: number; tokens: string[] }> = [
            { weight: 3.6, tokens: tokenize(name) },
            { weight: 3.0, tokens: tokenize(id) },
            { weight: 2.2, tokens: authorTokens },
            { weight: 2.0, tokens: tagTokens },
            { weight: 1.6, tokens: tokenize(category) },
            { weight: 1.0, tokens: tokenize(description) },
        ];

        let score = 0;

        for (const qAuthor of parsed.authors) {
            const s = bestTokenScore(qAuthor, authorTokens);
            if (!s) return null;
            score += s * 4.0;
        }

        for (const qTag of parsed.tags) {
            const s = bestTokenScore(qTag, tagTokens);
            if (!s) return null;
            score += s * 3.0;
        }

        for (const term of parsed.terms) {
            let best = 0;
            for (const field of fields) {
                const s = bestTokenScore(term, field.tokens);
                if (!s) continue;
                const weighted = s * field.weight;
                if (weighted > best) best = weighted;
            }
            if (!best) return null;
            score += best;
        }

        return score;
    };

    listEl.replaceChildren();
    detailEl.replaceChildren();
    detailEl.classList.add('empty');
    detailEl.textContent = 'Select a plugin to view details.';

    if (!TAURI.has) {
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

    const stateKey = '__pluginsPanelState';
    type PluginsPanelState = {
        list: PluginSummary[];
        disabled: Set<string>;
        enabled: Set<string>;
        pendingToggleById: Map<string, boolean>;
        errorToggleById: Set<string>;
        buttonErrorToggleById: Set<string>;
        buttonErrorTimerById: Map<string, number>;
        query: string;
        selectedId: string | null;
    };
    const state: PluginsPanelState = (modal as any)[stateKey] || {
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
    state.list = Array.isArray(list) ? list : [];
    state.disabled = disabled;
    state.enabled = enabled;
    state.query = String(searchEl.value || '').trim();

    const syncStartFailures = async (): Promise<void> => {
        if (!TAURI.has) {
            state.errorToggleById.clear();
            return;
        }
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
    };

    const pluginIsEnabled = (p: PluginSummary): boolean => {
        const id = String(p?.id || '').trim().toLowerCase();
        if (!id) return false;
        if (state.disabled.has(id)) return false;
        if (state.enabled.has(id)) return true;
        return !!p.default_enabled;
    };

    const enabledCount = state.list.filter((p) => p?.id && pluginIsEnabled(p)).length;
    groupLabelEl.textContent = `Installed (${enabledCount} of ${state.list.length} enabled)`;

    const getFiltered = (): PluginSummary[] => {
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
    };

    const ensureSelection = (filtered: PluginSummary[]) => {
        const current = state.selectedId ? String(state.selectedId).trim() : '';
        if (current && filtered.some((p) => String(p.id).trim() === current)) return;
        state.selectedId = filtered.length ? String(filtered[0].id).trim() : null;
    };

    const renderDetails = (filtered: PluginSummary[]) => {
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
        const isEnabledNow = pluginIsEnabled(plugin);
        const pendingToggle = state.pendingToggleById.get(idLower);
        const hasButtonError = state.buttonErrorToggleById.has(idLower);
        const isDisablingAction = typeof pendingToggle === 'boolean' ? pendingToggle === false : isEnabledNow;
        const version = String(plugin.version || '').trim();
        const author = String(plugin.author || '').trim();
        const category = String(plugin.category || '').trim();
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

    };

    const renderList = () => {
        const filtered = getFiltered();
        listEl.replaceChildren();
        if (!state.list.length) {
            const li = document.createElement('li');
            li.className = 'plugin-row';
            li.setAttribute('aria-selected', 'false');
            li.textContent = 'No plugins installed.';
            listEl.appendChild(li);
            renderDetails(filtered);
            return;
        }

        if (!filtered.length) {
            const li = document.createElement('li');
            li.className = 'plugin-row';
            li.setAttribute('aria-selected', 'false');
            li.textContent = 'No matching plugins.';
            listEl.appendChild(li);
            renderDetails(filtered);
            return;
        }

        for (const plugin of filtered) {
            const id = String(plugin.id).trim();
            const idLower = id.toLowerCase();
            const isEnabledNow = pluginIsEnabled(plugin);
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
                img.src = iconUrl;
                img.addEventListener('load', () => {
                    icon.classList.add('has-img');
                    icon.replaceChildren(img);
                });
                img.addEventListener('error', () => {
                    img.remove();
                    icon.classList.remove('has-img');
                    if (!icon.textContent?.trim()) icon.textContent = initial;
                });
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

        renderDetails(filtered);
    };

    const updateCounts = () => {
        const enabledNow = state.list.filter((p) => p?.id && pluginIsEnabled(p)).length;
        groupLabelEl.textContent = `Installed (${enabledNow} of ${state.list.length} enabled)`;
    };

    async function reloadPluginSummaries(): Promise<void> {
        if (!TAURI.has) return;
        let list: PluginSummary[] = [];
        try {
            list = await TAURI.invoke<PluginSummary[]>('list_plugins');
        } catch (err) {
            console.warn('reload list_plugins failed', err);
            return;
        }

        state.list = Array.isArray(list) ? list : [];
        await syncStartFailures();
        ensureSelection(getFiltered());
        renderList();
        updateCounts();
    }

    await syncStartFailures();
    ensureSelection(getFiltered());
    (modal as any)[stateKey] = state;
    renderList();

    const persistPluginsDisabled = async () => {
        if (!TAURI.has) return;
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
    };

    const persistSinglePluginToggle = async (pluginId: string, enabled: boolean) => {
        if (!TAURI.has) return;
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
            clearPluginSettingsCache();
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
                renderDetails(getFiltered());
            }, 2000);
            state.buttonErrorTimerById.set(idLower, timer);
            console.error('Failed to toggle plugin:', e);
            notify('Failed to toggle plugin');
        } finally {
            state.pendingToggleById.delete(idLower);
            updateCounts();
            renderList();
        }
    };

    const queuePluginToggle = (pluginIdRaw: string, enabled: boolean) => {
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
        renderList();
        void (async () => {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            await persistSinglePluginToggle(id, enabled);
        })();
    };

    if (!(pane as any).__wired) {
        (pane as any).__wired = true;

        const viewportPadding = 8;
        const contextMenu = document.createElement('div');
        contextMenu.className = 'plugins-context-menu';
        contextMenu.setAttribute('role', 'menu');
        contextMenu.tabIndex = -1;

        const toggleAction = document.createElement('button');
        toggleAction.type = 'button';
        toggleAction.className = 'plugins-context-menu-item';
        toggleAction.dataset.action = 'toggle';
        toggleAction.textContent = 'Toggle plugin';

        const removeAction = document.createElement('button');
        removeAction.type = 'button';
        removeAction.className = 'plugins-context-menu-item destructive';
        removeAction.dataset.action = 'remove';
        removeAction.textContent = 'Remove plugin';

        contextMenu.appendChild(toggleAction);
        contextMenu.appendChild(removeAction);
        modal.appendChild(contextMenu);

        let contextMenuPluginId: string | null = null;
        let contextMenuVisible = false;

        const hideContextMenu = () => {
            if (!contextMenuVisible) return;
            contextMenuVisible = false;
            contextMenuPluginId = null;
            contextMenu.classList.remove('visible');
            contextMenu.style.visibility = 'visible';
        };

        const showContextMenu = (pluginId: string, plugin: PluginSummary | null, x: number, y: number) => {
            hideContextMenu();
            contextMenuPluginId = pluginId;
            const enabled = plugin ? pluginIsEnabled(plugin) : false;
            toggleAction.textContent = enabled ? 'Disable plugin' : 'Enable plugin';

            const isBuiltIn = (plugin?.source || '') === 'built-in';
            removeAction.disabled = isBuiltIn;
            if (isBuiltIn) {
                removeAction.title = 'Built-in plugins cannot be removed.';
            } else {
                removeAction.removeAttribute('title');
            }

            contextMenu.style.left = `${x}px`;
            contextMenu.style.top = `${y}px`;
            contextMenu.classList.add('visible');
            contextMenu.style.visibility = 'hidden';
            const rect = contextMenu.getBoundingClientRect();
            let left = x;
            let top = y;
            if (rect.right > window.innerWidth - viewportPadding) {
                left = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            }
            if (rect.bottom > window.innerHeight - viewportPadding) {
                top = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
            }
            contextMenu.style.left = `${left}px`;
            contextMenu.style.top = `${top}px`;
            contextMenu.style.visibility = 'visible';
            contextMenuVisible = true;
        };

        toggleAction.addEventListener('click', () => {
            const id = contextMenuPluginId;
            hideContextMenu();
            if (!id) return;
            const checkbox = pane.querySelector<HTMLInputElement>(`input[type="checkbox"][data-plugin-id="${CSS.escape(id)}"]`);
            if (!checkbox) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });

        removeAction.addEventListener('click', async () => {
            if (removeAction.disabled) return;
            const id = contextMenuPluginId;
            hideContextMenu();
            if (!id) return;
            const plugin = state.list.find((p) => String(p?.id || '').trim() === id) || null;
            if (!plugin) return;
            const label = String(plugin.name || plugin.id || 'plugin');
            if (!(await confirmBool(`Remove ${label}? This will delete the plugin bundle.`))) return;
            if (!TAURI.has) {
                notify('Plugin removal is only available in the desktop app.');
                return;
            }
            try {
                await TAURI.invoke('uninstall_plugin', { pluginId: id });
                notify(`Removed ${label}`);
                const normalized = String(id || '').trim();
                const normalizedLower = normalized.toLowerCase();
                state.disabled.delete(normalizedLower);
                state.enabled.delete(normalizedLower);
                const activeSection = String(
                    modal
                        .querySelector<HTMLElement>('#settings-nav .seg-btn.active')
                        ?.getAttribute('data-section') || '',
                ).trim();
                await reloadPluginSummaries();
                clearPluginSettingsCache();
                await renderPluginMenus(modal);
                const nav = modal.querySelector('#settings-nav');
                const safeSection = activeSection && nav?.querySelector(`[data-section="${CSS.escape(activeSection)}"]`) ? activeSection : 'plugins';
                activateSection(modal, safeSection);
                persistPluginsDisabled().catch(() => {});
            } catch (err) {
                const msg = String(err || '').trim();
                notify(msg ? `Remove failed: ${msg}` : 'Failed to remove plugin');
            }
        });

        document.addEventListener('click', (e) => {
            if (!contextMenuVisible) return;
            if (!contextMenu.contains(e.target as Node)) {
                hideContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideContextMenu();
        });

        pane.addEventListener('contextmenu', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('.plugin-row[data-plugin]');
            if (!row) {
                hideContextMenu();
                return;
            }
            const pluginId = String(row.dataset.plugin || '').trim();
            if (!pluginId) {
                hideContextMenu();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            state.selectedId = pluginId;
            renderList();
            const plugin = state.list.find((p) => String(p?.id || '').trim() === pluginId) || null;
            showContextMenu(pluginId, plugin, e.clientX, e.clientY);
        });

        pane.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            const toggleBtn = target?.closest<HTMLButtonElement>('[data-plugin-toggle]') || null;
            if (toggleBtn) {
                const id = String(toggleBtn.dataset.pluginToggle || '').trim();
                if (!id) return;
                const plugin = state.list.find(
                    (p) => String(p?.id || '').trim().toLowerCase() === id.toLowerCase(),
                );
                const desiredEnabled = plugin ? !pluginIsEnabled(plugin) : false;
                const checkbox = pane.querySelector<HTMLInputElement>(
                    `input[type="checkbox"][data-plugin-id="${CSS.escape(id)}"]`,
                );
                if (checkbox) checkbox.checked = plugin ? pluginIsEnabled(plugin) : false;
                queuePluginToggle(id, desiredEnabled);
                return;
            }

            const row = target?.closest<HTMLElement>('.plugin-row[data-plugin]') || null;
            if (!row) return;
            const id = String(row.dataset.plugin || '').trim();
            if (!id) return;

            const isCheckbox = !!target?.closest('.plugin-check');
            if (!isCheckbox) {
                const now = Date.now();
                const idKey = id.toLowerCase();
                const lastAt = Number((state as any).lastClickAt ?? 0) || 0;
                const lastIdKey = String((state as any).lastClickIdKey ?? '');
                if (lastIdKey === idKey && now - lastAt <= 450) {
                    const checkbox =
                        row.querySelector<HTMLInputElement>('input[type="checkbox"][data-plugin-id]') ||
                        pane.querySelector<HTMLInputElement>(`input[type="checkbox"][data-plugin-id="${CSS.escape(id)}"]`);
                    if (checkbox) {
                        e.preventDefault();
                        e.stopPropagation();
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    (state as any).lastClickAt = 0;
                    (state as any).lastClickIdKey = '';
                    return;
                }
                (state as any).lastClickAt = now;
                (state as any).lastClickIdKey = idKey;
            }

            state.selectedId = id;
            renderList();
        });

        pane.addEventListener('change', (e) => {
            const el = e.target as HTMLInputElement | null;
            if (!el || el.type !== 'checkbox' || !el.dataset.pluginId) return;
            const id = String(el.dataset.pluginId).trim().toLowerCase();
            if (!id) return;
            const plugin = state.list.find(
                (p) => String(p?.id || '').trim().toLowerCase() === id,
            );
            const currentEnabled = plugin ? pluginIsEnabled(plugin) : false;
            const desiredEnabled = !currentEnabled;
            el.checked = currentEnabled;
            queuePluginToggle(id, desiredEnabled);
        });

        searchEl.addEventListener('input', () => {
            state.query = String(searchEl.value || '').trim();
            ensureSelection(getFiltered());
            renderList();
        });

        searchEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
        });

        if (!(enableAllBtn as any).dataset?.bound) {
            (enableAllBtn as any).dataset.bound = '1';
            enableAllBtn.addEventListener('click', () => {
            for (const p of state.list) {
                const id = String(p?.id || '').trim().toLowerCase();
                if (!id) continue;
                state.disabled.delete(id);
                state.enabled.add(id);
            }
            searchEl.dispatchEvent(new Event('input'));
            updateCounts();
            persistPluginsDisabled().catch(() => {});
            });
        }

        if (!(disableAllBtn as any).dataset?.bound) {
            (disableAllBtn as any).dataset.bound = '1';
            disableAllBtn.addEventListener('click', () => {
            for (const p of state.list) {
                const id = String(p?.id || '').trim().toLowerCase();
                if (!id) continue;
                state.enabled.delete(id);
                state.disabled.add(id);
            }
            searchEl.dispatchEvent(new Event('input'));
            updateCounts();
            persistPluginsDisabled().catch(() => {});
            });
        }

        pane.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === '/' && document.activeElement !== searchEl) {
                e.preventDefault();
                searchEl.focus();
            }
        });
    }
}
