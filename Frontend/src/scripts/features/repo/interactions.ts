import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { notify } from '../../lib/notify';
import { TAURI } from '../../lib/tauri';
import { state } from '../../state/state';
import { openStashConfirm } from '../stashConfirm';
import { dragState, listEl } from './context';
import { updateCommitButton } from './commit';
import { selectFile, renderCombinedDiff, clearDiffSelection, clearActiveRows, toggleFilePick, updateListCheckboxForPath, allHunkIndices, updateHunkCheckboxes } from './diffView';
import { hydrateStatus, hydrateStash } from './hydrate';
import { getVisibleFiles, updateSelectAllState } from './selectionState';

export function onFileClick(e: MouseEvent, file: { path: string }, index: number, visible: { path: string }[]) {
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
    const isToggle = e.ctrlKey || e.metaKey;
    const isRange = e.shiftKey && dragState.lastClickedIndex >= 0;

    if (isRange) {
        const a = Math.min(dragState.lastClickedIndex, index);
        const b = Math.max(dragState.lastClickedIndex, index);
        for (let i = a; i <= b; i++) {
            const p = visible[i]?.path; if (!p) continue;
            if (state.selectedFiles.has(p)) state.selectedFiles.delete(p);
            else state.selectedFiles.add(p);
        }
        state.defaultSelectAll = false;
        updateSelectAllState(visible);
        renderListAfterRangeSelect(file);
    } else if (isToggle) {
        const on = !state.selectedFiles.has(file.path);
        toggleFilePick(file.path, on);
        updateSelectAllState(visible);
        if (listEl) {
            const sel = `li.row[data-path="${(file.path || '').replace(/([\"\\])/g, '\\$1')}"]`;
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

export function onFileMouseDown(e: MouseEvent, file: { path: string }, index: number, visible: { path: string }[], li: HTMLElement) {
    if (e.button !== 0) return;
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
        dragState.dragTargetState = true;
        dragState.dragStartIndex = index; dragState.dragCurrentIndex = index;
        dragState.dragPreDiff = new Set(state.diffSelectedFiles);
        updateDragRange(visible);
    } else if (dragState.dragMode === 'commit') {
        const currentlyOn = state.selectedFiles.has(file.path);
        dragState.dragTargetState = !currentlyOn;
        dragState.dragStartIndex = index; dragState.dragCurrentIndex = index;
        dragState.dragPrePicked = new Set(state.selectedFiles);
        updateDragRange(visible);
    }

    const startX = e.clientX, startY = e.clientY;
    const onMove = (mv: MouseEvent) => {
        if (!dragState.dragMoved && (Math.abs(mv.clientX - startX) + Math.abs(mv.clientY - startY) > 3)) dragState.dragMoved = true;
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

export function applySelect(path: string, on: boolean, rowEl: HTMLElement | null, visible: { path: string }[], mode: 'diff' | 'commit') {
    state.defaultSelectAll = false;
    if (mode === 'commit') {
        if (on) state.selectedFiles.add(path); else state.selectedFiles.delete(path);
        if (rowEl) rowEl.classList.toggle('picked', on);
        const selector = `li.row[data-path="${path.replace(/([\"\\])/g, '\\$1')}"] input.pick`;
        const cb = listEl?.querySelector<HTMLInputElement>(selector) || null;
        if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
    } else {
        if (on) state.diffSelectedFiles.add(path); else state.diffSelectedFiles.delete(path);
        if (rowEl) rowEl.classList.toggle('diffsel', on);
    }
}

export function updateDragRange(visible: { path: string }[]) {
    if (!dragState.isDragSelecting || dragState.dragMode === null) return;
    const a = Math.min(dragState.dragStartIndex, dragState.dragCurrentIndex);
    const b = Math.max(dragState.dragStartIndex, dragState.dragCurrentIndex);
    if (dragState.dragMode === 'diff') {
        const next = new Set(dragState.dragPreDiff);
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i]?.path; if (!p) continue;
            if (i >= a && i <= b) next.add(p); else if (!dragState.dragPreDiff.has(p)) next.delete(p);
        }
        state.diffSelectedFiles = next;
        if (listEl) {
            visible.forEach((v) => {
                const row = listEl.querySelector<HTMLElement>(`li.row[data-path="${(v.path || '').replace(/([\"\\])/g, '\\$1')}"]`);
                if (row) row.classList.toggle('diffsel', state.diffSelectedFiles.has(v.path));
            });
        }
    } else if (dragState.dragMode === 'commit') {
        const next = new Set<string>();
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i]?.path; if (!p) continue;
            const inRange = i >= a && i <= b;
            const on = inRange ? dragState.dragTargetState : dragState.dragPrePicked.has(p);
            if (on) next.add(p);
            if (listEl) {
                const row = listEl.querySelector<HTMLElement>(`li.row[data-path="${(p || '').replace(/([\"\\])/g, '\\$1')}"]`);
                if (row) row.classList.toggle('picked', on);
                const cb = listEl.querySelector<HTMLInputElement>(`li.row[data-path="${(p || '').replace(/([\"\\])/g, '\\$1')}"] input.pick`);
                if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
            }
            if (state.currentFile && p === state.currentFile) {
                if (on) {
                    state.selectedHunks = allHunkIndices(state.currentDiff);
                    (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
                } else {
                    state.selectedHunks = [];
                    delete (state as any).selectedHunksByFile[state.currentFile];
                }
                updateHunkCheckboxes();
            }
        }
        state.selectedFiles = next;
    }
}

export function toggleSelectAll(on: boolean, visible: { path: string }[]) {
    if (on) {
        visible.forEach((f) => { if (f.path) toggleFilePick(f.path, true); });
    } else {
        visible.forEach((f) => { if (f.path) toggleFilePick(f.path, false); });
    }
}

export function onFileContextMenu(ev: MouseEvent, f: { path: string }) {
    ev.preventDefault();
    const x = ev.clientX, y = ev.clientY;
    const totalFiles = Array.isArray(state.files) ? state.files.length : 0;
    const selectedPaths = Array.from(state.selectedFiles || []);
    const hasManualSelection = (!state.defaultSelectAll) || (selectedPaths.length > 0 && selectedPaths.length !== totalFiles);
    const manualSelection = hasManualSelection ? selectedPaths : [];
    const clickedInSelection = manualSelection.includes(f.path);
    const hasMultiSelection = manualSelection.length > 1 && clickedInSelection;
    const hasSingleSelection = manualSelection.length === 1 && clickedInSelection;
    const items: CtxItem[] = [];
    const openStashForPaths = (paths: string[], defaultMessage: string) => {
        if (!paths.length) return;
        openStashConfirm({
            defaultMessage,
            includeUntracked: false,
            paths,
            onSuccess: async () => {
                await Promise.allSettled([hydrateStatus(), hydrateStash()]);
                renderListCallback?.();
            },
        });
    };
    items.push({ label: 'Discard changes', action: async () => {
        if (!TAURI.has) return;
        const ok = window.confirm(`Discard all changes in \n${f.path}? This cannot be undone.`);
        if (!ok) return;
        try { await TAURI.invoke('git_discard_paths', { paths: [f.path] }); await Promise.allSettled([hydrateStatus()]); }
        catch { notify('Discard failed'); }
    }});
    if (hasManualSelection && clickedInSelection) {
        items.push({ label: 'Discard selected files', action: async () => {
            if (!TAURI.has) return;
            const paths = manualSelection.slice();
            const ok = window.confirm(`Discard all changes in ${paths.length} selected file(s)? This cannot be undone.`);
            if (!ok) return;
            try { await TAURI.invoke('git_discard_paths', { paths }); await Promise.allSettled([hydrateStatus()]); }
            catch { notify('Discard failed'); }
        }});
        if (hasMultiSelection) {
            items.push({ label: 'Create stash from selection…', action: () => {
                openStashForPaths(manualSelection.slice(), 'WIP selection');
            }});
        }
    }
    const singleTarget = hasSingleSelection ? manualSelection[0] : f.path;
    const defaultMsg = `WIP ${singleTarget}`;
    items.push({ label: 'Create stash for this file…', action: () => {
        openStashForPaths([singleTarget], defaultMsg);
    }});
    items.push({ label: '---' });
    items.push({ label: 'Track with Git LFS', action: () => {
        if (!TAURI.has) {
            notify('Git LFS is available in the desktop app');
            return;
        }
        const targets = (hasManualSelection && clickedInSelection ? manualSelection.slice() : [f.path]).filter(Boolean);
        if (!targets.length) return;
        (async () => {
            try {
                await TAURI.invoke('git_lfs_track_paths', { paths: targets });
                notify(targets.length > 1 ? 'Tracked files with Git LFS' : 'Tracked file with Git LFS');
                await Promise.allSettled([hydrateStatus()]);
            } catch {
                notify('Git LFS track failed');
            }
        })();
    }});
    buildCtxMenu(items, x, y);
}

let renderListCallback: (() => void) | null = null;
export function setRenderListCallback(fn: () => void) {
    renderListCallback = fn;
}

export function isDragSelecting() {
    return dragState.isDragSelecting;
}

export function setDragCurrentIndex(index: number) {
    dragState.dragCurrentIndex = index;
}

function renderListAfterRangeSelect(file: { path: string }) {
    renderListCallback?.();
    const refreshed = getVisibleFiles();
    const nextIndex = refreshed.findIndex((v) => v.path === file.path);
    if (nextIndex >= 0) selectFile(refreshed[nextIndex], nextIndex);
    updateCommitButton();
}

function highlightRow(index: number) {
    const rows = listEl?.querySelectorAll<HTMLElement>('li.row');
    rows?.forEach((el, i) => el.classList.toggle('active', i === index));
}
