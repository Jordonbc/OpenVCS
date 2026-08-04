// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/fetchActions.ts
// Fetch/Pull/push actions plus the Fetch/Pull popover open/close state.
// Extracted from main.ts (single-responsibility module).

import { TAURI, isTauriRuntimeAvailable } from '../lib/tauri';
import { qs } from '../lib/dom';
import { notify } from '../lib/notify';
import { showError } from './errorModal';
import { resolveVcsActionLabel, state, hasRepo } from '../state/state';
import { refreshOverlayScrollbarsFor } from '../lib/scrollbars';
import { hydrateSnapshot, yieldToPaint } from './repo';
import { runHook } from '../plugins';

// Title bar actions
const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
const fetchCaret = qs<HTMLButtonElement>('#fetch-caret');
const fetchPop = qs<HTMLElement>('#fetch-pop');
const fetchList = qs<HTMLElement>('#fetch-list');
const pushBtn  = qs<HTMLButtonElement>('#push-btn');

let fetchCloseTimer: number | null = null;
/** Matches the fetch popover close animation so the element hides after the transition finishes. */
const FETCH_CLOSE_MS = 130;
let fetchInFlight: Promise<boolean> | null = null;

/** Status-controller shape returned by {@link statusController}. */
export type StatusController = ReturnType<typeof statusController>;

/** Creates a controller bound to the footer status element for busy-state messaging. */
function statusController() {
    const statusEl = document.getElementById('status');
    return {
        setBusy(msg: string) {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        },
        clearBusy() {
            if (statusEl) statusEl.classList.remove('busy');
        }
    };
}

/** Deduplicates concurrent fetch runs so overlapping triggers share one in-flight promise. */
async function runFetch(fn: () => Promise<boolean>) {
    if (fetchInFlight) return fetchInFlight;
    fetchInFlight = fn();
    try { return await fetchInFlight; }
    finally { fetchInFlight = null; }
}

/** Closes the Fetch/Pull popover, optionally with a short close animation. */
function closeFetchPopover() {
    if (!fetchPop || !fetchCaret) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fetchCaret.setAttribute('aria-expanded', 'false');
    if (reduceMotion) {
        fetchPop.hidden = true;
        return;
    }
    if (fetchCloseTimer !== null) window.clearTimeout(fetchCloseTimer);
    fetchPop.classList.add('is-closing');
    fetchCloseTimer = window.setTimeout(() => {
        fetchPop.classList.remove('is-closing');
        fetchPop.hidden = true;
        fetchCloseTimer = null;
    }, FETCH_CLOSE_MS);
}

/** Fetches the current remote only, optionally hydrating and keeping the busy state. */
async function fetchCurrentRemoteOnly(options: { hydrate?: boolean; status?: StatusController; keepBusy?: boolean } = {}) {
    if (!isTauriRuntimeAvailable()) return false;
    return runFetch(async () => {
        const { hydrate = true, status, keepBusy = false } = options;
        const ctl = status ?? statusController();
        let success = false;
        try {
            ctl.setBusy(`${resolveVcsActionLabel('VCS.Fetch', 'Fetch')}…`);
            await TAURI.invoke('vcs_fetch', {});
            notify('Fetched');
            if (hydrate) {
                await yieldToPaint();
                void hydrateSnapshot(true);
            }
            success = true;
        } catch (error) {
            const msg = String(error || '').trim();
            console.error('Fetch failed:', msg);
            showError('Fetch failed', msg || 'Could not fetch from remote. Check your network connection and remote URL.');
        } finally {
            if (!keepBusy) ctl.clearBusy();
        }
        return success;
    });
}

/** Fetches all remotes, toggling the fetching class on the fetch button. */
async function fetchAllRemotesOnly(options: { hydrate?: boolean; status?: StatusController; keepBusy?: boolean } = {}) {
    fetchBtn?.classList.add('fetching');
    try {
        if (!isTauriRuntimeAvailable()) return false;
        return await runFetch(async () => {
            const { hydrate = true, status, keepBusy = false } = options;
            const ctl = status ?? statusController();
            let success = false;
            try {
                ctl.setBusy('Fetching all…');
                await TAURI.invoke('vcs_fetch_all', {});
                notify('Fetched all remotes');
                if (hydrate) {
                    await yieldToPaint();
                    void hydrateSnapshot(true);
                }
                success = true;
            } catch (error) {
                const msg = String(error || '').trim();
                console.error('Fetch all failed:', msg);
                showError('Fetch all failed', msg || 'Could not fetch from remotes. Check your network connection and remote URLs.');
            } finally {
                if (!keepBusy) ctl.clearBusy();
            }
            return success;
        });
    } finally {
        fetchBtn?.classList.remove('fetching');
    }
}

/** Runs a plain fetch of the current remote with a button spinner state. */
async function fetchOnly() {
    fetchBtn?.classList.add('fetching');
    try {
        const ctl = statusController();
        await fetchCurrentRemoteOnly({ status: ctl });
    } finally {
        fetchBtn?.classList.remove('fetching');
    }
}

/** Returns the count of commits the current branch is behind its remote, or 0. */
function getBehindCount(): number {
    const behind = Number(state.behind || 0);
    return isFinite(behind) && behind > 0 ? behind : 0;
}

