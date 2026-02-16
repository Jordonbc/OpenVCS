// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from './lib/tauri';
import { notify } from './lib/notify';
import { initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from './lib/scrollbars';
import type { GlobalSettings, Json, ThemePayload, ThemeSummary } from './types';

/** Describes plugin metadata returned by discovery endpoints. */
export interface PluginSummary {
    id: string;
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    version?: string;
    author?: string;
    source?: 'built-in' | 'user' | string;
    entry?: string;
    default_enabled?: boolean;
    theme_dirs?: number;
    icon_data_url?: string;
}

/** Holds a plugin manifest summary with optional UI module code. */
export interface PluginPayload {
    summary: PluginSummary;
    entry?: string | null;
}

/** Enumerates supported lifecycle hook names for plugin callbacks. */
export type HookName =
    | 'preCommit' | 'onCommit' | 'postCommit'
    | 'prePush' | 'onPush' | 'postPush'
    | 'preSwitchBranch' | 'onSwitchBranch' | 'postSwitchBranch'
    | 'preBranchCreate' | 'onBranchCreate' | 'postBranchCreate'
    | 'preBranchDelete' | 'onBranchDelete' | 'postBranchDelete';

/** Carries hook execution data and cancellation controls. */
export interface HookContext<T = unknown> {
    name: HookName;
    data: T;
    cancelled: boolean;
    cancel(reason?: string): void;
    reason?: string;
}

/** Defines a hook callback signature used by plugin registrations. */
export type HookHandler<T = unknown> = (ctx: HookContext<T>) => void | Promise<void>;
/** Defines a generic plugin action callback signature. */
export type PluginAction = (payload?: unknown) => void | Promise<void>;

/** Represents a plugin-provided menu entry. */
export interface PluginMenuItem {
    label: string;
    action: string;
    title?: string;
}

/** Represents a plugin-provided titlebar action button. */
export interface PluginTitleButton {
    label: string;
    action: string;
    title?: string;
}

/** Represents a plugin-provided settings section descriptor. */
export interface PluginSettingsSection {
    id: string;
    label: string;
    html: string;
    before?: string;
    after?: string;
    onMount?: (ctx: { modal: HTMLElement; panel: HTMLElement }) => void;
}

/** Represents a plugin-provided menubar menu contribution. */
export interface PluginMenubarMenu {
    id: string;
    html: string;
    before?: string;
    after?: string;
}

/** Lists context menu targets supported by plugin contributions. */
export type PluginContextMenuTarget = 'files' | 'commits' | 'branches';

/** Represents a single context menu command contributed by a plugin. */
export interface PluginContextMenuItem {
    label: string;
    action: string;
    title?: string;
}

/** Groups context menu contributions by target surface. */
export interface PluginContextMenus {
    files?: PluginContextMenuItem[];
    commits?: PluginContextMenuItem[];
    branches?: PluginContextMenuItem[];
}

/** Defines the full plugin registration payload accepted by the host. */
export interface PluginRegistration {
    id?: string;
    name?: string;
    hooks?: Partial<Record<HookName, HookHandler>>;
    actions?: Record<string, PluginAction>;
    menuItems?: PluginMenuItem[];
    titlebarButtons?: PluginTitleButton[];
    settingsSections?: PluginSettingsSection[];
    menubarMenus?: PluginMenubarMenu[];
    contextMenus?: PluginContextMenus;
    themes?: ThemePayload[];
    themeSummaries?: ThemeSummary[];
}

declare global {
    interface Window {
        OpenVCS?: {
            registerPlugin(reg: PluginRegistration): void;
            registerTheme(theme: ThemePayload): void;
            registerThemeSummary(summary: ThemeSummary): void;
            registerAction(id: string, handler: PluginAction): void;
            addMenuItem(item: PluginMenuItem): void;
            addTitlebarButton(btn: PluginTitleButton): void;
            addSettingsSection?(section: PluginSettingsSection): void;
            addMenubarMenu?(menu: PluginMenubarMenu): void;
            invoke<T = unknown>(cmd: string, args?: Json): Promise<T>;
            listen<T = unknown>(event: string, cb: (evt: { payload: T }) => void): Promise<{ unlisten: () => void }>;
            notify(msg: string): void;
            callPlugin?(pluginId: string, method: string, params?: Json): Promise<unknown>;
        };
        callPluginMethod?: (pluginId: string, method: string, params?: Json) => Promise<unknown>;
        __openvcsPluginContext?: { id: string } | null;
    }
}

const PLUGIN_SCRIPT_NODES: HTMLScriptElement[] = [];
const pluginUiNodes = new Map<string, HTMLElement[]>();

const actionHandlers = new Map<string, PluginAction>();
const hookHandlers = new Map<HookName, Array<{ pluginId: string; handler: HookHandler }>>();
const registeredThemePayloads = new Map<string, ThemePayload>();
const registeredThemeSummaries = new Map<string, ThemeSummary>();
const contextMenuItems = new Map<PluginContextMenuTarget, PluginContextMenuItem[]>();
const settingsSections = new Map<string, PluginSettingsSection[]>();
const menubarMenus = new Map<string, PluginMenubarMenu[]>();

let initialized = false;
let disabledPlugins = new Set<string>();
let enabledPlugins = new Set<string>();

/** Normalizes ids for case-insensitive map keys. */
function normalizeId(value: string): string {
    return String(value || '').trim().toLowerCase();
}

/** Checks whether a plugin is enabled after overrides are applied. */
function isPluginEnabled(summary: PluginSummary): boolean {
    const id = normalizeId(summary?.id || '');
    if (!id) return false;
    if (disabledPlugins.has(id)) return false;
    if (enabledPlugins.has(id)) return true;
    return !!summary?.default_enabled;
}

/** Removes all injected plugin script nodes. */
function clearPluginScripts() {
    while (PLUGIN_SCRIPT_NODES.length) {
        const node = PLUGIN_SCRIPT_NODES.pop();
        node?.parentNode?.removeChild(node);
    }
}

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
    if (modal) applyPluginSettingsSections(modal);
}

