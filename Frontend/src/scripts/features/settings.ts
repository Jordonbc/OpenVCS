import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { toKebab } from '../lib/dom';
import { notify } from '../lib/notify';
import type { GlobalSettings } from '../types';

export function openSettings(){ openModal('settings-modal'); }

export function wireSettings() {
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

    // Close on backdrop / [data-close]
    modal.addEventListener('click', (e) => {
        const backdrop = modal.querySelector('.backdrop');
        if ((e.target as Element).matches?.('[data-close]') || e.target === backdrop) {
            closeModal('settings-modal');
        }
    });

    // Sidebar switching
    const nav = modal.querySelector('#settings-nav') as HTMLElement | null;
    const panels = modal.querySelector('#settings-panels') as HTMLElement | null;
    if (nav && panels) {
        nav.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('[data-section]') as HTMLElement | null;
            if (!btn) return;
            nav.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
            const target = btn.getAttribute('data-section');
            panels.querySelectorAll<HTMLElement>('.panel-form').forEach(p => {
                p.classList.toggle('hidden', p.getAttribute('data-panel') !== target);
            });
        });
    }

    const setThemeSel = modal.querySelector('#set-theme') as HTMLSelectElement | null;
    setThemeSel?.addEventListener('change', () => {
        const v = setThemeSel.value;
        document.documentElement.setAttribute('data-theme', v === 'dark' ? 'dark' : v === 'light' ? 'light' : 'system');
    });

    const settingsSave  = modal.querySelector('#settings-save')  as HTMLButtonElement | null;
    const settingsReset = modal.querySelector('#settings-reset') as HTMLButtonElement | null;

    settingsSave?.addEventListener('click', async () => {
        try {
            const baseRaw = (modal as HTMLElement).dataset.currentCfg || '{}';
            const base = JSON.parse(baseRaw || '{}');
            const prevBackend: string = String(base?.git?.backend || 'system');
            const next = collectSettingsFromForm(modal);

            if (TAURI.has) {
                await TAURI.invoke('set_global_settings', { cfg: next });

                // If backend changed, request a backend swap (reopens repo if open)
                const newBackend: string = String(next?.git?.backend || 'system');
                if (newBackend && newBackend !== prevBackend) {
                    const backend_id = (newBackend === 'libgit2') ? 'git-libgit2' : 'git-system';
                    try { await TAURI.invoke('set_backend_cmd', { backend_id }); } catch {}
                }
            }

            // Apply visual prefs immediately (no restart): theme, tab width, UI scale, mono font
            const theme = next.general?.theme || 'system';
            document.documentElement.setAttribute('data-theme', theme);
            try {
                const root = document.documentElement;
                const tabw = Number(next?.diff?.tab_width ?? 4);
                if (tabw && isFinite(tabw)) root.style.setProperty('--tab-size', String(tabw));
                const uiScale = Number(next?.ux?.ui_scale ?? 1);
                if (uiScale && isFinite(uiScale)) root.style.setProperty('--ui-scale', String(uiScale));
                const mono = String(next?.ux?.font_mono || '').trim();
                if (mono) root.style.setProperty('--mono', mono);
                else root.style.removeProperty('--mono');
            } catch {}

            notify('Settings saved');
            closeModal('settings-modal');
        } catch { notify('Failed to save settings'); }
    });

    settingsReset?.addEventListener('click', async () => {
        try {
            if (!TAURI.has) return;
            const cur = await TAURI.invoke<GlobalSettings>('get_global_settings');

            cur.general = { theme: 'system', language: 'system', default_backend: 'git', update_channel: 'stable', reopen_last_repos: true, checks_on_launch: true, telemetry: false, crash_reports: false };
            cur.git = { backend: 'system', default_branch: 'main', prune_on_fetch: true, watcher_debounce_ms: 300, large_repo_threshold_mb: 500, allow_hooks: 'ask', respect_core_autocrlf: true };
            cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
            cur.lfs = { enabled: true, concurrency: 4, bandwidth_kbps: 0, require_lock_before_edit: false, background_fetch_on_checkout: true };
            cur.performance = { graph_node_cap: 5000, progressive_render: true, gpu_accel: true, index_warm_on_open: true, background_index_on_battery: false };
            cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none', recents_limit: 10 };
            cur.logging = { level: 'info', live_viewer: false, retain_archives: 10 };

            await TAURI.invoke('set_global_settings', { cfg: cur });
            await loadSettingsIntoForm(modal);
            notify('Defaults restored');
        } catch { notify('Failed to restore defaults'); }
    });

    loadSettingsIntoForm(modal).catch(console.error);
}

