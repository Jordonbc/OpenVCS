import { escapeHtml } from '../../lib/dom';
import { state, prefs, statusClass } from '../../state/state';
import { refreshRepoActions } from '../../ui/layout';
import { filterInput, listEl, countEl, diffHeadPath, diffEl } from './context';
import { renderCombinedDiff, selectFile, toggleFilePick } from './diffView';
import { renderHistoryList } from './history';
import { renderStashList, showStashFooter, hideStashFooter, setRenderListRef } from './stash';
import { onFileClick, onFileMouseDown, onFileContextMenu, setRenderListCallback, isDragSelecting, setDragCurrentIndex, updateDragRange } from './interactions';
import { updateSelectAllState } from './selectionState';
import { updateCommitButton } from './commit';

export function renderList() {
    if (!listEl || !countEl || !filterInput || !diffHeadPath || !diffEl) return;

    listEl.innerHTML = '';
    const isHistory = prefs.tab === 'history';
    const isStash = prefs.tab === 'stash';
    if (isHistory || isStash) listEl.classList.add('commit-list');
    else listEl.classList.remove('commit-list');

    const q = filterInput.value.trim().toLowerCase();
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
    if (!listEl || !countEl) return;
    const files = (state.files || []).filter((f) => !query || (f.path || '').toLowerCase().includes(query));
    countEl.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
    updateSelectAllState(files);

    if (!files.length) {
        listEl.innerHTML = '<li class="row" aria-disabled="true"><div class="file">No changes. Clone or add a repository to get started.</div></li>';
        if (diffHeadPath) diffHeadPath.textContent = 'Select a file to view changes';
        if (diffEl) diffEl.innerHTML = '';
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
        li.classList.toggle('picked', picked);
        li.classList.toggle('diffsel', diffsel);
        li.innerHTML = `
      <input type="checkbox" class="pick" aria-label="Select file" ${picked ? 'checked' : ''} />
      <span class="status ${statusClass(f.status)}">${escapeHtml(f.status || '')}</span>
      <div class="file" title="${escapeHtml(f.path || '')}">${escapeHtml(f.path || '')}</div>
      <span class="pick-mark" aria-hidden="true">✓</span>`;
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
            li.classList.toggle('picked', !!cb?.checked && !(cb as any).indeterminate);
        });
        listEl.appendChild(li);
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
setRenderListRef(renderList);
setRenderListCallback(renderList);
