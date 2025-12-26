import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { toKebab } from '../lib/dom';
import { notify } from '../lib/notify';
import { setTheme } from '../ui/layout';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID, getActiveThemeId, getAvailableThemes, refreshAvailableThemes, selectThemePack } from '../themes';
import { reloadPlugins } from '../plugins';
import type { PluginSummary } from '../plugins';
import type { GlobalSettings, ThemeSummary } from '../types';

const THEME_PACK_HINT = 'Install a theme ZIP into the themes folder, or install a plugin that provides themes.';
const SYSTEM_DARK_MQ = matchMedia('(prefers-color-scheme: dark)');

function normalizeAppearance(value: unknown): 'light' | 'dark' | 'both' | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'light' || raw === 'dark' || raw === 'both') return raw;
    return null;
}

function modeForTheme(themeId: string): 'light' | 'dark' {
    const desired = (themeId || DEFAULT_LIGHT_THEME_ID).trim().toLowerCase() || DEFAULT_LIGHT_THEME_ID;
    const summary = getAvailableThemes().find((t) => (t.id || '').toLowerCase() === desired);
    const appearance = normalizeAppearance(summary?.appearance);
    if (appearance === 'light') return 'light';
    if (appearance === 'dark') return 'dark';
    return SYSTEM_DARK_MQ.matches ? 'dark' : 'light';
}

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

async function rebuildThemePackOptions(
    selectEl: HTMLSelectElement,
    opts: { desiredId?: string | null; forceReload?: boolean } = {},
) {
    const { desiredId, forceReload } = opts;
    if (forceReload) {
        try {
            await refreshAvailableThemes();
        } catch {
            // ignore refresh errors; fallback to whatever themes are cached
        }
    }

    const themes = getAvailableThemes();
    const desiredLower = String(desiredId ?? selectEl.value ?? DEFAULT_LIGHT_THEME_ID).trim().toLowerCase() || DEFAULT_LIGHT_THEME_ID;

    selectEl.innerHTML = '';
    for (const theme of themes) {
        const opt = document.createElement('option');
        opt.value = theme.id;
        opt.textContent = themeOptionLabel(theme);
        opt.title = themeTooltip(theme.id);
        selectEl.appendChild(opt);
    }

    const match = themes.find((t) => t.id.toLowerCase() === desiredLower);
    selectEl.value = match ? match.id : DEFAULT_LIGHT_THEME_ID;
    selectEl.title = themeTooltip(selectEl.value || DEFAULT_LIGHT_THEME_ID);
}

