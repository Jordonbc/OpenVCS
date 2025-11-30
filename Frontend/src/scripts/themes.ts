import { TAURI } from './lib/tauri';
import { notify } from './lib/notify';
import type { ThemePayload, ThemeSummary } from './types';

export const DEFAULT_THEME_ID = 'default';

const GLOBAL_STYLE_ID = 'openvcs-theme-global';
const MODE_STYLE_ID = 'openvcs-theme-mode';
const THEME_PACK_ATTR = 'data-theme-pack';

const HEAD_MARKUP_NODES: ChildNode[] = [];
const BODY_MARKUP_NODES: ChildNode[] = [];
const THEME_SCRIPT_NODES: HTMLScriptElement[] = [];

let availableThemes: ThemeSummary[] = [defaultSummary()];
let fetchedThemes = false;
let activeThemeId = DEFAULT_THEME_ID;
let activeStyles: ThemePayload['styles'] | null = null;
let activeMarkup: ThemePayload['markup'] | null = null;
let activeScripts: string[] = [];
let currentMode: 'system' | 'light' | 'dark' = 'system';

function defaultSummary(): ThemeSummary {
    return {
        id: DEFAULT_THEME_ID,
        name: 'Default',
        description: 'Built-in OpenVCS theme',
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
    if (!current || current === DEFAULT_THEME_ID) {
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
    syncThemePackAttr();
    const styles = activeStyles;
    const globalCss = styles?.global ?? null;
    setStyleContent(GLOBAL_STYLE_ID, globalCss);

    const selected = selectModeCss(styles, mode);
    setStyleContent(MODE_STYLE_ID, selected);
    applyMarkupNodes();
    applyScriptNodes();
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
        availableThemes = [defaultSummary()];
        fetchedThemes = true;
        return availableThemes;
    }

    try {
        const list = await TAURI.invoke<ThemeSummary[]>('list_themes');
        const others: ThemeSummary[] = [];
        let builtIn: ThemeSummary | null = null;
        const seen = new Set<string>();

        for (const item of Array.isArray(list) ? list : []) {
            if (!item) continue;
            const summary = sanitizeSummary(item);
            const norm = summary.id.toLowerCase();
            if (seen.has(norm)) continue;
            seen.add(norm);
            if (norm === DEFAULT_THEME_ID) {
                builtIn = summary;
            } else {
                others.push(summary);
            }
        }

        others.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        availableThemes = [builtIn ?? defaultSummary(), ...others];
    } catch (error) {
        console.warn('list_themes failed', error);
        availableThemes = [defaultSummary()];
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
    const target = (themeId || DEFAULT_THEME_ID).trim() || DEFAULT_THEME_ID;
    const desiredMode = opts.mode ?? currentMode;

    if (!TAURI.has || target.toLowerCase() === DEFAULT_THEME_ID) {
        activeThemeId = DEFAULT_THEME_ID;
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
        activeThemeId = DEFAULT_THEME_ID;
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
