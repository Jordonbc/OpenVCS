// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qs } from '../../lib/dom';

export const filterInput   = qs<HTMLInputElement>('#filter');
export const selectAllBox  = qs<HTMLInputElement>('#select-all');
export const listEl        = qs<HTMLElement>('#file-list');
export const countEl       = qs<HTMLElement>('#changes-count');
export const leftFootEl    = qs<HTMLElement>('#left-foot');
export const undoLeftBtn   = leftFootEl?.querySelector<HTMLButtonElement>('#undo-left-btn') ?? null;
export const diffHeadPath  = qs<HTMLElement>('#diff-path');
export const diffEl        = qs<HTMLElement>('#diff');

export const dragState = {
    lastClickedIndex: -1,
    isDragSelecting: false,
    dragTargetState: true as boolean,
    dragVisited: new Set<string>(),
    dragMoved: false,
    suppressNextClick: false,
    dragMode: null as 'diff' | 'commit' | null,
    dragStartIndex: -1,
    dragCurrentIndex: -1,
    dragPreDiff: new Set<string>(),
    dragPrePicked: new Set<string>(),
};

document.addEventListener('selectstart', (e) => { if (dragState.isDragSelecting) e.preventDefault(); }, true);
document.addEventListener('dragstart',   (e) => { if (dragState.isDragSelecting) e.preventDefault(); }, true);
