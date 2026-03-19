// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
type MenuAction = (id: string) => void | Promise<void>;
const MENU_CLOSE_MS = 130;

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
            closeMenus();
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
