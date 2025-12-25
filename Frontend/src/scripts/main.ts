import { TAURI } from './lib/tauri';
import { qs } from './lib/dom';
import { notify } from './lib/notify';
import { prefs, state, hasRepo } from './state/state';
import {
    bindTabs, initResizer, refreshRepoActions, setRepoHeader, resetRepoHeader, setTab, setTheme,
    bindLayoutActionState
} from './ui/layout';
import { initMenubar } from './ui/menubar';
import { bindCommandSheet, openSheet, closeSheet } from './features/commandSheet';
import { bindRepoHotkeys, bindFilter, renderList, wireRenderListCallbacks, hydrateBranches, hydrateStatus, hydrateCommits, hydrateStash } from './features/repo';
import { bindBranchUI } from './features/branches';
import { bindCommit } from './features/diff';
import { openAbout } from './features/about';
import { openSettings } from './features/settings';
import { showUpdateDialog } from './features/update';
import { openRepoSettings } from './features/repoSettings';
import { initSshHostkeyPrompt } from './features/sshHostkey';
import { initSshAuthPrompt } from './features/sshAuth';
import { initOutputLogViewIfRequested } from './features/outputLog';
import { DEFAULT_THEME_ID, refreshAvailableThemes, selectThemePack } from './themes';

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

