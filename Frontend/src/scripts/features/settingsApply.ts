// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { toKebab } from '../lib/dom';
import { populateSelect } from '../lib/forms';
import { loadPluginsIntoForm } from './settingsPlugins';
import { loadGeneralSettingsIntoForm } from './settingsGeneral';
import { loadCommitSettingsIntoForm } from './settingsCommit';
import { rebuildThemePackOptions } from './settingsTheme';
import type { GlobalSettings } from '../types';

/** Refreshes the default backend selector with the available VCS backends. */
async function refreshDefaultBackendOptions(modal: HTMLElement, cfg: GlobalSettings): Promise<void> {
    const el = modal.querySelector<HTMLSelectElement>('#set-default-backend');
    if (!el) return;

    const desired = String(cfg.general?.default_backend || '').trim();

    let available: Array<[string, string]> = [];
    let defaultBackendId = '';
    try {
        const res = await TAURI.invoke<{ backends: Array<[string, string]>; default_backend_id: string }>('list_vcs_backends_cmd');
        available = Array.isArray(res?.backends) ? res.backends : [];
        defaultBackendId = String(res?.default_backend_id || '').trim();
    } catch {}

    const backends = available
        .map(([id, name]) => [String(id || '').trim(), String(name || '').trim()] as const)
        .filter(([id]) => id.length > 0);

    const preferred = (desired && backends.some(([id]) => id === desired))
        ? desired
        : (defaultBackendId && backends.some(([id]) => id === defaultBackendId))
            ? defaultBackendId
            : '';
    populateSelect(el, backends, preferred);

    el.disabled = backends.length === 0;
    if (!backends.length) {
        console.warn(
            'settings: no VCS backends are currently available; default backend selection is disabled',
        );
        return;
    }
}

/** Loads all settings into the settings modal form controls. */
export async function loadSettingsIntoForm(root?: HTMLElement) {
    const m = root || (document.getElementById('settings-modal') as HTMLElement | null);
    if (!m) return;
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => m.querySelector<T>(sel);
    let cfg: GlobalSettings | null = null;
    try {
        cfg = await TAURI.invoke<GlobalSettings>('get_global_settings');
    } catch { /* ignore */ }
    if (!cfg) return;

    m.dataset.currentCfg = JSON.stringify(cfg);

    await loadPluginsIntoForm(m, cfg);

    await loadGeneralSettingsIntoForm(m, cfg, toKebab, refreshDefaultBackendOptions, rebuildThemePackOptions);
    loadCommitSettingsIntoForm(m, cfg);
    const elRl = get<HTMLInputElement>('#set-recents-limit'); if (elRl) elRl.value = String(cfg.ux?.recents_limit ?? 10);

    const elTw = get<HTMLInputElement>('#set-tab-width'); if (elTw) elTw.value = String(cfg.diff?.tab_width ?? 0);
    const elIw = get<HTMLSelectElement>('#set-ignore-whitespace'); if (elIw) elIw.value = toKebab(cfg.diff?.ignore_whitespace);
    const elMx = get<HTMLInputElement>('#set-max-file-size-mb'); if (elMx) elMx.value = String(cfg.diff?.max_file_size_mb ?? 0);
    const elIn = get<HTMLInputElement>('#set-intraline'); if (elIn) elIn.checked = !!cfg.diff?.intraline;
    const elBp = get<HTMLInputElement>('#set-binary-placeholders'); if (elBp) elBp.checked = !!cfg.diff?.show_binary_placeholders;
    const elRestrict = get<HTMLInputElement>('#set-restrict-commit-summary'); if (elRestrict) elRestrict.checked = cfg.commit?.restrict_commit_summary !== false;
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

    const elAni= get<HTMLInputElement>('#set-animations'); if (elAni) elAni.checked = cfg.performance?.animations !== false;
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
