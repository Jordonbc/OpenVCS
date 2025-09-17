import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { toKebab } from '../lib/dom';
import { notify } from '../lib/notify';
import { setTheme } from '../ui/layout';
import { DEFAULT_THEME_ID, getAvailableThemes, refreshAvailableThemes, selectThemePack } from '../themes';
import type { GlobalSettings, ThemeSummary } from '../types';

const THEME_PACK_HINT = 'Place theme ZIP files into the themes folder to enable them.';

function themeOptionLabel(theme: ThemeSummary): string {
    const version = theme.version?.trim();
    return version ? `${theme.name} (${version})` : theme.name;
}

function themeTooltip(id: string): string {
    const theme = getAvailableThemes().find((t) => t.id.toLowerCase() === id.toLowerCase());
    if (!theme) return THEME_PACK_HINT;
    const details: string[] = [];
    if (theme.description) details.push(theme.description);
    const meta = [theme.author, theme.version].filter(Boolean).join(' • ');
    if (meta) details.push(meta);
    return details.join('\n') || THEME_PACK_HINT;
}

export function openSettings(section?: string){
    openModal('settings-modal');
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (!modal) return;
    if (section) activateSection(modal, section);
    loadSettingsIntoForm(modal).catch(console.error);
}

function activateSection(modal: HTMLElement, section: string) {
    const nav = modal.querySelector('#settings-nav');
    const panels = modal.querySelector('#settings-panels');
    if (!nav || !panels) return;
    const btn = nav.querySelector<HTMLElement>(`[data-section="${section}"]`);
    nav.querySelectorAll<HTMLElement>('.seg-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
    });
    panels.querySelectorAll<HTMLElement>('.panel-form').forEach(p => {
        p.classList.toggle('hidden', p.getAttribute('data-panel') !== section);
    });
}

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
            const target = btn.getAttribute('data-section') || undefined;
            if (!target) return;
            activateSection(modal, target);
        });
    }

    const lfsToggle = modal.querySelector<HTMLInputElement>('#set-lfs-enabled');
    const lfsDependents = ['#set-lfs-concurrency', '#set-lfs-require-lock', '#set-lfs-bg-fetch']
        .map(sel => modal.querySelector<HTMLInputElement>(sel))
        .filter((el): el is HTMLInputElement => !!el);
    const updateLfsDependentState = () => {
        const enabled = !!lfsToggle?.checked;
        lfsDependents.forEach(input => input.disabled = !enabled);
    };
    updateLfsDependentState();
    lfsToggle?.addEventListener('change', updateLfsDependentState);

    const setThemeSel = modal.querySelector('#set-theme') as HTMLSelectElement | null;
    const setThemePackSel = modal.querySelector('#set-theme-pack') as HTMLSelectElement | null;

    const updateThemePackTitle = () => {
        if (!setThemePackSel) return;
        const val = setThemePackSel.value || DEFAULT_THEME_ID;
        setThemePackSel.title = themeTooltip(val);
    };

    setThemeSel?.addEventListener('change', () => {
        const v = (setThemeSel.value as ('system'|'dark'|'light')) || 'system';
        setTheme(v);
    });

    setThemePackSel?.addEventListener('change', async () => {
        if (!setThemePackSel) return;
        const choice = setThemePackSel.value || DEFAULT_THEME_ID;
        try {
            await selectThemePack(choice);
        } catch {
            setThemePackSel.value = DEFAULT_THEME_ID;
            try { await selectThemePack(DEFAULT_THEME_ID); } catch {}
        } finally {
            updateThemePackTitle();
        }
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

            modal.dataset.currentCfg = JSON.stringify(next);

            // Apply visual prefs immediately (no restart): theme, tab width, UI scale, mono font
            const theme = next.general?.theme || 'system';
            const pack = next.general?.theme_pack || DEFAULT_THEME_ID;
            try { await selectThemePack(pack, { silent: true, mode: theme }); } catch {}
            setTheme(theme);
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

            cur.general = { theme: 'system', theme_pack: DEFAULT_THEME_ID, language: 'system', default_backend: 'git', update_channel: 'stable', reopen_last_repos: true, checks_on_launch: true, telemetry: false, crash_reports: false };
            cur.git = { backend: 'system', default_branch: 'main', prune_on_fetch: true, fetch_on_focus: true, allow_hooks: 'ask', respect_core_autocrlf: true };
            cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
            cur.lfs = { enabled: true, concurrency: 4, require_lock_before_edit: false, background_fetch_on_checkout: true };
            cur.performance = { progressive_render: true, gpu_accel: true };
            cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none', recents_limit: 10 };
            cur.logging = { level: 'info', live_viewer: false, retain_archives: 10 };

            await TAURI.invoke('set_global_settings', { cfg: cur });
            await loadSettingsIntoForm(modal);
            try { await selectThemePack(DEFAULT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
            setTheme('system');
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
        theme_pack: get<HTMLSelectElement>('#set-theme-pack')?.value || DEFAULT_THEME_ID,
        language: get<HTMLSelectElement>('#set-language')?.value,
        default_backend: (get<HTMLSelectElement>('#set-default-backend')?.value || 'git') as any,
        update_channel: (() => { const v = get<HTMLSelectElement>('#set-update-channel')?.value; return v === 'beta' ? 'nightly' : v; })(),
        reopen_last_repos: !!get<HTMLInputElement>('#set-reopen-last')?.checked,
        checks_on_launch: !!get<HTMLInputElement>('#set-checks-on-launch')?.checked,
    };

    o.git = {
        ...o.git,
        backend: get<HTMLSelectElement>('#set-git-backend')?.value as any,
        prune_on_fetch: !!get<HTMLInputElement>('#set-prune-on-fetch')?.checked,
        fetch_on_focus: !!get<HTMLInputElement>('#set-fetch-on-focus')?.checked,
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

    const rawConc = Number(get<HTMLInputElement>('#set-lfs-concurrency')?.value ?? 0);
    const conc = rawConc && isFinite(rawConc) ? Math.max(1, Math.min(16, rawConc)) : 4;
    o.lfs = {
        ...o.lfs,
        enabled: !!get<HTMLInputElement>('#set-lfs-enabled')?.checked,
        concurrency: conc,
        require_lock_before_edit: !!get<HTMLInputElement>('#set-lfs-require-lock')?.checked,
        background_fetch_on_checkout: !!get<HTMLInputElement>('#set-lfs-bg-fetch')?.checked,
    };

    o.performance = {
        ...o.performance,
        progressive_render: !!get<HTMLInputElement>('#set-progressive-render')?.checked,
        gpu_accel: !!get<HTMLInputElement>('#set-gpu-accel')?.checked,
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

    try { await refreshAvailableThemes(); } catch {}
    const themePackSel = get<HTMLSelectElement>('#set-theme-pack');
    if (themePackSel) {
        const themes = getAvailableThemes();
        themePackSel.innerHTML = '';
        for (const theme of themes) {
            const opt = document.createElement('option');
            opt.value = theme.id;
            opt.textContent = themeOptionLabel(theme);
            opt.title = themeTooltip(theme.id);
            themePackSel.appendChild(opt);
        }
        const desired = String(cfg.general?.theme_pack || DEFAULT_THEME_ID);
        const match = themes.find((t) => t.id.toLowerCase() === desired.toLowerCase());
        themePackSel.value = match ? match.id : DEFAULT_THEME_ID;
        themePackSel.title = themeTooltip(themePackSel.value || DEFAULT_THEME_ID);
    }

    const elTheme = get<HTMLSelectElement>('#set-theme'); if (elTheme) elTheme.value = toKebab(cfg.general?.theme);
    const elLang  = get<HTMLSelectElement>('#set-language'); if (elLang) elLang.value = toKebab(cfg.general?.language);
    const elDefBe = get<HTMLSelectElement>('#set-default-backend'); if (elDefBe) elDefBe.value = toKebab(cfg.general?.default_backend || 'git');
    const elChan  = get<HTMLSelectElement>('#set-update-channel'); if (elChan) {
        const v = toKebab(cfg.general?.update_channel);
        elChan.value = (v === 'beta') ? 'nightly' : v;
    }
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
    const elFoF = get<HTMLInputElement>('#set-fetch-on-focus'); if (elFoF) elFoF.checked = !!cfg.git?.fetch_on_focus;
    
    const elHp = get<HTMLSelectElement>('#set-hook-policy'); if (elHp) elHp.value = toKebab(cfg.git?.allow_hooks);
    const elRc = get<HTMLInputElement>('#set-respect-autocrlf'); if (elRc) elRc.checked = !!cfg.git?.respect_core_autocrlf;

    const elTw = get<HTMLInputElement>('#set-tab-width'); if (elTw) elTw.value = String(cfg.diff?.tab_width ?? 0);
    const elIw = get<HTMLSelectElement>('#set-ignore-whitespace'); if (elIw) elIw.value = toKebab(cfg.diff?.ignore_whitespace);
    const elMx = get<HTMLInputElement>('#set-max-file-size-mb'); if (elMx) elMx.value = String(cfg.diff?.max_file_size_mb ?? 0);
    const elIn = get<HTMLInputElement>('#set-intraline'); if (elIn) elIn.checked = !!cfg.diff?.intraline;
    const elBp = get<HTMLInputElement>('#set-binary-placeholders'); if (elBp) elBp.checked = !!cfg.diff?.show_binary_placeholders;

    const elLe = get<HTMLInputElement>('#set-lfs-enabled'); if (elLe) elLe.checked = !!cfg.lfs?.enabled;
    const elLc = get<HTMLInputElement>('#set-lfs-concurrency'); if (elLc) elLc.value = String(cfg.lfs?.concurrency ?? 0);
    
    const elLl = get<HTMLInputElement>('#set-lfs-require-lock'); if (elLl) elLl.checked = !!cfg.lfs?.require_lock_before_edit;
    const elBg = get<HTMLInputElement>('#set-lfs-bg-fetch'); if (elBg) elBg.checked = !!cfg.lfs?.background_fetch_on_checkout;
    elLe?.dispatchEvent(new Event('change'));

    const elPrg= get<HTMLInputElement>('#set-progressive-render'); if (elPrg) elPrg.checked = !!cfg.performance?.progressive_render;
    const elGpu= get<HTMLInputElement>('#set-gpu-accel'); if (elGpu) elGpu.checked = !!cfg.performance?.gpu_accel;

    const elUi = get<HTMLInputElement>('#set-ui-scale'); if (elUi) elUi.value = String(cfg.ux?.ui_scale ?? 1.0);
    const elFm = get<HTMLInputElement>('#set-font-mono'); if (elFm) elFm.value = cfg.ux?.font_mono ?? 'monospace';
    const elVn = get<HTMLInputElement>('#set-vim-nav'); if (elVn) elVn.checked = !!cfg.ux?.vim_nav;
    const elCb = get<HTMLSelectElement>('#set-cb-mode'); if (elCb) elCb.value = toKebab(cfg.ux?.color_blind_mode);

    // Logging
    const elLvl = get<HTMLSelectElement>('#set-log-level'); if (elLvl) elLvl.value = toKebab(cfg.logging?.level || 'info');
    const elKeep= get<HTMLInputElement>('#set-log-keep'); if (elKeep) elKeep.value = String(cfg.logging?.retain_archives ?? 10);
}
