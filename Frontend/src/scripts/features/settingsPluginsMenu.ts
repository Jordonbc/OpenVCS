// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { confirmBool } from '../lib/confirm';
import { reloadPlugins } from '../plugins';
import type { PluginSummary } from '../plugins';
import { renderPluginMenus, activateSection } from './settingsPluginUI';
import { ensureSelection, getFilteredPlugins, pluginIsEnabled } from './settingsPluginsState';
import type { PluginsPanelCtx } from './settingsPluginsState';
import { renderPluginList, updatePluginCounts, reloadPluginSummaries } from './settingsPluginsList';
import { queuePluginToggle, persistPluginsDisabled } from './settingsPluginsToggle';

/** Tracks panes whose context-menu wiring has already been installed. */
const pluginPaneWired = new WeakSet<HTMLElement>();

/** Installs the plugins pane context menu and event wiring (once per pane). */
export function wirePluginsPane(ctx: PluginsPanelCtx): void {
    const { modal, pane, state, searchEl, enableAllBtn, disableAllBtn } = ctx;

    if (pluginPaneWired.has(pane)) return;
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
        const enabled = plugin ? pluginIsEnabled(state, plugin) : false;
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
            await reloadPluginSummaries(ctx);
            await renderPluginMenus(modal);
            const nav = modal.querySelector('#settings-nav');
            const safeSection = activeSection && nav?.querySelector(`[data-section="${CSS.escape(activeSection)}"]`) ? activeSection : 'plugins';
            activateSection(modal, safeSection);
            persistPluginsDisabled(ctx).catch(() => {});
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
        renderPluginList(ctx);
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
            const desiredEnabled = plugin ? !pluginIsEnabled(state, plugin) : false;
            const checkbox = pane.querySelector<HTMLInputElement>(
                `input[type="checkbox"][data-plugin-id="${CSS.escape(id)}"]`,
            );
            if (checkbox) checkbox.checked = plugin ? pluginIsEnabled(state, plugin) : false;
            queuePluginToggle(ctx, id, desiredEnabled);
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
        renderPluginList(ctx);
    });

    pane.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement | null;
        if (!el || el.type !== 'checkbox' || !el.dataset.pluginId) return;
        const id = String(el.dataset.pluginId).trim().toLowerCase();
        if (!id) return;
        const plugin = state.list.find(
            (p) => String(p?.id || '').trim().toLowerCase() === id,
        );
        const currentEnabled = plugin ? pluginIsEnabled(state, plugin) : false;
        const desiredEnabled = !currentEnabled;
        el.checked = currentEnabled;
        queuePluginToggle(ctx, id, desiredEnabled);
    });

    searchEl.addEventListener('input', () => {
        state.query = String(searchEl.value || '').trim();
        ensureSelection(state, getFilteredPlugins(state));
        renderPluginList(ctx);
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
        updatePluginCounts(ctx);
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
        updatePluginCounts(ctx);
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
