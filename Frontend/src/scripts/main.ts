import { TAURI } from './lib/tauri';
import { qs } from './lib/dom';
import { notify } from './lib/notify';
import { prefs, savePrefs, state } from './state/state';
import {
    bindTabs, initResizer, refreshRepoActions, setRepoHeader, resetRepoHeader, setTab, setTheme,
    bindLayoutActionState
} from './ui/layout';
import { bindCommandSheet, openSheet, closeSheet } from './features/commandSheet';
import { bindRepoHotkeys, bindFilter, renderList, hydrateBranches, hydrateStatus, hydrateCommits } from './features/repo';
import { bindBranchUI } from './features/branches';
import { bindCommit } from './features/diff';
import { openAbout } from './features/about';
import { openModal } from './ui/modals';
import { openSettings, loadSettingsIntoForm } from './features/settings';
import { showUpdateDialog } from './features/update';
import { openRepoSettings } from './features/repoSettings';

// Title bar actions
const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
const pushBtn  = qs<HTMLButtonElement>('#push-btn');
const cloneBtn = qs<HTMLButtonElement>('#clone-btn');
const repoSwitch = qs<HTMLButtonElement>('#repo-switch');
const commitBtn = qs<HTMLButtonElement>('#commit-btn');

function boot() {
    // theme & basic layout
    // Prefer native settings for theme; fall back to current in-memory default
    if (TAURI.has) {
        TAURI.invoke<any>('get_global_settings')
            .then((cfg) => {
                const t = cfg?.general?.theme as ('dark'|'light'|'system'|undefined);
                setTheme(t || prefs.theme);
                // Apply additional visual prefs: tab width, UI scale, monospace font
                try {
                    const root = document.documentElement;
                    const tabw = Number(cfg?.diff?.tab_width ?? 4);
                    if (tabw && isFinite(tabw)) root.style.setProperty('--tab-size', String(tabw));
                    const uiScale = Number(cfg?.ux?.ui_scale ?? 1);
                    if (uiScale && isFinite(uiScale)) root.style.setProperty('--ui-scale', String(uiScale));
                    const mono = String(cfg?.ux?.font_mono || '').trim();
                    if (mono) root.style.setProperty('--mono', mono);
                } catch { /* best-effort */ }
            })
            .catch(() => setTheme(prefs.theme));
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
    bindLayoutActionState()
    bindRepoHotkeys(commitBtn || null, openSheet);

    // title actions
    fetchBtn?.addEventListener('click', async () => {
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
        try {
            if (!TAURI.has) return;
            const hasLocalChanges = Array.isArray(state.files) && state.files.length > 0;
            const ahead = (state as any).ahead || 0;
            const behind = (state as any).behind || 0;
            const canFastForward = !hasLocalChanges && ahead === 0;

            if (canFastForward) {
                setBusy('Pulling…');
                await TAURI.invoke('git_pull', {});
                notify(behind > 0 ? 'Pulled (fast-forward)' : 'Already up to date');
            } else {
                setBusy('Fetching…');
                await TAURI.invoke('git_fetch', {});
                notify('Fetched');
            }
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        } catch {
            notify('Fetch/Pull failed');
        } finally { clearBusy(); }
    });
    pushBtn?.addEventListener('click', async () => {
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = () => { if (statusEl) statusEl.classList.remove('busy'); };
        try {
            if (TAURI.has) { setBusy('Pushing…'); await TAURI.invoke('git_push', {}); }
            notify('Pushed');
            // Refresh status/commits so ahead/behind and history update immediately
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
        } catch { notify('Push failed'); } finally { clearBusy(); }
    });
    cloneBtn?.addEventListener('click', () => openSheet('clone'));
    repoSwitch?.addEventListener('click', () => openSheet('switch'));


    // initial UI
    setTab(prefs.tab);
    renderList();
    refreshRepoActions();

    // initial data
    hydrateBranches().then(() => setRepoHeader());
    hydrateStatus();
    hydrateCommits();

    // menu routing
    TAURI.listen?.('menu', ({ payload: id }) => {
        switch (id) {
            case 'clone_repo': openSheet('clone'); break;
            case 'add_repo':   openSheet('add');   break;
            case 'open_repo':  openSheet('switch');break;
            case 'fetch': fetchBtn?.click(); break;
            case 'push':  pushBtn?.click();  break;
            case 'commit': commitBtn?.click(); break;
            case 'docs': notify('Open docs…'); break;
            case 'about': openAbout(); break;
            case 'settings': openSettings(); break;
        }
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
    TAURI.listen?.('repo:selected', async ({ payload }) => {
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

    // app focus throttle + refresh
    (function () {
        let cooling = false;
        const COOL_MS = 350;

        async function refreshAll() {
            const statusEl = document.getElementById('status');
            if (statusEl) statusEl.textContent = 'Refreshing…';
            await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits()]);
            if (statusEl) statusEl.textContent = 'Ready';
        }

        TAURI.listen?.('app:focus', () => {
            if (cooling) return;
            cooling = true;
            refreshAll().finally(() => setTimeout(() => (cooling = false), COOL_MS));
        });
    })();

    // open settings via event
      TAURI.listen?.('ui:open-settings', () => openModal('settings-modal'));
      TAURI.listen?.('ui:open-about', () => openAbout());
      TAURI.listen?.('ui:open-repo-settings', () => openRepoSettings());
  }

boot();