function collectSettingsFromForm(root: HTMLElement): GlobalSettings {
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

    const base = JSON.parse(root?.dataset.currentCfg || '{}');

    const o: GlobalSettings = { ...base };

    o.general = {
        ...o.general,
        theme: (get<HTMLSelectElement>('#set-theme')?.value) as any,
        language: get<HTMLSelectElement>('#set-language')?.value,
        default_backend: (get<HTMLSelectElement>('#set-default-backend')?.value || 'git') as any,
        update_channel: get<HTMLSelectElement>('#set-update-channel')?.value,
        reopen_last_repos: !!get<HTMLInputElement>('#set-reopen-last')?.checked,
        checks_on_launch: !!get<HTMLInputElement>('#set-checks-on-launch')?.checked,
    };

    o.git = {
        ...o.git,
        backend: get<HTMLSelectElement>('#set-git-backend')?.value as any,
        prune_on_fetch: !!get<HTMLInputElement>('#set-prune-on-fetch')?.checked,
        watcher_debounce_ms: Number(get<HTMLInputElement>('#set-watcher-debounce-ms')?.value ?? 0),
        large_repo_threshold_mb: Number(get<HTMLInputElement>('#set-large-repo-threshold-mb')?.value ?? 0),
        allow_hooks: get<HTMLSelectElement>('#set-hook-policy')?.value,
        respect_core_autocrlf: !!get<HTMLInputElement>('#set-respect-autocrlf')?.checked,
    };

    o.diff = {
        ...o.diff,
        tab_width: Number(get<HTMLInputElement>('#set-tab-width')?.value ?? 0),
        ignore_whitespace: get<HTMLSelectElement>('#set-ignore-whitespace')?.value,
        max_file_size_mb: Number(get<HTMLInputElement>('#set-max-file-size-mb')?.value ?? 0),
        intraline: !!get<HTMLInputElement>('#set-intraline')?.checked,
        show_binary_placeholders: !!get<HTMLInputElement>('#set-binary-placeholders')?.checked,
    };

    o.lfs = {
        ...o.lfs,
        enabled: !!get<HTMLInputElement>('#set-lfs-enabled')?.checked,
        concurrency: Number(get<HTMLInputElement>('#set-lfs-concurrency')?.value ?? 0),
        bandwidth_kbps: Number(get<HTMLInputElement>('#set-lfs-bandwidth')?.value ?? 0),
        require_lock_before_edit: !!get<HTMLInputElement>('#set-lfs-require-lock')?.checked,
        background_fetch_on_checkout: !!get<HTMLInputElement>('#set-lfs-bg-fetch')?.checked,
    };

    o.performance = {
        ...o.performance,
        graph_node_cap: Number(get<HTMLInputElement>('#set-graph-cap')?.value ?? 0),
        progressive_render: !!get<HTMLInputElement>('#set-progressive-render')?.checked,
        gpu_accel: !!get<HTMLInputElement>('#set-gpu-accel')?.checked,
        index_warm_on_open: !!get<HTMLInputElement>('#set-index-warm')?.checked,
        background_index_on_battery: !!get<HTMLInputElement>('#set-bg-index-on-battery')?.checked,
    };

    const rlRaw = get<HTMLInputElement>('#set-recents-limit')?.value ?? '';
    const recentsLimit = rlRaw.trim() === '' ? 10 : Math.max(1, Math.min(100, Number(rlRaw)));
    o.ux = {
        ...o.ux,
        ui_scale: Number(get<HTMLInputElement>('#set-ui-scale')?.value ?? 1),
        font_mono: get<HTMLInputElement>('#set-font-mono')?.value,
        vim_nav: !!get<HTMLInputElement>('#set-vim-nav')?.checked,
        color_blind_mode: get<HTMLSelectElement>('#set-cb-mode')?.value,
        recents_limit: recentsLimit,
    };

    // Logging
    const keepRaw = get<HTMLInputElement>('#set-log-keep')?.value ?? '';
    const keep = keepRaw.trim() === '' ? 10 : Math.max(1, Math.min(100, Number(keepRaw)));
    o.logging = {
        ...o.logging,
        level: (get<HTMLSelectElement>('#set-log-level')?.value || 'info') as any,
        retain_archives: keep,
    };

    return o;
}

