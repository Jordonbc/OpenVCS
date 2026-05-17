// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import type { Json } from '../types';
import type { HookName, HookHandler, PluginAction, PluginContextMenuTarget, PluginContextMenuItem, PluginMenuItem, PluginRegistration, PluginSettingsSection, PluginTitleButton, PluginMenubarMenu, PluginContextMenus } from './types';
import { normalizeId, escapeCssSelector, parseSanitizedPluginElement } from './sanitize';
import {
    actionHandlers,
    hookHandlers,
    registeredThemePayloads,
    registeredThemeSummaries,
    contextMenuItems,
    settingsSections,
    disabledPlugins,
    enabledPlugins,
} from './state';
import type { ThemePayload, ThemeSummary } from '../types';

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

const PLUGIN_SCRIPT_NODES: HTMLScriptElement[] = [];
const pluginUiNodes = new Map<string, HTMLElement[]>();
const menubarMenus = new Map<string, PluginMenubarMenu[]>();

// ---------------------------------------------------------------------------
// Plugin enable/disable helpers
// ---------------------------------------------------------------------------

/** Checks whether a plugin is enabled after overrides are applied. */
function isPluginEnabled(summary: { id: string; default_enabled?: boolean }): boolean {
    const id = normalizeId(summary?.id || '');
    if (!id) return false;
    if (disabledPlugins.has(id)) return false;
    if (enabledPlugins.has(id)) return true;
    return !!summary?.default_enabled;
}

// ---------------------------------------------------------------------------
// Script injection & cleanup
// ---------------------------------------------------------------------------

/** Removes all injected plugin script nodes. */
function clearPluginScripts() {
    while (PLUGIN_SCRIPT_NODES.length) {
        const node = PLUGIN_SCRIPT_NODES.pop();
        node?.parentNode?.removeChild(node);
    }
}

/** Injects a plugin module into the document head. */
function injectPluginModule(code: string, pluginId: string) {
    const head = document.head;
    if (!head) return;
    const script = document.createElement('script');
    script.type = 'module';
    script.dataset.openvcsPluginId = pluginId;
    script.textContent =
        `window.__openvcsPluginContext = { id: ${JSON.stringify(pluginId)} };\n`
        + String(code || '')
        + `\nwindow.__openvcsPluginContext = null;\n`;
    head.appendChild(script);
    PLUGIN_SCRIPT_NODES.push(script);
}

/** Removes tracked UI nodes that belong to a plugin. */
function clearPluginUi(pluginId: string) {
    const nodes = pluginUiNodes.get(pluginId) || [];
    for (const node of nodes) {
        node.parentElement?.removeChild(node);
    }
    pluginUiNodes.delete(pluginId);
}

/** Tracks host-inserted UI nodes for plugin cleanup. */
function trackUiNode(pluginId: string, node: HTMLElement) {
    const list = pluginUiNodes.get(pluginId) || [];
    list.push(node);
    pluginUiNodes.set(pluginId, list);
}

// ---------------------------------------------------------------------------
// DOM query helpers
// ---------------------------------------------------------------------------

/** Returns the plugins menu list element. */
function pluginsMenuList(): HTMLElement | null {
    return document.getElementById('plugins-menu-list');
}

/** Returns the titlebar plugin action host element. */
function pluginActionsHost(): HTMLElement | null {
    return document.getElementById('plugin-title-actions');
}

/** Ensures a disabled placeholder row exists when no plugin menu items exist. */
function ensurePluginsMenuPlaceholder() {
    const list = pluginsMenuList();
    if (!list) return;
    const hasAny = !!list.querySelector('.menu-item:not(.disabled)');
    if (hasAny) return;
    if (list.querySelector('[data-openvcs-plugin-placeholder="true"]')) return;

    const btn = document.createElement('button');
    btn.className = 'menu-item disabled';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('data-openvcs-plugin-placeholder', 'true');
    btn.textContent = 'No plugins installed';
    list.appendChild(btn);
}

/** Removes the plugin menu placeholder row. */
function removePluginsMenuPlaceholder() {
    pluginsMenuList()
        ?.querySelector<HTMLElement>('[data-openvcs-plugin-placeholder="true"]')
        ?.remove();
}

// ---------------------------------------------------------------------------
// Single-item registration helpers
// ---------------------------------------------------------------------------

/** Registers a plugin action handler by id. */
function registerAction(id: string, handler: PluginAction) {
    const key = String(id || '').trim();
    if (!key) return;
    actionHandlers.set(key, handler);
}

/** Registers a lifecycle hook handler for a plugin. */
function registerHook(pluginId: string, name: HookName, handler: HookHandler) {
    const list = hookHandlers.get(name) || [];
    list.push({ pluginId, handler });
    hookHandlers.set(name, list);
}

