// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Coordinator barrel — the original public API is now maintained in
// plugins/ submodules. This file re-exports every symbol so existing
// imports from './plugins' continue to work unchanged.

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
} from './plugins/types';

export {
    handlePluginActionResult,
    invokePluginAction,
} from './plugins/modal';

export {
    applyPluginSettingsSections,
    getRegisteredThemeSummaries,
    getRegisteredThemePayload,
    runHook,
    runPluginAction,
    getPluginContextMenuItems,
    initPlugins,
    reloadPlugins,
} from './plugins/runtime';
