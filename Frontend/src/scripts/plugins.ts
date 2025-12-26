import { TAURI } from './lib/tauri';
import { notify } from './lib/notify';
import type { GlobalSettings, Json, ThemePayload, ThemeSummary } from './types';

export interface PluginSummary {
    id: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    entry?: string;
    theme_dirs?: number;
}

export interface PluginPayload {
    summary: PluginSummary;
    entry?: string | null;
}

export type HookName =
    | 'preCommit' | 'onCommit' | 'postCommit'
    | 'prePush' | 'onPush' | 'postPush'
    | 'preSwitchBranch' | 'onSwitchBranch' | 'postSwitchBranch'
    | 'preBranchCreate' | 'onBranchCreate' | 'postBranchCreate'
    | 'preBranchDelete' | 'onBranchDelete' | 'postBranchDelete';

export interface HookContext<T = unknown> {
    name: HookName;
    data: T;
    cancelled: boolean;
    cancel(reason?: string): void;
    reason?: string;
}

export type HookHandler<T = unknown> = (ctx: HookContext<T>) => void | Promise<void>;
export type PluginAction = (payload?: unknown) => void | Promise<void>;

export interface PluginMenuItem {
    label: string;
    action: string;
    title?: string;
}

export interface PluginTitleButton {
    label: string;
    action: string;
    title?: string;
}

export interface PluginRegistration {
    id?: string;
    name?: string;
    hooks?: Partial<Record<HookName, HookHandler>>;
    actions?: Record<string, PluginAction>;
    menuItems?: PluginMenuItem[];
    titlebarButtons?: PluginTitleButton[];
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
            invoke<T = unknown>(cmd: string, args?: Json): Promise<T>;
            listen<T = unknown>(event: string, cb: (evt: { payload: T }) => void): Promise<{ unlisten: () => void }>;
            notify(msg: string): void;
        };
        __openvcsPluginContext?: { id: string } | null;
    }
}

const PLUGIN_SCRIPT_NODES: HTMLScriptElement[] = [];
const pluginUiNodes = new Map<string, HTMLElement[]>();

const actionHandlers = new Map<string, PluginAction>();
const hookHandlers = new Map<HookName, Array<{ pluginId: string; handler: HookHandler }>>();
const registeredThemePayloads = new Map<string, ThemePayload>();
const registeredThemeSummaries = new Map<string, ThemeSummary>();

let initialized = false;
let disabledPlugins = new Set<string>();

function normalizeId(value: string): string {
    return String(value || '').trim().toLowerCase();
}

function clearPluginScripts() {
    while (PLUGIN_SCRIPT_NODES.length) {
        const node = PLUGIN_SCRIPT_NODES.pop();
        node?.parentNode?.removeChild(node);
    }
}

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

    const menu = pluginsMenuList();
    if (menu) menu.replaceChildren();
    const host = pluginActionsHost();
    if (host) host.replaceChildren();
}

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

function clearPluginUi(pluginId: string) {
    const nodes = pluginUiNodes.get(pluginId) || [];
    for (const node of nodes) {
        node.parentElement?.removeChild(node);
    }
    pluginUiNodes.delete(pluginId);
}

function trackUiNode(pluginId: string, node: HTMLElement) {
    const list = pluginUiNodes.get(pluginId) || [];
    list.push(node);
    pluginUiNodes.set(pluginId, list);
}

function pluginsMenuList(): HTMLElement | null {
    return document.getElementById('plugins-menu-list');
}

function pluginActionsHost(): HTMLElement | null {
    return document.getElementById('plugin-title-actions');
}

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

function removePluginsMenuPlaceholder() {
    pluginsMenuList()
        ?.querySelector<HTMLElement>('[data-openvcs-plugin-placeholder="true"]')
        ?.remove();
}

function registerAction(id: string, handler: PluginAction) {
    const key = String(id || '').trim();
    if (!key) return;
    actionHandlers.set(key, handler);
}

function registerHook(pluginId: string, name: HookName, handler: HookHandler) {
    const list = hookHandlers.get(name) || [];
    list.push({ pluginId, handler });
    hookHandlers.set(name, list);
}

function registerTheme(theme: ThemePayload) {
    const id = normalizeId(theme?.summary?.id || '');
    if (!id) return;
    registeredThemePayloads.set(id, theme);
    if (theme.summary) {
        registeredThemeSummaries.set(id, theme.summary);
    }
}

function registerThemeSummary(summary: ThemeSummary) {
    const id = normalizeId(summary?.id || '');
    if (!id) return;
    registeredThemeSummaries.set(id, summary);
}

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

function currentPluginIdForRegistration(explicit?: string): string | null {
    const id = String(explicit || '').trim();
    if (id) return id;
    const ctxId = String(window.__openvcsPluginContext?.id || '').trim();
    return ctxId || null;
}

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
}

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

export function getRegisteredThemeSummaries(): ThemeSummary[] {
    return Array.from(registeredThemeSummaries.values());
}

export function getRegisteredThemePayload(id: string): ThemePayload | null {
    const key = normalizeId(id);
    return registeredThemePayloads.get(key) || null;
}

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
        const ids = Array.isArray(cfg?.plugins?.disabled) ? cfg.plugins!.disabled! : [];
        disabledPlugins = new Set(ids.map((s) => normalizeId(s)).filter(Boolean));
    } catch {
        disabledPlugins = new Set();
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
        if (disabledPlugins.has(normalizeId(pluginId))) continue;

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

export async function reloadPlugins(): Promise<void> {
    installGlobalApi();
    if (!TAURI.has) return;
    initialized = false;
    await initPlugins();
}
