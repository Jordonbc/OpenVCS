// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Populate a `<select>` with options, optionally preselecting one.
 *
 * @param sel - Select element to populate (existing children are removed)
 * @param options - `[value, label]` pairs rendered in the given order
 * @param preferred - Value to preselect; ignored when absent from `options`
 * @param placeholder - Optional disabled placeholder option rendered first,
 *   shown when no preferred value is selected
 */
export function populateSelect(
    sel: HTMLSelectElement,
    options: ReadonlyArray<readonly [string, string]>,
    preferred = '',
    placeholder = '',
): void {
    if (placeholder) {
        sel.innerHTML = `<option value="" disabled ${preferred ? '' : 'selected'}>${placeholder}</option>`;
    } else {
        sel.replaceChildren();
    }
    for (const [value, label] of options) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        opt.selected = value === preferred;
        sel.appendChild(opt);
    }
}

/**
 * Set the disabled state of a modal's confirm button.
 *
 * @param modal - Modal root element
 * @param confirmSelector - CSS selector for the confirm button
 * @param disabled - Whether the button should be disabled
 */
export function setConfirmDisabled(modal: HTMLElement, confirmSelector: string, disabled: boolean): void {
    const confirm = modal.querySelector<HTMLButtonElement>(confirmSelector);
    if (confirm) confirm.disabled = disabled;
}
