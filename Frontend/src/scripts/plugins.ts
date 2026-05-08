// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from './lib/tauri';
import { notify } from './lib/notify';
import { initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from './lib/scrollbars';
import { openModal } from './ui/modals';
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
    source_kind?: string;
    source_spec?: string;
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

/** Describes the button alignment hints accepted by plugin modals. */
type PluginModalAlign = 'left' | 'centered' | 'right';

/** Describes the visual emphasis supported by plugin modal buttons. */
type PluginModalButtonVariant = 'default' | 'primary' | 'danger';

/** Describes one plugin modal button definition. */
interface PluginModalButtonDefinition {
    id: string;
    content: string;
    title?: string;
    variant?: PluginModalButtonVariant;
    align?: PluginModalAlign;
    payload?: Record<string, unknown>;
}

/** Describes one plugin modal text block definition. */
interface PluginModalTextDefinition {
    type: 'text';
    content: string;
    title?: string;
    align?: PluginModalAlign;
}

/** Describes one plugin modal separator definition. */
interface PluginModalSeparatorDefinition {
    type: 'separator';
}

/** Describes one plugin modal input definition. */
interface PluginModalInputDefinition {
    type: 'input';
    id: string;
    label: string;
    kind?: 'text' | 'search' | 'password' | 'url' | 'number';
    value?: string;
    placeholder?: string;
    required?: boolean;
    align?: PluginModalAlign;
}

/** Describes one plugin modal select option definition. */
interface PluginModalSelectOptionDefinition {
    label: string;
    value: string;
    selected?: boolean;
}

/** Describes one plugin modal select definition. */
interface PluginModalSelectDefinition {
    type: 'select';
    id: string;
    label: string;
    options: PluginModalSelectOptionDefinition[];
    value?: string;
    align?: PluginModalAlign;
}

/** Describes one plugin modal list row action definition. */
interface PluginModalListActionDefinition extends PluginModalButtonDefinition {
    type?: 'button';
}

/** Describes one plugin modal list row definition. */
interface PluginModalListRowDefinition {
    id: string;
    title: string;
    status?: string;
    meta?: string;
    description?: string;
    actions?: PluginModalListActionDefinition[];
}

/** Describes one plugin modal list definition. */
interface PluginModalListDefinition {
    type: 'list';
    id: string;
    label?: string;
    emptyText?: string;
    align?: PluginModalAlign;
    items: PluginModalListRowDefinition[];
}

/** Describes one horizontal box rendered inside a plugin modal. */
interface PluginModalHorizontalBoxDefinition {
    type: 'horizontal-box';
    content: PluginModalContentItem[];
    gap?: string;
    align?: PluginModalAlign;
    wrap?: boolean;
}

/** Describes one vertical box rendered inside a plugin modal. */
interface PluginModalVerticalBoxDefinition {
    type: 'vertical-box';
    content: PluginModalContentItem[];
    gap?: string;
}

/** Describes one grid rendered inside a plugin modal. */
interface PluginModalGridDefinition {
    type: 'grid';
    content: PluginModalContentItem[];
    columns: string;
    gap?: string;
}

/** Describes one plugin modal content item. */
type PluginModalContentItem =
    | PluginModalTextDefinition
    | PluginModalSeparatorDefinition
    | PluginModalHorizontalBoxDefinition
    | PluginModalVerticalBoxDefinition
    | PluginModalGridDefinition
    | PluginModalButtonDefinition & { type?: 'button' }
    | PluginModalInputDefinition
    | PluginModalSelectDefinition
    | PluginModalListDefinition;

/** Describes a structured plugin modal payload. */
export interface PluginModalDefinition {
    title: string;
    content: PluginModalContentItem[];
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
const contextMenuItems = new Map<PluginContextMenuTarget, PluginContextMenuItem[]>();
const settingsSections = new Map<string, PluginSettingsSection[]>();
const menubarMenus = new Map<string, PluginMenubarMenu[]>();

let initialized = false;
let disabledPlugins = new Set<string>();
let enabledPlugins = new Set<string>();
let pluginModalActionWired = false;

/** Normalizes ids for case-insensitive map keys. */
function normalizeId(value: string): string {
    return String(value || '').trim().toLowerCase();
}

/** Escapes one string for use in a CSS selector. */
function escapeCssSelector(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(String(value || ''));
    }
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

const BLOCKED_PLUGIN_TAGS = new Set([
    'base',
    'embed',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
    'style',
    'svg',
    'template',
]);

const URL_PLUGIN_ATTRS = new Set(['action', 'formaction', 'href', 'src', 'xlink:href']);

/** Returns true when one plugin URL attribute is safe to keep. */
function isSafePluginUrl(value: string): boolean {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    try {
        const url = new URL(trimmed, document.baseURI);
        return url.protocol !== 'javascript:' && url.protocol !== 'vbscript:' && url.protocol !== 'data:';
    } catch {
        return false;
    }
}

/** Removes unsafe tags and attributes from one plugin HTML subtree. */
function sanitizePluginSubtree(root: ParentNode): void {
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType === Node.COMMENT_NODE) {
            node.remove();
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        if (BLOCKED_PLUGIN_TAGS.has(tag)) {
            element.remove();
            continue;
        }

        for (const attr of Array.from(element.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'style') {
                element.removeAttribute(attr.name);
                continue;
            }
            if (URL_PLUGIN_ATTRS.has(name) && !isSafePluginUrl(attr.value)) {
                element.removeAttribute(attr.name);
            }
        }

        sanitizePluginSubtree(element);
    }
}

/** Parses plugin HTML and strips unsafe markup before insertion. */
function parseSanitizedPluginElement(html: string): HTMLElement | null {
    const template = document.createElement('template');
    template.innerHTML = String(html || '').trim();
    sanitizePluginSubtree(template.content);
    const node = template.content.firstElementChild;
    return node instanceof HTMLElement ? node : null;
}

/** Returns whether a value looks like a plugin modal definition. */
function isPluginModalDefinition(value: unknown): value is PluginModalDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const modal = value as Partial<PluginModalDefinition>;
    return typeof modal.title === 'string' && Array.isArray(modal.content);
}

