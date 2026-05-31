// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from './lib/tauri';
import { notify } from './lib/notify';
import { getRegisteredThemePayload, getRegisteredThemeSummaries } from './plugins';
import type { ThemePayload, ThemeSummary } from './types';

export const DEFAULT_THEME_ID = 'default';
export const DEFAULT_LIGHT_THEME_ID = 'default-light';
export const DEFAULT_DARK_THEME_ID = 'default-dark';

const GLOBAL_STYLE_ID = 'openvcs-theme-global';
const MODE_STYLE_ID = 'openvcs-theme-mode';
const THEME_PACK_ATTR = 'data-theme-pack';
const SYSTEM_DARK_MQ = matchMedia('(prefers-color-scheme: dark)');

const HEAD_MARKUP_NODES: ChildNode[] = [];
const BODY_MARKUP_NODES: ChildNode[] = [];
const THEME_SCRIPT_NODES: HTMLScriptElement[] = [];

let availableThemes: ThemeSummary[] = [defaultLightSummary(), defaultDarkSummary()];
let activeThemeId = defaultThemeIdForMode('system');
let activeThemePackId = defaultThemeIdForMode('system');
let activeStyles: string | null = null;
let activeMarkup: ThemePayload['markup'] | null = null;
let activeScripts: string[] = [];
let currentMode: 'system' | 'light' | 'dark' = 'system';
let systemListenerInstalled = false;

/** Resolves the current system appearance mode from media query state. */
function effectiveSystemMode(): 'light' | 'dark' {
    return SYSTEM_DARK_MQ.matches ? 'dark' : 'light';
}

/** Checks whether an id refers to one of the built-in defaults. */
function isBuiltInDefaultThemeId(id: string): boolean {
    const desired = String(id ?? '').trim().toLowerCase();
    return (
        desired === DEFAULT_THEME_ID
        || desired === DEFAULT_LIGHT_THEME_ID
        || desired === DEFAULT_DARK_THEME_ID
    );
}

/** Resolves the built-in default theme id for a display mode. */
function defaultThemeIdForMode(mode: 'system' | 'light' | 'dark'): string {
    const target = mode === 'system' ? effectiveSystemMode() : mode;
    return target === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
}

/** Normalizes theme appearance metadata from external sources. */
function normalizeAppearance(value: unknown): 'light' | 'dark' | 'both' | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'light' || raw === 'dark' || raw === 'both') return raw;
    return null;
}

/** Finds a loaded theme summary by id. */
function getThemeSummary(id: string): ThemeSummary | null {
    const desired = String(id || DEFAULT_THEME_ID).trim().toLowerCase() || DEFAULT_THEME_ID;
    return availableThemes.find((t) => (t.id || '').toLowerCase() === desired) ?? null;
}

/** Returns a paired theme id when switching between light and dark variants. */
function resolvePairedThemeId(id: string): string | null {
    const desired = String(id || DEFAULT_THEME_ID).trim() || DEFAULT_THEME_ID;
    const summary = getThemeSummary(desired);
    const appearance = normalizeAppearance(summary?.appearance);
    const target = effectiveSystemMode();
    const paired = String(summary?.paired_with ?? '').trim();
    if (!summary || !appearance || appearance === 'both') return null;
    if (appearance === target) return null;
    if (paired && paired.toLowerCase() !== desired.toLowerCase()) return paired;

    // Heuristic fallback: swap "-dark" <-> "-light" and "_dark" <-> "_light".
    const lowered = desired.toLowerCase();
    const candidates = [
        lowered.endsWith('-dark') ? desired.slice(0, -5) + '-light' : null,
        lowered.endsWith('-light') ? desired.slice(0, -6) + '-dark' : null,
        lowered.endsWith('_dark') ? desired.slice(0, -5) + '_light' : null,
        lowered.endsWith('_light') ? desired.slice(0, -6) + '_dark' : null,
    ].filter((x): x is string => !!x);

    for (const candidate of candidates) {
        const match = getThemeSummary(candidate);
        if (match) return match.id;
    }

    return null;
}