/** Registers a theme payload exposed by a plugin. */
function registerTheme(theme: ThemePayload) {
    const id = normalizeId(theme?.summary?.id || '');
    if (!id) return;
    registeredThemePayloads.set(id, theme);
    if (theme.summary) {
        registeredThemeSummaries.set(id, theme.summary);
    }
}

/** Registers theme summary metadata exposed by a plugin. */
function registerThemeSummary(summary: ThemeSummary) {
    const id = normalizeId(summary?.id || '');
    if (!id) return;
    registeredThemeSummaries.set(id, summary);
}

/** Adds a plugin item to the plugins menu list. */
function addMenuItem(pluginId: string, item: PluginMenuItem) {
    const list = pluginsMenuList();
    if (!list) return;
    const label = String(item?.label || '').trim();
    const action = String(item?.action || '').trim();
    if (!label || !action) return;

    removePluginsMenuPlaceholder();

    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.action = action;
    if (item.title) btn.title = item.title;
    btn.textContent = label;
    list.appendChild(btn);
    trackUiNode(pluginId, btn);
}

/** Adds a plugin action button to the titlebar host. */
function addTitlebarButton(pluginId: string, btn: PluginTitleButton) {
    const host = pluginActionsHost();
    if (!host) return;
    const label = String(btn?.label || '').trim();
    const action = String(btn?.action || '').trim();
    if (!label || !action) return;

    const el = document.createElement('button');
    el.className = 'btn';
    el.dataset.action = action;
    if (btn.title) el.title = btn.title;
    el.textContent = label;
    host.appendChild(el);
    trackUiNode(pluginId, el);
}

// ---------------------------------------------------------------------------
// Settings section + menubar injection
// ---------------------------------------------------------------------------

// Forward reference set by runtime.ts to avoid circular imports.
let _applyPluginSectionsFn: ((modal?: HTMLElement | null) => void) | null = null;

/** Registers a callback for `applyPluginSettingsSections` (invoked by runtime.ts). */
export function _setApplyPluginSectionsFallback(fn: (modal?: HTMLElement | null) => void): void {
    _applyPluginSectionsFn = fn;
}

/** Inserts or updates a plugin-provided settings section. */
function upsertSettingsSection(pluginId: string, section: PluginSettingsSection) {
    const id = String(section?.id || '').trim();
    const label = String(section?.label || '').trim();
    const html = String(section?.html || '');
    if (!id || !label || !html.trim()) return;

    const list = settingsSections.get(pluginId) || [];
    const filtered = list.filter((s) => String(s.id || '').trim() !== id);
    filtered.push({ ...section, id, label, html });
    settingsSections.set(pluginId, filtered);

    // Best-effort apply immediately if the modal is already in the DOM.
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (modal && _applyPluginSectionsFn) {
        _applyPluginSectionsFn(modal);
    }
}

/** Inserts or updates a plugin-provided menubar menu. */
function applyMenubarMenu(pluginId: string, menu: PluginMenubarMenu) {
    const id = String(menu?.id || '').trim();
    const html = String(menu?.html || '');
    if (!id || !html.trim()) return;

    const root = document.querySelector<HTMLElement>('.menubar');
    if (!root) return;

    const node = parseSanitizedPluginElement(html);
    if (!node) return;

    const before = String(menu?.before || '').trim();
    const after = String(menu?.after || '').trim();
    const existing = root.querySelector<HTMLElement>(`.menu[data-menu="${escapeCssSelector(id)}"]`);
    if (existing) existing.remove();

    const afterEl = after ? root.querySelector<HTMLElement>(`.menu[data-menu="${escapeCssSelector(after)}"]`) : null;
    const beforeEl = before ? root.querySelector<HTMLElement>(`.menu[data-menu="${escapeCssSelector(before)}"]`) : null;
    if (afterEl) {
        afterEl.insertAdjacentElement('afterend', node);
    } else if (beforeEl) {
        beforeEl.insertAdjacentElement('beforebegin', node);
    } else {
        root.appendChild(node);
    }
    trackUiNode(pluginId, node);
}

// ---------------------------------------------------------------------------
// Plugin id resolution
// ---------------------------------------------------------------------------

/** Resolves plugin id during global API registration callbacks. */
function currentPluginIdForRegistration(explicit?: string): string | null {
    const id = String(explicit || '').trim();
    if (id) return id;
    const ctxId = String(window.__openvcsPluginContext?.id || '').trim();
    return ctxId || null;
}

// ---------------------------------------------------------------------------
// Full plugin registration
// ---------------------------------------------------------------------------

