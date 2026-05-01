// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import './lib/logger';
import { syncFrontendMonitoring } from './lib/monitoring';
import { TAURI, assertDesktopRuntime, isTauriRuntimeAvailable } from './lib/tauri';
import type { GlobalSettings } from './types';
import { qs } from './lib/dom';
import { notify } from './lib/notify';
import { setStatus } from './lib/status';
import { destroyOverlayScrollbarsFor, initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from './lib/scrollbars';
import { prefs, state, hasRepo, resolveVcsActionLabel } from './state/state';
import {
    bindTabs, initResizer, refreshRepoActions, setRepoHeader, resetRepoHeader, setTab, setTheme,
    bindLayoutActionState
} from './ui/layout';
import { clearPluginMenubarMenus, initMenubar, refreshPluginMenubarMenus } from './ui/menubar';
import { closeAllModals } from './ui/modals';
import { bindCommandSheet, openSheet, closeSheet } from './features/commandSheet';
import { bindRepoHotkeys, bindFilter, renderList, wireRenderListCallbacks, hydrateBranches, hydrateStatus, hydrateCommits, hydrateStash, hydrateVcsActionLabels, yieldToPaint } from './features/repo';
import { bindBranchUI } from './features/branches';
import { bindCommit } from './features/diff';
import { openAbout } from './features/about';
import { applyAnimationPreference, openSettings } from './features/settings';
import { showUpdateDialog } from './features/update';
import { openRepoSettings } from './features/repoSettings';
import { initSshHostkeyPrompt } from './features/sshHostkey';
import { initSshAuthPrompt } from './features/sshAuth';
import { initOutputLogViewIfRequested } from './features/outputLog';
import { DEFAULT_LIGHT_THEME_ID, refreshAvailableThemes, selectThemePack } from './themes';
import { initPlugins, invokePluginAction, runHook, runPluginAction } from './plugins';
import { openSwitchDrawer, closeSwitchDrawer, registerDrawerActions } from './features/repoSwitchDrawer';

const WIKI_URL = 'https://github.com/jordonbc/OpenVCS/wiki';

// Title bar actions
    const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
const fetchCaret = qs<HTMLButtonElement>('#fetch-caret');
const fetchPop = qs<HTMLElement>('#fetch-pop');
const fetchList = qs<HTMLElement>('#fetch-list');
const pushBtn  = qs<HTMLButtonElement>('#push-btn');
const cloneBtn = qs<HTMLButtonElement>('#clone-btn');
const repoSwitch = qs<HTMLButtonElement>('#repo-switch');
const commitBtn = qs<HTMLButtonElement>('#commit-btn');
    const undoLeftBtn = qs<HTMLButtonElement>('#undo-left-btn');
    let fetchCloseTimer: number | null = null;
    let pluginMenuRefreshTimer: number | null = null;
    /** Matches the fetch popover close animation so the element hides after the transition finishes. */
    const FETCH_CLOSE_MS = 130;
    /** Gives repo-open plugin state time to settle before rebuilding contributed menubar items. */
    const PLUGIN_MENU_REFRESH_SETTLE_MS = 400;

    /** Schedules a delayed plugin menubar refresh to avoid repo-open races while plugin state settles. */
    function schedulePluginMenuRefresh(delayMs = 250) {
        if (pluginMenuRefreshTimer !== null) {
            window.clearTimeout(pluginMenuRefreshTimer);
        }
        pluginMenuRefreshTimer = window.setTimeout(() => {
            pluginMenuRefreshTimer = null;
            refreshPluginMenubarMenus().catch(() => {});
        }, delayMs);
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

    // Plugin-contributed modal UIs (e.g. LFS Locks, Submodules) can close themselves.
    window.dispatchEvent(new CustomEvent('app:repo-will-switch'));
}

/** Boots the frontend shell, wires handlers, and hydrates initial state. */
async function boot() {
    assertDesktopRuntime();
    const cfg = await loadInitialGlobalSettings();
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
                    const root = document.documentElement;
                    const tabw = Number(cfg?.diff?.tab_width ?? 4);
                    if (tabw && isFinite(tabw)) root.style.setProperty('--tab-size', String(tabw));
                    const uiScale = Number(cfg?.ux?.ui_scale ?? 1);
                    if (uiScale && isFinite(uiScale)) root.style.setProperty('--ui-scale', String(uiScale));
                    const mono = String(cfg?.ux?.font_mono || '').trim();
                    if (mono) root.style.setProperty('--mono', mono);
                    applyAnimationPreference(cfg?.performance?.animations);
                } catch { /* best-effort */ }
            } catch {
                try { await selectThemePack(DEFAULT_LIGHT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
                setTheme(prefs.theme);
                applyAnimationPreference(true);
            }
        })();
    } else {
        setTheme(prefs.theme);
        applyAnimationPreference(true);
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

    let fetchInFlight: Promise<boolean> | null = null;
    async function runFetch(fn: () => Promise<boolean>) {
        if (fetchInFlight) return fetchInFlight;
        fetchInFlight = fn();
        try { return await fetchInFlight; }
        finally { fetchInFlight = null; }
    }

    async function fetchCurrentRemoteOnly(options: { hydrate?: boolean; status?: ReturnType<typeof statusController>; keepBusy?: boolean } = {}) {
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
                    void Promise.allSettled([hydrateStatus(), hydrateCommits()]);
                }
                success = true;
            } catch {
                notify('Fetch failed');
            } finally {
                if (!keepBusy) ctl.clearBusy();
            }
            return success;
        });
    }

    async function fetchAllRemotesOnly(options: { hydrate?: boolean; status?: ReturnType<typeof statusController>; keepBusy?: boolean } = {}) {
        if (!isTauriRuntimeAvailable()) return false;
        return runFetch(async () => {
            const { hydrate = true, status, keepBusy = false } = options;
            const ctl = status ?? statusController();
            let success = false;
            try {
                ctl.setBusy('Fetching all…');
                await TAURI.invoke('vcs_fetch_all', {});
                notify('Fetched all remotes');
                if (hydrate) {
                    await yieldToPaint();
                    void Promise.allSettled([hydrateStatus(), hydrateCommits()]);
                }
                success = true;
            } catch {
                notify('Fetch all failed');
            } finally {
                if (!keepBusy) ctl.clearBusy();
            }
            return success;
        });
    }

    async function fetchOnly() {
        const ctl = statusController();
        await fetchCurrentRemoteOnly({ status: ctl });
    }

    function getBehindCount(): number {
        const behind = Number((state as any)?.behind || 0);
        return isFinite(behind) && behind > 0 ? behind : 0;
    }

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

    async function fetchAndPull() {
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
        } catch {
            notify('Pull failed');
        } finally {
            ctl.clearBusy();
        }

        await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits(), hydrateStash(), hydrateVcsActionLabels()]);
    }

    async function defaultFetchAction() {
        if (getBehindCount() > 0) await fetchAndPull();
        else await fetchOnly();
    }

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

    async function pushChanges() {
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
            setBusy('Pushing…'); await TAURI.invoke('vcs_push', {});
            await runHook('onPush', hookData);
            notify('Pushed');
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
            await runHook('postPush', hookData);
        } catch (e) { console.error('Push failed:', e); notify('Push failed'); } finally { clearBusy(); }
    }

    async function openDocs() {
        try { await TAURI.invoke('open_docs', {}); } catch { /* fall back */ }
        try { window.open(WIKI_URL, '_blank', 'noopener'); } catch (e) { console.error('Unable to open docs:', e); notify('Unable to open docs'); }
    }

    async function runMenuAction(id?: string | null, payload?: { pluginId?: string; actionId?: string } | null) {
        switch (id) {
            case 'clone_repo': console.log('Action: clone_repo'); openSheet('clone'); break;
            case 'add_repo':   console.log('Action: add_repo'); openSheet('add'); break;
            case 'open_repo':  console.log('Action: open_repo'); openSwitchDrawer(); break;
            case 'fetch': console.log('Action: fetch'); await defaultFetchAction(); break;
            case 'push':  console.log('Action: push'); await pushChanges();  break;
            case 'commit': console.log('Action: commit'); commitBtn?.click(); break;
            case 'docs': console.log('Action: docs'); await openDocs(); break;
            case 'show-output-log':
                console.log('Action: show-output-log');
                try { await TAURI.invoke('open_output_log_window', {}); }
                catch (e) { console.error('Failed to open Output Log:', e); notify('Failed to open Output Log'); }
                break;
            case 'about': console.log('Action: about'); openAbout(); break;
            case 'settings': console.log('Action: settings'); openSettings(); break;
            case 'repo-settings': console.log('Action: repo-settings'); openRepoSettings(); break;
            case 'repo-edit-gitignore':
            case 'repo-edit-gitattributes': {
                console.log('Action:', id);
                const name = id === 'repo-edit-gitignore' ? '.gitignore' : '.gitattributes';
                try { await TAURI.invoke('open_repo_dotfile', { name }); }
                catch (e) { console.error(`Could not open ${name}:`, e); notify(`Could not open ${name}`); }
                break;
            }
            case 'lfs-settings': openSettings('lfs'); break;
            case 'check_updates':
                try {
                    const hasUpdate = await TAURI.invoke<boolean>('check_for_updates', {});
                    if (!hasUpdate) notify('Already up to date');
                } catch (e) { console.error('Update check failed:', e); notify('Update check failed'); }
                break;
            case '__plugin_menu_action__': {
                const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
                const actionId = typeof payload?.actionId === 'string' ? payload.actionId.trim() : '';
                if (!pluginId || !actionId) {
                    console.warn(`Plugin menu action skipped: missing pluginId (${!!pluginId}) or actionId (${!!actionId})`);
                    notify(!pluginId && !actionId
                        ? 'Plugin action is missing plugin and action IDs'
                        : !pluginId
                            ? 'Plugin action missing plugin ID'
                            : `Plugin action missing action for "${pluginId}"`);
                    break;
                }
                try {
                    await invokePluginAction(pluginId, actionId);
                } catch (e) {
                    console.error(`Plugin menu action failed: ${pluginId}/${actionId}`, e);
                    notify(`Plugin action for "${pluginId}" failed`);
                }
                break;
            }
            case 'exit': TAURI.invoke('exit_app', {}).catch(() => {}); break;
            default: {
                if (!id) break;
                const handled = await runPluginAction(id);
                if (!handled) break;
            }
        }
    }

    // title actions
    fetchBtn?.addEventListener('click', () => { defaultFetchAction().catch(() => {}); });
    fetchCaret?.addEventListener('click', (e) => {
        if (!fetchPop) return;
        if (fetchPop.hidden) openFetchPopover(); else closeFetchPopover();
        e.stopPropagation();
    });
    pushBtn?.addEventListener('click', pushChanges);
    cloneBtn?.addEventListener('click', () => openSheet('clone'));
    repoSwitch?.addEventListener('click', () => openSwitchDrawer());
    document.getElementById('plugin-title-actions')?.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]') || null;
        const action = target?.dataset.action || '';
        if (!action) return;
        runMenuAction(action).catch(() => {});
    });

    // No dynamic undo insertion; the inline button lives in the commit panel

    undoLeftBtn?.addEventListener('click', async () => {
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
        try {
            setBusy('Undoing…');
            await TAURI.invoke('vcs_undo_since_push', {});
            notify('Undid unpushed commits');
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        } catch (e) { console.error('Undo failed:', e); notify('Undo failed'); } finally { clearBusy(); }
    });


    // initial UI
    setTab(prefs.tab);
    renderList();
    refreshRepoActions();
    updateFetchUI();

    // initial data
    hydrateBranches().then(() => setRepoHeader());
    hydrateStatus();
    hydrateCommits();
    hydrateStash();

    initMenubar(runMenuAction);
    refreshPluginMenubarMenus().catch(() => {});
    schedulePluginMenuRefresh(PLUGIN_MENU_REFRESH_SETTLE_MS);

    TAURI.listen?.('menu', async ({ payload: id }) => {
        const resolved = typeof id === 'string' ? id : String(id ?? '');
        await runMenuAction(resolved);
    });

    // backend events
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
                const focused = document.visibilityState === 'visible' && document.hasFocus();
                setBusy('Working…', focused);
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

        await hydrateBranches();
        setRepoHeader(path);
        await Promise.allSettled([hydrateStatus(), hydrateCommits(), hydrateVcsActionLabels()]);
        updateFetchUI();

        // Broadcast app-level event so branch UI and actions can sync
        window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path } }));
        refreshRepoActions();
        await refreshPluginMenubarMenus().catch(() => {});
        schedulePluginMenuRefresh();
    });

  // If backend reopened a repo before the webview was ready, sync initial state.
  TAURI.invoke<string | null>('current_repo_path')
      .then(async (p) => {
        const path = (p || '').trim();
        if (!path) return;
        setRepoHeader(path);
        forceCloseTransientUi();
        await hydrateBranches();
        setRepoHeader(path);
        await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path } }));
        refreshRepoActions();
        updateFetchUI();
        await refreshPluginMenubarMenus().catch(() => {});
        schedulePluginMenuRefresh();
      })
      .catch(() => {});

  // backend status updates (footer)
  TAURI.listen?.('status:set', ({ payload }) => {
      try { setStatus(String((payload as any) ?? '')); } catch {}
  });

    // update available payload from backend -> open modal with notes
    TAURI.listen?.('ui:update-available', ({ payload }) => {
        showUpdateDialog(payload);
    });

    // App focus: handle entirely in TS (no backend event)
    let focusInFlight: Promise<void> | null = null;
    async function onFocus() {
        if (focusInFlight) return focusInFlight;
        focusInFlight = (async () => {
        let doFetch = true;
        try {
            const fields = await TAURI.invoke<Array<{ id: string; value: unknown }>>('get_plugin_settings', {
                pluginId: 'openvcs.git',
            });
            const fetchSetting = (Array.isArray(fields) ? fields : []).find((field) => String(field?.id || '').trim() === 'fetch_on_focus');
            if (fetchSetting && typeof fetchSetting.value === 'boolean') {
                doFetch = fetchSetting.value;
            }
        } catch {}
        if (doFetch) {
            await fetchCurrentRemoteOnly({ hydrate: false });
        }
        await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits(), hydrateStash(), hydrateVcsActionLabels()]);
        updateFetchUI();
        })();
        try {
            await focusInFlight;
        } finally {
            focusInFlight = null;
        }
    }

    window.addEventListener('focus', () => { onFocus().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onFocus().catch(() => {});
    });

    // Poll HEAD so external checkouts (CLI/other apps) update the UI while focused.
    // This is intentionally lightweight: only re-hydrate when HEAD changes.
    let headPollInFlight: Promise<void> | null = null;
    let lastHeadKey = '';
    const headPollMs = 15000;
    const scheduleHeadPoll = () => {
        window.setTimeout(async () => {
            if (!isTauriRuntimeAvailable() || !state.hasRepo || document.visibilityState !== 'visible' || !document.hasFocus()) {
                return scheduleHeadPoll();
            }
            if (headPollInFlight) {
                return scheduleHeadPoll();
            }
            headPollInFlight = (async () => {
                try {
                    const head = await TAURI.invoke<{ detached: boolean; branch?: string; commit?: string }>('vcs_head_status');
                    const key = `${head?.detached ? 1 : 0}:${String(head?.branch || '')}:${String(head?.commit || '')}`;
                    if (key === lastHeadKey) return;

                    const ok = await hydrateBranches();
                    if (!ok) return;
                    setRepoHeader();
                    await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
                    updateFetchUI();
                    lastHeadKey = key;
                } catch {
                    // ignore transient failures (e.g. repo switching / git busy)
                }
            })().finally(() => {
                headPollInFlight = null;
                scheduleHeadPoll();
            });
        }, headPollMs);
    };
    scheduleHeadPoll();

    // open settings via event
      TAURI.listen?.('ui:open-settings', ({ payload }) => {
          const section = typeof payload === 'string'
              ? String(payload)
              : (payload && typeof payload === 'object' ? (payload as any).section : undefined);
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

    // fetch popover interactions
    fetchList?.addEventListener('click', (e) => {
        const li = (e.target as HTMLElement).closest('li[data-action]') as HTMLElement | null;
        if (!li) return;
        if (li.getAttribute('aria-disabled') === 'true') return;
        const action = li.dataset.action || '';
        closeFetchPopover();
        if (action === 'fetch-only') fetchOnly().catch(() => {});
        else if (action === 'fetch-all') fetchAllRemotesOnly().catch(() => {});
        else if (action === 'pull') fetchAndPull().catch(() => {});
    });

    document.addEventListener('click', (e) => {
        if (!fetchPop || fetchPop.hidden) return;
        const target = e.target as Node;
        const split = document.getElementById('fetch-split');
        if (fetchPop.contains(target)) return;
        if (split && split.contains(target)) return;
        closeFetchPopover();
    });

    window.addEventListener('resize', closeFetchPopover);
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (fetchPop && !fetchPop.hidden) closeFetchPopover();
    });
}

/** Loads persisted global settings for bootstrap-time features such as theming and monitoring. */
async function loadInitialGlobalSettings(): Promise<GlobalSettings | null> {
    try {
        return await TAURI.invoke<GlobalSettings>('get_global_settings');
    } catch {
        return null;
    }
}

boot();