/** Broadcasts a theme-pack change event to the UI. */
function dispatchThemeChanged() {
    try {
        window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed', { detail: { id: activeThemeId } }));
    } catch {
        // ignore
    }
}

/** Installs a system color-scheme listener once. */
function ensureSystemListener() {
    if (systemListenerInstalled) return;
    systemListenerInstalled = true;
    SYSTEM_DARK_MQ.addEventListener('change', () => {
        if (currentMode !== 'system') return;
        const paired = resolvePairedThemeId(activeThemeId);
        if (paired) {
            selectThemePack(paired, { silent: true, mode: 'system' }).catch(() => {});
            return;
        }
        applyModeStyles('system');
    });
}

/** Builds the fallback built-in light theme summary. */
function defaultLightSummary(): ThemeSummary {
    return {
        id: DEFAULT_LIGHT_THEME_ID,
        name: 'Default (Light)',
        description: 'Built-in OpenVCS theme',
        appearance: 'light',
        paired_with: DEFAULT_DARK_THEME_ID,
        source: 'built-in',
    };
}

/** Builds the fallback built-in dark theme summary. */
function defaultDarkSummary(): ThemeSummary {
    return {
        id: DEFAULT_DARK_THEME_ID,
        name: 'Default (Dark)',
        description: 'Built-in OpenVCS theme',
        appearance: 'dark',
        paired_with: DEFAULT_LIGHT_THEME_ID,
        source: 'built-in',
    };
}

/** Sanitizes externally provided theme summary fields. */
function sanitizeSummary(raw: ThemeSummary): ThemeSummary {
    const id = String(raw?.id ?? '').trim() || DEFAULT_THEME_ID;
    const base: ThemeSummary = {
        id,
        name: String(raw?.name ?? id).trim() || id,
        description: raw?.description?.toString().trim() || undefined,
        version: raw?.version?.toString().trim() || undefined,
        author: raw?.author?.toString().trim() || undefined,
        appearance: raw?.appearance,
        paired_with: raw?.paired_with?.toString().trim() || undefined,
        source: (raw?.source as any) || (id.toLowerCase() === DEFAULT_THEME_ID ? 'built-in' : 'user'),
    };
    return base;
}

/** Creates, updates, or removes a style tag by id. */
function setStyleContent(id: string, css: string | null | undefined) {
    const existing = document.getElementById(id) as HTMLStyleElement | null;
    const text = typeof css === 'string' ? css : '';
    if (!text.trim()) {
        if (existing?.parentElement) {
            existing.parentElement.removeChild(existing);
        }
        return;
    }

    const target = existing ?? (() => {
        const el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
        return el;
    })();

    target.textContent = text;
}

/** Syncs the active theme-pack id onto the document root attribute. */
function syncThemePackAttr() {
    const root = document.documentElement;
    if (!root) return;
    if (isBuiltInDefaultThemeId(activeThemeId)) {
        root.removeAttribute(THEME_PACK_ATTR);
        return;
    }
    const current = (activeThemePackId || DEFAULT_THEME_ID).trim().toLowerCase();
    if (!current) {
        root.removeAttribute(THEME_PACK_ATTR);
        return;
    }
    root.setAttribute(THEME_PACK_ATTR, current);
}

/** Applies active markup snippets to head and body. */
function applyMarkupNodes() {
    const markup = activeMarkup ?? null;
    const headHtml = markup?.head ?? null;
    const bodyHtml = markup?.body ?? null;
    setMarkupForTarget(document.head, HEAD_MARKUP_NODES, headHtml);
    setMarkupForTarget(document.body, BODY_MARKUP_NODES, bodyHtml);
}

/** Strips dangerous script content from theme markup while preserving style/link/meta. */
function sanitizeThemeMarkup(root: ParentNode): void {
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;
        if (element.tagName.toLowerCase() === 'script') {
            element.remove();
            continue;
        }
        for (const attr of Array.from(element.attributes)) {
            if (attr.name.toLowerCase().startsWith('on')) {
                element.removeAttribute(attr.name);
            }
        }
        sanitizeThemeMarkup(element);
    }
}

