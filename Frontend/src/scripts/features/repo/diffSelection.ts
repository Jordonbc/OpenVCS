// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { disableDefaultSelectAll, state } from '../../state/state';
import { listEl } from './context';
import { updateCommitButton } from './commit';
import { getVisibleFiles, updateSelectAllState } from './selectionState';
import { allHunkIndices } from './diffFragment';

/** Clears picked styling and checkboxes for all visible rows. */
function clearAllFileSelections() {
    if (!listEl) return;
    const rows = listEl.querySelectorAll<HTMLElement>('li.row');
    rows.forEach((row) => {
        row.classList.remove('picked');
        const cb = row.querySelector<HTMLInputElement>('input.pick');
        if (cb) { cb.checked = false; (cb as any).indeterminate = false; }
    });
}

/** Toggles commit inclusion for a file and syncs current hunk selection. */
export function toggleFilePick(path: string, on: boolean) {
    if (!path) return;
    const clearedImplicit = disableDefaultSelectAll(true);
    if (clearedImplicit) clearAllFileSelections();
    if (on) state.selectedFiles.add(path);
    else state.selectedFiles.delete(path);
    if (state.currentFile && state.currentFile === path && !state.currentDiffBinary) {
        const hunkNodes = state.currentDiffHunkNodes;
        if (on) {
            state.selectedHunks = allHunkIndices(state.currentDiff);
            (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
            const rec: Record<number, number[]> = {};
            hunkNodes.forEach((refs, idx) => {
                refs.hunkCheckboxes.forEach((box) => {
                    box.checked = true;
                    box.indeterminate = false;
                });
                const picked: number[] = [];
                Object.entries(refs.lineCheckboxes).forEach(([key, box]) => {
                    const lineIdx = Number(key);
                    if (lineIdx < 0) return;
                    picked.push(lineIdx);
                    box.checked = true;
                });
                if (picked.length > 0) rec[idx] = Array.from(new Set(picked)).sort((a, b) => a - b);
            });
            (state as any).selectedLinesByFile[state.currentFile] = rec;
        } else {
            state.selectedHunks = [];
            delete (state as any).selectedHunksByFile[state.currentFile];
            delete (state as any).selectedLinesByFile[state.currentFile];
            hunkNodes.forEach((refs) => {
                refs.hunkCheckboxes.forEach((box) => {
                    box.checked = false;
                    box.indeterminate = false;
                });
                Object.values(refs.lineCheckboxes).forEach((box) => { box.checked = false; });
            });
        }
        updateHunkCheckboxes();
    }
    updateCommitButton();
}

/** Reconciles hunk and line checkbox UI with in-memory selection state. */
export function updateHunkCheckboxes() {
    const nodes = state.currentDiffHunkNodes;
    if (!nodes || nodes.size === 0) return;
    const rec: Record<number, number[]> = state.currentFile
        ? (state as any).selectedLinesByFile[state.currentFile] || {}
        : {};
    nodes.forEach((refs, idx) => {
        const isSelected = state.selectedHunks.includes(idx);
        refs.hunkCheckboxes.forEach((box) => {
            box.checked = isSelected;
            box.indeterminate = false;
        });
        refs.hunkEls.forEach((el) => {
            el.classList.toggle('picked', isSelected);
        });
        if (state.currentFile) {
            const lines = rec[idx] || [];
            Object.entries(refs.lineCheckboxes).forEach(([key, box]) => {
                const lineIdx = Number(key);
                const checked = Array.isArray(lines) && lines.includes(lineIdx);
                box.checked = checked;
            });
            const total = state.currentDiffMeta?.changeCounts[idx] ?? Object.keys(refs.lineCheckboxes).length;
            const chosen = lines.length;
            refs.hunkCheckboxes.forEach((box) => {
                box.checked = total > 0 && chosen === total;
                box.indeterminate = chosen > 0 && chosen < total;
            });
        } else {
            Object.values(refs.lineCheckboxes).forEach((box) => { box.checked = false; });
            refs.hunkCheckboxes.forEach((box) => { box.indeterminate = false; });
        }
    });
}

/** Tracks whether delegated diff checkbox handlers are already bound. */
let diffToggleHandlerBound = false;

/** Binds delegated change handling for hunk and line toggles once. */
function bindHunkToggles(root: HTMLElement) {
    if (!root || diffToggleHandlerBound) return;
    root.addEventListener('change', handleDiffInputChange);
    diffToggleHandlerBound = true;
}

export { bindHunkToggles };

/** Routes checkbox changes to hunk-level or line-level handlers. */
function handleDiffInputChange(ev: Event) {
    const target = ev.target as HTMLInputElement | null;
    if (!target || !(target instanceof HTMLInputElement)) return;
    const fileContainer = target.closest<HTMLElement>('[data-file]');
    if (fileContainer) {
        const file = fileContainer.dataset.file || '';
        if (!file) return;
        if (target.classList.contains('pick-hunk')) {
            handleMultiHunkToggle(target, file);
        } else if (target.classList.contains('pick-line')) {
            handleMultiLineToggle(target, file);
        }
        return;
    }
    if (target.classList.contains('pick-hunk')) {
        handleHunkToggle(target);
    } else if (target.classList.contains('pick-line')) {
        handleLineToggle(target);
    }
}

/** Applies selection updates for a single hunk toggle interaction. */
function handleHunkToggle(input: HTMLInputElement) {
    const idx = Number(input.dataset.hunk || -1);
    if (!state.currentFile || idx < 0) return;
    const clearedImplicit = disableDefaultSelectAll(true);
    if (clearedImplicit) clearAllFileSelections();
    const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
    if (input.checked) {
        if (!state.selectedHunks.includes(idx)) state.selectedHunks.push(idx);
        const refs = state.currentDiffHunkNodes.get(idx);
        const picked: number[] = [];
        Object.entries(refs?.lineCheckboxes || {}).forEach(([k, box]) => {
            const lineIdx = Number(k);
            if (lineIdx < 0) return;
            picked.push(lineIdx);
            box.checked = true;
        });
        if (picked.length > 0) rec[idx] = Array.from(new Set(picked)).sort((a, b) => a - b);
    } else {
        state.selectedHunks = state.selectedHunks.filter((i) => i !== idx);
        const refs = state.currentDiffHunkNodes.get(idx);
        Object.values(refs?.lineCheckboxes || {}).forEach((box) => { box.checked = false; });
        delete rec[idx];
    }
    (state as any).selectedLinesByFile[state.currentFile] = rec;
    const refs = state.currentDiffHunkNodes.get(idx);
    refs?.hunkEls.forEach((el) => {
        el.classList.toggle('picked', input.checked);
    });
    refs?.hunkCheckboxes.forEach((box) => {
        box.indeterminate = false;
        box.checked = input.checked;
    });
    if (state.currentFile) {
        (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
    }
    syncFileCheckboxWithHunks();
    updateSelectAllState(getVisibleFiles());
    updateCommitButton();
}

/** Applies selection updates for a single changed line toggle. */
function handleLineToggle(input: HTMLInputElement) {
    const hunk = Number(input.dataset.hunk || -1);
    const line = Number(input.dataset.line || -1);
    if (!state.currentFile || hunk < 0 || line < 0) return;
    const clearedImplicit = disableDefaultSelectAll(true);
    if (clearedImplicit) clearAllFileSelections();
    const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
    const old = new Set<number>(rec[hunk] || []);
    if (input.checked) {
        old.add(line);
    } else {
        old.delete(line);
    }
    const next = Array.from(old).sort((a, b) => a - b);
    if (next.length > 0) {
        rec[hunk] = next;
    } else {
        delete rec[hunk];
    }
    (state as any).selectedLinesByFile[state.currentFile] = rec;
    const refs = state.currentDiffHunkNodes.get(hunk);
    const total = state.currentDiffMeta?.changeCounts[hunk] ?? Object.keys(refs?.lineCheckboxes || {}).length;
    const hunkChecked = total > 0 && next.length === total;
    const hunkIndeterminate = next.length > 0 && next.length < total;
    refs?.hunkCheckboxes.forEach((box) => {
        box.checked = hunkChecked;
        box.indeterminate = hunkIndeterminate;
    });
    if (hunkChecked) {
        if (!state.selectedHunks.includes(hunk)) state.selectedHunks.push(hunk);
    } else {
        state.selectedHunks = state.selectedHunks.filter((i) => i !== hunk);
    }
    refs?.hunkEls.forEach((el) => {
        el.classList.toggle('picked', hunkChecked);
    });
    if (state.currentFile) {
        (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
    }
    syncFileCheckboxWithHunks();
    updateSelectAllState(getVisibleFiles());
    updateCommitButton();
}

/** Syncs the file-level checkbox to current hunk and line selections. */
export function syncFileCheckboxWithHunks() {
    if (!state.currentFile) return;
    if (state.currentDiffBinary) {
        const on = state.selectedFiles.has(state.currentFile);
        updateListCheckboxForPath(state.currentFile, on, false);
        return;
    }
    const meta = state.currentDiffMeta;
    const totalHunks = meta?.totalHunks ?? allHunkIndices(state.currentDiff).length;
    const selHunks = (state.selectedHunks || []).length;
    if (totalHunks === 0) {
        updateListCheckboxForPath(state.currentFile, false, false);
        state.selectedFiles.delete(state.currentFile);
        return;
    }
    const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
    const hasAnyLineSel = Object.keys(rec).length > 0;
    const hasPartialLineSel = Object.keys(rec).some((key) => {
        const idx = Number(key);
        const chosen = Array.isArray(rec[idx]) ? rec[idx].length : 0;
        const total = meta?.changeCounts[idx] ?? 0;
        return total > 0 && chosen > 0 && chosen < total;
    });
    if (selHunks === totalHunks && !hasPartialLineSel) {
        updateListCheckboxForPath(state.currentFile, true, false);
        state.selectedFiles.add(state.currentFile);
    } else if (selHunks === 0 && !hasAnyLineSel) {
        updateListCheckboxForPath(state.currentFile, false, false);
        state.selectedFiles.delete(state.currentFile);
    } else {
        updateListCheckboxForPath(state.currentFile, false, true);
        state.selectedFiles.delete(state.currentFile);
    }
}

function handleMultiHunkToggle(input: HTMLInputElement, file: string) {
    const idx = Number(input.dataset.hunk || -1);
    if (!file || idx < 0) return;
    const checked = input.checked;
    const hunkContainer = input.closest('[data-hunk-index]') as HTMLElement | null;
    if (!hunkContainer) return;
    const hunks: number[] = (state as any).selectedHunksByFile[file] || [];
    if (checked) {
        if (!hunks.includes(idx)) hunks.push(idx);
    } else {
        const pos = hunks.indexOf(idx);
        if (pos >= 0) hunks.splice(pos, 1);
    }
    (state as any).selectedHunksByFile[file] = hunks;
    const lineCbs = hunkContainer.querySelectorAll<HTMLInputElement>('.pick-line');
    const linesRec: Record<number, number[]> = { ...((state as any).selectedLinesByFile[file] || {}) };
    if (checked && lineCbs.length > 0) {
        const lineIndices: number[] = [];
        lineCbs.forEach((cb) => {
            const li = Number(cb.dataset.line || -1);
            if (li >= 0) {
                cb.checked = true;
                lineIndices.push(li);
            }
        });
        if (lineIndices.length > 0) linesRec[idx] = Array.from(new Set(lineIndices)).sort((a, b) => a - b);
    } else {
        delete linesRec[idx];
        lineCbs.forEach((cb) => { cb.checked = false; });
    }
    (state as any).selectedLinesByFile[file] = linesRec;
    hunkContainer.querySelectorAll<HTMLInputElement>('.pick-hunk').forEach((cb) => {
        cb.indeterminate = false;
        cb.checked = checked;
    });
    const allHunkCbs = hunkContainer.closest('[data-file]')?.querySelectorAll<HTMLInputElement>('.pick-hunk') || [];
    const allChecked = Array.from(allHunkCbs).every((cb) => cb.checked);
    updateListCheckboxForPath(file, allChecked, false);
    if (allChecked) state.selectedFiles.add(file);
    else state.selectedFiles.delete(file);
    updateSelectAllState(getVisibleFiles());
    updateCommitButton();
}

function handleMultiLineToggle(input: HTMLInputElement, file: string) {
    const hunk = Number(input.dataset.hunk || -1);
    const line = Number(input.dataset.line || -1);
    if (!file || hunk < 0 || line < 0) return;
    const checked = input.checked;
    const hunkContainer = input.closest('[data-hunk-index]') as HTMLElement | null;
    if (!hunkContainer) return;
    const linesRec: Record<number, number[]> = { ...((state as any).selectedLinesByFile[file] || {}) };
    const oldLines = new Set(linesRec[hunk] || []);
    if (checked) oldLines.add(line);
    else oldLines.delete(line);
    const next = Array.from(oldLines).sort((a, b) => a - b);
    if (next.length > 0) linesRec[hunk] = next;
    else delete linesRec[hunk];
    (state as any).selectedLinesByFile[file] = linesRec;
    const totalLines = hunkContainer.querySelectorAll('.pick-line').length || 0;
    const hunks: number[] = (state as any).selectedHunksByFile[file] || [];
    if (next.length === totalLines) {
        hunkContainer.querySelectorAll<HTMLInputElement>('.pick-hunk').forEach((cb) => {
            cb.checked = true;
            cb.indeterminate = false;
        });
        if (!hunks.includes(hunk)) hunks.push(hunk);
    } else if (next.length === 0) {
        hunkContainer.querySelectorAll<HTMLInputElement>('.pick-hunk').forEach((cb) => {
            cb.checked = false;
            cb.indeterminate = false;
        });
        const pos = hunks.indexOf(hunk);
        if (pos >= 0) hunks.splice(pos, 1);
    } else {
        hunkContainer.querySelectorAll<HTMLInputElement>('.pick-hunk').forEach((cb) => {
            cb.checked = false;
            cb.indeterminate = true;
        });
        const pos = hunks.indexOf(hunk);
        if (pos >= 0) hunks.splice(pos, 1);
    }
    (state as any).selectedHunksByFile[file] = hunks;
    const allHunkCbs = hunkContainer.closest('[data-file]')?.querySelectorAll<HTMLInputElement>('.pick-hunk') || [];
    const allChecked = Array.from(allHunkCbs).every((cb) => cb.checked);
    const anyChecked = Array.from(allHunkCbs).some((cb) => cb.checked || cb.indeterminate);
    updateListCheckboxForPath(file, allChecked, !allChecked && anyChecked);
    if (allChecked) state.selectedFiles.add(file);
    else state.selectedFiles.delete(file);
    updateSelectAllState(getVisibleFiles());
    updateCommitButton();
}

/** Updates a list row checkbox and picked class for a specific file path. */
export function updateListCheckboxForPath(path: string, checked: boolean, indeterminate: boolean) {
    if (!listEl || !path) return;
    const rowSel = `li.row[data-path="${path.replace(/(["\\])/g, '\\$1')}"]`;
    const row = listEl.querySelector<HTMLElement>(rowSel);
    if (row) row.classList.toggle('picked', checked && !indeterminate);
    const cb = row?.querySelector<HTMLInputElement>('input.pick');
    if (cb) {
        cb.checked = checked;
        (cb as any).indeterminate = indeterminate;
    }
}
