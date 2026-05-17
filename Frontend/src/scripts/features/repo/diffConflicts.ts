// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { escapeHtml } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { TAURI } from '../../lib/tauri';
import { notify } from '../../lib/notify';
import { state } from '../../state/state';
import type { FileStatus, ConflictDetails } from '../../types';
import { diffEl } from './context';
import { hydrateStatus } from './hydrate';
import { scrollDiffToTop } from './diffBinary';
import { openMergeModal, hasExternalMergeTool, launchExternalMergeTool } from '../conflicts';

/** Loads and renders conflict details and resolution actions. */
export async function renderConflictView(file: FileStatus) {
    if (!diffEl) return;
    state.currentFile = file.path;
    state.currentDiff = [];
    state.selectedHunks = [];
    if ((state as any).selectedHunksByFile) {
        delete (state as any).selectedHunksByFile[file.path];
    }
    if ((state as any).selectedLinesByFile) {
        delete (state as any).selectedLinesByFile[file.path];
    }
    diffEl.innerHTML = '<div class="conflict-view"><div class="conflict-loading">Loading conflict…</div></div>';
    scrollDiffToTop();
    try {
        const details = await TAURI.invoke<ConflictDetails>('vcs_conflict_details', { path: file.path });
        diffEl.innerHTML = renderConflictMarkup(details);
        bindConflictActions(diffEl, file, details);
        scrollDiffToTop();
    } catch (err) {
        console.error(err);
        diffEl.innerHTML = '<div class="conflict-view"><div class="conflict-error">Failed to load conflict details.</div></div>';
        scrollDiffToTop();
    }
}

/** Builds conflict view markup for text or binary conflicts. */
function renderConflictMarkup(details: ConflictDetails) {
    const binary = !!details.binary;
    const header = `<div class="conflict-header"><div class="conflict-title">Merge conflict</div>${renderConflictActions(binary)}</div>`;
    const body = binary ? renderBinaryConflictBody() : renderTextConflictBody(details);
    const pathAttr = escapeHtml(details.path || '');
    return `<div class="conflict-view" data-conflict-path="${pathAttr}" data-conflict-binary="${binary ? '1' : '0'}">${header}${body}</div>`;
}

/** Renders conflict action buttons based on conflict content type. */
function renderConflictActions(binary: boolean) {
    const mergeBtn = binary ? '' : '<button class="btn" data-conflict-action="merge">Merge…</button>';
    return `<div class="conflict-actions">
        <button class="btn" data-conflict-action="ours">Use Mine</button>
        <button class="btn" data-conflict-action="theirs">Use Theirs</button>
        ${mergeBtn}
    </div>`;
}

/** Renders a compact binary-conflict explanation panel. */
function renderBinaryConflictBody() {
    const note = 'This file is binary. Choose which version to keep.';
    return `<div class="conflict-body"><div class="conflict-note">${escapeHtml(note)}</div></div>`;
}

/** Renders side-by-side panes for textual conflict content. */
function renderTextConflictBody(details: ConflictDetails) {
    return `<div class="conflict-body"><div class="conflict-panels">
        ${renderConflictPane('Mine', details.ours)}
        ${renderConflictPane('Theirs', details.theirs)}
    </div></div>`;
}

/** Renders one labeled conflict pane section. */
function renderConflictPane(label: string, value?: string | null) {
    const safeLabel = escapeHtml(label);
    const hasText = typeof value === 'string' && value.length > 0;
    const body = hasText
        ? `<pre class="conflict-code">${escapeHtml(value || '')}</pre>`
        : '<div class="conflict-empty">(empty)</div>';
    return `<section class="conflict-pane"><header>${safeLabel}</header>${body}</section>`;
}

/** Wires conflict action buttons to backend commands and UI refreshes. */
function bindConflictActions(root: HTMLElement, file: FileStatus, details: ConflictDetails) {
    const container = root.querySelector('.conflict-view') as HTMLElement | null;
    if (!container) return;

    const resolve = async (side: 'ours' | 'theirs') => {
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-conflict-action]');
        buttons.forEach((b) => { b.disabled = true; });
        container.setAttribute('data-busy', '1');
        try {
            await TAURI.invoke('vcs_resolve_conflict_side', { path: file.path, side });
            notify(side === 'ours' ? 'Kept your version' : 'Kept their version');
            await Promise.allSettled([hydrateStatus()]);
        } catch (err) {
            console.error(err);
            notify('Failed to resolve conflict');
        } finally {
            container.removeAttribute('data-busy');
            buttons.forEach((b) => { b.disabled = false; });
        }
    };

    const oursBtn = container.querySelector<HTMLButtonElement>('[data-conflict-action="ours"]');
    const theirsBtn = container.querySelector<HTMLButtonElement>('[data-conflict-action="theirs"]');
    oursBtn?.addEventListener('click', () => resolve('ours'));
    theirsBtn?.addEventListener('click', () => resolve('theirs'));

    const mergeBtn = container.querySelector<HTMLButtonElement>('[data-conflict-action="merge"]');
    if (mergeBtn) {
        mergeBtn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const rect = mergeBtn.getBoundingClientRect();
            const items: CtxItem[] = [
                { label: 'Open built-in merge tool', action: () => openMergeModal(file, details) },
            ];
            if (await hasExternalMergeTool()) {
                items.push({ label: 'Open custom merge tool', action: () => { launchExternalMergeTool(file.path); } });
            }
            buildCtxMenu(items, rect.left, rect.bottom + 4);
        });
    }
}