export function openSettings(section?: string){
    openModal('settings-modal');
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (!modal) return;
    if (section) activateSection(modal, section);

    // Prevent a "double-click to refresh" feel where the user opens the Theme dropdown
    // before the async settings/theme list has finished loading.
    if (TAURI.has) {
        modal.setAttribute('aria-busy', 'true');
        const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
        const setThemeSel = modal.querySelector<HTMLSelectElement>('#set-theme');
        if (setThemeAuto) setThemeAuto.disabled = true;
        if (setThemeSel) {
            setThemeSel.disabled = true;
            setThemeSel.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = DEFAULT_LIGHT_THEME_ID;
            opt.textContent = 'Loading…';
            setThemeSel.appendChild(opt);
        }
    }

    loadSettingsIntoForm(modal)
        .catch(console.error)
        .finally(() => {
            modal.removeAttribute('aria-busy');
            const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
            if (setThemeAuto) setThemeAuto.disabled = false;
        });
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

    // Plugins are applied immediately (no Save/Cancel).
    const actions = modal.querySelector<HTMLElement>('.sheet-actions');
    if (actions) actions.classList.toggle('hidden', section === 'plugins');
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

    const mergeModeSel = modal.querySelector('#set-merge-mode') as HTMLSelectElement | null;
    const mergeCustomGroups = Array.from(modal.querySelectorAll<HTMLElement>('[data-merge-custom]'));

    const updateMergeCustomState = () => {
        const custom = (mergeModeSel?.value || 'builtin') === 'custom';
        mergeCustomGroups.forEach((group) => {
            group.classList.toggle('disabled', !custom);
            group.querySelectorAll('input, textarea, select').forEach((field) => {
                (field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled = !custom;
            });
        });
    };
    updateMergeCustomState();
    mergeModeSel?.addEventListener('change', updateMergeCustomState);

    const sshBinSel = modal.querySelector('#set-git-ssh-binary') as HTMLSelectElement | null;
    const sshPathInput = modal.querySelector('#set-git-ssh-path') as HTMLInputElement | null;
    const updateSshPathState = () => {
        if (!sshPathInput) return;
        const mode = (sshBinSel?.value || 'auto').toLowerCase();
        const enabled = mode === 'custom';
        sshPathInput.disabled = !enabled;
        if (!enabled) sshPathInput.value = '';
    };
    updateSshPathState();
    sshBinSel?.addEventListener('change', updateSshPathState);

    const setThemeAuto = modal.querySelector<HTMLInputElement>('#set-theme-auto');
    const setThemeSel = modal.querySelector<HTMLSelectElement>('#set-theme');

    const syncThemeTitle = () => {
        if (!setThemeSel) return;
        setThemeSel.title = themeTooltip(setThemeSel.value || DEFAULT_LIGHT_THEME_ID);
    };

    const applyThemeFromControls = async (opts: { silent?: boolean } = {}) => {
        if (!setThemeSel) return;
        const auto = !!setThemeAuto?.checked;
        setThemeSel.disabled = auto;

        const themeId = setThemeSel.value || DEFAULT_LIGHT_THEME_ID;
        const mode: 'system' | 'light' | 'dark' = auto ? 'system' : modeForTheme(themeId);
        setTheme(mode);
        await selectThemePack(themeId, { silent: opts.silent, mode });
        if (auto) {
            setThemeSel.value = getActiveThemeId() || DEFAULT_LIGHT_THEME_ID;
        }
        syncThemeTitle();
    };

    setThemeSel?.addEventListener('pointerdown', () => {
        if (setThemeAuto?.checked) return;

        // Keep the options list in sync with the already-cached theme list without
        // kicking off an async refresh during the same user gesture (which makes the
        // native picker look stale until it's opened again).
        rebuildThemePackOptions(setThemeSel, {
            desiredId: setThemeSel.value,
            forceReload: false,
        }).catch(() => {});
    });

    setThemeSel?.addEventListener('change', () => {
        applyThemeFromControls({ silent: true }).catch(() => {});
    });

    setThemeAuto?.addEventListener('change', () => {
        applyThemeFromControls({ silent: true }).catch(() => {});
    });

    window.addEventListener('openvcs:theme-pack-changed', () => {
        if (!setThemeAuto?.checked || !setThemeSel) return;
        setThemeSel.value = getActiveThemeId() || DEFAULT_LIGHT_THEME_ID;
        setThemeSel.disabled = true;
        syncThemeTitle();
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
            const theme = (next.general?.theme || 'system') as 'system' | 'light' | 'dark';
            const pack = String(next.general?.theme_pack || DEFAULT_LIGHT_THEME_ID);
            setTheme(theme);
            try { await selectThemePack(pack, { silent: true, mode: theme }); } catch {}
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

            cur.general = {
                theme: 'system',
                theme_pack: DEFAULT_LIGHT_THEME_ID,
                language: 'system',
                default_backend: 'git',
                update_channel: 'stable',
                reopen_last_repos: true,
                checks_on_launch: true,
                telemetry: false,
                crash_reports: false,
            };
            cur.git = { backend: 'system', default_branch: 'main', prune_on_fetch: true, fetch_on_focus: true, allow_hooks: 'ask', respect_core_autocrlf: true, merge_commit_message_template: "Merged branch '{branch:source}' into '{branch:target}'" };
            cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
            cur.lfs = { enabled: true, concurrency: 4, require_lock_before_edit: false, background_fetch_on_checkout: true };
            cur.performance = { progressive_render: true, gpu_accel: true };
            cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none', recents_limit: 10 };
            cur.logging = { level: 'info', live_viewer: false, retain_archives: 10 };
            cur.plugins = { disabled: [] };

            await TAURI.invoke('set_global_settings', { cfg: cur });
            await loadSettingsIntoForm(modal);
            setTheme('system');
            try { await selectThemePack(DEFAULT_LIGHT_THEME_ID, { silent: true, mode: 'system' }); } catch {}
            notify('Defaults restored');
        } catch { notify('Failed to restore defaults'); }
    });

    // Settings are loaded by `openSettings()` on open.
}

