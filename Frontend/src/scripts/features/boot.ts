// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/boot.ts
// Frontend bootstrap: settings, theming, UI bindings, initial hydration, menubar,
// and wiring of the feature modules (backend events, head poll, fetch popover).
// Extracted from main.ts (single-responsibility module).

import { TAURI, assertDesktopRuntime } from '../lib/tauri';
import type { GlobalSettings } from '../types';
import { qs } from '../lib/dom';
import { syncFrontendMonitoring } from '../lib/monitoring';
import { destroyOverlayScrollbarsFor, initOverlayScrollbarsFor } from '../lib/scrollbars';
import { prefs, setGlobalSettings } from '../state/state';
import {
    applyCommitSummaryRestriction, applyGpuAccelerationPreference, bindLayoutActionState, bindTabs,
    initResizer, refreshRepoActions, setRepoHeader, setTab, setTheme
} from '../ui/layout';
import { initMenubar, refreshPluginMenubarMenus } from '../ui/menubar';
import { bindCommandSheet, openSheet } from './commandSheet';
import { bindFilter, bindRepoHotkeys, hydrateSnapshot, renderList, wireRenderListCallbacks } from './repo';
import { bindBranchUI } from './branches';
import { bindCommit } from './diff';
import { applyAnimationPreference } from './settings';
import { openSwitchDrawer, registerDrawerActions } from './repoSwitchDrawer';
import { initSshHostkeyPrompt } from './sshHostkey';
import { initSshAuthPrompt } from './sshAuth';
import { initOutputLogViewIfRequested } from './outputLog';
import { DEFAULT_LIGHT_THEME_ID, refreshAvailableThemes, selectThemePack } from '../themes';
import { initPlugins } from '../plugins';
import { applyAppearanceCssVars } from '../lib/cssVars';
import { defaultFetchAction, updateFetchUI } from './fetchActions';
import { runMenuAction } from './menuDispatcher';
import { bindBackendEvents } from './repoEvents';
import { bindHeadPoll } from './headPoll';
import { bindFetchPopover } from './fetchPopover';

const commitBtn = qs<HTMLButtonElement>('#commit-btn');

let pluginMenuRefreshTimer: number | null = null;
/** Gives repo-open plugin state time to settle before rebuilding contributed menubar items. */
const PLUGIN_MENU_REFRESH_SETTLE_MS = 400;

/** Schedules a delayed plugin menubar refresh to avoid repo-open races while plugin state settles. */
function schedulePluginMenuRefresh(delayMs = 250) {
    if (pluginMenuRefreshTimer !== null) {
        window.clearTimeout(pluginMenuRefreshTimer);
    }
    pluginMenuRefreshTimer = window.setTimeout(() => {
        pluginMenuRefreshTimer = null;
        refreshPluginMenubarMenus().catch((err) => console.warn('Plugin menu refresh failed:', err));
    }, delayMs);
}

/** Boots the frontend shell, wires handlers, and hydrates initial state. */
async function boot() {
    assertDesktopRuntime();
    const cfg = await loadInitialGlobalSettings();
    setGlobalSettings(cfg ?? null);
    await syncFrontendMonitoring(cfg);

    // If launched as the Output Log window, render that view and skip the main app UI.
    if (await initOutputLogViewIfRequested()) return;
    initOverlayScrollbarsFor(document);
    destroyOverlayScrollbarsFor('.diff-scroll');
    await initPlugins();
    // theme & basic layout
    // Prefer native settings for theme; fall back to current in-memory default
    if (cfg) {
        (async () => {
            try {
                const themeMode = cfg?.general?.theme as ('dark'|'light'|'system'|undefined);
                const modeForPack = themeMode ?? 'system';
                const themePack = String(cfg?.general?.theme_pack || DEFAULT_LIGHT_THEME_ID);
                try { await refreshAvailableThemes(); } catch { /* best effort */ }
                try {
                    await selectThemePack(themePack, { silent: true, mode: modeForPack });
                } catch {
                    await selectThemePack(DEFAULT_LIGHT_THEME_ID, { silent: true, mode: modeForPack });
                }
                setTheme(themeMode || prefs.theme);
                try {
                    applyAppearanceCssVars({
                        tabWidth: cfg?.diff?.tab_width,
                        uiScale: cfg?.ux?.ui_scale,
                        fontMono: cfg?.ux?.font_mono,
                    });
                    applyAnimationPreference(cfg?.performance?.animations);
                    applyGpuAccelerationPreference(cfg?.performance?.gpu_accel);
                    applyCommitSummaryRestriction(cfg?.commit?.restrict_commit_summary !== false);
                } catch { /* best-effort */ }
            } catch {
                try { await selectThemePack(DEFAULT_LIGHT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
                setTheme(prefs.theme);
                applyAnimationPreference(true);
                applyGpuAccelerationPreference(true);
                applyCommitSummaryRestriction(true);
            }
        })();
    } else {
        setTheme(prefs.theme);
        applyAnimationPreference(true);
        applyGpuAccelerationPreference(true);
        applyCommitSummaryRestriction(true);
    }
    wireRenderListCallbacks();
    bindTabs((t) => { setTab(t); renderList(); });
    initResizer();

    // repo interactions
    bindFilter();
    bindCommit();
    bindCommandSheet();
    registerDrawerActions({
        openClone: () => openSheet('clone'),
        openAdd: () => openSheet('add'),
    });
    bindBranchUI();
    bindLayoutActionState();
    bindRepoHotkeys(commitBtn || null, openSwitchDrawer, defaultFetchAction);
    initSshHostkeyPrompt();
    initSshAuthPrompt();

    // initial UI
    setTab(prefs.tab);
    renderList();
    refreshRepoActions();
    updateFetchUI();

    // initial data
    hydrateSnapshot().then(() => setRepoHeader()).catch((err) => console.warn('Failed to hydrate repo snapshot on startup:', err));

    initMenubar(runMenuAction);
    refreshPluginMenubarMenus().catch((err) => console.warn('Plugin menu refresh failed:', err));
    schedulePluginMenuRefresh(PLUGIN_MENU_REFRESH_SETTLE_MS);

    bindBackendEvents();
    bindHeadPoll();
    bindFetchPopover();
}

/** Loads persisted global settings for bootstrap-time features such as theming and monitoring. */
async function loadInitialGlobalSettings(): Promise<GlobalSettings | null> {
    try {
        return await TAURI.invoke<GlobalSettings>('get_global_settings');
    } catch {
        return null;
    }
}

export { boot, loadInitialGlobalSettings };
export { forceCloseTransientUi } from './repoEvents';
export { statusController } from './fetchActions';
