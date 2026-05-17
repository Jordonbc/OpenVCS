// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { openModal } from '../ui/modals';
import type { PluginModalAlign, PluginModalButtonDefinition, PluginModalContentItem, PluginModalDefinition, PluginModalInputDefinition, PluginModalSelectDefinition } from './types';
import { escapeCssSelector } from './sanitize';

let pluginModalActionWired = false;

/** Returns whether a value looks like a plugin modal definition. */
function isPluginModalDefinition(value: unknown): value is PluginModalDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const modal = value as Partial<PluginModalDefinition>;
    return typeof modal.title === 'string' && Array.isArray(modal.content);
}

/** Creates a stable DOM id for one plugin modal. */
function pluginModalId(pluginId: string): string {
    const safe = String(pluginId || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    return `plugin-modal-${safe || 'plugin'}`;
}

/** Collects field values from a plugin modal body. */
function collectPluginModalPayload(modal: HTMLElement): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-plugin-field]')
        .forEach((field) => {
            const key = String(field.getAttribute('data-plugin-field') || '').trim();
            if (!key) return;
            if (field instanceof HTMLInputElement && field.type === 'checkbox') {
                payload[key] = field.checked;
                return;
            }
            payload[key] = field.value;
        });
    return payload;
}

/** Returns the modal element for one plugin id, creating it if needed. */
function ensurePluginModalElement(pluginId: string): HTMLElement | null {
    const root = document.getElementById('modals-root');
    if (!root) return null;

    const id = pluginModalId(pluginId);
    let modal = document.getElementById(id) as HTMLElement | null;
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = id;
    modal.dataset.pluginId = pluginId;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="backdrop" data-close></div>
      <div class="dialog sheet" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="sheet-head">
          <h3 id="${id}-title" style="margin:0"></h3>
          <button class="icon close" data-close aria-label="Close">\u2715</button>
        </div>
        <section class="sheet-body" style="display:grid; gap:.8rem;"></section>
      </div>
    `;
    root.appendChild(modal);
    return modal;
}

/** Returns a CSS justify-content value for one alignment hint. */
function alignToJustifyContent(align?: PluginModalAlign): string {
    if (align === 'centered') return 'center';
    if (align === 'right') return 'flex-end';
    return 'flex-start';
}

/** Appends one modal button inside an optional centered row wrapper. */
function appendModalButton(
    parent: HTMLElement,
    button: HTMLButtonElement,
    align?: PluginModalAlign,
    wrapInRow = false,
): void {
    if (!wrapInRow) {
        parent.appendChild(button);
        return;
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '.5rem';
    row.style.justifyContent = alignToJustifyContent(align);
    row.appendChild(button);
    parent.appendChild(row);
}

/** Builds one plugin modal button element. */
function createModalButton(pluginId: string, modalId: string, buttonDef: PluginModalButtonDefinition): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tbtn';
    if (buttonDef.variant === 'primary') button.classList.add('primary');
    if (buttonDef.variant === 'danger') button.classList.add('danger');
    button.textContent = buttonDef.content;
    if (buttonDef.title) button.title = buttonDef.title;
    button.dataset.pluginAction = String(buttonDef.id || '').trim();
    button.dataset.pluginId = pluginId;
    button.dataset.pluginModal = modalId;
    if (buttonDef.payload) {
        button.dataset.pluginPayload = JSON.stringify(buttonDef.payload);
    }
    return button;
}

/** Renders one nested plugin modal content item. */
function renderPluginModalItem(
    pluginId: string,
    modal: HTMLElement,
    parent: HTMLElement,
    item: PluginModalContentItem,
    topLevel = false,
): void {
    const body = parent;

    if (item.type === 'text') {
        const block = document.createElement('div');
        block.textContent = String(item.content || '');
        if (item.title) block.title = item.title;
        block.style.textAlign = item.align === 'centered' ? 'center' : item.align === 'right' ? 'right' : 'left';
        body.appendChild(block);
        return;
    }

    if (item.type === 'separator') {
        const rule = document.createElement('hr');
        rule.style.width = '100%';
        body.appendChild(rule);
        return;
    }

    if (item.type === 'horizontal-box') {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexWrap = item.wrap === false ? 'nowrap' : 'wrap';
        wrap.style.gap = item.gap || '.5rem';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = alignToJustifyContent(item.align);
        body.appendChild(wrap);
        for (const child of Array.isArray(item.content) ? item.content : []) {
            renderPluginModalItem(pluginId, modal, wrap, child, false);
        }
        return;
    }

    if (item.type === 'vertical-box') {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gap = item.gap || '.75rem';
        body.appendChild(wrap);
        for (const child of Array.isArray(item.content) ? item.content : []) {
            renderPluginModalItem(pluginId, modal, wrap, child, false);
        }
        return;
    }

    if (item.type === 'grid') {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gridTemplateColumns = String(item.columns || '').trim() || '1fr';
        wrap.style.gap = item.gap || '.75rem';
        body.appendChild(wrap);
        for (const child of Array.isArray(item.content) ? item.content : []) {
            renderPluginModalItem(pluginId, modal, wrap, child, false);
        }
        return;
    }

    if (item.type === 'input') {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        const label = document.createElement('label');
        label.textContent = item.label;
        label.htmlFor = `${modal.id}-${item.id}`;
        const input = document.createElement('input');
        input.id = `${modal.id}-${item.id}`;
        input.dataset.pluginField = item.id;
        input.type = item.kind || 'text';
        if (item.value !== undefined) input.value = item.value;
        if (item.placeholder) input.placeholder = item.placeholder;
        if (item.required) input.required = true;
        wrap.appendChild(label);
        wrap.appendChild(input);
        body.appendChild(wrap);
        return;
    }

    if (item.type === 'select') {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        const label = document.createElement('label');
        label.textContent = item.label;
        label.htmlFor = `${modal.id}-${item.id}`;
        const select = document.createElement('select');
        select.id = `${modal.id}-${item.id}`;
        select.dataset.pluginField = item.id;
        const selectedValue = item.value;
        for (const option of Array.isArray(item.options) ? item.options : []) {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            if (selectedValue !== undefined) {
                opt.selected = option.value === selectedValue;
            } else if (option.selected) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }
        wrap.appendChild(label);
        wrap.appendChild(select);
        body.appendChild(wrap);
        return;
    }

    if (item.type === 'list') {
        const wrap = document.createElement('div');
        wrap.className = 'group';
        if (item.label) {
            const label = document.createElement('div');
            label.className = 'meta';
            label.textContent = item.label;
            wrap.appendChild(label);
        }
        const items = Array.isArray(item.items) ? item.items : [];
        if (items.length === 0 && item.emptyText) {
            const empty = document.createElement('div');
            empty.className = 'meta';
            empty.textContent = item.emptyText;
            wrap.appendChild(empty);
        }
        for (const row of items) {
            const card = document.createElement('div');
            card.style.display = 'grid';
            card.style.gap = '.5rem';
            card.style.padding = '.6rem';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = '8px';

            const titleRow = document.createElement('div');
            titleRow.style.display = 'grid';
            titleRow.style.gap = '.2rem';
            const rowTitle = document.createElement('div');
            rowTitle.style.fontWeight = '600';
            rowTitle.textContent = row.title;
            titleRow.appendChild(rowTitle);
            if (row.meta) {
                const meta = document.createElement('div');
                meta.className = 'meta';
                meta.textContent = row.meta;
                titleRow.appendChild(meta);
            }
            if (row.description) {
                const desc = document.createElement('div');
                desc.textContent = row.description;
                titleRow.appendChild(desc);
            }
            if (row.status) {
                const status = document.createElement('div');
                status.className = 'meta';
                status.textContent = row.status;
                titleRow.appendChild(status);
            }
            card.appendChild(titleRow);

            const rowActions = document.createElement('div');
            rowActions.style.display = 'flex';
            rowActions.style.flexWrap = 'wrap';
            rowActions.style.gap = '.5rem';
            for (const action of Array.isArray(row.actions) ? row.actions : []) {
                rowActions.appendChild(createModalButton(pluginId, modal.id, action));
            }
            card.appendChild(rowActions);
            wrap.appendChild(card);
        }
        body.appendChild(wrap);
        return;
    }

    if (item.type === 'button' || typeof (item as PluginModalButtonDefinition).content === 'string') {
        appendModalButton(body, createModalButton(pluginId, modal.id, item as PluginModalButtonDefinition), item.align, topLevel);
    }
}

/** Renders one plugin modal definition into the DOM. */
function renderPluginModal(pluginId: string, definition: PluginModalDefinition): void {
    const modal = ensurePluginModalElement(pluginId);
    if (!modal) return;

    const title = modal.querySelector<HTMLElement>(`#${escapeCssSelector(modal.id)}-title`);
    const body = modal.querySelector<HTMLElement>('.sheet-body');
    if (!title || !body) return;

    title.textContent = String(definition.title || '').trim() || 'Plugin';
    body.replaceChildren();

    for (const item of Array.isArray(definition.content) ? definition.content : []) {
        if (!item) continue;
        renderPluginModalItem(pluginId, modal, body, item, true);
    }

    openModal(modal.id);
}