function collectSettingsFromForm(root: HTMLElement): GlobalSettings {
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

    const base = JSON.parse(root?.dataset.currentCfg || '{}');

    const o: GlobalSettings = { ...base };

    const autoTheme = !!get<HTMLInputElement>('#set-theme-auto')?.checked;
    const themePack = get<HTMLSelectElement>('#set-theme')?.value || DEFAULT_LIGHT_THEME_ID;
    const theme = autoTheme ? 'system' : modeForTheme(themePack);

    o.general = {
        ...o.general,
        theme,
        theme_pack: themePack || DEFAULT_LIGHT_THEME_ID,
        language: get<HTMLSelectElement>('#set-language')?.value,
        default_backend: (get<HTMLSelectElement>('#set-default-backend')?.value || 'git') as any,
        update_channel: (() => { const v = get<HTMLSelectElement>('#set-update-channel')?.value; return v === 'beta' ? 'nightly' : v; })(),
        reopen_last_repos: !!get<HTMLInputElement>('#set-reopen-last')?.checked,
        checks_on_launch: !!get<HTMLInputElement>('#set-checks-on-launch')?.checked,
    };

    o.git = {
        ...o.git,
        backend: get<HTMLSelectElement>('#set-git-backend')?.value as any,
        merge_commit_message_template: get<HTMLInputElement>('#set-merge-message-template')?.value ?? '',
        ssh_binary: (get<HTMLSelectElement>('#set-git-ssh-binary')?.value || 'auto') as any,
        ssh_path: (get<HTMLInputElement>('#set-git-ssh-path')?.value || '').trim(),
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
        external_merge: (() => {
            const mode = get<HTMLSelectElement>('#set-merge-mode')?.value || 'builtin';
            const path = (get<HTMLInputElement>('#set-merge-path')?.value || '').trim();
            const args = get<HTMLInputElement>('#set-merge-args')?.value || '';
            return {
                enabled: mode === 'custom' && path.length > 0,
                path,
                args,
            };
        })(),
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

    const pluginsStateKey = '__pluginsPanelState';
    const pluginsState = (root as any)[pluginsStateKey] as { disabled?: Set<string>; list?: PluginSummary[] } | undefined;
    if (pluginsState?.disabled instanceof Set) {
        const byLower = new Map<string, string>();
        for (const plugin of Array.isArray(pluginsState.list) ? pluginsState.list : []) {
            const id = String(plugin?.id || '').trim();
            if (!id) continue;
            byLower.set(id.toLowerCase(), id);
        }
        const disabled = Array.from(pluginsState.disabled.values())
            .map((id) => String(id || '').trim().toLowerCase())
            .filter(Boolean)
            .map((id) => byLower.get(id) || id);
        o.plugins = { ...(o.plugins || {}), disabled };
    } else {
        const pluginToggles = Array.from(root.querySelectorAll<HTMLInputElement>('[data-plugin-id]'));
        if (pluginToggles.length) {
            const disabled: string[] = [];
            for (const toggle of pluginToggles) {
                const id = String(toggle.dataset.pluginId || '').trim();
                if (!id) continue;
                if (!toggle.checked) disabled.push(id);
            }
            o.plugins = { ...(o.plugins || {}), disabled };
        }
    }

    return o;
}

export async function loadSettingsIntoForm(root?: HTMLElement) {
    const m = root || (document.getElementById('settings-modal') as HTMLElement | null);
    if (!m) return;
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => m.querySelector<T>(sel);
    const cfg = TAURI.has ? await TAURI.invoke<GlobalSettings>('get_global_settings') : null;
    if (!cfg) return;

    m.dataset.currentCfg = JSON.stringify(cfg);

    await loadPluginsIntoForm(m, cfg);

    const themeSel = get<HTMLSelectElement>('#set-theme');
    const elAuto = get<HTMLInputElement>('#set-theme-auto');
    const themePref = (cfg.general?.theme || 'system') as 'system'|'light'|'dark';

    if (elAuto) elAuto.checked = themePref === 'system';

    if (themeSel) {
        let desiredId = String(cfg.general?.theme_pack || DEFAULT_LIGHT_THEME_ID);
        if (desiredId.trim().toLowerCase() === DEFAULT_THEME_ID) {
            desiredId = themePref === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
        }
        await rebuildThemePackOptions(themeSel, {
            desiredId,
            forceReload: true,
        });
        themeSel.disabled = themePref === 'system';
        if (themePref === 'system') {
            themeSel.value = getActiveThemeId() || themeSel.value;
        }
    }

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
    const elMmt = get<HTMLInputElement>('#set-merge-message-template');
    if (elMmt) elMmt.value = cfg.git?.merge_commit_message_template ?? '';
    const elSshBin = get<HTMLSelectElement>('#set-git-ssh-binary');
    if (elSshBin) elSshBin.value = toKebab(cfg.git?.ssh_binary) || 'auto';
    const elSshPath = get<HTMLInputElement>('#set-git-ssh-path');
    if (elSshPath) elSshPath.value = cfg.git?.ssh_path ?? '';
    if (elSshPath) {
        const enabled = (elSshBin?.value || 'auto') === 'custom';
        elSshPath.disabled = !enabled;
        if (!enabled) elSshPath.value = '';
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
    const elMm = get<HTMLSelectElement>('#set-merge-mode');
    const elMp = get<HTMLInputElement>('#set-merge-path');
    const elMa = get<HTMLInputElement>('#set-merge-args');
    if (elMp) elMp.value = cfg.diff?.external_merge?.path ?? '';
    if (elMa) elMa.value = cfg.diff?.external_merge?.args ?? '';
    if (elMm) {
        const ext = cfg.diff?.external_merge;
        elMm.value = ext && ext.enabled && (ext.path || '').trim().length > 0 ? 'custom' : 'builtin';
        elMm.dispatchEvent(new Event('change'));
    }

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

async function loadPluginsIntoForm(modal: HTMLElement, cfg: GlobalSettings) {
    const pane = modal.querySelector<HTMLElement>('#plugins-pane');
    const listEl = modal.querySelector<HTMLElement>('#plugins-list');
    const detailEl = modal.querySelector<HTMLElement>('#plugins-detail');
    const groupLabelEl = modal.querySelector<HTMLElement>('#plugins-group-label');
    const searchEl = modal.querySelector<HTMLInputElement>('#plugins-search');
    const enableAllBtn = modal.querySelector<HTMLButtonElement>('#plugins-enable-all');
    const disableAllBtn = modal.querySelector<HTMLButtonElement>('#plugins-disable-all');

    if (!pane || !listEl || !detailEl || !groupLabelEl || !searchEl || !enableAllBtn || !disableAllBtn) return;

    listEl.replaceChildren();
    detailEl.replaceChildren();
    detailEl.classList.add('empty');
    detailEl.textContent = 'Select a plugin to view details.';

    if (!TAURI.has) {
        groupLabelEl.textContent = 'Installed (0 of 0 enabled)';
        listEl.replaceChildren();
        return;
    }

    let list: PluginSummary[] = [];
    try {
        list = await TAURI.invoke<PluginSummary[]>('list_plugins');
    } catch {
        groupLabelEl.textContent = 'Installed (0 of 0 enabled)';
        listEl.replaceChildren();
        detailEl.classList.add('empty');
        detailEl.textContent = 'Failed to load plugins.';
        return;
    }

    const disabled = new Set(
        (Array.isArray(cfg.plugins?.disabled) ? cfg.plugins!.disabled! : [])
            .map((s) => String(s || '').trim().toLowerCase())
            .filter(Boolean),
    );

    const stateKey = '__pluginsPanelState';
    type PluginsPanelState = {
        list: PluginSummary[];
        disabled: Set<string>;
        query: string;
        selectedId: string | null;
    };
    const state: PluginsPanelState = (modal as any)[stateKey] || {
        list: [],
        disabled: new Set<string>(),
        query: '',
        selectedId: null,
    };
    state.list = Array.isArray(list) ? list : [];
    state.disabled = disabled;
    state.query = String(searchEl.value || '').trim().toLowerCase();

    const matchesQuery = (p: PluginSummary, q: string): boolean => {
        if (!q) return true;
        const tags = Array.isArray(p.tags) ? String(p.tags.join(' ') || '') : '';
        const hay = [
            p.name,
            p.id,
            p.author,
            p.description,
            p.category,
            tags,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    };

    const enabledCount = state.list.filter((p) => p?.id && !state.disabled.has(String(p.id).trim().toLowerCase())).length;
    groupLabelEl.textContent = `Installed (${enabledCount} of ${state.list.length} enabled)`;

    const filtered = state.list.filter((p) => p && p.id && p.name && matchesQuery(p, state.query));

    const ensureSelection = () => {
        const current = state.selectedId ? String(state.selectedId).trim() : '';
        if (current && filtered.some((p) => String(p.id).trim() === current)) return;
        state.selectedId = filtered.length ? String(filtered[0].id).trim() : null;
    };

    const renderDetails = () => {
        detailEl.replaceChildren();
        const selectedId = state.selectedId ? String(state.selectedId).trim() : '';
        const plugin = state.list.find((p) => String(p?.id || '').trim() === selectedId) || null;
        if (!plugin) {
            detailEl.classList.add('empty');
            detailEl.textContent = filtered.length ? 'Select a plugin to view details.' : 'No plugins installed.';
            return;
        }
        detailEl.classList.remove('empty');

        const id = String(plugin.id).trim();
        const idLower = id.toLowerCase();
        const isEnabled = !state.disabled.has(idLower);
        const version = String(plugin.version || '').trim();
        const author = String(plugin.author || '').trim();
        const category = String(plugin.category || '').trim();
        const tags = Array.isArray(plugin.tags)
            ? plugin.tags.map((t) => String(t || '').trim()).filter(Boolean)
            : [];
        const themeCount = Number(plugin.theme_dirs ?? 0) || 0;

        const head = document.createElement('div');
        head.className = 'plugin-detail-head';

        const title = document.createElement('div');
        title.className = 'plugin-detail-title';
        const nameEl = document.createElement('div');
        nameEl.className = 'name';
        nameEl.textContent = String(plugin.name || id).trim();
        const metaEl = document.createElement('div');
        metaEl.className = 'meta';
        metaEl.textContent = [
            category || '',
            version ? `v${version}` : '',
            author || '',
        ].filter(Boolean).join(' • ') || ' ';
        title.appendChild(nameEl);
        title.appendChild(metaEl);

        const actions = document.createElement('div');
        actions.className = 'plugin-detail-actions';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'tbtn';
        toggle.id = 'plugins-toggle-selected';
        toggle.textContent = isEnabled ? 'Disable' : 'Enable';
        toggle.dataset.pluginToggle = id;
        actions.appendChild(toggle);

        head.appendChild(title);
        head.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'plugin-detail-body';
        const descText = String(plugin.description || '').trim();
        if (descText) {
            const desc = document.createElement('div');
            desc.className = 'desc';
            desc.textContent = descText;
            body.appendChild(desc);
        }

        const kv = document.createElement('div');
        kv.className = 'plugin-detail-kv';
        const row = (k: string, v: string) => {
            const kEl = document.createElement('div');
            kEl.className = 'k';
            kEl.textContent = k;
            const vEl = document.createElement('div');
            vEl.className = 'v';
            vEl.textContent = v;
            kv.appendChild(kEl);
            kv.appendChild(vEl);
        };
        row('ID', id);
        row('Code', plugin.entry ? 'Yes' : 'No');
        row('Themes', themeCount ? String(themeCount) : '0');
        if (category) row('Category', category);
        if (tags.length) row('Tags', tags.join(', '));
        if (author) row('Author', author);
        if (version) row('Version', version);
        body.appendChild(kv);

        detailEl.appendChild(head);
        detailEl.appendChild(body);
    };

    const renderList = () => {
        listEl.replaceChildren();
        if (!state.list.length) {
            const li = document.createElement('li');
            li.className = 'plugin-row';
            li.setAttribute('aria-selected', 'false');
            li.textContent = 'No plugins installed.';
            listEl.appendChild(li);
            renderDetails();
            return;
        }

        if (!filtered.length) {
            const li = document.createElement('li');
            li.className = 'plugin-row';
            li.setAttribute('aria-selected', 'false');
            li.textContent = 'No matching plugins.';
            listEl.appendChild(li);
            renderDetails();
            return;
        }

        for (const plugin of filtered) {
            const id = String(plugin.id).trim();
            const idLower = id.toLowerCase();
            const isEnabled = !state.disabled.has(idLower);

            const li = document.createElement('li');
            li.className = 'plugin-row';
            li.dataset.plugin = id;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', state.selectedId === id ? 'true' : 'false');

            const main = document.createElement('div');
            main.className = 'plugin-row-main';

            const icon = document.createElement('div');
            icon.className = 'plugin-icon';
            const initial = String(plugin.name || id).trim().slice(0, 1).toUpperCase() || 'P';
            icon.textContent = initial;

            const text = document.createElement('div');
            text.className = 'plugin-row-text';
            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = String(plugin.name || id).trim();
            const meta = document.createElement('div');
            meta.className = 'meta';
            const version = String(plugin.version || '').trim();
            const author = String(plugin.author || '').trim();
            const category = String(plugin.category || '').trim();
            meta.textContent = [category, author, version ? `v${version}` : ''].filter(Boolean).join(' • ') || id;
            text.appendChild(name);
            text.appendChild(meta);

            main.appendChild(icon);
            main.appendChild(text);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isEnabled;
            checkbox.dataset.pluginId = id;
            checkbox.setAttribute('aria-label', `Enable ${plugin.name || id}`);

            li.appendChild(main);
            li.appendChild(checkbox);
            listEl.appendChild(li);
        }

        renderDetails();
    };

    const updateCounts = () => {
        const enabledNow = state.list.filter((p) => p?.id && !state.disabled.has(String(p.id).trim().toLowerCase())).length;
        groupLabelEl.textContent = `Installed (${enabledNow} of ${state.list.length} enabled)`;
    };

    ensureSelection();
    (modal as any)[stateKey] = state;
    renderList();

    const persistPluginsDisabled = async () => {
        if (!TAURI.has) return;
        try {
            const cur = await TAURI.invoke<GlobalSettings>('get_global_settings');
            const next: GlobalSettings = { ...(cur || {}) };
            next.plugins = { ...(next.plugins || {}) };
            next.plugins.disabled = Array.from(state.disabled.values());
            await TAURI.invoke('set_global_settings', { cfg: next });
            modal.dataset.currentCfg = JSON.stringify(next);
            await reloadPlugins();
            try {
                await refreshAvailableThemes();
                const themeSel = modal.querySelector<HTMLSelectElement>('#set-theme');
                if (themeSel && document.activeElement !== themeSel) {
                    await rebuildThemePackOptions(themeSel, { desiredId: themeSel.value, forceReload: false });
                }
            } catch {}
        } catch {
            notify('Failed to update plugins');
        }
    };

    if (!(pane as any).__wired) {
        (pane as any).__wired = true;

        pane.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            const toggleBtn = target?.closest<HTMLButtonElement>('[data-plugin-toggle]') || null;
            if (toggleBtn) {
                const id = String(toggleBtn.dataset.pluginToggle || '').trim();
                const checkbox = pane.querySelector<HTMLInputElement>(`input[type="checkbox"][data-plugin-id="${CSS.escape(id)}"]`);
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return;
            }

            const row = target?.closest<HTMLElement>('.plugin-row[data-plugin]') || null;
            if (!row) return;
            const id = String(row.dataset.plugin || '').trim();
            if (!id) return;
            state.selectedId = id;
            renderList();
        });

        pane.addEventListener('change', (e) => {
            const el = e.target as HTMLInputElement | null;
            if (!el || el.type !== 'checkbox' || !el.dataset.pluginId) return;
            const id = String(el.dataset.pluginId).trim().toLowerCase();
            if (!id) return;
            if (el.checked) state.disabled.delete(id);
            else state.disabled.add(id);
            updateCounts();
            renderDetails();
            persistPluginsDisabled().catch(() => {});
        });

        searchEl.addEventListener('input', () => {
            state.query = String(searchEl.value || '').trim().toLowerCase();
            ensureSelection();
            renderList();
        });

        enableAllBtn.addEventListener('click', () => {
            for (const p of state.list) {
                const id = String(p?.id || '').trim().toLowerCase();
                if (id) state.disabled.delete(id);
            }
            searchEl.dispatchEvent(new Event('input'));
            updateCounts();
            persistPluginsDisabled().catch(() => {});
        });

        disableAllBtn.addEventListener('click', () => {
            for (const p of state.list) {
                const id = String(p?.id || '').trim().toLowerCase();
                if (id) state.disabled.add(id);
            }
            searchEl.dispatchEvent(new Event('input'));
            updateCounts();
            persistPluginsDisabled().catch(() => {});
        });

        pane.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === '/' && document.activeElement !== searchEl) {
                e.preventDefault();
                searchEl.focus();
            }
        });
    }
}
