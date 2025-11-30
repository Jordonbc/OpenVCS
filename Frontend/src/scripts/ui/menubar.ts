import { qsa } from '../lib/dom';

type MenuAction = (id: string) => void | Promise<void>;

export function initMenubar(onAction: MenuAction) {
    const root = document.querySelector<HTMLElement>('.menubar');
    if (!root) return;

    let openMenu: HTMLElement | null = null;

    const closeMenus = () => {
        openMenu?.querySelector<HTMLElement>('.menu-trigger')?.setAttribute('aria-expanded', 'false');
        openMenu?.querySelector<HTMLElement>('.menu-list')?.setAttribute('hidden', '');
        openMenu = null;
    };

    const open = (menu: HTMLElement) => {
        if (openMenu && openMenu !== menu) closeMenus();
        const list = menu.querySelector<HTMLElement>('.menu-list');
        const trigger = menu.querySelector<HTMLElement>('.menu-trigger');
        if (!list || !trigger) return;
        const isOpen = !list.hasAttribute('hidden');
        if (isOpen) {
            closeMenus();
            return;
        }
        list.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        openMenu = menu;
    };

    qsa<HTMLElement>('.menubar .menu').forEach((menu) => {
        const trigger = menu.querySelector<HTMLElement>('.menu-trigger');
        trigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            open(menu);
        });

        const list = menu.querySelector<HTMLElement>('.menu-list');
        list?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
            if (!btn) return;
            const id = btn.getAttribute('data-action');
            closeMenus();
            if (id) {
                Promise.resolve(onAction(id)).catch(() => {});
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (openMenu && !openMenu.contains(e.target as Node)) closeMenus();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenus();
    });
}