/** Creates a stable DOM id for one plugin modal. */
function pluginModalId(pluginId: string): string {
    const safe = String(pluginId || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    return `plugin-modal-${safe || 'plugin'}`;
}

/** Collects field values from a plugin modal body. */
function collectPluginModalPayload(modal: HTMLElement): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-plugin-field]')
        .forEach((field) => {
            const key = String(field.getAttribute('data-plugin-field') || '').trim();
            if (!key) return;
            if (field instanceof HTMLInputElement && field.type === 'checkbox') {
                payload[key] = field.checked;
                return;
            }
            payload[key] = field.value;
        });
    return payload;
}

/** Returns the modal element for one plugin id, creating it if needed. */
function ensurePluginModalElement(pluginId: string): HTMLElement | null {
    const root = document.getElementById('modals-root');
    if (!root) return null;

    const id = pluginModalId(pluginId);
    let modal = document.getElementById(id) as HTMLElement | null;
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = id;
    modal.dataset.pluginId = pluginId;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="backdrop" data-close></div>
      <div class="dialog sheet" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="sheet-head">
          <h3 id="${id}-title" style="margin:0"></h3>
          <button class="icon close" data-close aria-label="Close">✕</button>
        </div>
        <section class="sheet-body" style="display:grid; gap:.8rem;"></section>
      </div>
    `;
    root.appendChild(modal);
    return modal;
}

/** Returns a CSS justify-content value for one alignment hint. */
function alignToJustifyContent(align?: PluginModalAlign): string {
    if (align === 'centered') return 'center';
    if (align === 'right') return 'flex-end';
    return 'flex-start';
}

/** Appends one modal button inside an optional centered row wrapper. */
function appendModalButton(
    parent: HTMLElement,
    button: HTMLButtonElement,
    align?: PluginModalAlign,
    wrapInRow = false,
): void {
    if (!wrapInRow) {
        parent.appendChild(button);
        return;
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '.5rem';
    row.style.justifyContent = alignToJustifyContent(align);
    row.appendChild(button);
    parent.appendChild(row);
}

/** Builds one plugin modal button element. */
function createModalButton(pluginId: string, modalId: string, buttonDef: PluginModalButtonDefinition): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tbtn';
    if (buttonDef.variant === 'primary') button.classList.add('primary');
    if (buttonDef.variant === 'danger') button.classList.add('danger');
    button.textContent = buttonDef.content;
    if (buttonDef.title) button.title = buttonDef.title;
    button.dataset.pluginAction = String(buttonDef.id || '').trim();
    button.dataset.pluginId = pluginId;
    button.dataset.pluginModal = modalId;
    if (buttonDef.payload) {
        button.dataset.pluginPayload = JSON.stringify(buttonDef.payload);
    }
    return button;
}

/** Renders one nested plugin modal content item. */
function renderPluginModalItem(
    pluginId: string,
    modal: HTMLElement,
    parent: HTMLElement,
    item: PluginModalContentItem,
    topLevel = false,
): void {
    const body = parent;

    if (item.type === 'text') {
        const block = document.createElement('div');
        block.textContent = String(item.content || '');
        if (item.title) block.title = item.title;
        block.style.textAlign = item.align === 'centered' ? 'center' : item.align === 'right' ? 'right' : 'left';
        body.appendChild(block);
        return;
    }

    if (item.type === 'separator') {
        const rule = document.createElement('hr');
        rule.style.width = '100%';
        body.appendChild(rule);
        return;
    }

    if (item.type === 'horizontal-box') {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexWrap = item.wrap === false ? 'nowrap' : 'wrap';
        wrap.style.gap = item.gap || '.5rem';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = alignToJustifyContent(item.align);
        body.appendChild(wrap);
        for (const child of Array.isArray(item.content) ? item.content : []) {
            renderPluginModalItem(pluginId, modal, wrap, child, false);
        }
        return;
    }

    if (item.type === 'vertical-box') {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gap = item.gap || '.75rem';
        body.appendChild(wrap);
        for (const child of Array.isArray(item.content) ? item.content : []) {
            renderPluginModalItem(pluginId, modal, wrap, child, false);
        }
        return;
    }

    if (item.type === 'grid') {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gridTemplateColumns = String(item.columns || '').trim() || '1fr';
        wrap.style.gap = item.gap || '.75rem';
        body.appendChild(wrap);
        for (const child of Array.isArray(item.content) ? item.content : []) {
            renderPluginModalItem(pluginId, modal, wrap, child, false);
        }
        return;
    }

    if (item.type === 'input') {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        const label = document.createElement('label');
        label.textContent = item.label;
        label.htmlFor = `${modal.id}-${item.id}`;
        const input = document.createElement('input');
        input.id = `${modal.id}-${item.id}`;
        input.dataset.pluginField = item.id;
        input.type = item.kind || 'text';
        if (item.value !== undefined) input.value = item.value;
        if (item.placeholder) input.placeholder = item.placeholder;
        if (item.required) input.required = true;
        wrap.appendChild(label);
        wrap.appendChild(input);
        body.appendChild(wrap);
        return;
    }

    if (item.type === 'select') {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        const label = document.createElement('label');
        label.textContent = item.label;
        label.htmlFor = `${modal.id}-${item.id}`;
        const select = document.createElement('select');
        select.id = `${modal.id}-${item.id}`;
        select.dataset.pluginField = item.id;
        const selectedValue = item.value;
        for (const option of Array.isArray(item.options) ? item.options : []) {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            if (selectedValue !== undefined) {
                opt.selected = option.value === selectedValue;
            } else if (option.selected) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }
        wrap.appendChild(label);
        wrap.appendChild(select);
        body.appendChild(wrap);
        return;
    }

    if (item.type === 'list') {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        if (item.label) {
            const label = document.createElement('div');
            label.className = 'meta';
            label.textContent = item.label;
            wrap.appendChild(label);
        }
        const items = Array.isArray(item.items) ? item.items : [];
        if (items.length === 0 && item.emptyText) {
            const empty = document.createElement('div');
            empty.className = 'meta';
            empty.textContent = item.emptyText;
            wrap.appendChild(empty);
        }
        for (const row of items) {
            const card = document.createElement('div');
            card.style.display = 'grid';
            card.style.gap = '.5rem';
            card.style.padding = '.6rem';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = '8px';

            const titleRow = document.createElement('div');
            titleRow.style.display = 'grid';
            titleRow.style.gap = '.2rem';
            const rowTitle = document.createElement('div');
            rowTitle.style.fontWeight = '600';
            rowTitle.textContent = row.title;
            titleRow.appendChild(rowTitle);
            if (row.meta) {
                const meta = document.createElement('div');
                meta.className = 'meta';
                meta.textContent = row.meta;
                titleRow.appendChild(meta);
            }
            if (row.description) {
                const desc = document.createElement('div');
                desc.textContent = row.description;
                titleRow.appendChild(desc);
            }
            if (row.status) {
                const status = document.createElement('div');
                status.className = 'meta';
                status.textContent = row.status;
                titleRow.appendChild(status);
            }
            card.appendChild(titleRow);

            const rowActions = document.createElement('div');
            rowActions.style.display = 'flex';
            rowActions.style.flexWrap = 'wrap';
            rowActions.style.gap = '.5rem';
            for (const action of Array.isArray(row.actions) ? row.actions : []) {
                rowActions.appendChild(createModalButton(pluginId, modal.id, action));
            }
            card.appendChild(rowActions);
            wrap.appendChild(card);
        }
        body.appendChild(wrap);
        return;
    }

    if (item.type === 'button' || typeof (item as PluginModalButtonDefinition).content === 'string') {
        appendModalButton(body, createModalButton(pluginId, modal.id, item as PluginModalButtonDefinition), item.align, topLevel);
    }
}

/** Renders one plugin modal definition into the DOM. */
function renderPluginModal(pluginId: string, definition: PluginModalDefinition): void {
    const modal = ensurePluginModalElement(pluginId);
    if (!modal) return;

    const title = modal.querySelector<HTMLElement>(`#${escapeCssSelector(modal.id)}-title`);
    const body = modal.querySelector<HTMLElement>('.sheet-body');
    if (!title || !body) return;

    title.textContent = String(definition.title || '').trim() || 'Plugin';
    body.replaceChildren();

    for (const item of Array.isArray(definition.content) ? definition.content : []) {
        if (!item) continue;
        renderPluginModalItem(pluginId, modal, body, item, true);
    }

    openModal(modal.id);
}

