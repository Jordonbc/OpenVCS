// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { escapeCssAttribute } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { confirmBool } from '../../lib/confirm';
import { notify } from '../../lib/notify';
import { TAURI } from '../../lib/tauri';
import { refreshAll } from '../../lib/async';
import { collectHunkLineIndices } from '../../lib/hunks';
import { getPluginContextMenuItems, runPluginAction } from '../../plugins';
import { state, disableDefaultSelectAll } from '../../state/state';
import type { FileStatus } from '../../types';
import { openStashConfirm } from '../stashConfirm';
import { dragState, listEl } from './context';
import { updateCommitButton } from './commit';
import { selectFile, renderCombinedDiff, clearDiffSelection, clearActiveRows, toggleFilePick, allHunkIndices, updateHunkCheckboxes } from './diffView';
import { hydrateStatus, hydrateStash } from './hydrate';
import { getVisibleFiles, updateSelectAllState } from './selectionState';

/** Handles click selection behavior for a file row. */
export function onFileClick(e: MouseEvent, file: FileStatus, index: number, visible: FileStatus[]) {
    if (dragState.suppressNextClick) {
        dragState.suppressNextClick = false;
        if (state.diffSelectedFiles && state.diffSelectedFiles.size > 1) {
            highlightRow(index);
            renderCombinedDiff(Array.from(state.diffSelectedFiles));
        } else {
            clearDiffSelection();
            selectFile(file, index);
        }
        return;
    }
    const isDiffToggle = e.shiftKey;
    const isToggle = e.ctrlKey || e.metaKey;

    if (isDiffToggle) {
        const on = !state.diffSelectedFiles.has(file.path);
        if (on) state.diffSelectedFiles.add(file.path);
        else state.diffSelectedFiles.delete(file.path);
        if (listEl) {
            const sel = `li.row[data-path="${escapeCssAttribute(file.path || '')}"]`;
            const row = listEl.querySelector<HTMLElement>(sel);
            if (row) row.classList.toggle('diffsel', on);
        }
        if (state.diffSelectedFiles.size > 1) {
            renderCombinedDiff(Array.from(state.diffSelectedFiles));
        } else if (state.diffSelectedFiles.size === 1) {
            const p = state.diffSelectedFiles.values().next().value;
            const idx = visible.findIndex((v) => v.path === p);
            if (idx >= 0) selectFile(visible[idx], idx);
        }
    } else if (isToggle) {
        const on = !state.selectedFiles.has(file.path);
        toggleFilePick(file.path, on);
        updateSelectAllState(visible);
        if (listEl) {
            const sel = `li.row[data-path="${escapeCssAttribute(file.path || '')}"]`;
            const row = listEl.querySelector<HTMLElement>(sel);
            if (row) {
                row.classList.toggle('picked', on);
                const cb = row.querySelector<HTMLInputElement>('input.pick');
                if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
            }
        }
        if (!(state.diffSelectedFiles && state.diffSelectedFiles.size > 1)) {
            selectFile(file, index);
        }
    } else {
        clearDiffSelection();
        selectFile(file, index);
    }
    dragState.lastClickedIndex = index;
    updateCommitButton();
}

