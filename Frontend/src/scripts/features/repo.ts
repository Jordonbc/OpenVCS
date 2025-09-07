// src/scripts/features/repo.ts
import { qs, qsa, escapeHtml } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state, prefs, statusLabel, statusClass } from '../state/state';

const filterInput   = qs<HTMLInputElement>('#filter');
const selectAllBox  = qs<HTMLInputElement>('#select-all');
const listEl        = qs<HTMLElement>('#file-list');
const countEl       = qs<HTMLElement>('#changes-count');

const diffHeadPath  = qs<HTMLElement>('#diff-path');
const diffEl        = qs<HTMLElement>('#diff');

export function bindRepoHotkeys(commitBtn: HTMLButtonElement | null, openSheet: (w: 'clone'|'add'|'switch') => void) {
    if (!filterInput) return;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && key === 'f') { e.preventDefault(); filterInput.focus(); }
        if (e.ctrlKey && key === 'r') { e.preventDefault(); openSheet('switch'); }
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commitBtn?.click(); }
        if (e.key === 'Escape') {
            const about = document.getElementById('about-modal');
            if (about?.classList.contains('show')) about.classList.remove('show');
            // do not force-open the command sheet on Esc; let modal system handle closes
        }
    });
}

export function bindFilter() {
    filterInput?.addEventListener('input', () => renderList());
    selectAllBox?.addEventListener('change', () => {
        if (prefs.tab !== 'changes') return;
        state.defaultSelectAll = false;
        const files = getVisibleFiles();
        toggleSelectAll(Boolean(selectAllBox?.checked), files);
        renderList();
    });
}

