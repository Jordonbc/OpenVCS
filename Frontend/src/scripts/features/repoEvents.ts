// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/repoEvents.ts
// Backend event subscriptions (menu, progress, repo selection, status, settings),
// the undo-commit workflow, and transient-UI teardown on repo switch.
// Extracted from main.ts (single-responsibility module).

import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { confirmBool } from '../lib/confirm';
import { setStatus } from '../lib/status';
import { prefillCommitForm } from '../lib/commitForm';
import { clearPluginMenubarMenus, refreshPluginMenubarMenus } from '../ui/menubar';
import { closeAllModals } from '../ui/modals';
import { closeSheet } from './commandSheet';
import { closeSwitchDrawer } from './repoSwitchDrawer';
import { closeFetchPopover, updateFetchUI } from './fetchActions';
import { runMenuAction } from './menuDispatcher';
import { hydrateSnapshot } from './repo';
import { showUpdateDialog } from './update';
import { openSettings } from './settings';
import { openAbout } from './about';
import { openRepoSettings } from './repoSettings';
import { setRepoHeader, refreshRepoActions } from '../ui/layout';

/** Closes transient UI surfaces before a repo switch or hard refresh. */
function forceCloseTransientUi() {
    closeAllModals();
    closeSheet();
    closeSwitchDrawer();
    closeFetchPopover();

    const branchPop = document.getElementById('branch-pop') as HTMLElement | null;
    if (branchPop && !branchPop.hidden) {
        branchPop.classList.remove('is-closing');
        branchPop.hidden = true;
    }
    const branchBtn = document.getElementById('branch-switch') as HTMLButtonElement | null;
    branchBtn?.setAttribute('aria-expanded', 'false');

    // Plugin-contributed modal UIs can close themselves.
    window.dispatchEvent(new CustomEvent('app:repo-will-switch'));
}

/** Undoes the last commit, keeping changes in the working tree (confirm-guarded). */
async function undoCommit() {
    const ok = await confirmBool('Undo last commit? Changes stay in your working tree.');
    if (!ok) return;

    let headMsg = '';
    try {
        const headCommits = await TAURI.invoke<any[]>('vcs_log', { limit: 1 });
        headMsg = String(headCommits?.[0]?.msg || '').trim();
    } catch {}

    const statusEl = document.getElementById('status');
    const setBusy = (msg: string) => {
        if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
    };
    const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
    try {
        setBusy('Undoing…');
        await TAURI.invoke('vcs_undo_since_push', {});
        const summary = headMsg ? headMsg.split('\n')[0].trim() : '';
        notify(summary ? `Undone commit "${summary}" successfully` : 'Undone');
        await hydrateSnapshot(true);
        if (headMsg) prefillCommitForm(headMsg);
    } catch (e) {
        const msg = String(e || '').trim();
        notify(msg ? `Undo failed: ${msg}` : 'Undo failed');
    } finally { clearBusy(); }
}

/** Wires all backend event subscriptions and startup repo-state restoration. */
function bindBackendEvents() {
    TAURI.listen?.('menu', async ({ payload: id }) => {
        const resolved = typeof id === 'string' ? id : String(id ?? '');
        await runMenuAction(resolved);
    });

    // Global busy indicator for any Git activity
    (function(){
        let busyTimer: any = null;
        let busyFrame: number | null = null;
        const setBusy = (msg: string, showSpinner = true) => {
            const s = document.getElementById('status');
            if (!s) return;
            s.textContent = msg || 'Working…';
            if (showSpinner) s.classList.add('busy');
            else s.classList.remove('busy');
            if (busyTimer) clearTimeout(busyTimer);
            // Clear after a short quiet period
            busyTimer = setTimeout(() => {
                s.classList.remove('busy');
                s.textContent = 'Ready';
            }, 1500);
        };
        const queueBusyUpdate = () => {
            if (busyFrame !== null) return;
            busyFrame = window.requestAnimationFrame(() => {
                busyFrame = null;
                const s = document.getElementById('status');
                if (!s) return;
                const current = String(s.textContent || '');
                if (s.classList.contains('busy') && !current.startsWith('Working')) return;
                setBusy('Working…', true);
            });
        };
        TAURI.listen?.('vcs-progress', ({ payload }) => {
            // Don't spam the footer with raw git output; keep it generic.
            void payload;
            // Avoid spinner-driven repaint churn for passive/background progress.
            // Explicit user actions already set busy state via their own controllers.
            queueBusyUpdate();
        });
    })();

    // repo selected -> refresh
    TAURI.listen<string | { path?: string; repoPath?: string; repo?: string; dir?: string }>('repo:selected', async ({ payload }) => {
        const path = typeof payload === 'string'
            ? payload
            : (payload?.path ?? payload?.repoPath ?? payload?.repo ?? payload?.dir ?? '');
        if (path) notify(`Opened ${path}`);
        setRepoHeader(path);
        forceCloseTransientUi();

        await hydrateSnapshot();
        setRepoHeader(path);
        updateFetchUI();

        // Broadcast app-level event so branch UI and actions can sync
        window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path } }));
        refreshRepoActions();
        await refreshPluginMenubarMenus().catch((err) => console.warn('Plugin menu refresh failed:', err));
    });

    // If backend reopened a repo before the webview was ready, sync initial state.
    TAURI.invoke<string | null>('current_repo_path')
        .then(async (p) => {
            const path = (p || '').trim();
            if (!path) return;
            setRepoHeader(path);
            forceCloseTransientUi();
            await hydrateSnapshot();
            setRepoHeader(path);
            window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path } }));
            refreshRepoActions();
            updateFetchUI();
            await refreshPluginMenubarMenus().catch((err) => console.warn('Plugin menu refresh failed:', err));
        })
        .catch((err) => console.warn('Failed to restore initial repository state:', err));

    // backend status updates (footer)
    TAURI.listen?.('status:set', ({ payload }) => {
        setStatus(String(payload ?? ''));
    });

    // update available payload from backend -> open modal with notes
    TAURI.listen?.('ui:update-available', ({ payload }) => {
        showUpdateDialog(payload);
    });

    // open settings via event
    TAURI.listen?.('ui:open-settings', ({ payload }) => {
        const rawSection = payload && typeof payload === 'object' && 'section' in payload
            ? (payload as { section?: unknown }).section
            : undefined;
        const section = typeof payload === 'string'
            ? String(payload)
            : rawSection == null ? undefined : String(rawSection);
        openSettings(section);
    });
    TAURI.listen?.('ui:open-about', () => openAbout());
    TAURI.listen?.('ui:open-repo-settings', () => openRepoSettings());

    // keep Fetch/Pull label in sync with status
    window.addEventListener('app:status-updated', updateFetchUI);
    window.addEventListener('app:branches-updated', updateFetchUI);
    window.addEventListener('app:repo-selected', updateFetchUI);
    window.addEventListener('app:vcs-action-labels-updated', updateFetchUI);
    window.addEventListener('app:repo-will-switch', clearPluginMenubarMenus);
}

export { bindBackendEvents, forceCloseTransientUi, undoCommit };
