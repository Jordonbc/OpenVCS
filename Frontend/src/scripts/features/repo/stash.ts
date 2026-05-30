// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { escapeHtml } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { TAURI } from '../../lib/tauri';
import { confirmBool } from '../../lib/confirm';
import { notify } from '../../lib/notify';
import { state } from '../../state/state';
import { openStashConfirm } from '../stashConfirm';
import { diffEl, diffHeadPath, listEl, countEl, leftFootEl, undoLeftBtn } from './context';
import { highlightRow, selectStashDiff } from './diffView';
import { hydrateStatus, hydrateStash } from './hydrate';

/** Lazily created footer container for stash actions. */
let stashFootEl: HTMLElement | null = null;
/** True once stash footer button handlers are wired. */
let stashFootBound = false;
/** Optional callback used to refresh the stash list. */
let renderListRef: (() => void) | null = null;

/** Minimal stash list item shape used by selection helpers. */
type StashListItem = {
    selector: string;
    msg?: string;
    meta?: string;
};

/** Registers a list render callback used after stash mutations. */
export function setRenderListRef(fn: () => void) {
    renderListRef = fn;
}

/** Renders stash entries filtered by the provided query. */
export function renderStashList(query: string): boolean {
    const list = listEl;
    const count = countEl;
    const head = diffHeadPath;
    const diff = diffEl;
    if (!list || !count || !head || !diff) return false;
    list.innerHTML = '';
    const stash = ((state as any).stash || []) as any[];
    const items = stash.filter((s) => !query || (s.msg || '').toLowerCase().includes(query) || (s.selector || '').includes(query));
    count.textContent = `${items.length} stash${items.length === 1 ? '' : 'es'}`;
    list.classList.toggle('empty-state', !items.length);

    /** Enables or disables footer action buttons for stash operations. */
    const enableActionButtons = (enabled: boolean) => {
        const a = document.querySelector<HTMLButtonElement>('#stash-apply-btn'); if (a) a.disabled = !enabled;
        const p = document.querySelector<HTMLButtonElement>('#stash-pop-btn'); if (p) p.disabled = !enabled;
        const d = document.querySelector<HTMLButtonElement>('#stash-drop-btn'); if (d) d.disabled = !enabled;
    };

    if (!items.length) {
        list.innerHTML = '<li class="empty-state-message" aria-disabled="true"><div class="file">No stashes.</div></li>';
        head.textContent = 'Stash details';
        diff.innerHTML = '';
        enableActionButtons(false);
        return true;
    }

    items.forEach((s: any, i: number) => {
        const li = document.createElement('li');
        li.className = 'row commit';
        const sel = s.selector || '';
        const exact = (s.meta || '').trim();
        li.dataset.selector = sel;
        li.innerHTML = `
        <div class="file" title="${escapeHtml(s.msg || '')}">${escapeHtml(s.msg || '(no message)')}</div>
        <span class="badge time" title="${escapeHtml(exact)}">${escapeHtml(exact)}</span>`;
        li.addEventListener('click', () => selectStash(s, i));
        li.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            state.currentStash = sel;
            enableActionButtons(true);
            const mev = ev as MouseEvent;
            const x = mev.clientX, y = mev.clientY;
            const target = sel;
            const items: CtxItem[] = [];
            items.push({ label: 'Apply stash', action: async () => {
                try {
                    await TAURI.invoke('vcs_stash_apply', { selector: target });
                    notify('Applied stash');
                    await Promise.allSettled([hydrateStatus(), hydrateStash()]);
                    renderListRef?.();
                } catch (e) { console.error('Failed to apply stash:', e); notify('Failed to apply stash'); }
            }});
            items.push({ label: 'Delete stash', action: async () => {
                const ok = await confirmBool(`Delete ${target}? This cannot be undone.`);
                if (!ok) return;
                try {
                    await TAURI.invoke('vcs_stash_drop', { selector: target });
                    notify('Deleted stash');
                    if (state.currentStash === target) state.currentStash = '';
                    await Promise.allSettled([hydrateStash()]);
                    renderListRef?.();
                } catch (e) { console.error('Failed to delete stash:', e); notify('Failed to delete stash'); }
            }});
            buildCtxMenu(items, x, y);
        });
        list.appendChild(li);
    });
    selectStash(items[0], 0);
    return true;
}

