// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Barrel — re-exports all public plugin API from submodules.

export type {
    PluginSummary,
    PluginPayload,
    HookName,
    HookContext,
    HookHandler,
    PluginAction,
    PluginMenuItem,
    PluginTitleButton,
    PluginSettingsSection,
    PluginMenubarMenu,
    PluginContextMenuTarget,
    PluginContextMenuItem,
    PluginContextMenus,
    PluginRegistration,
    PluginModalDefinition,
} from './types';

export {
    handlePluginActionResult,
    invokePluginAction,
} from './modal';

export {
    applyPluginSettingsSections,
    getRegisteredThemeSummaries,
    getRegisteredThemePayload,
    runHook,
    runPluginAction,
    getPluginContextMenuItems,
    initPlugins,
    reloadPlugins,
} from './runtime';