/** Syncs the Fetch/Pull button label and popover menu items with the current repo state. */
function updateFetchUI() {
    const behind = getBehindCount();
    const repoOn = hasRepo();
    const canPull = repoOn;
    const fetchLabel = resolveVcsActionLabel('VCS.Fetch', 'Fetch');
    const pullLabel = resolveVcsActionLabel('VCS.Pull', 'Pull');
    const mainLabel = behind > 0 ? `${pullLabel} (${behind})` : fetchLabel;
    const mainTitle = behind > 0
        ? `${pullLabel} ${behind} commit${behind === 1 ? '' : 's'} (F5)`
        : `${fetchLabel} (F5)`;

    if (fetchBtn) {
        fetchBtn.textContent = mainLabel;
        fetchBtn.title = mainTitle;
        fetchBtn.setAttribute('aria-label', mainTitle);
    }

    if (!fetchList) return;
    const fetchOnlyItem = fetchList.querySelector<HTMLElement>('li[data-action="fetch-only"]');
    const fetchAllItem = fetchList.querySelector<HTMLElement>('li[data-action="fetch-all"]');
    const pullItem = fetchList.querySelector<HTMLElement>('li[data-action="pull"]');
    if (fetchOnlyItem) {
        fetchOnlyItem.setAttribute('aria-disabled', 'false');
        fetchOnlyItem.tabIndex = 0;
        const name = fetchOnlyItem.querySelector<HTMLElement>('.name');
        if (name) name.textContent = fetchLabel;
    }
    if (fetchAllItem) {
        fetchAllItem.setAttribute('aria-disabled', 'false');
        fetchAllItem.tabIndex = 0;
    }
    if (pullItem) {
        const pullText = behind > 0 ? `${pullLabel} (${behind})` : pullLabel;
        pullItem.setAttribute('aria-disabled', canPull ? 'false' : 'true');
        pullItem.tabIndex = canPull ? 0 : -1;
        const name = pullItem.querySelector<HTMLElement>('.name');
        if (name) name.textContent = pullText;
    }
}

/** Fetches then pulls, hydrating and clearing busy state after the pull finishes. */
async function fetchAndPull() {
    fetchBtn?.classList.add('fetching');
    try {
        const ctl = statusController();
        const fetched = await fetchCurrentRemoteOnly({ hydrate: false, status: ctl, keepBusy: true });
        if (!fetched) { ctl.clearBusy(); return; }

        try {
            ctl.setBusy(`${resolveVcsActionLabel('VCS.Pull', 'Pull')}ing…`);
            const res = await TAURI.invoke<{ pulled: boolean; branch: string; reason?: string | null }>('vcs_pull', {});
            if (res?.pulled) {
                notify('Pulled latest changes');
            } else {
                notify((res?.reason ?? 'No upstream configured for this branch; pull skipped') as string);
            }
        } catch (e) {
            const msg = String(e || '').trim();
            showError('Pull failed', msg || 'Could not pull changes from remote.');
        } finally {
            ctl.clearBusy();
        }

        await hydrateSnapshot(true);
    } finally {
        fetchBtn?.classList.remove('fetching');
    }
}

/** Runs a pull when behind, otherwise a plain fetch. */
async function defaultFetchAction() {
    if (getBehindCount() > 0) await fetchAndPull();
    else await fetchOnly();
}

/** Opens the Fetch/Pull popover anchored to the fetch split button. */
function openFetchPopover() {
    if (!fetchPop || !fetchCaret) return;
    if (fetchCloseTimer !== null) {
        window.clearTimeout(fetchCloseTimer);
        fetchCloseTimer = null;
    }
    const anchor = (document.getElementById('fetch-split') || fetchBtn || fetchCaret) as HTMLElement | null;
    if (!anchor) return;
    updateFetchUI();
    const r = anchor.getBoundingClientRect();
    fetchPop.classList.remove('is-closing');
    fetchPop.hidden = false;
    fetchPop.style.left = `${r.left}px`;
    fetchPop.style.top  = `${r.bottom + 6}px`;
    fetchCaret.setAttribute('aria-expanded', 'true');
    try { refreshOverlayScrollbarsFor(fetchPop); } catch {}

    const firstEnabled = fetchList?.querySelector<HTMLElement>('li[role="menuitem"][aria-disabled="false"]');
    setTimeout(() => firstEnabled?.focus(), 0);
}

/** Pushes the current branch through the pre/on/post push hooks, hydrating on success. */
async function pushChanges() {
    pushBtn?.classList.add('pushing');
    const statusEl = document.getElementById('status');
    const setBusy = (msg: string) => {
        if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
    };
    const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
    try {
        const hookData = { branch: state.branch };
        const pre = await runHook('prePush', hookData);
        if (pre.cancelled) {
            notify(pre.reason || 'Push cancelled');
            return;
        }
        setBusy('Pushing…');
        await yieldToPaint();
        await TAURI.invoke('vcs_push', {});
        await runHook('onPush', hookData);
        notify('Pushed');
        await hydrateSnapshot(true);
        await runHook('postPush', hookData);
    } catch (e) {
        const msg = String(e || '').trim();
        console.error('Push failed:', msg);
        showError('Push failed', msg || 'Could not push to remote. Check your network connection and remote URL.');
    } finally { pushBtn?.classList.remove('pushing'); clearBusy(); }
}

export {
    closeFetchPopover,
    defaultFetchAction,
    fetchAllRemotesOnly,
    fetchAndPull,
    fetchCurrentRemoteOnly,
    fetchOnly,
    getBehindCount,
    openFetchPopover,
    pushChanges,
    runFetch,
    statusController,
    updateFetchUI,
};