/** Starts drag-selection for diff or commit selection gestures. */
export function onFileMouseDown(e: MouseEvent, file: FileStatus, index: number, visible: FileStatus[], _li: HTMLElement) {
    if (e.button !== 0) return;
    dragState.suppressNextClick = false;
    const mode = e.shiftKey ? 'diff' : (e.ctrlKey || e.metaKey) ? 'commit' : null;
    if (mode === null) {
        dragState.dragMode = null;
        dragState.isDragSelecting = false;
        dragState.dragMoved = false;
        dragState.dragVisited.clear();
        return;
    }
    e.preventDefault();
    dragState.dragMode = mode;
    dragState.dragMoved = false;
    dragState.isDragSelecting = true;
    dragState.dragVisited.clear();
    document.body.classList.add('drag-selecting');
    try { const sel = window.getSelection?.(); sel && sel.removeAllRanges(); } catch {}
    if (dragState.dragMode === 'diff') {
        clearActiveRows();
        const currentlyOn = state.diffSelectedFiles.has(file.path);
        dragState.dragTargetState = !currentlyOn;
        dragState.dragStartIndex = index; dragState.dragCurrentIndex = index;
        dragState.dragPreDiff = new Set(state.diffSelectedFiles);
    } else if (dragState.dragMode === 'commit') {
        const clearedImplicit = disableDefaultSelectAll(true);
        if (clearedImplicit && listEl) {
            listEl.querySelectorAll<HTMLElement>('li.row.picked').forEach((row) => {
                row.classList.remove('picked');
                const cb = row.querySelector<HTMLInputElement>('input.pick');
                if (cb) { cb.checked = false; (cb as any).indeterminate = false; }
            });
        }
        const currentlyOn = state.selectedFiles.has(file.path);
        dragState.dragTargetState = !currentlyOn;
        dragState.dragStartIndex = index; dragState.dragCurrentIndex = index;
        dragState.dragPrePicked = new Set(state.selectedFiles);
    }

    const startX = e.clientX, startY = e.clientY;
    const onMove = (mv: MouseEvent) => {
        if (!dragState.dragMoved && (Math.abs(mv.clientX - startX) + Math.abs(mv.clientY - startY) > 3)) {
            dragState.dragMoved = true;
            updateDragRange(visible);
        }
        const el = document.elementFromPoint(mv.clientX, mv.clientY) as HTMLElement | null;
        const row = el ? el.closest('li.row[data-path]') as HTMLElement | null : null;
        if (row) {
            const p = row.getAttribute('data-path') || '';
            const i2 = visible.findIndex((v) => v.path === p);
            if (i2 >= 0 && i2 !== dragState.dragCurrentIndex) {
                dragState.dragCurrentIndex = i2;
                updateDragRange(visible);
            }
        }
    };
    const onUp = () => {
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('mousemove', onMove);
        dragState.isDragSelecting = false;
        document.body.classList.remove('drag-selecting');
        updateSelectAllState(visible);
        updateCommitButton();
        if (dragState.dragMoved) dragState.suppressNextClick = true;
        dragState.lastClickedIndex = index;
        if (state.diffSelectedFiles && state.diffSelectedFiles.size > 1) {
            renderCombinedDiff(Array.from(state.diffSelectedFiles));
        }
        dragState.dragMode = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
}

/** Applies one row selection change for the active drag mode. */
export function applySelect(path: string, on: boolean, rowEl: HTMLElement | null, _visible: FileStatus[], mode: 'diff' | 'commit') {
    disableDefaultSelectAll();
    if (mode === 'commit') {
        if (on) state.selectedFiles.add(path); else state.selectedFiles.delete(path);
        if (rowEl) rowEl.classList.toggle('picked', on);
        const selector = `li.row[data-path="${escapeCssAttribute(path)}"] input.pick`;
        const cb = listEl?.querySelector<HTMLInputElement>(selector) || null;
        if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
    } else {
        if (on) state.diffSelectedFiles.add(path); else state.diffSelectedFiles.delete(path);
        if (rowEl) rowEl.classList.toggle('diffsel', on);
    }
}

/** Recomputes drag selection state for the current cursor range. */
export function updateDragRange(visible: FileStatus[]) {
    if (!dragState.isDragSelecting || dragState.dragMode === null) return;
    const list = listEl;
    const a = Math.min(dragState.dragStartIndex, dragState.dragCurrentIndex);
    const b = Math.max(dragState.dragStartIndex, dragState.dragCurrentIndex);
    if (dragState.dragMode === 'diff') {
        const next = new Set(dragState.dragPreDiff);
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i]?.path; if (!p) continue;
            const inRange = i >= a && i <= b;
            const on = inRange ? dragState.dragTargetState : dragState.dragPreDiff.has(p);
            if (on) next.add(p); else next.delete(p);
        }
        state.diffSelectedFiles = next;
        if (list) {
            visible.forEach((v) => {
                const row = list.querySelector<HTMLElement>(`li.row[data-path="${escapeCssAttribute(v.path || '')}"]`);
                if (row) row.classList.toggle('diffsel', state.diffSelectedFiles.has(v.path));
            });
        }
    } else if (dragState.dragMode === 'commit') {
        const next = new Set<string>(dragState.dragPrePicked);
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i]?.path; if (!p) continue;
            const inRange = i >= a && i <= b;
            const on = inRange ? dragState.dragTargetState : dragState.dragPrePicked.has(p);
            if (on) next.add(p); else next.delete(p);
            if (list) {
                const row = list.querySelector<HTMLElement>(`li.row[data-path="${escapeCssAttribute(p || '')}"]`);
                if (row) row.classList.toggle('picked', on);
                const cb = list.querySelector<HTMLInputElement>(`li.row[data-path="${escapeCssAttribute(p || '')}"] input.pick`);
                if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
            }
            if (state.currentFile && p === state.currentFile) {
                if (on) {
                    state.selectedHunks = allHunkIndices(state.currentDiff);
                    (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
                    const hunkNodes = state.currentDiffHunkNodes;
                    const recExisting: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
                    const rec: Record<number, number[]> = { ...recExisting };
                    state.selectedHunks.forEach((h) => {
                        if (rec[h] && rec[h].length > 0) return;
                        const picked = collectHunkLineIndices(hunkNodes.get(h));
                        if (picked.length > 0) rec[h] = picked;
                    });
                    (state as any).selectedLinesByFile[state.currentFile] = rec;
                } else {
                    state.selectedHunks = [];
                    delete (state as any).selectedHunksByFile[state.currentFile];
                    delete (state as any).selectedLinesByFile[state.currentFile];
                }
                updateHunkCheckboxes();
            }
        }
        state.selectedFiles = next;
    }
}