/** Selects a stash entry and loads its diff preview. */
export async function selectStash(item: StashListItem, index: number) {
    if (!diffHeadPath || !diffEl) return;
    highlightRow(index);
    state.currentStash = item.selector;
    const title = (item.msg || '').trim();
    diffHeadPath.textContent = title || item.selector;
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    try {
        await selectStashDiff(item.selector);
        const a = document.querySelector<HTMLButtonElement>('#stash-apply-btn'); if (a) a.disabled = false;
        const p = document.querySelector<HTMLButtonElement>('#stash-pop-btn'); if (p) p.disabled = false;
        const d = document.querySelector<HTMLButtonElement>('#stash-drop-btn'); if (d) d.disabled = false;
    } catch (e) {
        console.warn('vcs_stash_show failed', e);
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load stash diff</div></div></div>';
    }
}

/** Shows the stash-specific footer controls and hides undo UI. */
export function showStashFooter() {
    if (!leftFootEl) return;
    const foot = ensureStashFooterControls();
    if (!foot) return;
    leftFootEl.dataset.mode = 'stash';
    leftFootEl.classList.add('show');
    if (undoLeftBtn) undoLeftBtn.style.display = 'none';
    foot.classList.add('show');
}

/** Hides stash footer controls and restores default footer state. */
export function hideStashFooter() {
    if (!leftFootEl) return;
    if (leftFootEl.dataset.mode === 'stash') {
        leftFootEl.classList.remove('show');
        leftFootEl.dataset.mode = '';
    }
    if (undoLeftBtn) undoLeftBtn.style.display = '';
    if (stashFootEl) stashFootEl.classList.remove('show');
}

/** Returns the currently active stash selector from state or list row. */
export function getActiveStashSelector(): string {
    if (state.currentStash) return state.currentStash;
    const active = listEl?.querySelector<HTMLElement>('li.row.commit.active');
    const sel = active?.dataset.selector || '';
    if (sel) state.currentStash = sel;
    return sel;
}

/** Creates stash footer controls on demand and wires handlers once. */
function ensureStashFooterControls(): HTMLElement | null {
    if (!leftFootEl) return null;
    if (!stashFootEl) {
        stashFootEl = document.createElement('div');
        stashFootEl.id = 'stash-foot-controls';
        stashFootEl.className = 'stash-foot';
        stashFootEl.innerHTML = `
          <button class="btn" id="stash-create-btn" title="Stash current changes">Create Stash</button>
          <button class="btn" id="stash-apply-btn" disabled>Apply</button>
          <button class="btn" id="stash-pop-btn" disabled>Pop</button>
          <button class="btn" id="stash-drop-btn" disabled>Drop</button>
        `;
        leftFootEl.appendChild(stashFootEl);
    }
    if (!stashFootBound && stashFootEl) {
        wireStashFooterButtons(stashFootEl);
        stashFootBound = true;
    }
    return stashFootEl;
}

/** Binds click handlers for create/apply/pop/drop stash actions. */
function wireStashFooterButtons(container: HTMLElement) {
    const createBtn = container.querySelector<HTMLButtonElement>('#stash-create-btn');
    createBtn?.addEventListener('click', () => {
        openStashConfirm({
            onSuccess: async () => {
                await Promise.allSettled([hydrateStatus(), hydrateStash()]);
                renderListRef?.();
            },
        });
    });

    const applyBtn = container.querySelector<HTMLButtonElement>('#stash-apply-btn');
    applyBtn?.addEventListener('click', async () => {
        const selector = getActiveStashSelector();
        if (!selector) return;
        try {
            await TAURI.invoke('vcs_stash_apply', { selector });
            notify('Applied stash');
            await Promise.allSettled([hydrateStatus(), hydrateStash()]);
            renderListRef?.();
        } catch (e) { console.error('vcs_stash_apply failed:', e); notify('Failed to apply stash'); }
    });

    const popBtn = container.querySelector<HTMLButtonElement>('#stash-pop-btn');
    popBtn?.addEventListener('click', async () => {
        const selector = getActiveStashSelector();
        if (!selector) return;
        try {
            await TAURI.invoke('vcs_stash_pop', { selector });
            notify('Popped stash');
            await Promise.allSettled([hydrateStatus(), hydrateStash()]);
            renderListRef?.();
        } catch (e) { console.error('vcs_stash_pop failed:', e); notify('Failed to pop stash'); }
    });

    const dropBtn = container.querySelector<HTMLButtonElement>('#stash-drop-btn');
    dropBtn?.addEventListener('click', async () => {
        const selector = getActiveStashSelector();
        if (!selector) return;
        const ok = await confirmBool(`Drop ${selector}? This cannot be undone.`);
        if (!ok) return;
        try {
            await TAURI.invoke('vcs_stash_drop', { selector });
            notify('Dropped stash');
            state.currentStash = '';
            await Promise.allSettled([hydrateStash()]);
            renderListRef?.();
        } catch (e) { console.error('vcs_stash_drop failed:', e); notify('Failed to drop stash'); }
    });
}