/** Handles a plugin action result and opens plugin modals when returned. */
export function handlePluginActionResult(pluginId: string, result: unknown): void {
    if (isPluginModalDefinition(result)) {
        renderPluginModal(pluginId, result);
    }
}

/** Invokes one plugin action and opens returned plugin modals. */
export async function invokePluginAction(
    pluginId: string,
    actionId: string,
    payload?: Record<string, unknown>,
): Promise<unknown> {
    const result = await TAURI.invoke<unknown>('invoke_plugin_action', {
        pluginId,
        actionId,
        payload: payload ?? null,
    });
    handlePluginActionResult(pluginId, result);
    return result;
}

/** Wires plugin modal button clicks to the host action bridge once. */
function wirePluginModalActions(): void {
    if (pluginModalActionWired) return;
    pluginModalActionWired = true;

    document.addEventListener('click', async (event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
            '.modal[data-plugin-id] button[data-plugin-action][data-plugin-id]',
        );
        if (!target) return;

        const pluginId = String(target.dataset.pluginId || '').trim();
        const actionId = String(target.dataset.pluginAction || '').trim();
        if (!pluginId || !actionId) return;

        const modal = target.closest<HTMLElement>('.modal[data-plugin-id]');
        const payload = modal ? collectPluginModalPayload(modal) : {};
        const extra = target.dataset.pluginPayload;
        if (extra) {
            try {
                Object.assign(payload, JSON.parse(extra) as Record<string, unknown>);
            } catch {
                // Ignore malformed payload hints and continue with collected fields.
            }
        }

        event.preventDefault();
        event.stopPropagation();

        try {
            await invokePluginAction(pluginId, actionId, payload);
        } catch (err) {
            console.error(`Plugin modal action failed (${pluginId}/${actionId})`, err);
            notify('Plugin action failed');
        }
    });
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
            const existingNav = nav.querySelector<HTMLElement>(`[data-section="${escapeCssSelector(id)}"]`);
            const existingPanel = panelsScroll.querySelector<HTMLElement>(`.panel-form[data-panel="${escapeCssSelector(id)}"]`);
            if (existingNav && existingPanel) continue;

            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.setAttribute('data-section', id);
            btn.textContent = label;
            li.appendChild(btn);

            const panel = parseSanitizedPluginElement(html);
            if (!panel) continue;

            if (!panel.classList.contains('panel-form')) panel.classList.add('panel-form');
            if (!panel.getAttribute('data-panel')) panel.setAttribute('data-panel', id);
            panel.classList.add('hidden');

            const before = String(section?.before || '').trim();
            const after = String(section?.after || '').trim();
            const beforeBtn = before ? nav.querySelector<HTMLElement>(`[data-section="${escapeCssSelector(before)}"]`) : null;
            const afterBtn = after ? nav.querySelector<HTMLElement>(`[data-section="${escapeCssSelector(after)}"]`) : null;

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
    wirePluginModalActions();

    ensurePluginsMenuPlaceholder();

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
        if (!isPluginEnabled(summary)) continue;
    }

    ensurePluginsMenuPlaceholder();
}

/** Reloads plugins by resetting and reinitializing the plugin runtime. */
export async function reloadPlugins(): Promise<void> {
    installGlobalApi();
    initialized = false;
    await initPlugins();
}