export async function loadSettingsIntoForm(root?: HTMLElement) {
    const m = root || (document.getElementById('settings-modal') as HTMLElement | null);
    if (!m) return;
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => m.querySelector<T>(sel);
    const cfg = TAURI.has ? await TAURI.invoke<GlobalSettings>('get_global_settings') : null;
    if (!cfg) return;

    m.dataset.currentCfg = JSON.stringify(cfg);

    const elTheme = get<HTMLSelectElement>('#set-theme'); if (elTheme) elTheme.value = toKebab(cfg.general?.theme);
    const elLang  = get<HTMLSelectElement>('#set-language'); if (elLang) elLang.value = toKebab(cfg.general?.language);
    const elDefBe = get<HTMLSelectElement>('#set-default-backend'); if (elDefBe) elDefBe.value = toKebab(cfg.general?.default_backend || 'git');
    const elChan  = get<HTMLSelectElement>('#set-update-channel'); if (elChan) elChan.value = toKebab(cfg.general?.update_channel);
    const elReo   = get<HTMLInputElement>('#set-reopen-last'); if (elReo) elReo.checked = !!cfg.general?.reopen_last_repos;
    const elChk   = get<HTMLInputElement>('#set-checks-on-launch'); if (elChk) elChk.checked = !!cfg.general?.checks_on_launch;
    const elRl    = get<HTMLInputElement>('#set-recents-limit'); if (elRl) elRl.value = String(cfg.ux?.recents_limit ?? 10);

    const backend = toKebab(cfg.git?.backend) || 'system';
    const elGb = get<HTMLSelectElement>('#set-git-backend');
    if (elGb) {
        // Map to enum string values used by backend settings
        elGb.value = backend === 'libgit2' ? 'libgit2' : 'system';
    }
    const elPr = get<HTMLInputElement>('#set-prune-on-fetch'); if (elPr) elPr.checked = !!cfg.git?.prune_on_fetch;
    const elWd = get<HTMLInputElement>('#set-watcher-debounce-ms'); if (elWd) elWd.value = String(cfg.git?.watcher_debounce_ms ?? 0);
    const elLr = get<HTMLInputElement>('#set-large-repo-threshold-mb'); if (elLr) elLr.value = String(cfg.git?.large_repo_threshold_mb ?? 0);
    const elHp = get<HTMLSelectElement>('#set-hook-policy'); if (elHp) elHp.value = toKebab(cfg.git?.allow_hooks);
    const elRc = get<HTMLInputElement>('#set-respect-autocrlf'); if (elRc) elRc.checked = !!cfg.git?.respect_core_autocrlf;

    const elTw = get<HTMLInputElement>('#set-tab-width'); if (elTw) elTw.value = String(cfg.diff?.tab_width ?? 0);
    const elIw = get<HTMLSelectElement>('#set-ignore-whitespace'); if (elIw) elIw.value = toKebab(cfg.diff?.ignore_whitespace);
    const elMx = get<HTMLInputElement>('#set-max-file-size-mb'); if (elMx) elMx.value = String(cfg.diff?.max_file_size_mb ?? 0);
    const elIn = get<HTMLInputElement>('#set-intraline'); if (elIn) elIn.checked = !!cfg.diff?.intraline;
    const elBp = get<HTMLInputElement>('#set-binary-placeholders'); if (elBp) elBp.checked = !!cfg.diff?.show_binary_placeholders;

    const elLe = get<HTMLInputElement>('#set-lfs-enabled'); if (elLe) elLe.checked = !!cfg.lfs?.enabled;
    const elLc = get<HTMLInputElement>('#set-lfs-concurrency'); if (elLc) elLc.value = String(cfg.lfs?.concurrency ?? 0);
    const elLb = get<HTMLInputElement>('#set-lfs-bandwidth'); if (elLb) elLb.value = String(cfg.lfs?.bandwidth_kbps ?? 0);
    const elLl = get<HTMLInputElement>('#set-lfs-require-lock'); if (elLl) elLl.checked = !!cfg.lfs?.require_lock_before_edit;
    const elBg = get<HTMLInputElement>('#set-lfs-bg-fetch'); if (elBg) elBg.checked = !!cfg.lfs?.background_fetch_on_checkout;

    const elGc = get<HTMLInputElement>('#set-graph-cap'); if (elGc) elGc.value = String(cfg.performance?.graph_node_cap ?? 0);
    const elPrg= get<HTMLInputElement>('#set-progressive-render'); if (elPrg) elPrg.checked = !!cfg.performance?.progressive_render;
    const elGpu= get<HTMLInputElement>('#set-gpu-accel'); if (elGpu) elGpu.checked = !!cfg.performance?.gpu_accel;
    const elIdx= get<HTMLInputElement>('#set-index-warm'); if (elIdx) elIdx.checked = !!cfg.performance?.index_warm_on_open;
    const elBat= get<HTMLInputElement>('#set-bg-index-on-battery'); if (elBat) elBat.checked = !!cfg.performance?.background_index_on_battery;

    const elUi = get<HTMLInputElement>('#set-ui-scale'); if (elUi) elUi.value = String(cfg.ux?.ui_scale ?? 1.0);
    const elFm = get<HTMLInputElement>('#set-font-mono'); if (elFm) elFm.value = cfg.ux?.font_mono ?? 'monospace';
    const elVn = get<HTMLInputElement>('#set-vim-nav'); if (elVn) elVn.checked = !!cfg.ux?.vim_nav;
    const elCb = get<HTMLSelectElement>('#set-cb-mode'); if (elCb) elCb.value = toKebab(cfg.ux?.color_blind_mode);

    // Logging
    const elLvl = get<HTMLSelectElement>('#set-log-level'); if (elLvl) elLvl.value = toKebab(cfg.logging?.level || 'info');
    const elKeep= get<HTMLInputElement>('#set-log-keep'); if (elKeep) elKeep.value = String(cfg.logging?.retain_archives ?? 10);
}
