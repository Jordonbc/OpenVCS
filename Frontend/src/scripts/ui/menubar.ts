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