/** Inserts or updates a plugin-provided menubar menu. */
function applyMenubarMenu(pluginId: string, menu: PluginMenubarMenu) {
    const id = String(menu?.id || '').trim();
    const html = String(menu?.html || '');
    if (!id || !html.trim()) return;

    const root = document.querySelector<HTMLElement>('.menubar');
    if (!root) return;

    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const node = template.content.firstElementChild as HTMLElement | null;
    if (!node) return;

    const before = String(menu?.before || '').trim();
    const after = String(menu?.after || '').trim();
    const existing = root.querySelector<HTMLElement>(`.menu[data-menu="${CSS.escape(id)}"]`);
    if (existing) existing.remove();

    const afterEl = after ? root.querySelector<HTMLElement>(`.menu[data-menu="${CSS.escape(after)}"]`) : null;
    const beforeEl = before ? root.querySelector<HTMLElement>(`.menu[data-menu="${CSS.escape(before)}"]`) : null;
    if (afterEl) {
        afterEl.insertAdjacentElement('afterend', node);
    } else if (beforeEl) {
        beforeEl.insertAdjacentElement('beforebegin', node);
    } else {
        root.appendChild(node);
    }
    trackUiNode(pluginId, node);
}

/** Resolves plugin id during global API registration callbacks. */
function currentPluginIdForRegistration(explicit?: string): string | null {
    const id = String(explicit || '').trim();
    if (id) return id;
    const ctxId = String(window.__openvcsPluginContext?.id || '').trim();
    return ctxId || null;
}

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

/** Installs the `window.OpenVCS` plugin registration API once. */
function installGlobalApi() {
    if (window.OpenVCS) return;
    const callPluginMethod = (
        pluginId: string,
        method: string,
        params?: Json,
    ) => {
        return TAURI.invoke('call_plugin_module_method', {
            pluginId,
            method,
            params: params ?? null,
        });
    };
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
        callPlugin(pluginId: string, method: string, params?: Json) {
            return callPluginMethod(pluginId, method, params);
        },
    };
    if (!window.callPluginMethod) {
        window.callPluginMethod = (pluginId: string, method: string, params?: Json) =>
            callPluginMethod(pluginId, method, params);
    }
}