/** Replaces tracked markup nodes for a target container. */
function setMarkupForTarget(target: ParentNode | null, store: ChildNode[], html: string | null | undefined) {
    const parent = target ?? null;
    if (!parent) return;
    clearNodes(store);
    const text = typeof html === 'string' ? html.trim() : '';
    if (!text) return;
    const template = document.createElement('template');
    template.innerHTML = text;
    sanitizeThemeMarkup(template.content);
    const nodes = Array.from(template.content.childNodes);
    for (const node of nodes) {
        parent.appendChild(node);
    }
    store.push(...nodes);
}

/** Rebuilds theme-provided script nodes from the active payload. */
function applyScriptNodes() {
    while (THEME_SCRIPT_NODES.length) {
        const node = THEME_SCRIPT_NODES.pop();
        node?.parentNode?.removeChild(node);
    }

    const scripts = Array.isArray(activeScripts) ? activeScripts : [];
    if (!scripts.length) return;
    const head = document.head;
    if (!head) return;

    scripts.forEach((code, index) => {
        if (typeof code !== 'string' || !code.trim()) return;
        const script = document.createElement('script');
        script.type = 'module';
        script.dataset.themePack = activeThemeId;
        script.setAttribute('data-theme-script-index', String(index));
        script.textContent = code;
        head.appendChild(script);
        THEME_SCRIPT_NODES.push(script);
    });
}

/** Removes tracked DOM nodes from the document. */
function clearNodes(store: ChildNode[]) {
    while (store.length) {
        const node = store.pop();
        node?.parentNode?.removeChild(node);
    }
}

/** Applies currently selected theme assets for the requested appearance mode. */
function applyModeStyles(mode: 'system' | 'light' | 'dark') {
    currentMode = mode;
    ensureSystemListener();
    syncThemePackAttr();
    const css = typeof activeStyles === 'string' ? activeStyles : '';
    setStyleContent(GLOBAL_STYLE_ID, css);
    setStyleContent(MODE_STYLE_ID, null);
    applyMarkupNodes();
    applyScriptNodes();
    dispatchThemeChanged();
}

/** Resolves the id written to the root theme-pack attribute. */
function resolveThemePackAttrId(summary: ThemeSummary | null | undefined, themeId: string): string {
    const rawId = String(summary?.id ?? themeId ?? DEFAULT_THEME_ID).trim() || DEFAULT_THEME_ID;
    const pluginId = String(summary?.plugin_id ?? '').trim();
    if (!pluginId) return rawId;
    const prefix = `${pluginId}.`;
    if (rawId.toLowerCase().startsWith(prefix.toLowerCase())) {
        return rawId.slice(prefix.length);
    }
    return rawId;
}

/** Returns the current list of available theme summaries. */
export function getAvailableThemes(): ThemeSummary[] {
    return [...availableThemes];
}

/** Returns the currently active theme id. */
export function getActiveThemeId(): string {
    return activeThemeId;
}

/** Returns the current appearance mode used by theme rendering. */
export function getCurrentMode(): 'system' | 'light' | 'dark' {
    return currentMode;
}

/** Refreshes available themes from backend and plugin registries. */
export async function refreshAvailableThemes(): Promise<ThemeSummary[]> {
    const pluginSummaries = getRegisteredThemeSummaries();

    try {
        const list = await TAURI.invoke<ThemeSummary[]>('list_themes');
        const others: ThemeSummary[] = [];
        const seen = new Set<string>([DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID]);

        for (const item of Array.isArray(list) ? list : []) {
            if (!item) continue;
            const summary = sanitizeSummary(item);
            const norm = summary.id.toLowerCase();
            if (seen.has(norm)) continue;
            seen.add(norm);
            others.push(summary);
        }

        for (const item of Array.isArray(pluginSummaries) ? pluginSummaries : []) {
            if (!item) continue;
            const summary = sanitizeSummary(item);
            const norm = summary.id.toLowerCase();
            if (seen.has(norm)) continue;
            seen.add(norm);
            others.push(summary);
        }

        others.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        availableThemes = [defaultLightSummary(), defaultDarkSummary(), ...others];
    } catch (error) {
        console.warn('list_themes failed', error);
        const others: ThemeSummary[] = [];
        const seen = new Set<string>([DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID]);
        for (const item of Array.isArray(pluginSummaries) ? pluginSummaries : []) {
            if (!item) continue;
            const summary = sanitizeSummary(item);
            const norm = summary.id.toLowerCase();
            if (seen.has(norm)) continue;
            seen.add(norm);
            others.push(summary);
        }
        others.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        availableThemes = [defaultLightSummary(), defaultDarkSummary(), ...others];
    }

    return availableThemes;
}

