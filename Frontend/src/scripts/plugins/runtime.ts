// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from '../lib/scrollbars';
import { notify } from '../lib/notify';
import type { HookContext, HookName, PluginContextMenuItem, PluginContextMenuTarget } from './types';
import type { ThemePayload, ThemeSummary } from '../types';
import { escapeCssSelector, parseSanitizedPluginElement, normalizeId } from './sanitize';
import {
    actionHandlers,
    hookHandlers,
    registeredThemePayloads,
    registeredThemeSummaries,
    contextMenuItems,
    settingsSections,
    initialized,
    setInitialized,
} from './state';
import {
    trackUiNode,
    ensurePluginsMenuPlaceholder,
    installGlobalApi,
    resetPluginRuntime,
    _setApplyPluginSectionsFallback,
} from './registration';
import { wirePluginModalActions } from './modal';

// ---------------------------------------------------------------------------
// Settings section injection fallback registration
// ---------------------------------------------------------------------------

// Register forward-reference so registration.ts can trigger settings section
// injection without a circular import.
_setApplyPluginSectionsFallback(applyPluginSettingsSections);

// ---------------------------------------------------------------------------
// Settings sections
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Theme queries
// ---------------------------------------------------------------------------

/** Returns registered theme summaries from loaded plugins. */
export function getRegisteredThemeSummaries(): ThemeSummary[] {
    return Array.from(registeredThemeSummaries.values());
}

/** Returns a registered theme payload by id, if available. */
export function getRegisteredThemePayload(id: string): ThemePayload | null {
    const key = normalizeId(id);
    return registeredThemePayloads.get(key) || null;
}

// ---------------------------------------------------------------------------
// Hook execution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Context menu queries
// ---------------------------------------------------------------------------

/** Returns plugin-contributed context menu items for a target surface. */
export function getPluginContextMenuItems(
    target: PluginContextMenuTarget,
): PluginContextMenuItem[] {
    return (contextMenuItems.get(target) || []).slice();
}

// ---------------------------------------------------------------------------
// Init / reload
// ---------------------------------------------------------------------------

/** Loads plugin manifests and installs plugin UI/runtime state. */
export async function initPlugins(): Promise<void> {
    if (initialized) return;
    setInitialized(true);
    installGlobalApi();
    wirePluginModalActions();

    ensurePluginsMenuPlaceholder();

    resetPluginRuntime();
    ensurePluginsMenuPlaceholder();

    ensurePluginsMenuPlaceholder();
}

/** Reloads plugins by resetting and reinitializing the plugin runtime. */
export async function reloadPlugins(): Promise<void> {
    installGlobalApi();
    setInitialized(false);
    await initPlugins();
}
