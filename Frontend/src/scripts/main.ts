import { TAURI } from './lib/tauri';
import { qs } from './lib/dom';
import { notify } from './lib/notify';
import { prefs, savePrefs } from './state/state';
import {
    bindTabs, initResizer, refreshRepoActions, setRepoHeader, resetRepoHeader, setTab, setTheme, toggleTheme,
    bindLayoutActionState
} from './ui/layout';
import { bindCommandSheet, openSheet, closeSheet } from './features/commandSheet';
import { bindRepoHotkeys, bindFilter, renderList, hydrateBranches, hydrateStatus, hydrateCommits } from './features/repo';
import { bindBranchUI } from './features/branches';
import { bindCommit } from './features/diff';
import { openAbout } from './features/about';
import { openModal } from './ui/modals';
import { openSettings, loadSettingsIntoForm } from './features/settings';

// Title bar actions
const themeBtn = qs<HTMLButtonElement>('#theme-btn');
const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
const pushBtn  = qs<HTMLButtonElement>('#push-btn');
const cloneBtn = qs<HTMLButtonElement>('#clone-btn');
const repoSwitch = qs<HTMLButtonElement>('#repo-switch');
const commitBtn = qs<HTMLButtonElement>('#commit-btn');

function boot() {
    // theme & basic layout
    setTheme(prefs.theme);
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
    themeBtn?.addEventListener('click', toggleTheme);
    fetchBtn?.addEventListener('click', async () => {
        try { if (TAURI.has) await TAURI.invoke('git_fetch', {}); notify('Fetched'); await Promise.allSettled([hydrateStatus(), hydrateCommits()]); }
        catch { notify('Fetch failed'); }
    });
    pushBtn?.addEventListener('click', async () => {
        try { if (TAURI.has) await TAURI.invoke('git_push', {}); notify('Pushed'); }
        catch { notify('Push failed'); }
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
            case 'toggle_theme': themeBtn?.click(); break;
            case 'fetch': fetchBtn?.click(); break;
            case 'push':  pushBtn?.click();  break;
            case 'commit': commitBtn?.click(); break;
            case 'docs': notify('Open docs…'); break;
            case 'about': openAbout(); break;
            case 'settings': openSettings(); break;
        }
    });

    // backend events
    TAURI.listen?.('git-progress', ({ payload }) => {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = payload?.message || 'Working…';
    });

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
}

boot();
