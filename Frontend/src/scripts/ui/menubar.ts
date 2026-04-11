// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';

type MenuAction = (id: string, payload?: { pluginId?: string; actionId?: string }) => void | Promise<void>;
const MENU_CLOSE_MS = 130;
const PLUGIN_MENU_ACTION_ID = '__plugin_menu_action__';

interface PluginMenuPayload {
    plugin_id: string;
    id: string;
    label: string;
    elements: Array<{
        type: 'text' | 'button' | string;
        id?: string;
        content?: string;
        label?: string;
    }>;
}

/** Returns the DOM list element for a top-level menubar menu id. */
function getMenuList(menuId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.menu[data-menu="${String(menuId || '').trim()}"] .menu-list`);
}

/** Returns whether a menu already exposes a specific action id. */
function menuHasAction(list: HTMLElement, actionId: string): boolean {
    const target = String(actionId || '').trim();
    if (!target) return false;

    return Array.from(list.querySelectorAll<HTMLElement>('[data-action]')).some((entry) => {
        const existingAction = String(entry.dataset.action || '').trim();
        const existingPluginAction = String(entry.dataset.pluginAction || '').trim();
        return existingAction === target || existingPluginAction === target;
    });
}

/** Removes previously injected plugin menu nodes from the menubar. */
export function clearPluginMenubarMenus(): void {
    document
        .querySelectorAll<HTMLElement>('[data-plugin-menubar="true"]')
        .forEach((node) => node.remove());
}

/** Renders active plugin-contributed menu entries into matching top-level menus. */
export async function refreshPluginMenubarMenus(): Promise<void> {
    clearPluginMenubarMenus();

    if (!TAURI.has) return;

    let menus: PluginMenuPayload[] = [];
    try {
        menus = await TAURI.invoke<PluginMenuPayload[]>('list_plugin_menus');
    } catch {
        return;
    }

    for (const menu of Array.isArray(menus) ? menus : []) {
        const menuId = String(menu?.id || '').trim();
        const list = getMenuList(menuId);
        if (!menuId || !list) continue;

        const entries = Array.isArray(menu.elements) ? menu.elements : [];
        const buttonEntries = entries.filter((entry) => {
            if (String(entry?.type || '').trim() !== 'button') {
                return false;
            }

            const actionId = String(entry?.id || '').trim();
            return !!actionId && !menuHasAction(list, actionId);
        });
        if (buttonEntries.length === 0) continue;

        const separator = document.createElement('div');
        separator.className = 'menu-sep';
        separator.setAttribute('role', 'separator');
        separator.dataset.pluginMenubar = 'true';
        list.appendChild(separator);

        for (const entry of buttonEntries) {
            const actionId = String(entry?.id || '').trim();
            const label = String(entry?.label || '').trim();
            if (!actionId || !label) continue;

            const button = document.createElement('button');
            button.className = 'menu-item';
            button.setAttribute('role', 'menuitem');
            button.dataset.action = PLUGIN_MENU_ACTION_ID;
            button.dataset.pluginId = String(menu.plugin_id || '').trim();
            button.dataset.pluginAction = actionId;
            button.dataset.pluginMenubar = 'true';
            button.textContent = label;
            list.appendChild(button);
        }
    }
}

export function initMenubar(onAction: MenuAction) {
    const root = document.querySelector<HTMLElement>('.menubar');
    if (!root) return;

    let openMenu: HTMLElement | null = null;
    let closeTimer: number | null = null;

    const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const finalizeClose = (menu: HTMLElement) => {
        const trigger = menu.querySelector<HTMLElement>('.menu-trigger');
        const list = menu.querySelector<HTMLElement>('.menu-list');
        trigger?.setAttribute('aria-expanded', 'false');
        if (list) {
            list.classList.remove('is-closing');
            list.setAttribute('hidden', '');
        }
        if (openMenu === menu) openMenu = null;
    };

    const closeMenu = (menu: HTMLElement | null, immediate = false) => {
        if (!menu) return;
        if (closeTimer !== null) {
            window.clearTimeout(closeTimer);
            closeTimer = null;
        }
        const list = menu.querySelector<HTMLElement>('.menu-list');
        if (!list || list.hasAttribute('hidden')) {
            finalizeClose(menu);
            return;
        }
        if (immediate || isReducedMotion()) {
            finalizeClose(menu);
            return;
        }
        list.classList.add('is-closing');
        closeTimer = window.setTimeout(() => {
            finalizeClose(menu);
            closeTimer = null;
        }, MENU_CLOSE_MS);
    };

    const closeMenus = () => {
        closeMenu(openMenu);
    };

    const open = (menu: HTMLElement) => {
        if (closeTimer !== null) {
            window.clearTimeout(closeTimer);
            closeTimer = null;
        }
        if (openMenu && openMenu !== menu) closeMenu(openMenu, true);
        const list = menu.querySelector<HTMLElement>('.menu-list');
        const trigger = menu.querySelector<HTMLElement>('.menu-trigger');
        if (!list || !trigger) return;
        const isOpen = !list.hasAttribute('hidden');
        if (isOpen) {
            const menuName = trigger.textContent || 'menu';
            console.log(`UI: Close ${menuName} menu`);
            closeMenus();
            return;
        }
        const menuName = trigger.textContent || 'menu';
        console.log(`UI: Open ${menuName} menu`);
        list.classList.remove('is-closing');
        list.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        openMenu = menu;
    };

    // Use event delegation so plugin-injected menus work without reinitializing.
    root.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        const item = target.closest<HTMLElement>('.menu-list [data-action]');
        if (item) {
            const id = item.getAttribute('data-action');
            const pluginId = item.dataset.pluginId;
            const pluginAction = item.dataset.pluginAction;
            closeMenus();
            if (id === PLUGIN_MENU_ACTION_ID && pluginId && pluginAction) {
                Promise.resolve(onAction(id, { pluginId, actionId: pluginAction })).catch(() => {});
                return;
            }
            if (id) Promise.resolve(onAction(id)).catch(() => {});
            return;
        }

        const trigger = target.closest<HTMLElement>('.menu-trigger');
        if (!trigger) return;
        const menu = trigger.closest<HTMLElement>('.menu');
        if (!menu) return;
        e.stopPropagation();
        open(menu);
    });

    // mouseenter doesn't bubble; use pointerover for delegation.
    root.addEventListener('pointerover', (e) => {
        const target = e.target as HTMLElement;
        const trigger = target.closest<HTMLElement>('.menu-trigger');
        if (!trigger) return;
        const menu = trigger.closest<HTMLElement>('.menu');
        if (!menu) return;
        if (openMenu && openMenu !== menu) open(menu);
    });

    document.addEventListener('click', (e) => {
        if (openMenu && !openMenu.contains(e.target as Node)) closeMenus();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenus();
    });
}
