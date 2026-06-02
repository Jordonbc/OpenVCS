// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { escapeHtml } from '../../lib/dom';
import { hasRepo, isConflictStatus, state, prefs, statusClass, statusLabel } from '../../state/state';
import { refreshRepoActions } from '../../ui/layout';
import { filterInput, listEl, countEl, diffHeadPath, diffEl } from './context';
import { renderCombinedDiff, selectFile, toggleFilePick, updateDiffHeaderMeta } from './diffView';
import { renderHistoryList } from './history';
import { renderStashList, showStashFooter, hideStashFooter, setRenderListRef } from './stash';
import { onFileClick, onFileMouseDown, onFileContextMenu, setRenderListCallback, isDragSelecting, setDragCurrentIndex, updateDragRange } from './interactions';
import { updateSelectAllState } from './selectionState';
import { updateCommitButton } from './commit';

export function wireRenderListCallbacks() {
    setRenderListRef(renderList);
    setRenderListCallback(renderList);
}

export function renderList() {
    const list = listEl;
    const count = countEl;
    const filter = filterInput;
    const head = diffHeadPath;
    const diff = diffEl;
    if (!list || !count || !filter || !head || !diff) return;

    list.innerHTML = '';
    const isHistory = prefs.tab === 'history';
    const isStash = prefs.tab === 'stash';
    if (isHistory || isStash) list.classList.add('commit-list');
    else list.classList.remove('commit-list');

    const q = filter.value.trim().toLowerCase();
    updateCommitButton();

    if (isStash) showStashFooter();
    else hideStashFooter();
    refreshRepoActions();

    if (isHistory) {
        renderHistoryList(q);
        return;
    }
    if (isStash) {
        renderStashList(q);
        return;
    }

    renderChangesList(q);
}

function renderChangesList(query: string) {
    const list = listEl;
    const count = countEl;
    if (!list || !count) return;
    const files = (state.files || []).filter((f: any) => {
        if (!query) return true;
        const p = String(f?.path || '').toLowerCase();
        const o = String((f as any)?.old_path || '').toLowerCase();
        return p.includes(query) || o.includes(query);
    });
    list.classList.toggle('empty-state', !files.length);
    count.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
    updateSelectAllState(files);

    if (!files.length) {
        const emptyMessage = hasRepo()
            ? 'No changes in this repository.'
            : 'No repository is open. Clone or add a repository to get started.';
        list.innerHTML = `<li class="empty-state-message" aria-disabled="true"><div class="file">${escapeHtml(emptyMessage)}</div></li>`;
        if (diffHeadPath) diffHeadPath.textContent = 'Select a file to view changes';
        if (diffEl) diffEl.innerHTML = '';
        updateDiffHeaderMeta(null);
        state.currentFileMeta = null;
        updateSelectAllState([]);
        updateCommitButton();
        return;
    }

    files.forEach((f, i) => {
        const li = document.createElement('li');
        li.className = 'row';
        li.setAttribute('role', 'option');
        li.setAttribute('data-path', f.path || '');
        const picked = state.selectedFiles.has(f.path);
        const diffsel = state.diffSelectedFiles.has(f.path);
        const staged = !!(f as any).staged;
        const status = String((f as any)?.status || '').toUpperCase();
        const conflicted = isConflictStatus(status);
        const resolvedConflict =
            !!(f as any).resolved_conflict ||
            (state.mergeInProgress && staged && !conflicted && state.seenConflicts.has(String(f.path || '')));
        const oldPath = String((f as any)?.old_path || '').trim();
        const displayPath = (status === 'R' || status === 'C') && oldPath
            ? `${oldPath} → ${String(f.path || '').trim()}`
            : String(f.path || '');
        li.classList.toggle('picked', picked);
        li.classList.toggle('diffsel', diffsel);
        li.classList.toggle('resolved', resolvedConflict);
        li.classList.toggle('conflicted', conflicted);
        li.innerHTML = `
	      <input type="checkbox" class="pick" aria-label="Select file" ${picked ? 'checked' : ''} />
	      <span class="status-dot ${statusClass(status)}" title="${escapeHtml(statusLabel(status).trim())}" aria-hidden="true"></span>
	      <div class="file" title="${escapeHtml(displayPath)}">${escapeHtml(displayPath)}</div>
          <span class="row-marks" aria-hidden="true">
            <span class="stage-mark">✓</span>
            <span class="conflict-mark">!</span>
          </span>`;
        li.addEventListener('click', (e) => onFileClick(e as MouseEvent, f, i, files));
        li.addEventListener('mousedown', (e) => onFileMouseDown(e as MouseEvent, f, i, files, li));
        li.addEventListener('mouseenter', () => {
            if (isDragSelecting()) {
                setDragCurrentIndex(i);
                updateDragRange(files);
            }
        });
        li.addEventListener('contextmenu', (ev) => onFileContextMenu(ev, f));
        const cb = li.querySelector<HTMLInputElement>('input.pick');
        if (cb) cb.dataset.path = f.path || '';
        cb?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleFilePick(f.path, !!cb?.checked);
            updateSelectAllState(files);
            li.classList.toggle('picked', state.selectedFiles.has(f.path));
        });
        list.appendChild(li);
    });

    if (state.diffSelectedFiles && state.diffSelectedFiles.size > 1) {
        renderCombinedDiff(Array.from(state.diffSelectedFiles));
    } else {
        const curIdx = state.currentFile ? files.findIndex((x) => x.path === state.currentFile) : -1;
        if (curIdx >= 0) selectFile(files[curIdx], curIdx);
        else selectFile(files[0], 0);
    }
    updateCommitButton();
}