/** Toggles commit selection for all visible files. */
export function toggleSelectAll(on: boolean, visible: FileStatus[]) {
    if (on) {
        visible.forEach((f) => { if (f.path) toggleFilePick(f.path, true); });
    } else {
        visible.forEach((f) => { if (f.path) toggleFilePick(f.path, false); });
    }
}

/** Opens the context menu for one file row and current selection. */
export async function onFileContextMenu(ev: MouseEvent, f: FileStatus) {
    ev.preventDefault();
    const x = ev.clientX, y = ev.clientY;
    const diffPaths = Array.from(state.diffSelectedFiles || [])
        .map((p) => p.trim())
        .filter(Boolean);
    const stagingPaths = Array.from(state.selectedFiles || [])
        .map((p) => p.trim())
        .filter(Boolean);
    const hasMultiStaging = stagingPaths.length > 1 && !state.selectionImplicitAll;
    const hasMultiDiff = diffPaths.length > 1;
    const useDiffSelection = hasMultiDiff && !hasMultiStaging;
    const selectedPaths = useDiffSelection ? diffPaths : stagingPaths;
    const clickedPath = (f.path || '').trim();
    const clickedInSelection = useDiffSelection
        ? diffPaths.includes(clickedPath)
        : stagingPaths.includes(clickedPath);
    const explicitMultiSelection = useDiffSelection
        ? hasMultiDiff && clickedInSelection
        : hasMultiStaging && clickedInSelection;
    const hasSingleSelection = !useDiffSelection && clickedInSelection && stagingPaths.length === 1 && !state.selectionImplicitAll;
    const singleTarget = (hasSingleSelection ? selectedPaths[0] : clickedPath) || '';
    const items: CtxItem[] = [];
    /** Opens the stash modal pre-filled for the provided paths. */
    const openStashForPaths = (paths: string[], defaultMessage: string) => {
        const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean);
        if (!normalizedPaths.length) return;
        openStashConfirm({
            defaultMessage,
            includeUntracked: false,
            paths: normalizedPaths,
            onSuccess: async () => {
                await refreshAll([hydrateStatus, hydrateStash]);
                renderListCallback?.();
            },
        });
    };

    items.push({ label: 'Open with default application', action: async () => {
        const target = (hasSingleSelection ? selectedPaths[0] : clickedPath) || '';
        if (!target) return;
        try {
            await TAURI.invoke('open_repo_file', { path: target });
        } catch {
            notify('Open failed');
        }
    }});
    items.push({ label: '---' });

    if (explicitMultiSelection) {
        items.push({ label: 'Create stash from selection…', action: () => {
            openStashForPaths(selectedPaths.slice(), 'WIP selection');
        }});
    } else if (singleTarget) {
        const defaultMsg = `WIP ${singleTarget}`;
        items.push({ label: 'Create stash for this file…', action: () => {
            openStashForPaths([singleTarget], defaultMsg);
        }});
    }
    items.push({ label: '---' });
    items.push({ label: 'Add to ignore file', action: async () => {
        const targets = (explicitMultiSelection ? selectedPaths.slice() : [f.path]).filter(Boolean);
        if (!targets.length) return;
        const label = targets.length > 1 ? `${targets.length} files` : targets[0];
        const ok = await confirmBool(`Add ${label} to ignore file?`);
        if (!ok) return;
        try {
            await TAURI.invoke('vcs_add_to_ignore_paths', { paths: targets });
            notify('Added to ignore file');
            await refreshAll([hydrateStatus]);
        } catch {
            notify('Ignore failed');
        }
    }});
    items.push({ label: '---' });
    if (explicitMultiSelection) {
        items.push({ label: 'Discard all selected', action: async () => {
            const paths = selectedPaths.slice();
            const ok = await confirmBool(`Discard all changes in ${paths.length} selected file(s)? This cannot be undone.`);
            if (!ok) return;
            try { await TAURI.invoke('vcs_discard_paths', { paths }); await refreshAll([hydrateStatus]); }
            catch (e) { console.error('Discard failed:', e); notify('Discard failed'); }
        }});
    } else {
        items.push({ label: 'Discard changes', action: async () => {
            const ok = await confirmBool(`Discard all changes in \n${f.path}? This cannot be undone.`);
            if (!ok) return;
            try { await TAURI.invoke('vcs_discard_paths', { paths: [f.path] }); await refreshAll([hydrateStatus]); }
            catch (e) { console.error('Discard failed:', e); notify('Discard failed'); }
        }});
    }

    const pluginTargets = (explicitMultiSelection ? selectedPaths.slice() : [singleTarget]).filter(Boolean);
    const pluginItems = getPluginContextMenuItems('files');
    if (pluginItems.length > 0) {
        items.push({ label: '---' });
        for (const it of pluginItems) {
            items.push({
                label: it.label,
                action: async () => {
                    await runPluginAction(it.action, { paths: pluginTargets, clickedPath: singleTarget, file: f });
                },
            });
        }
    }
    buildCtxMenu(items, x, y);
}

/** Optional callback that re-renders the left list. */
let renderListCallback: (() => void) | null = null;

/** Registers a callback used after operations that refresh list state. */
export function setRenderListCallback(fn: () => void) {
    renderListCallback = fn;
}

/** Returns true while drag selection is currently active. */
export function isDragSelecting() {
    return dragState.isDragSelecting;
}

/** Stores the latest drag cursor index for range updates. */
export function setDragCurrentIndex(index: number) {
    dragState.dragCurrentIndex = index;
}

/** Applies active-row styling by index in the current list. */
function highlightRow(index: number) {
    const rows = listEl?.querySelectorAll<HTMLElement>('li.row');
    rows?.forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });
}
