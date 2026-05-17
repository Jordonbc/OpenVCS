// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Json, ThemePayload, ThemeSummary } from '../types';

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
export type PluginModalAlign = 'left' | 'centered' | 'right';

/** Describes the visual emphasis supported by plugin modal buttons. */
export type PluginModalButtonVariant = 'default' | 'primary' | 'danger';

/** Describes one plugin modal button definition. */
export interface PluginModalButtonDefinition {
    id: string;
    content: string;
    title?: string;
    variant?: PluginModalButtonVariant;
    align?: PluginModalAlign;
    payload?: Record<string, unknown>;
}

/** Describes one plugin modal text block definition. */
export interface PluginModalTextDefinition {
    type: 'text';
    content: string;
    title?: string;
    align?: PluginModalAlign;
}

/** Describes one plugin modal separator definition. */
export interface PluginModalSeparatorDefinition {
    type: 'separator';
}

/** Describes one plugin modal input definition. */
export interface PluginModalInputDefinition {
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
export interface PluginModalSelectOptionDefinition {
    label: string;
    value: string;
    selected?: boolean;
}

/** Describes one plugin modal select definition. */
export interface PluginModalSelectDefinition {
    type: 'select';
    id: string;
    label: string;
    options: PluginModalSelectOptionDefinition[];
    value?: string;
    align?: PluginModalAlign;
}

/** Describes one plugin modal list row action definition. */
export interface PluginModalListActionDefinition extends PluginModalButtonDefinition {
    type?: 'button';
}

/** Describes one plugin modal list row definition. */
export interface PluginModalListRowDefinition {
    id: string;
    title: string;
    status?: string;
    meta?: string;
    description?: string;
    actions?: PluginModalListActionDefinition[];
}

/** Describes one plugin modal list definition. */
export interface PluginModalListDefinition {
    type: 'list';
    id: string;
    label?: string;
    emptyText?: string;
    align?: PluginModalAlign;
    items: PluginModalListRowDefinition[];
}

/** Describes one horizontal box rendered inside a plugin modal. */
export interface PluginModalHorizontalBoxDefinition {
    type: 'horizontal-box';
    content: PluginModalContentItem[];
    gap?: string;
    align?: PluginModalAlign;
    wrap?: boolean;
}

/** Describes one vertical box rendered inside a plugin modal. */
export interface PluginModalVerticalBoxDefinition {
    type: 'vertical-box';
    content: PluginModalContentItem[];
    gap?: string;
}

/** Describes one grid rendered inside a plugin modal. */
export interface PluginModalGridDefinition {
    type: 'grid';
    content: PluginModalContentItem[];
    columns: string;
    gap?: string;
}

/** Describes one plugin modal content item. */
export type PluginModalContentItem =
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
