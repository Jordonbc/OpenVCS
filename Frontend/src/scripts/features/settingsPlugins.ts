// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI, isTauriRuntimeAvailable } from '../lib/tauri';
import { notify } from '../lib/notify';
import { confirmBool } from '../lib/confirm';
import { reloadPlugins } from '../plugins';
import type { PluginSummary } from '../plugins';
import { DEFAULT_LIGHT_THEME_ID, refreshAvailableThemes, selectThemePack } from '../themes';
import { setTheme } from '../ui/layout';
import type { GlobalSettings } from '../types';
import { modeForTheme, rebuildThemePackOptions } from './settingsTheme';
import { renderPluginMenus, activateSection } from './settingsPluginUI';
import { parsePluginQuery, pluginSearchScore } from './settingsPluginSearch';

/** Tracks panes whose context-menu wiring has already been installed. */
const pluginPaneWired = new WeakSet<HTMLElement>();

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

    // This settings pane can be initialized multiple times during navigation/rerender.
    // Avoid stacking duplicate click handlers which would open many dialogs.
    if (!(syncConfigBtn as any).dataset?.bound) {
        (syncConfigBtn as any).dataset.bound = '1';
        syncConfigBtn.addEventListener('click', async () => {
            try {
                await TAURI.invoke('sync_configured_plugins');
                notify('Reloaded plugin config');
                await reloadPluginSummaries();
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
        if (state.disabled.has(id)) return false;
        if (state.enabled.has(id)) return true;
        return typeof p?.enabled === 'boolean' ? p.enabled : !!p?.default_enabled;
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

        renderDetails(filtered);
    };

    const updateCounts = () => {
        const enabledNow = state.list.filter((p) => p?.id && pluginIsEnabled(p)).length;
        groupLabelEl.textContent = `Installed (${enabledNow} of ${state.list.length} enabled)`;
    };

    async function reloadPluginSummaries(): Promise<void> {
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

    if (!pluginPaneWired.has(pane)) {
        pluginPaneWired.add(pane);

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
            enableAllBtn.addEventListener('click', async () => {
            for (const p of state.list) {
                const id = String(p?.id || '').trim();
                if (!id) continue;
                const idLower = id.toLowerCase();
                state.disabled.delete(idLower);
                state.enabled.add(idLower);
                try {
                    await TAURI.invoke('set_plugin_enabled', { pluginId: id, enabled: true });
                } catch (e) {
                    console.warn(`enable-all: toggle ${id} failed`, e);
                }
            }
            searchEl.dispatchEvent(new Event('input'));
            updateCounts();
            try {
                await reloadPlugins();
                await renderPluginMenus(modal);
            } catch (e) { console.warn('enable-all: reload failed', e); }
            });
        }

        if (!(disableAllBtn as any).dataset?.bound) {
            (disableAllBtn as any).dataset.bound = '1';
            disableAllBtn.addEventListener('click', async () => {
            for (const p of state.list) {
                const id = String(p?.id || '').trim();
                if (!id) continue;
                const idLower = id.toLowerCase();
                state.enabled.delete(idLower);
                state.disabled.add(idLower);
                try {
                    await TAURI.invoke('set_plugin_enabled', { pluginId: id, enabled: false });
                } catch (e) {
                    console.warn(`disable-all: toggle ${id} failed`, e);
                }
            }
            searchEl.dispatchEvent(new Event('input'));
            updateCounts();
            try {
                await reloadPlugins();
                await renderPluginMenus(modal);
            } catch (e) { console.warn('disable-all: reload failed', e); }
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