/** Renders plugin-provided settings sections inside the settings modal. */
export function applyPluginSettingsSections(modal?: HTMLElement | null): void {
    const m = modal || (document.getElementById('settings-modal') as HTMLElement | null);
    if (!m) return;

    const nav = m.querySelector<HTMLElement>('#settings-nav');
    const panelsScroll = m.querySelector<HTMLElement>('#settings-panels-scroll');
    if (!nav || !panelsScroll) return;

    // OverlayScrollbars wraps `.list-scroll` containers and moves children into a `.os-content` node.
    // If we append to the host after initialization, the content ends up outside the viewport.
    let panelsContent: HTMLElement = panelsScroll;
    for (const child of Array.from(panelsScroll.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (!child.classList.contains('os-host')) continue;
        const hostContent = child.querySelector<HTMLElement>('.os-content');
        if (hostContent) {
            panelsContent = hostContent;
        }
        break;
    }

    let insertedAny = false;

    for (const [pluginId, sections] of settingsSections.entries()) {
        for (const section of Array.isArray(sections) ? sections : []) {
            const id = String(section?.id || '').trim();
            const label = String(section?.label || '').trim();
            const html = String(section?.html || '');
            if (!id || !label || !html.trim()) continue;

            // Avoid duplicate insertion.
            const existingNav = nav.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`);
            const existingPanel = panelsScroll.querySelector<HTMLElement>(`.panel-form[data-panel="${CSS.escape(id)}"]`);
            if (existingNav && existingPanel) continue;

            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.setAttribute('data-section', id);
            btn.textContent = label;
            li.appendChild(btn);

            const template = document.createElement('template');
            template.innerHTML = html.trim();
            const panel = template.content.firstElementChild as HTMLElement | null;
            if (!panel) continue;

            if (!panel.classList.contains('panel-form')) panel.classList.add('panel-form');
            if (!panel.getAttribute('data-panel')) panel.setAttribute('data-panel', id);
            panel.classList.add('hidden');

            const before = String(section?.before || '').trim();
            const after = String(section?.after || '').trim();
            const beforeBtn = before ? nav.querySelector<HTMLElement>(`[data-section="${CSS.escape(before)}"]`) : null;
            const afterBtn = after ? nav.querySelector<HTMLElement>(`[data-section="${CSS.escape(after)}"]`) : null;

            if (afterBtn?.parentElement?.tagName.toLowerCase() === 'li') {
                afterBtn.parentElement.insertAdjacentElement('afterend', li);
            } else if (beforeBtn?.parentElement?.tagName.toLowerCase() === 'li') {
                beforeBtn.parentElement.insertAdjacentElement('beforebegin', li);
            } else {
                nav.appendChild(li);
            }

            panelsContent.appendChild(panel);

            trackUiNode(pluginId, li);
            trackUiNode(pluginId, panel);

            try {
                section.onMount?.({ modal: m, panel });
            } catch (err) {
                console.warn(`plugin settings section mount failed (${pluginId}:${id})`, err);
            }
            insertedAny = true;
        }
    }

    if (insertedAny) {
        initOverlayScrollbarsFor(m);
        refreshOverlayScrollbarsFor(m);
    }
}

/** Returns registered theme summaries from loaded plugins. */
export function getRegisteredThemeSummaries(): ThemeSummary[] {
    return Array.from(registeredThemeSummaries.values());
}

/** Returns a registered theme payload by id, if available. */
export function getRegisteredThemePayload(id: string): ThemePayload | null {
    const key = normalizeId(id);
    return registeredThemePayloads.get(key) || null;
}

/** Executes all handlers registered for a lifecycle hook. */
export async function runHook<T = unknown>(name: HookName, data: T): Promise<HookContext<T>> {
    const ctx: HookContext<T> = {
        name,
        data,
        cancelled: false,
        cancel(reason?: string) {
            ctx.cancelled = true;
            if (reason) ctx.reason = String(reason);
        },
        reason: undefined,
    };

    const list = hookHandlers.get(name) || [];
    for (const { handler } of list) {
        if (ctx.cancelled) break;
        try {
            await handler(ctx);
        } catch (err) {
            ctx.cancelled = true;
            ctx.reason = String(err || 'Hook failed');
            break;
        }
    }
    return ctx;
}

/** Executes a plugin action by id and returns whether it ran. */
export async function runPluginAction(actionId: string, payload?: unknown): Promise<boolean> {
    const id = String(actionId || '').trim();
    if (!id) return false;
    const handler = actionHandlers.get(id);
    if (!handler) return false;
    try {
        await handler(payload);
    } catch (err) {
        const msg = String(err || '').trim();
        notify(msg ? `Plugin action failed: ${msg}` : 'Plugin action failed');
    }
    return true;
}

/** Returns plugin-contributed context menu items for a target surface. */
export function getPluginContextMenuItems(
    target: PluginContextMenuTarget,
): PluginContextMenuItem[] {
    return (contextMenuItems.get(target) || []).slice();
}

/** Loads plugin manifests and installs plugin UI/runtime state. */
export async function initPlugins(): Promise<void> {
    if (initialized) return;
    initialized = true;
    installGlobalApi();

    ensurePluginsMenuPlaceholder();

    if (!TAURI.has) return;

    resetPluginRuntime();
    ensurePluginsMenuPlaceholder();

    try {
        const cfg = await TAURI.invoke<GlobalSettings>('get_global_settings');
        const disabledIds = Array.isArray(cfg?.plugins?.disabled) ? cfg.plugins!.disabled! : [];
        const enabledIds = Array.isArray(cfg?.plugins?.enabled) ? cfg.plugins!.enabled! : [];
        disabledPlugins = new Set(disabledIds.map((s: string) => normalizeId(s)).filter(Boolean));
        enabledPlugins = new Set(enabledIds.map((s: string) => normalizeId(s)).filter(Boolean));
    } catch {
        disabledPlugins = new Set();
        enabledPlugins = new Set();
    }

    let list: PluginSummary[] = [];
    try {
        list = await TAURI.invoke<PluginSummary[]>('list_plugins');
    } catch (err) {
        console.warn('list_plugins failed', err);
        return;
    }

    for (const summary of Array.isArray(list) ? list : []) {
        const pluginId = String(summary?.id || '').trim();
        if (!pluginId) continue;
        if (!summary.entry) continue;
        if (!isPluginEnabled(summary)) continue;

        try {
            const payload = await TAURI.invoke<PluginPayload>('load_plugin', { id: pluginId });
            const code = typeof payload?.entry === 'string' ? payload.entry : '';
            if (!code.trim()) continue;
            injectPluginModule(code, pluginId);
        } catch (err) {
            console.warn(`load_plugin failed (${pluginId})`, err);
        }
    }

    ensurePluginsMenuPlaceholder();
}

/** Reloads plugins by resetting and reinitializing the plugin runtime. */
export async function reloadPlugins(): Promise<void> {
    installGlobalApi();
    if (!TAURI.has) return;
    initialized = false;
    await initPlugins();
}