/** Registers plugin hooks, actions, menus, and theme contributions. */
function registerPlugin(reg: PluginRegistration) {
    const pluginId = currentPluginIdForRegistration(reg?.id) || null;
    if (!pluginId) return;

    clearPluginUi(pluginId);

    if (reg?.actions) {
        for (const [id, handler] of Object.entries(reg.actions)) {
            if (typeof handler !== 'function') continue;
            registerAction(id, handler);
        }
    }

    if (reg?.hooks) {
        for (const [name, handler] of Object.entries(reg.hooks) as Array<[HookName, HookHandler]>) {
            if (typeof handler !== 'function') continue;
            registerHook(pluginId, name, handler);
        }
    }

    if (Array.isArray(reg?.themes)) {
        for (const theme of reg.themes) {
            if (theme) registerTheme(theme);
        }
    }

    if (Array.isArray(reg?.themeSummaries)) {
        for (const summary of reg.themeSummaries) {
            if (summary) registerThemeSummary(summary);
        }
    }

    if (Array.isArray(reg?.menuItems)) {
        for (const item of reg.menuItems) {
            if (item) addMenuItem(pluginId, item);
        }
    }

    if (Array.isArray(reg?.titlebarButtons)) {
        for (const btn of reg.titlebarButtons) {
            if (btn) addTitlebarButton(pluginId, btn);
        }
    }

    if (Array.isArray(reg?.settingsSections)) {
        for (const section of reg.settingsSections) {
            if (section) upsertSettingsSection(pluginId, section);
        }
    }

    if (Array.isArray(reg?.menubarMenus)) {
        for (const menu of reg.menubarMenus) {
            if (!menu) continue;
            const id = String(menu?.id || '').trim();
            const list = menubarMenus.get(pluginId) || [];
            menubarMenus.set(pluginId, list.filter((m) => String(m.id || '').trim() !== id).concat(menu));
            applyMenubarMenu(pluginId, menu);
        }
    }

    const menus = reg?.contextMenus;
    if (menus) {
        const merge = (target: PluginContextMenuTarget, items?: PluginContextMenuItem[]) => {
            const list = contextMenuItems.get(target) || [];
            for (const it of Array.isArray(items) ? items : []) {
                const label = String(it?.label || '').trim();
                const action = String(it?.action || '').trim();
                if (!label || !action) continue;
                list.push({ label, action, title: it?.title });
            }
            contextMenuItems.set(target, list);
        };
        merge('files', menus.files);
        merge('commits', menus.commits);
        merge('branches', menus.branches);
    }
}

// ---------------------------------------------------------------------------
// Global API installation
// ---------------------------------------------------------------------------

/** Installs the `window.OpenVCS` plugin registration API once. */
function installGlobalApi() {
    if (window.OpenVCS) return;
    window.OpenVCS = {
        registerPlugin,
        registerTheme,
        registerThemeSummary,
        registerAction,
        addMenuItem(item: PluginMenuItem) {
            const pluginId = currentPluginIdForRegistration() || 'unknown';
            addMenuItem(pluginId, item);
        },
        addTitlebarButton(btn: PluginTitleButton) {
            const pluginId = currentPluginIdForRegistration() || 'unknown';
            addTitlebarButton(pluginId, btn);
        },
        addSettingsSection(section: PluginSettingsSection) {
            const pluginId = currentPluginIdForRegistration() || 'unknown';
            upsertSettingsSection(pluginId, section);
        },
        addMenubarMenu(menu: PluginMenubarMenu) {
            const pluginId = currentPluginIdForRegistration() || 'unknown';
            applyMenubarMenu(pluginId, menu);
        },
        invoke<T = unknown>(cmd: string, args?: Json) {
            return TAURI.invoke<T>(cmd, args);
        },
        listen<T = unknown>(event: string, cb: (evt: { payload: T }) => void) {
            return TAURI.listen<T>(event, cb);
        },
        notify(msg: string) {
            notify(msg);
        },
    };
}

// ---------------------------------------------------------------------------
// Runtime reset
// ---------------------------------------------------------------------------

/** Clears all plugin runtime registries and injected UI. */
function resetPluginRuntime() {
    clearPluginScripts();

    for (const [pluginId] of pluginUiNodes) {
        clearPluginUi(pluginId);
    }
    pluginUiNodes.clear();

    actionHandlers.clear();
    hookHandlers.clear();
    registeredThemePayloads.clear();
    registeredThemeSummaries.clear();
    contextMenuItems.clear();
    settingsSections.clear();
    menubarMenus.clear();

    const menu = pluginsMenuList();
    if (menu) menu.replaceChildren();
    const host = pluginActionsHost();
    if (host) host.replaceChildren();
}

export {
    isPluginEnabled,
    clearPluginScripts,
    injectPluginModule,
    clearPluginUi,
    trackUiNode,
    pluginsMenuList,
    pluginActionsHost,
    ensurePluginsMenuPlaceholder,
    removePluginsMenuPlaceholder,
    registerAction,
    registerHook,
    registerTheme,
    registerThemeSummary,
    addMenuItem,
    addTitlebarButton,
    upsertSettingsSection,
    applyMenubarMenu,
    currentPluginIdForRegistration,
    registerPlugin,
    installGlobalApi,
    resetPluginRuntime,
};
