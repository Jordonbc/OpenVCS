// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { collectGeneralSettings } from './settingsGeneral';
import { collectCommitSettings, collectCommitTemplateSettings } from './settingsCommit';
import { modeForTheme } from './settingsTheme';
import type { PluginSummary } from '../plugins';
import type { GlobalSettings } from '../types';

/** Collects all settings currently held by the settings form controls. */
export function collectSettingsFromForm(root: HTMLElement): GlobalSettings {
    const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

    let base: Partial<GlobalSettings> = {};
    try {
        base = JSON.parse(root?.dataset.currentCfg || '{}');
    } catch {
        // Corrupted or missing config — fall back to defaults.
    }

    const o: GlobalSettings = { ...base };

    o.general = collectGeneralSettings(root, o, modeForTheme);
    o.commit = {
        ...o.commit,
        ...collectCommitSettings(root),
        commit_templates: {
            ...(o.commit?.commit_templates || {}),
            ...collectCommitTemplateSettings(root),
        },
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

    o.performance = {
        ...o.performance,
        animations: !!get<HTMLInputElement>('#set-animations')?.checked,
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
    const pluginsState = (root as any)[pluginsStateKey] as { disabled?: Set<string>; enabled?: Set<string>; list?: PluginSummary[] } | undefined;
    if (pluginsState?.disabled instanceof Set && pluginsState?.enabled instanceof Set) {
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

        const enabled = Array.from(pluginsState.enabled.values())
            .map((id) => String(id || '').trim().toLowerCase())
            .filter(Boolean)
            .map((id) => byLower.get(id) || id);

        o.plugins = { ...(o.plugins || {}), disabled, enabled };
    } else {
        const pluginToggles = Array.from(root.querySelectorAll<HTMLInputElement>('[data-plugin-id]'));
        if (pluginToggles.length) {
            const disabled: string[] = [];
            const enabled: string[] = [];
            for (const toggle of pluginToggles) {
                const id = String(toggle.dataset.pluginId || '').trim();
                if (!id) continue;
                if (toggle.checked) enabled.push(id);
                else disabled.push(id);
            }
            o.plugins = { ...(o.plugins || {}), disabled, enabled };
        }
    }

    return o;
}
