// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { HookHandler, HookName, PluginAction, PluginContextMenuItem, PluginContextMenuTarget, PluginSettingsSection } from './types';
import type { ThemePayload, ThemeSummary } from '../types';

/** Maps action ids to registered handler functions. */
export const actionHandlers = new Map<string, PluginAction>();

/** Groups hook handlers by lifecycle hook name, keyed by plugin id. */
export const hookHandlers = new Map<HookName, Array<{ pluginId: string; handler: HookHandler }>>();

/** Stores registered theme payloads keyed by normalized theme id. */
export const registeredThemePayloads = new Map<string, ThemePayload>();

/** Stores registered theme summaries keyed by normalized theme id. */
export const registeredThemeSummaries = new Map<string, ThemeSummary>();

/** Stores plugin-contributed context menu items grouped by target surface. */
export const contextMenuItems = new Map<PluginContextMenuTarget, PluginContextMenuItem[]>();

/** Stores plugin-provided settings sections grouped by plugin id. */
export const settingsSections = new Map<string, PluginSettingsSection[]>();

/** Whether the plugin system has been initialized. */
export let initialized = false;

/** Sets the initialized flag for the plugin system. */
export function setInitialized(value: boolean): void {
    initialized = value;
}
