// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    DEFAULT_LIGHT_THEME_ID,
    getAvailableThemes,
    refreshAvailableThemes,
} from '../themes';
import type { ThemeSummary } from '../types';

const THEME_PACK_HINT = 'Install a theme ZIP into the themes folder, or install a plugin that provides themes.';
const SYSTEM_DARK_MQ = matchMedia('(prefers-color-scheme: dark)');

/** Applies the animation preference as a data attribute on document root. */
export function applyAnimationPreference(enabled: boolean | undefined | null): void {
    document.documentElement.dataset.animations = enabled === false ? 'off' : 'on';
}

/** Normalizes an appearance value to 'light' | 'dark' | 'both' or null. */
function normalizeAppearance(value: unknown): 'light' | 'dark' | 'both' | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'light' || raw === 'dark' || raw === 'both') return raw;
    return null;
}

/** Resolves a theme ID to 'light' | 'dark' using appearance metadata or the system color scheme. */
export function modeForTheme(themeId: string): 'light' | 'dark' {
    const desired = (themeId || DEFAULT_LIGHT_THEME_ID).trim().toLowerCase() || DEFAULT_LIGHT_THEME_ID;
    const summary = getAvailableThemes().find((t) => (t.id || '').toLowerCase() === desired);
    const appearance = normalizeAppearance(summary?.appearance);
    if (appearance === 'light') return 'light';
    if (appearance === 'dark') return 'dark';
    return SYSTEM_DARK_MQ.matches ? 'dark' : 'light';
}

/** Formats a theme label including version when available. */
function themeOptionLabel(theme: ThemeSummary): string {
    const version = theme.version?.trim();
    return version ? `${theme.name} (${version})` : theme.name;
}

/** Builds a theme tooltip from description, author, and version. */
export function themeTooltip(id: string): string {
    const theme = getAvailableThemes().find((t) => t.id.toLowerCase() === id.toLowerCase());
    if (!theme) return THEME_PACK_HINT;
    const details: string[] = [];
    if (theme.description) details.push(theme.description);
    const meta = [theme.author, theme.version].filter(Boolean).join(' • ');
    if (meta) details.push(meta);
    return details.join('\n') || THEME_PACK_HINT;
}

/** Rebuilds a theme <select>'s options from the cached theme list, optionally forcing a refresh. */
export async function rebuildThemePackOptions(
    selectEl: HTMLSelectElement,
    opts: { desiredId?: string | null; forceReload?: boolean } = {},
): Promise<void> {
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