export function renderList() {
    if (!listEl || !countEl || !filterInput || !diffHeadPath || !diffEl) return;

    listEl.innerHTML = '';
    const isHistory = prefs.tab === 'history';
    const q = filterInput.value.trim().toLowerCase();
    updateCommitButton();

    if (isHistory) {
        const commits = (state.commits || []).filter(c =>
            !q || c.msg?.toLowerCase().includes(q) || c.id?.includes(q)
        );

        countEl.textContent = `${commits.length} commit${commits.length === 1 ? '' : 's'}`;

        if (!commits.length) {
            listEl.innerHTML = `<li class="row" aria-disabled="true"><div class="file">No commits loaded.</div></li>`;
            diffHeadPath.textContent = 'Commit details';
            diffEl.innerHTML = '';
            return;
        }

        commits.forEach((c, i) => {
            const li = document.createElement('li');
            li.className = 'row';
            li.innerHTML = `
        <span class="badge">${(c.id || '').slice(0,7)}</span>
        <div class="file" title="${escapeHtml(c.msg || '')}">${escapeHtml(c.msg || '(no message)')}</div>
        <span class="badge">${escapeHtml(c.meta || '')}</span>`;
            li.addEventListener('click', () => selectHistory(c, i));
            listEl.appendChild(li);
        });
        selectHistory(commits[0], 0);
        return;
    }

    const files = (state.files || []).filter(f =>
        !q || (f.path || '').toLowerCase().includes(q)
    );
    countEl.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
    updateSelectAllState(files);

    if (!files.length) {
        listEl.innerHTML = `<li class="row" aria-disabled="true"><div class="file">No changes. Clone or add a repository to get started.</div></li>`;
        diffHeadPath.textContent = 'Select a file to view changes';
        diffEl.innerHTML = '';
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
        li.classList.toggle('picked', picked);
        li.innerHTML = `
      <input type="checkbox" class="pick" aria-label="Select file" ${picked ? 'checked' : ''} />
      <span class="status ${statusClass(f.status)}">${escapeHtml(f.status || '')}</span>
      <div class="file" title="${escapeHtml(f.path || '')}">${escapeHtml(f.path || '')}</div>
      <span class="pick-mark" aria-hidden="true">✓</span>
      <span class="badge">${statusLabel(f.status)}</span>`;
        li.addEventListener('click', () => selectFile(f, i));
        // prevent row click when toggling checkbox
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

    selectFile(files[0], 0);
    updateCommitButton();
}

function highlightRow(index: number) {
    const rows = qsa<HTMLElement>('.row', listEl || (undefined as any));
    rows.forEach((el, i) => el.classList.toggle('active', i === index));
}

async function selectFile(file: { path: string }, index: number) {
    if (!diffHeadPath || !diffEl) return;
    highlightRow(index);
    diffHeadPath.textContent = file.path || '(unknown file)';
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';

    try {
        let lines: string[] = [];
        if (TAURI.has && file.path) {
            lines = await TAURI.invoke<string[]>('git_diff_file', { path: file.path });
        }
        state.currentFile = file.path;
        state.currentDiff = lines || [];
        diffEl.innerHTML = renderHunksWithSelection(state.currentDiff);
        bindHunkToggles(diffEl);
        const cached = (state as any).selectedHunksByFile?.[file.path] as number[] | undefined;
        if (Array.isArray(cached)) {
            state.selectedHunks = cached.slice();
            updateHunkCheckboxes();
        } else if (state.selectedFiles.has(file.path) || state.defaultSelectAll) {
            state.selectedHunks = allHunkIndices(state.currentDiff);
            updateHunkCheckboxes();
        } else {
            state.selectedHunks = [];
        }
        syncFileCheckboxWithHunks();
        updateCommitButton();
    } catch (e) {
        console.error(e);
        diffEl.innerHTML = `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>`;
    }
}

function selectHistory(commit: any, index: number) {
    if (!diffHeadPath || !diffEl) return;
    highlightRow(index);
    const id = (commit.id || '').slice(0,7);
    diffHeadPath.textContent = `Commit ${id || '(unknown)'}`;
    diffEl.innerHTML = `
    <div class="hunk">
      <div class="hline"><div class="gutter">commit</div><div class="code">${escapeHtml(commit.id || '')}</div></div>
      <div class="hline"><div class="gutter">Author</div><div class="code">${escapeHtml(commit.author || 'You <you@example.com>')}</div></div>
      <div class="hline"><div class="gutter">Message</div><div class="code">${escapeHtml(commit.msg || '')}</div></div>
    </div>`;
}

/* ---------------- hydration ---------------- */

/** Keep names consistent with backend: git_list_branches / git_current_branch */
export async function hydrateBranches() {
    if (!TAURI.has) return;
    try {
        const list = await TAURI.invoke<any[]>('git_list_branches');
        const current = await TAURI.invoke<string>('git_current_branch').catch(() => '');

        const has = Array.isArray(list) && list.length > 0;
        state.hasRepo = state.hasRepo || has; // don’t flip to false if another hydrate confirms true

        if (has) {
            state.branches = list as any;
            state.branch = current || (list.find((b: any) => b.current)?.name) || state.branch || 'main';
            window.dispatchEvent(new CustomEvent('app:branches-updated'));
        }
    } catch (e) {
        // Don’t nuke state here; status/summary calls will decide hasRepo
        console.warn('hydrateBranches failed', e);
    }
}

/** Status drives file list; on failure we clear files but don’t assert repo absence unless it’s consistent */
export async function hydrateStatus() {
    if (!TAURI.has) return;
    try {
        const result = await TAURI.invoke<{ files: any[]; ahead?: number; behind?: number }>('git_status');
        state.hasRepo = true;
        state.files = Array.isArray(result?.files) ? (result.files as any) : [];
        // Default-select all files unless the user has modified selection
        const currentPaths = new Set((state.files || []).map(f => f.path));
        if (state.defaultSelectAll) {
            state.selectedFiles = new Set(Array.from(currentPaths));
        } else {
            // prune stale selections no longer present
            state.selectedFiles.forEach(p => { if (!currentPaths.has(p)) state.selectedFiles.delete(p); });
        }
        // ahead/behind are optional in older backends; default to 0
        (state as any).ahead = Number((result as any)?.ahead || 0);
        (state as any).behind = Number((result as any)?.behind || 0);
        renderList();
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    } catch (e) {
        console.warn('hydrateStatus failed', e);
        state.files = [];
        state.selectedFiles.clear();
        renderList();
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    }
}

export async function hydrateCommits() {
    if (!TAURI.has) return;
    try {
        const list = await TAURI.invoke<any[]>('git_log', { limit: 100 });
        state.hasRepo = true;
        state.commits = Array.isArray(list) ? (list as any) : [];
        if (prefs.tab === 'history') renderList();
    } catch (e) {
        console.warn('hydrateCommits failed', e);
        state.commits = [];
    }
}

function renderHunksWithSelection(lines: string[]) {
    if (!lines || !lines.length) return '';
    // Find hunks; hide prelude lines like 'diff --git' / 'index ...' / '---' / '+++'
    let idx = lines.findIndex(l => l.startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
    starts.push(rest.length);

    if (starts.length <= 1) {
        return `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No textual hunks to display</div></div></div>`;
    }

    let html = '';
    // Render each hunk with a compact checkbox in the gutter
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h+1];
        const hunkLines = rest.slice(s, e);
        const offset = (idx >= 0 ? idx : 0) + s; // approximate numbering
        html += `<div class="hunk" data-hunk-index="${h}">
  <div class="hline"><div class="gutter"><label class="pick-toggle"><input type="checkbox" class="pick-hunk" data-hunk="${h}" /><span class="sr-only">Include hunk</span></label></div><div class="code"></div></div>
  ${hunkLines.map((ln, i) => hline(ln, offset + i + 1)).join('')}
</div>`;
    }
    return html;
}