async function boot() {
    // If launched as the Output Log window, render that view and skip the main app UI.
    if (await initOutputLogViewIfRequested()) return;
    // theme & basic layout
    // Prefer native settings for theme; fall back to current in-memory default
    if (TAURI.has) {
        (async () => {
            try {
                const cfg = await TAURI.invoke<any>('get_global_settings');
                const themeMode = cfg?.general?.theme as ('dark'|'light'|'system'|undefined);
                const modeForPack = themeMode ?? 'system';
                const themePack = String(cfg?.general?.theme_pack || DEFAULT_THEME_ID);
                try { await refreshAvailableThemes(); } catch { /* best effort */ }
                try {
                    await selectThemePack(themePack, { silent: true, mode: modeForPack });
                } catch {
                    await selectThemePack(DEFAULT_THEME_ID, { silent: true, mode: modeForPack });
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
                } catch { /* best-effort */ }
            } catch {
                try { await selectThemePack(DEFAULT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
                setTheme(prefs.theme);
            }
        })();
    } else {
        setTheme(prefs.theme);
    }
    wireRenderListCallbacks();
    bindTabs((t) => { setTab(t); renderList(); });
    initResizer();

    // repo interactions
    bindFilter();
    bindCommit();
    bindCommandSheet();
    bindBranchUI();
    bindLayoutActionState();
    bindRepoHotkeys(commitBtn || null, openSheet, defaultFetchAction);
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
        if (!TAURI.has) return false;
        return runFetch(async () => {
            const { hydrate = true, status, keepBusy = false } = options;
            const ctl = status ?? statusController();
            let success = false;
            try {
                ctl.setBusy('Fetching…');
                await TAURI.invoke('git_fetch', {});
                notify('Fetched');
                if (hydrate) {
                    await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
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
        if (!TAURI.has) return false;
        return runFetch(async () => {
            const { hydrate = true, status, keepBusy = false } = options;
            const ctl = status ?? statusController();
            let success = false;
            try {
                ctl.setBusy('Fetching all…');
                await TAURI.invoke('git_fetch_all', {});
                notify('Fetched all remotes');
                if (hydrate) {
                    await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
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
        const mainLabel = behind > 0 ? `Pull (${behind})` : 'Fetch';
        const mainTitle = behind > 0
            ? `Pull ${behind} commit${behind === 1 ? '' : 's'} (F5)`
            : 'Fetch (F5)';

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
            if (name) name.textContent = 'Fetch';
        }
        if (fetchAllItem) {
            fetchAllItem.setAttribute('aria-disabled', 'false');
            fetchAllItem.tabIndex = 0;
        }
        if (pullItem) {
            const pullLabel = behind > 0 ? `Pull (${behind})` : 'Pull';
            pullItem.setAttribute('aria-disabled', canPull ? 'false' : 'true');
            pullItem.tabIndex = canPull ? 0 : -1;
            const name = pullItem.querySelector<HTMLElement>('.name');
            if (name) name.textContent = pullLabel;
        }
    }

    async function fetchAndPull() {
        if (!TAURI.has) return;
        const ctl = statusController();
        const fetched = await fetchCurrentRemoteOnly({ hydrate: false, status: ctl, keepBusy: true });
        if (!fetched) { ctl.clearBusy(); return; }

        try {
            ctl.setBusy('Pulling…');
            const res = await TAURI.invoke<{ pulled: boolean; branch: string; reason?: string | null }>('git_pull', {});
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

        await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits(), hydrateStash()]);
    }

    async function defaultFetchAction() {
        if (getBehindCount() > 0) await fetchAndPull();
        else await fetchOnly();
    }

    function openFetchPopover() {
        if (!fetchPop || !fetchCaret) return;
        const anchor = (document.getElementById('fetch-split') || fetchBtn || fetchCaret) as HTMLElement | null;
        if (!anchor) return;
        updateFetchUI();
        const r = anchor.getBoundingClientRect();
        fetchPop.style.left = `${r.left}px`;
        fetchPop.style.top  = `${r.bottom + 6}px`;
        fetchPop.hidden = false;
        fetchCaret.setAttribute('aria-expanded', 'true');

        const firstEnabled = fetchList?.querySelector<HTMLElement>('li[role="menuitem"][aria-disabled="false"]');
        setTimeout(() => firstEnabled?.focus(), 0);
    }

    function closeFetchPopover() {
        if (!fetchPop || !fetchCaret) return;
        fetchPop.hidden = true;
        fetchCaret.setAttribute('aria-expanded', 'false');
    }

    async function pushChanges() {
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
        try {
            if (TAURI.has) { setBusy('Pushing…'); await TAURI.invoke('git_push', {}); }
            notify('Pushed');
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        } catch { notify('Push failed'); } finally { clearBusy(); }
    }

    async function openDocs() {
        if (TAURI.has) {
            try { await TAURI.invoke('open_docs', {}); return; } catch { /* fall back */ }
        }
        try { window.open(WIKI_URL, '_blank', 'noopener'); } catch { notify('Unable to open docs'); }
    }

    async function runLfsCommand(cmd: string, okMsg: string, errMsg: string) {
        if (!TAURI.has) {
            notify('Git LFS actions require the desktop app');
            return;
        }
        try {
            await TAURI.invoke(cmd);
            notify(okMsg);
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        } catch (err) {
            const msg = String(err || '').trim();
            const friendly = msg.includes('unsupported backend')
                ? 'The current backend does not support Git LFS'
                : (msg || errMsg);
            notify(friendly);
        }
    }

    async function runMenuAction(id?: string | null) {
        switch (id) {
            case 'clone_repo': openSheet('clone'); break;
            case 'add_repo':   openSheet('add');   break;
            case 'open_repo':  openSheet('switch');break;
            case 'fetch': await defaultFetchAction(); break;
            case 'push':  await pushChanges();  break;
            case 'commit': commitBtn?.click(); break;
            case 'docs': await openDocs(); break;
            case 'show-output-log':
                if (!TAURI.has) { notify('Output Log is available in the desktop app'); break; }
                try { await TAURI.invoke('open_output_log_window', {}); }
                catch { notify('Failed to open Output Log'); }
                break;
            case 'about': openAbout(); break;
            case 'settings': openSettings(); break;
            case 'repo-settings': openRepoSettings(); break;
            case 'repo-edit-gitignore':
            case 'repo-edit-gitattributes': {
                if (!TAURI.has) { notify('Open this in the desktop app to edit repository files'); break; }
                const name = id === 'repo-edit-gitignore' ? '.gitignore' : '.gitattributes';
                try { await TAURI.invoke('open_repo_dotfile', { name }); }
                catch { notify(`Could not open ${name}`); }
                break;
            }
            case 'lfs-settings': openSettings('lfs'); break;
            case 'lfs-fetch-all': await runLfsCommand('git_lfs_fetch_all', 'Fetched Git LFS objects', 'Git LFS fetch failed'); break;
            case 'lfs-pull-all': await runLfsCommand('git_lfs_pull', 'Pulled Git LFS objects', 'Git LFS pull failed'); break;
            case 'lfs-prune': await runLfsCommand('git_lfs_prune', 'Pruned Git LFS cache', 'Git LFS prune failed'); break;
            case 'check_updates':
                if (!TAURI.has) { notify('Update checks are available in the desktop app'); break; }
                try {
                    const hasUpdate = await TAURI.invoke<boolean>('check_for_updates', {});
                    if (!hasUpdate) notify('Already up to date');
                } catch { notify('Update check failed'); }
                break;
            case 'exit': if (TAURI.has) { TAURI.invoke('exit_app', {}).catch(() => {}); } break;
            default: break;
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
    repoSwitch?.addEventListener('click', () => openSheet('switch'));

    // No dynamic undo insertion; the inline button lives in the commit panel

    undoLeftBtn?.addEventListener('click', async () => {
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
        try {
            if (!TAURI.has) return;
            setBusy('Undoing…');
            await TAURI.invoke('git_undo_since_push', {});
            notify('Undid unpushed commits');
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        } catch { notify('Undo failed'); } finally { clearBusy(); }
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

    TAURI.listen?.('menu', async ({ payload: id }) => {
        const resolved = typeof id === 'string' ? id : String(id ?? '');
        await runMenuAction(resolved);
    });

    // backend events
    // Global busy indicator for any Git activity
    (function(){
        let busyTimer: any = null;
        const setBusy = (msg: string) => {
            const s = document.getElementById('status');
            if (!s) return;
            s.textContent = msg || 'Working…';
            s.classList.add('busy');
            if (busyTimer) clearTimeout(busyTimer);
            // Clear after a short quiet period
            busyTimer = setTimeout(() => {
                s.classList.remove('busy');
                s.textContent = 'Ready';
            }, 1500);
        };
        TAURI.listen?.('git-progress', ({ payload }) => {
            // Don't spam the footer with raw git output; keep it generic.
            void payload;
            setBusy('Working…');
        });
    })();

  // repo selected -> refresh
    TAURI.listen<string | { path?: string; repoPath?: string; repo?: string; dir?: string }>('repo:selected', async ({ payload }) => {
        const path = typeof payload === 'string'
            ? payload
            : (payload?.path ?? payload?.repoPath ?? payload?.repo ?? payload?.dir ?? '');
        if (path) notify(`Opened ${path}`);
        setRepoHeader(path);
        closeSheet();

        await hydrateBranches();
        setRepoHeader(path);
        await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        updateFetchUI();

        // Broadcast app-level event so branch UI and actions can sync
        window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path } }));
        refreshRepoActions();
    });

  // If backend reopened a repo before the webview was ready, sync initial state.
  if (TAURI.has) {
    TAURI.invoke<string | null>('current_repo_path')
      .then(async (p) => {
        const path = (p || '').trim();
        if (!path) return;
        setRepoHeader(path);
        await hydrateBranches();
        setRepoHeader(path);
        await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path } }));
        refreshRepoActions();
        updateFetchUI();
      })
      .catch(() => {});
  }

  // generic notifications from backend
  TAURI.listen?.('ui:notify', ({ payload }) => {
      try { notify(String((payload as any) ?? '')); } catch {}
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
        let doFetch = false;
        if (TAURI.has) {
            try {
                const cfg = await TAURI.invoke<any>('get_global_settings');
                doFetch = cfg?.git?.fetch_on_focus !== false; // default true when unset
            } catch {}
        }
        if (doFetch) {
            await fetchCurrentRemoteOnly({ hydrate: false });
        }
        await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits(), hydrateStash()]);
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
    const headPollMs = 2000;
    setInterval(() => {
        if (!TAURI.has) return;
        if (!state.hasRepo) return;
        if (document.visibilityState !== 'visible') return;
        if (headPollInFlight) return;
        headPollInFlight = (async () => {
            try {
                const head = await TAURI.invoke<{ detached: boolean; branch?: string; commit?: string }>('git_head_status');
                const key = `${head?.detached ? 1 : 0}:${String(head?.branch || '')}:${String(head?.commit || '')}`;
                if (key === lastHeadKey) return;
                lastHeadKey = key;
                await hydrateBranches();
                setRepoHeader();
                await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
                updateFetchUI();
            } catch {
                // ignore transient failures (e.g. repo switching / git busy)
            }
        })().finally(() => { headPollInFlight = null; });
    }, headPollMs);

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

boot();
