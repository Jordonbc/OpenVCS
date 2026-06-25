// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/repoSwitchDrawer.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { hydrate, openModal, closeModal } from '../ui/modals';

type Recent = { path: string; name?: string; backend?: string };

let drawerRoot: HTMLElement | null = null;
let drawerDialog: HTMLDivElement | null = null;
let recentList: HTMLElement | null = null;
let filterInput: HTMLInputElement | null = null;
let addTrigger: HTMLButtonElement | null = null;
let allRecents: Recent[] = [];
let closeTimer: number | null = null;

const resizeHandler = () => positionDrawer();

let openCloneSheet = () => {};

function ensureDrawer() {
    if (drawerRoot) return;
    hydrate('repo-switch-drawer');
    drawerRoot = document.getElementById('repo-switch-drawer');
    if (!drawerRoot) return;

    drawerDialog = drawerRoot.querySelector<HTMLDivElement>('.dialog.drawer');
    recentList = drawerRoot.querySelector<HTMLElement>('#drawer-recent-list');
    filterInput = drawerRoot.querySelector<HTMLInputElement>('#drawer-filter');
    addTrigger = drawerRoot.querySelector<HTMLButtonElement>('#drawer-add-trigger');
    addTrigger?.addEventListener('click', () => {
        closeSwitchDrawer();
        openCloneSheet();
    });

    filterInput?.addEventListener('input', () => renderRecents());
}

function positionDrawer() {
    if (!drawerDialog) return;
    const anchor = document.getElementById('repo-switch');
    const rect = anchor?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const margin = 8;
    const width = drawerDialog.offsetWidth || 320;
    const height = drawerDialog.offsetHeight || 0;
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let left = (rect?.left ?? margin) + scrollX;
    const maxLeft = viewportWidth - width - margin;
    left = Math.min(Math.max(margin + scrollX, left), Math.max(margin + scrollX, maxLeft));

    let top = (rect ? rect.bottom : 60) + scrollY + 4;
    const maxTop = viewportHeight - height - margin;
    if (top > maxTop) top = Math.max(margin + scrollY, maxTop);

    drawerDialog.style.left = `${left}px`;
    drawerDialog.style.top = `${top}px`;
}

function escapeHTML(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function filteredRecents(): Recent[] {
    const term = (filterInput?.value || '').trim().toLowerCase();
    if (!term) return allRecents;
    return allRecents.filter((item) => {
        const name = (item.name || item.path.split(/[\\/]/).pop() || item.path).toLowerCase();
        const path = item.path.toLowerCase();
        return name.includes(term) || path.includes(term);
    });
}

function renderRecents() {
    if (!recentList) return;
    const items = filteredRecents();
    if (items.length === 0) {
        recentList.innerHTML = `<li class="empty" aria-disabled="true">No matching repositories</li>`;
        return;
    }

    recentList.innerHTML = items
        .map((item) => {
            const base = item.name || item.path.split(/[\\/]/).pop() || item.path;
            const label = escapeHTML(base);
            const escapedPath = escapeHTML(item.path);
            const backendAttr = item.backend ? ` data-backend="${escapeHTML(item.backend)}"` : "";
            return `
                <li data-path="${escapedPath}"${backendAttr} tabindex="0" role="button" aria-label="Open ${label}">
                    <span class="repo-icon" aria-hidden="true">▣</span>
                    <div class="repo-main">
                        <strong>${label}</strong>
                        <div class="path" title="${escapedPath}">${escapedPath}</div>
                    </div>
                </li>
            `;
        })
        .join('');
}

async function openRecent(path: string, backend?: string) {
    const args: Record<string, unknown> = { path };
    if (backend) args.backendId = backend;
    try {
        await TAURI.invoke('open_repo', args);
        closeSwitchDrawer();
    } catch {
        notify('Open failed');
    }
}

async function loadRecents() {
    if (!recentList) return;
    try {
        let raw: unknown = [];
        raw = await TAURI.invoke<any[]>('list_recent_repos').catch(() => []);

        allRecents = Array.isArray(raw)
            ? raw
                  .filter((r: any): r is Recent => !!r && typeof r === 'object' && typeof r.path === 'string' && r.path.trim() !== '')
                  .map((r: any) => ({
                      path: r.path.trim(),
                      name: typeof r.name === 'string' ? r.name.trim() : undefined,
                      backend: typeof r.backend === 'string' ? r.backend.trim() : undefined,
                  }))
            : [];

        renderRecents();

        recentList.onclick = async (event) => {
            const row = (event.target as HTMLElement)?.closest<HTMLElement>('li[data-path]');
            const path = row?.dataset.path?.trim();
            if (!path) return;
            const backend = row?.dataset.backend?.trim() || undefined;
            await openRecent(path, backend);
        };

        recentList.onkeydown = async (event) => {
            const keyEvent = event as KeyboardEvent;
            if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
            const row = (event.target as HTMLElement)?.closest<HTMLElement>('li[data-path]');
            const path = row?.dataset.path?.trim();
            if (!path) return;
            const backend = row?.dataset.backend?.trim() || undefined;
            keyEvent.preventDefault();
            await openRecent(path, backend);
        };
    } catch {
        allRecents = [];
        recentList.innerHTML = `<li class="empty" aria-disabled="true">No recent repositories</li>`;
    }
}

export function registerDrawerActions(actions: { openClone: () => void; openAdd: () => void }) {
    openCloneSheet = actions.openClone;
    void actions.openAdd;
}

export function openSwitchDrawer() {
    ensureDrawer();
    if (!drawerRoot) return;
    if (closeTimer !== null) {
        window.clearTimeout(closeTimer);
        closeTimer = null;
    }
    drawerRoot.classList.remove('is-closing');
    openModal('repo-switch-drawer');
    if (filterInput) filterInput.value = '';
    loadRecents();
    positionDrawer();
    window.addEventListener('resize', resizeHandler);
}

export function closeSwitchDrawer() {
    if (!drawerRoot) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shouldAnimate = !reduceMotion;
    if (!shouldAnimate) {
        closeModal('repo-switch-drawer');
        window.removeEventListener('resize', resizeHandler);
        return;
    }
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    drawerRoot.classList.add('is-closing');
    closeTimer = window.setTimeout(() => {
        drawerRoot?.classList.remove('is-closing');
        closeModal('repo-switch-drawer');
        window.removeEventListener('resize', resizeHandler);
        closeTimer = null;
    }, 130);
}
