// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/** Normalizes ids for case-insensitive map keys. */
export function normalizeId(value: string): string {
    return String(value || '').trim().toLowerCase();
}

/** Escapes one string for use in a CSS selector. */
export function escapeCssSelector(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(String(value || ''));
    }
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

const BLOCKED_PLUGIN_TAGS = new Set([
    'base',
    'embed',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
    'style',
    'svg',
    'template',
]);

const URL_PLUGIN_ATTRS = new Set(['action', 'formaction', 'href', 'src', 'xlink:href']);

/** Returns true when one plugin URL attribute is safe to keep. */
function isSafePluginUrl(value: string): boolean {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    try {
        const url = new URL(trimmed, document.baseURI);
        return url.protocol !== 'javascript:' && url.protocol !== 'vbscript:' && url.protocol !== 'data:';
    } catch {
        return false;
    }
}

/** Removes unsafe tags and attributes from one plugin HTML subtree. */
function sanitizePluginSubtree(root: ParentNode): void {
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType === Node.COMMENT_NODE) {
            node.remove();
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        if (BLOCKED_PLUGIN_TAGS.has(tag)) {
            element.remove();
            continue;
        }

        for (const attr of Array.from(element.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'style') {
                element.removeAttribute(attr.name);
                continue;
            }
            if (URL_PLUGIN_ATTRS.has(name) && !isSafePluginUrl(attr.value)) {
                element.removeAttribute(attr.name);
            }
        }

        sanitizePluginSubtree(element);
    }
}

/** Parses plugin HTML and strips unsafe markup before insertion. */
export function parseSanitizedPluginElement(html: string): HTMLElement | null {
    const template = document.createElement('template');
    template.innerHTML = String(html || '').trim();
    sanitizePluginSubtree(template.content);
    const node = template.content.firstElementChild;
    return node instanceof HTMLElement ? node : null;
}
