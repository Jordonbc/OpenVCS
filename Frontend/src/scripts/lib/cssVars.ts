// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Settings slice used by {@link applyAppearanceCssVars}.
 */
export interface AppearanceCssVarValues {
    /** Diff tab width (falls back to 4 when absent). */
    tabWidth?: unknown;
    /** UI scale factor (falls back to 1 when absent). */
    uiScale?: unknown;
    /** Monospace font family (applied only when non-empty). */
    fontMono?: unknown;
}

/**
 * Apply appearance-related CSS custom properties from a settings slice.
 *
 * Numeric values are guarded with `Number()` + `isFinite()`; the mono font is
 * trimmed and applied only when non-empty. When `clearMono` is set, an empty
 * mono font value removes the variable instead of leaving a stale value.
 *
 * @param cfg - Settings slice with the appearance values
 * @param clearMono - Remove `--mono` when the mono font value is empty
 */
export function applyAppearanceCssVars(cfg: AppearanceCssVarValues, clearMono = false): void {
    const root = document.documentElement;
    const tabw = Number(cfg.tabWidth ?? 4);
    if (tabw && isFinite(tabw)) root.style.setProperty('--tab-size', String(tabw));
    const uiScale = Number(cfg.uiScale ?? 1);
    if (uiScale && isFinite(uiScale)) root.style.setProperty('--ui-scale', String(uiScale));
    const mono = String(cfg.fontMono || '').trim();
    if (mono) root.style.setProperty('--mono', mono);
    else if (clearMono) root.style.removeProperty('--mono');
}
