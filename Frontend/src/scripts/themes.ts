import { TAURI } from './lib/tauri';
import { notify } from './lib/notify';
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
let fetchedThemes = false;
let activeThemeId = defaultThemeIdForMode('system');
let activeStyles: ThemePayload['styles'] | null = null;
let activeMarkup: ThemePayload['markup'] | null = null;
let activeScripts: string[] = [];
let currentMode: 'system' | 'light' | 'dark' = 'system';
let systemListenerInstalled = false;

function effectiveSystemMode(): 'light' | 'dark' {
    return SYSTEM_DARK_MQ.matches ? 'dark' : 'light';
}

function isBuiltInDefaultThemeId(id: string): boolean {
    const desired = String(id ?? '').trim().toLowerCase();
    return (
        desired === DEFAULT_THEME_ID
        || desired === DEFAULT_LIGHT_THEME_ID
        || desired === DEFAULT_DARK_THEME_ID
    );
}

function defaultThemeIdForMode(mode: 'system' | 'light' | 'dark'): string {
    const target = mode === 'system' ? effectiveSystemMode() : mode;
    return target === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
}

function normalizeAppearance(value: unknown): 'light' | 'dark' | 'both' | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'light' || raw === 'dark' || raw === 'both') return raw;
    return null;
}

function getThemeSummary(id: string): ThemeSummary | null {
    const desired = String(id || DEFAULT_THEME_ID).trim().toLowerCase() || DEFAULT_THEME_ID;
    return availableThemes.find((t) => (t.id || '').toLowerCase() === desired) ?? null;
}

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

function dispatchThemeChanged() {
    try {
        window.dispatchEvent(new CustomEvent('openvcs:theme-pack-changed', { detail: { id: activeThemeId } }));
    } catch {
        // ignore
    }
}

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

function defaultSummary(): ThemeSummary {
    return {
        id: DEFAULT_THEME_ID,
        name: 'Default',
        description: 'Built-in OpenVCS theme',
        source: 'built-in',
    };
}

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

function syncThemePackAttr() {
    const root = document.documentElement;
    if (!root) return;
    const current = (activeThemeId || DEFAULT_THEME_ID).trim().toLowerCase();
    if (!current || isBuiltInDefaultThemeId(current)) {
        root.removeAttribute(THEME_PACK_ATTR);
        return;
    }
    root.setAttribute(THEME_PACK_ATTR, current);
}

function applyMarkupNodes() {
    const markup = activeMarkup ?? null;
    const headHtml = markup?.head ?? null;
    const bodyHtml = markup?.body ?? null;
    setMarkupForTarget(document.head, HEAD_MARKUP_NODES, headHtml);
    setMarkupForTarget(document.body, BODY_MARKUP_NODES, bodyHtml);
}

function setMarkupForTarget(target: ParentNode | null, store: ChildNode[], html: string | null | undefined) {
    const parent = target ?? null;
    if (!parent) return;
    clearNodes(store);
    const text = typeof html === 'string' ? html.trim() : '';
    if (!text) return;
    const template = document.createElement('template');
    template.innerHTML = text;
    const nodes = Array.from(template.content.childNodes);
    for (const node of nodes) {
        parent.appendChild(node);
    }
    store.push(...nodes);
}

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

function clearNodes(store: ChildNode[]) {
    while (store.length) {
        const node = store.pop();
        node?.parentNode?.removeChild(node);
    }
}

function applyModeStyles(mode: 'system' | 'light' | 'dark') {
    currentMode = mode;
    ensureSystemListener();
    syncThemePackAttr();
    const styles = activeStyles;
    const globalCss = styles?.global ?? null;
    setStyleContent(GLOBAL_STYLE_ID, globalCss);

    const selected = (() => {
        if (mode !== 'system') return selectModeCss(styles, mode);
        const systemCss = typeof styles?.system === 'string' ? styles.system.trim() : '';
        if (systemCss) return systemCss;
        return selectModeCss(styles, effectiveSystemMode());
    })();
    setStyleContent(MODE_STYLE_ID, selected);
    applyMarkupNodes();
    applyScriptNodes();
    dispatchThemeChanged();
}

function selectModeCss(styles: ThemePayload['styles'] | null, mode: 'system' | 'light' | 'dark'): string {
    if (!styles) return '';
    const { system, light, dark } = styles;
    const pick =
        mode === 'system'
            ? system ?? light ?? dark
            : mode === 'light'
                ? light ?? system ?? dark
                : dark ?? system ?? light;
    const text = typeof pick === 'string' ? pick : '';
    return text.trim() ? text : '';
}

export function getAvailableThemes(): ThemeSummary[] {
    return [...availableThemes];
}

export function getActiveThemeId(): string {
    return activeThemeId;
}

export function getCurrentMode(): 'system' | 'light' | 'dark' {
    return currentMode;
}

export async function refreshAvailableThemes(): Promise<ThemeSummary[]> {
    if (!TAURI.has) {
        availableThemes = [defaultLightSummary(), defaultDarkSummary()];
        fetchedThemes = true;
        return availableThemes;
    }

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

        others.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        availableThemes = [defaultLightSummary(), defaultDarkSummary(), ...others];
    } catch (error) {
        console.warn('list_themes failed', error);
        availableThemes = [defaultLightSummary(), defaultDarkSummary()];
    }

    fetchedThemes = true;
    return availableThemes;
}

export async function ensureThemesLoaded(force?: boolean): Promise<ThemeSummary[]> {
    if (!fetchedThemes || force) {
        return refreshAvailableThemes();
    }
    return availableThemes;
}

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
        const paired = resolvePairedThemeId(target);
        if (paired) target = paired;
    }

    if (!TAURI.has || isBuiltInDefaultThemeId(target)) {
        activeThemeId = isBuiltInDefaultThemeId(target) ? target : defaultThemeIdForMode(desiredMode);
        activeStyles = null;
        activeMarkup = null;
        activeScripts = [];
        applyModeStyles(desiredMode);
        return;
    }

    try {
        const payload = await TAURI.invoke<ThemePayload>('load_theme', { id: target });
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid theme payload');
        }
        activeThemeId = String(payload.summary?.id || target);
        activeStyles = payload.styles ?? null;
        activeMarkup = payload.markup ?? null;
        activeScripts = Array.isArray(payload.scripts) ? payload.scripts : [];
        applyModeStyles(desiredMode);
    } catch (error) {
        console.warn('load_theme failed', error);
        activeThemeId = defaultThemeIdForMode(desiredMode);
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

export function setAppearanceMode(mode: 'system' | 'light' | 'dark') {
    applyModeStyles(mode);
}