function hline(ln: string, n: number) {
    const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
    const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
    return `<div class="hline ${t}"><div class="gutter">${n}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
}

function toggleFilePick(path: string, on: boolean) {
    if (!path) return;
    state.defaultSelectAll = false;
    if (on) state.selectedFiles.add(path); else state.selectedFiles.delete(path);
    // If this is the currently viewed file, mirror selection to all hunks in the diff
    if (state.currentFile && state.currentFile === path) {
        if (on) {
            state.selectedHunks = allHunkIndices(state.currentDiff);
            (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
        } else {
            state.selectedHunks = [];
            delete (state as any).selectedHunksByFile[state.currentFile];
        }
        updateHunkCheckboxes();
    }
    updateCommitButton();
}

function updateSelectAllState(visible: { path: string }[]) {
    if (!selectAllBox) return;
    if (prefs.tab !== 'changes') {
        selectAllBox.indeterminate = false;
        selectAllBox.checked = false;
        return;
    }
    const total = visible.length;
    if (total === 0) {
        selectAllBox.indeterminate = false;
        selectAllBox.checked = false;
        return;
    }
    const selected = visible.filter(f => state.selectedFiles.has(f.path)).length;
    selectAllBox.indeterminate = selected > 0 && selected < total;
    selectAllBox.checked = selected === total;
}

function getVisibleFiles(): { path: string }[] {
    if (prefs.tab !== 'changes') return [];
    const q = (filterInput?.value || '').trim().toLowerCase();
    return (state.files || []).filter(f => !q || (f.path || '').toLowerCase().includes(q));
}

function toggleSelectAll(on: boolean, visible: { path: string }[]) {
    if (on) {
        visible.forEach(f => { if (f.path) toggleFilePick(f.path, true); });
    } else {
        visible.forEach(f => { if (f.path) toggleFilePick(f.path, false); });
    }
}

function bindHunkToggles(root: HTMLElement) {
    const boxes = root.querySelectorAll<HTMLInputElement>('input.pick-hunk');
    boxes.forEach(b => {
        b.addEventListener('change', () => {
            state.defaultSelectAll = false;
            const idx = Number(b.dataset.hunk || -1);
            if (b.checked) {
                if (!state.selectedHunks.includes(idx)) state.selectedHunks.push(idx);
            } else {
                state.selectedHunks = state.selectedHunks.filter(i => i !== idx);
            }
            if (state.currentFile) {
                (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
            }
            // Update file checkbox and selectedFiles based on hunk selection
            const before = (state.selectedHunks || []).length;
            // Sync checkbox tri-state
            (function(){ syncFileCheckboxWithHunks(); })();
            if ((state.selectedHunks || []).length === 0 && state.currentFile) {
                state.selectedFiles.delete(state.currentFile);
                delete (state as any).selectedHunksByFile[state.currentFile];
            }
            updateSelectAllState(getVisibleFiles());
            updateCommitButton();
            const hk = b.closest('.hunk') as HTMLElement | null;
            if (hk) hk.classList.toggle('picked', b.checked);
        });
    });
}

function syncFileCheckboxWithHunks() {
    if (!state.currentFile) return;
    const total = allHunkIndices(state.currentDiff).length;
    const sel = (state.selectedHunks || []).length;
    if (total === 0) {
        updateListCheckboxForPath(state.currentFile, false, false);
        state.selectedFiles.delete(state.currentFile);
        return;
    }
    if (sel === 0) {
        updateListCheckboxForPath(state.currentFile, false, false);
        state.selectedFiles.delete(state.currentFile);
    } else if (sel === total) {
        updateListCheckboxForPath(state.currentFile, true, false);
        state.selectedFiles.add(state.currentFile);
    } else {
        updateListCheckboxForPath(state.currentFile, false, true);
        state.selectedFiles.delete(state.currentFile);
    }
}

function allHunkIndices(lines: string[]) {
    if (!Array.isArray(lines) || !lines.length) return [] as number[];
    const idx = lines.findIndex(l => l.startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
    // indices are 0..(count-1)
    return starts.map((_, i) => i);
}

function updateHunkCheckboxes() {
    const root = diffEl as HTMLElement;
    if (!root) return;
    const boxes = root.querySelectorAll<HTMLInputElement>('input.pick-hunk');
    boxes.forEach(b => {
        const idx = Number(b.dataset.hunk || -1);
        const on = state.selectedHunks.includes(idx);
        b.checked = on;
        const hk = b.closest('.hunk') as HTMLElement | null;
        if (hk) hk.classList.toggle('picked', on);
    });
}

function updateListCheckboxForPath(path: string, checked: boolean, indeterminate: boolean) {
    if (!listEl || !path) return;
    const selector = `li.row[data-path="${path.replace(/(["\\])/g, '\\$1')}"] input.pick`;
    const cb = listEl.querySelector<HTMLInputElement>(selector);
    if (cb) {
        cb.checked = checked;
        (cb as any).indeterminate = indeterminate;
    }
}

function updateCommitButton() {
    const btn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const hasHunks = (state.selectedHunks || []).length > 0 && (state.currentDiff || []).length > 0;
    const hasFiles = state.selectedFiles && state.selectedFiles.size > 0;
    const summary = document.getElementById('commit-summary') as HTMLInputElement | null;
    const summaryFilled = (summary?.value.trim().length ?? 0) > 0;
    btn.disabled = !(summaryFilled && (hasHunks || hasFiles));
}