/** Handles a plugin action result and opens plugin modals when returned. */
export function handlePluginActionResult(pluginId: string, result: unknown): void {
    if (isPluginModalDefinition(result)) {
        renderPluginModal(pluginId, result);
    }
}

/** Invokes one plugin action and opens returned plugin modals. */
export async function invokePluginAction(
    pluginId: string,
    actionId: string,
    payload?: Record<string, unknown>,
): Promise<unknown> {
    const result = await TAURI.invoke<unknown>('invoke_plugin_action', {
        pluginId,
        actionId,
        payload: payload ?? null,
    });
    handlePluginActionResult(pluginId, result);
    return result;
}

/** Wires plugin modal button clicks to the host action bridge once. */
export function wirePluginModalActions(): void {
    if (pluginModalActionWired) return;
    pluginModalActionWired = true;

    document.addEventListener('click', async (event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
            '.modal[data-plugin-id] button[data-plugin-action][data-plugin-id]',
        );
        if (!target) return;

        const pluginId = String(target.dataset.pluginId || '').trim();
        const actionId = String(target.dataset.pluginAction || '').trim();
        if (!pluginId || !actionId) return;

        const modal = target.closest<HTMLElement>('.modal[data-plugin-id]');
        const payload = modal ? collectPluginModalPayload(modal) : {};
        const extra = target.dataset.pluginPayload;
        if (extra) {
            try {
                Object.assign(payload, JSON.parse(extra) as Record<string, unknown>);
            } catch {
                // Ignore malformed payload hints and continue with collected fields.
            }
        }

        event.preventDefault();
        event.stopPropagation();

        try {
            await invokePluginAction(pluginId, actionId, payload);
        } catch (err) {
            console.error(`Plugin modal action failed (${pluginId}/${actionId})`, err);
            notify('Plugin action failed');
        }
    });
}
