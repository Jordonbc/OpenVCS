import { TAURI } from './lib/tauri';
import { qs } from './lib/dom';
import { notify } from './lib/notify';
import { prefs } from './state/state';
import {
    bindTabs, initResizer, refreshRepoActions, setRepoHeader, resetRepoHeader, setTab, setTheme,
    bindLayoutActionState
} from './ui/layout';
import { initMenubar } from './ui/menubar';
import { bindCommandSheet, openSheet, closeSheet } from './features/commandSheet';
import { bindRepoHotkeys, bindFilter, renderList, hydrateBranches, hydrateStatus, hydrateCommits, hydrateStash } from './features/repo';
import { bindBranchUI } from './features/branches';
import { bindCommit } from './features/diff';
import { openAbout } from './features/about';
import { openSettings } from './features/settings';
import { showUpdateDialog } from './features/update';
import { openRepoSettings } from './features/repoSettings';
import { DEFAULT_THEME_ID, refreshAvailableThemes, selectThemePack } from './themes';

const WIKI_URL = 'https://github.com/jordonbc/OpenVCS/wiki';

// Title bar actions
const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
const pushBtn  = qs<HTMLButtonElement>('#push-btn');
const cloneBtn = qs<HTMLButtonElement>('#clone-btn');
const repoSwitch = qs<HTMLButtonElement>('#repo-switch');
const commitBtn = qs<HTMLButtonElement>('#commit-btn');
const undoLeftBtn = qs<HTMLButtonElement>('#undo-left-btn');

function boot() {
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
    bindTabs((t) => { setTab(t); renderList(); });
    initResizer();

    // repo interactions
    bindFilter();
    bindCommit();
    bindCommandSheet();
    bindBranchUI();
    bindLayoutActionState();
    bindRepoHotkeys(commitBtn || null, openSheet, fetchOnly);

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

    async function fetchAllRemotesOnly(options: { hydrate?: boolean; status?: ReturnType<typeof statusController>; keepBusy?: boolean } = {}) {
        if (!TAURI.has) return false;
        const { hydrate = true, status, keepBusy = false } = options;
        const ctl = status ?? statusController();
        let success = false;
        try {
            ctl.setBusy('Fetching…');
            await TAURI.invoke('git_fetch_all', {});
            notify('Fetched all remotes');
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
    }

    async function fetchOnly() {
        const ctl = statusController();
        await fetchAllRemotesOnly({ status: ctl });
    }

    async function fetchAndPull() {
        if (!TAURI.has) return;
        const ctl = statusController();
        const fetched = await fetchAllRemotesOnly({ hydrate: false, status: ctl, keepBusy: true });
        if (!fetched) { ctl.clearBusy(); return; }

        try {
            ctl.setBusy('Pulling…');
            await TAURI.invoke('git_pull', {});
            notify('Pulled latest changes');
        } catch {
            notify('Pull failed');
        } finally {
            ctl.clearBusy();
        }

        await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits(), hydrateStash()]);
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
            case 'fetch': await fetchAndPull(); break;
            case 'push':  await pushChanges();  break;
            case 'commit': commitBtn?.click(); break;
            case 'docs': await openDocs(); break;
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
    fetchBtn?.addEventListener('click', fetchAndPull);
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
            setBusy(String((payload as any)?.message || 'Working…'));
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
    async function onFocus() {
        let doFetch = false;
        if (TAURI.has) {
            try {
                const cfg = await TAURI.invoke<any>('get_global_settings');
                doFetch = cfg?.git?.fetch_on_focus !== false; // default true when unset
            } catch {}
        }
        if (doFetch) {
            await fetchAllRemotesOnly({ hydrate: false });
        }
        await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits(), hydrateStash()]);
    }

    window.addEventListener('focus', () => { onFocus().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onFocus().catch(() => {});
    });

    // open settings via event
      TAURI.listen?.('ui:open-settings', ({ payload }) => {
          const section = typeof payload === 'string'
              ? String(payload)
              : (payload && typeof payload === 'object' ? (payload as any).section : undefined);
          openSettings(section);
      });
      TAURI.listen?.('ui:open-about', () => openAbout());
      TAURI.listen?.('ui:open-repo-settings', () => openRepoSettings());
  }

boot();
