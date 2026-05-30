// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Query a single element by CSS selector.
 * @param sel - CSS selector string
 * @param root - Root element to search within (defaults to document)
 * @returns First matching element or null
 */
export const qs = <T extends Element = Element>(sel: string, root: Document | Element = document): T | null =>
    root.querySelector(sel) as T | null;

/**
 * Query all elements matching a CSS selector.
 * @param sel - CSS selector string
 * @param root - Root element to search within (defaults to document)
 * @returns Array of matching elements
 */
export const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document): T[] =>
    Array.from(root.querySelectorAll(sel)) as T[];

/**
 * Set the text content of an element.
 * @param el - Element to modify
 * @param text - Text content to set
 */
export const setText = (el: Element | null | undefined, text: string) => { if (el) (el as HTMLElement).textContent = text; };
/**
 * Set the value of an input or select element.
 * @param el - Form element to modify
 * @param value - Value to set
 */
export const setValue = (el: HTMLInputElement | HTMLSelectElement | null | undefined, value: string | number) => {
    if (!el) return;
    (el as HTMLInputElement | HTMLSelectElement).value = String(value);
};
/**
 * Set the checked state of a checkbox or radio input.
 * @param el - Input element to modify
 * @param on - Whether to check the element
 */
export const setChecked = (el: HTMLInputElement | null | undefined, on: boolean) => { if (el) el.checked = on; };

/**
 * Escape HTML special characters in a string.
 * @param s - Value to escape
 * @returns HTML-escaped string
 */
export const escapeHtml = (s: any) => String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;');

/**
 * Add an event listener to a target.
 * @param target - Event target (Document, HTMLElement, or Window)
 * @param type - Event type
 * @param fn - Event handler function
 */
export const on = <K extends keyof DocumentEventMap>(target: Document | Element | Window, type: K, fn: (ev: DocumentEventMap[K]) => any) =>
    target.addEventListener(type, fn as any);

/**
 * Convert a value to kebab-case.
 * @param v - Value to convert
 * @returns Kebab-case string
 */
export const toKebab = (v: unknown) => String(v ?? '').toLowerCase().replace(/_/g, '-');