/** Ensures theme metadata has been loaded at least once. */
export async function ensureThemesLoaded(_force?: boolean): Promise<ThemeSummary[]> {
    return refreshAvailableThemes();
}

/** Loads and applies a theme pack for the requested mode. */
export async function selectThemePack(
    themeId: string,
    opts: { silent?: boolean; mode?: 'system' | 'light' | 'dark' } = {},
): Promise<void> {
    const desiredMode = opts.mode ?? currentMode;
    let target = (themeId || DEFAULT_THEME_ID).trim() || DEFAULT_THEME_ID;
    if (target.trim().toLowerCase() === DEFAULT_THEME_ID) {
        target = defaultThemeIdForMode(desiredMode);
    }

    if (desiredMode === 'system') {
        const originalTarget = target;
        let backendChangedTarget = false;
        try {
            const resolved = await TAURI.invoke<string>('resolve_theme_target', {
                id: target,
                mode: effectiveSystemMode(),
            });
            const resolvedTarget = String(resolved || '').trim();
            if (resolvedTarget) {
                backendChangedTarget = resolvedTarget.toLowerCase() !== originalTarget.toLowerCase();
                target = resolvedTarget;
            }
        } catch (error) {
            console.warn('resolve_theme_target failed', error);
        }

        if (!backendChangedTarget) {
            const paired = resolvePairedThemeId(target);
            if (paired) target = paired;
        }
    }

    const targetId = target.trim().toLowerCase();
    if (targetId === DEFAULT_LIGHT_THEME_ID || targetId === DEFAULT_DARK_THEME_ID) {
        activeThemeId = target;
        activeThemePackId = activeThemeId;
        activeStyles = null;
        activeMarkup = null;
        activeScripts = [];
        applyModeStyles(desiredMode);
        return;
    }

    const registered = getRegisteredThemePayload(target);
    if (registered) {
        activeThemeId = String(registered.summary?.id || target);
        activeThemePackId = resolveThemePackAttrId(registered.summary, activeThemeId);
        activeStyles = typeof registered.styles === 'string' ? registered.styles : null;
        activeMarkup = registered.markup ?? null;
        activeScripts = Array.isArray(registered.scripts) ? registered.scripts : [];
        applyModeStyles(desiredMode);
        return;
    }

    try {
        const payload = await TAURI.invoke<ThemePayload>('load_theme', { id: target });
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid theme payload');
        }
        activeThemeId = String(payload.summary?.id || target);
        activeThemePackId = resolveThemePackAttrId(payload.summary, activeThemeId);
        activeStyles = typeof payload.styles === 'string' ? payload.styles : null;
        activeMarkup = payload.markup ?? null;
        activeScripts = Array.isArray(payload.scripts) ? payload.scripts : [];
        applyModeStyles(desiredMode);
    } catch (error) {
        console.warn('load_theme failed', error);
        activeThemeId = defaultThemeIdForMode(desiredMode);
        activeThemePackId = activeThemeId;
        activeStyles = null;
        activeMarkup = null;
        activeScripts = [];
        applyModeStyles(desiredMode);
        if (!opts.silent) {
            notify('Theme failed to load. Reverted to the default theme.');
        }
        throw error;
    }
}

/** Reapplies active theme assets for a new appearance mode. */
export function setAppearanceMode(mode: 'system' | 'light' | 'dark') {
    applyModeStyles(mode);
}
