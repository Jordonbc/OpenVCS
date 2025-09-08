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
let lastClickedIndex: number = -1;
let isDragSelecting = false;
let dragTargetState = true; // true=select, false=deselect
let dragVisited = new Set<string>();
let dragMoved = false;
let suppressNextClick = false;
let dragMode: 'diff' | 'commit' | null = null;
let dragStartIndex: number = -1;
let dragCurrentIndex: number = -1;
let dragPreDiff = new Set<string>();
let dragPrePicked = new Set<string>();

// Global guards to suppress native text selection/drag while we paint-select
document.addEventListener('selectstart', (e) => { if (isDragSelecting) e.preventDefault(); }, true);
document.addEventListener('dragstart',   (e) => { if (isDragSelecting) e.preventDefault(); }, true);

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
    // Toggle list styling for history vs changes
    if (isHistory) listEl.classList.add('commit-list');
    else listEl.classList.remove('commit-list');
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
            li.className = 'row commit';
            const short = (c.id || '').slice(0, 7);
            const whenRaw = String(c.meta || '').split('•')[0].trim();
            const rel = formatTimeAgo(whenRaw);
            const exact = (c.meta || '').trim();
            li.innerHTML = `
        <span class="badge hash" title="${escapeHtml(c.id || '')}">${escapeHtml(short)}</span>
        <div class="file" title="${escapeHtml(c.msg || '')}">${escapeHtml(c.msg || '(no message)')}</div>
        <span class="badge time" title="${escapeHtml(exact)}">${escapeHtml(rel)}</span>`;
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
        const diffsel = state.diffSelectedFiles.has(f.path);
        li.classList.toggle('picked', picked);
        li.classList.toggle('diffsel', diffsel);
        li.innerHTML = `
      <input type="checkbox" class="pick" aria-label="Select file" ${picked ? 'checked' : ''} />
      <span class="status ${statusClass(f.status)}">${escapeHtml(f.status || '')}</span>
      <div class="file" title="${escapeHtml(f.path || '')}">${escapeHtml(f.path || '')}</div>
      <span class="pick-mark" aria-hidden="true">✓</span>
      <span class="badge">${statusLabel(f.status)}</span>`;
        li.addEventListener('click', (e) => onFileClick(e as MouseEvent, f, i, files));
        li.addEventListener('mousedown', (e) => onFileMouseDown(e as MouseEvent, f, i, files, li));
        li.addEventListener('mouseenter', () => {
            if (isDragSelecting) {
                dragCurrentIndex = i;
                updateDragRange(files);
            }
        });
        li.addEventListener('contextmenu', (ev) => onFileContextMenu(ev, f));
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

    // Preserve current viewed file if present; otherwise show combined diff or first file
    const curIdx = state.currentFile ? files.findIndex(x => x.path === state.currentFile) : -1;
    if (state.diffSelectedFiles && state.diffSelectedFiles.size > 1) {
        renderCombinedDiff(Array.from(state.diffSelectedFiles));
    } else if (curIdx >= 0) {
        selectFile(files[curIdx], curIdx);
    } else {
        selectFile(files[0], 0);
    }
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
        // Right-click on hunk → context menu to discard this hunk
        const onCtx = (ev: Event) => {
            const mev = ev as MouseEvent;
            if (mev.type !== 'contextmenu') return;
            const hk = (mev.target as HTMLElement).closest('.hunk') as HTMLElement | null;
            if (!hk) return;
            mev.preventDefault();
            const idxAttr = hk.getAttribute('data-hunk-index');
            const hi = idxAttr ? Number(idxAttr) : -1;
            if (hi < 0) return;
            const x = mev.clientX, y = mev.clientY;
            const items: { label: string; action: () => void }[] = [];
            items.push({ label: 'Discard hunk', action: async () => {
                if (!TAURI.has) return;
                const ok = window.confirm('Discard this hunk? This cannot be undone.');
                if (!ok) return;
                try {
                    const patch = buildPatchForSelectedHunks(file.path, state.currentDiff, [hi]);
                    if (patch) {
                        await TAURI.invoke('git_discard_patch', { patch });
                        await Promise.allSettled([hydrateStatus()]);
                    }
                } catch { notify('Discard failed'); }
            }});
            const selected = (state as any).selectedHunksByFile?.[file.path] as number[] | undefined;
            if (Array.isArray(selected) && selected.length > 0) {
                items.push({ label: 'Discard selected hunks (this file)', action: async () => {
                    if (!TAURI.has) return;
                    const ok = window.confirm(`Discard ${selected.length} selected hunk(s) in this file? This cannot be undone.`);
                    if (!ok) return;
                    try {
                        const patch = buildPatchForSelectedHunks(file.path, state.currentDiff, selected);
                        if (patch) {
                            await TAURI.invoke('git_discard_patch', { patch });
                            await Promise.allSettled([hydrateStatus()]);
                        }
                    } catch { notify('Discard failed'); }
                }});
            }
            // Discard selected hunks across files
            const hunksMap: Record<string, number[]> = (state as any).selectedHunksByFile || {};
            const filesWithSel = Object.keys(hunksMap).filter(k => Array.isArray(hunksMap[k]) && hunksMap[k].length > 0);
            if (filesWithSel.length > 0) {
                items.push({ label: 'Discard selected hunks (all files)', action: async () => {
                    if (!TAURI.has) return;
                    const ok = window.confirm(`Discard selected hunks across ${filesWithSel.length} file(s)? This cannot be undone.`);
                    if (!ok) return;
                    try {
                        let patch = '';
                        for (const p of filesWithSel) {
                            let lines: string[] = [];
                            try { lines = await TAURI.invoke<string[]>('git_diff_file', { path: p }); } catch {}
                            if (!Array.isArray(lines) || lines.length === 0) continue;
                            patch += buildPatchForSelectedHunks(p, lines, hunksMap[p]) + '\n';
                        }
                        if (patch.trim()) {
                            await TAURI.invoke('git_discard_patch', { patch });
                            await Promise.allSettled([hydrateStatus()]);
                        }
                    } catch { notify('Discard failed'); }
                }});
            }
            buildCtxMenu(items, x, y);
        };
        diffEl.addEventListener('contextmenu', onCtx, { once: true });
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

function onFileClick(e: MouseEvent, file: { path: string }, index: number, visible: { path: string }[]) {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const isToggle = e.ctrlKey || e.metaKey;
    const isRange = e.shiftKey && lastClickedIndex >= 0;

    if (isRange) {
        // Toggle (invert) selection for the whole range
        const a = Math.min(lastClickedIndex, index);
        const b = Math.max(lastClickedIndex, index);
        for (let i = a; i <= b; i++) {
            const p = visible[i]?.path; if (!p) continue;
            if (state.selectedFiles.has(p)) state.selectedFiles.delete(p);
            else state.selectedFiles.add(p);
        }
        state.defaultSelectAll = false;
        updateSelectAllState(visible);
        renderList();
        // Keep the clicked file as the viewed file
        selectFile(file, index);
    } else if (isToggle) {
        const on = !state.selectedFiles.has(file.path);
        toggleFilePick(file.path, on);
        updateSelectAllState(visible);
        // Update row UI immediately (checkbox + picked class)
        if (listEl) {
            const sel = `li.row[data-path="${(file.path || '').replace(/([\"\\])/g, '\\$1')}"]`;
            const row = listEl.querySelector<HTMLElement>(sel);
            if (row) {
                row.classList.toggle('picked', on);
                const cb = row.querySelector<HTMLInputElement>('input.pick');
                if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
            }
        }
        // Do not affect diff multi-selection with commit toggle
        if (!(state.diffSelectedFiles && state.diffSelectedFiles.size > 1)) {
            selectFile(file, index);
        }
    } else {
        // plain click: clear diff multi-selection and view just this file
        clearDiffSelection();
        selectFile(file, index);
    }
    lastClickedIndex = index;
    updateCommitButton();
}

function onFileMouseDown(e: MouseEvent, file: { path: string }, index: number, visible: { path: string }[], li: HTMLElement) {
    if (e.button !== 0) return; // left only
    e.preventDefault(); // avoid starting native selection
    dragMoved = false;
    isDragSelecting = true;
    dragVisited.clear();
    document.body.classList.add('drag-selecting');
    // Clear any current selection
    try { const sel = window.getSelection?.(); sel && sel.removeAllRanges(); } catch {}
    // Decide mode based on modifiers
    dragMode = e.shiftKey ? 'diff' : (e.ctrlKey || e.metaKey) ? 'commit' : null;
    if (dragMode === 'diff') {
        dragTargetState = true;
        dragStartIndex = index; dragCurrentIndex = index;
        dragPreDiff = new Set(state.diffSelectedFiles);
        updateDragRange(visible);
    } else if (dragMode === 'commit') {
        const currentlyOn = state.selectedFiles.has(file.path);
        dragTargetState = !currentlyOn;
        dragStartIndex = index; dragCurrentIndex = index;
        dragPrePicked = new Set(state.selectedFiles);
        updateDragRange(visible);
    }

    const startX = e.clientX, startY = e.clientY;
    const onMove = (mv: MouseEvent) => {
        if (!dragMoved && (Math.abs(mv.clientX - startX) + Math.abs(mv.clientY - startY) > 3)) dragMoved = true;
        const el = document.elementFromPoint(mv.clientX, mv.clientY) as HTMLElement | null;
        const row = el ? el.closest('li.row[data-path]') as HTMLElement | null : null;
        if (row) {
            const p = row.getAttribute('data-path') || '';
            const i2 = visible.findIndex(v => v.path === p);
            if (i2 >= 0 && i2 !== dragCurrentIndex) {
                dragCurrentIndex = i2;
                updateDragRange(visible);
            }
        }
    };
    const onUp = () => {
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('mousemove', onMove);
        isDragSelecting = false;
        document.body.classList.remove('drag-selecting');
        updateSelectAllState(visible);
        updateCommitButton();
        if (dragMoved) suppressNextClick = true;
        lastClickedIndex = index;
        // If multiple files are diff-selected, render combined view
        if (state.diffSelectedFiles && state.diffSelectedFiles.size > 1) {
            renderCombinedDiff(Array.from(state.diffSelectedFiles));
        }
        dragMode = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
}

function applySelect(path: string, on: boolean, rowEl: HTMLElement | null, visible: { path: string }[], mode: 'diff'|'commit') {
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

function updateDragRange(visible: { path: string }[]) {
    if (!isDragSelecting || dragMode === null) return;
    const a = Math.min(dragStartIndex, dragCurrentIndex);
    const b = Math.max(dragStartIndex, dragCurrentIndex);
    if (dragMode === 'diff') {
        const next = new Set(dragPreDiff);
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i]?.path; if (!p) continue;
            if (i >= a && i <= b) next.add(p); else if (!dragPreDiff.has(p)) next.delete(p);
        }
        state.diffSelectedFiles = next;
        if (listEl) {
            visible.forEach(v => {
                const row = listEl!.querySelector<HTMLElement>(`li.row[data-path="${(v.path || '').replace(/([\"\\])/g, '\\$1')}"]`);
                if (row) row.classList.toggle('diffsel', state.diffSelectedFiles.has(v.path));
            });
        }
    } else if (dragMode === 'commit') {
        const next = new Set<string>();
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i]?.path; if (!p) continue;
            const inRange = i >= a && i <= b;
            const on = inRange ? dragTargetState : dragPrePicked.has(p);
            if (on) next.add(p);
            if (listEl) {
                const row = listEl!.querySelector<HTMLElement>(`li.row[data-path="${(p || '').replace(/([\"\\])/g, '\\$1')}"]`);
                if (row) row.classList.toggle('picked', on);
                const cb = listEl!.querySelector<HTMLInputElement>(`li.row[data-path="${(p || '').replace(/([\"\\])/g, '\\$1')}"] input.pick`);
                if (cb) { cb.checked = on; (cb as any).indeterminate = false; }
            }
            // If this is the currently viewed file, mirror commit selection to hunk selection
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

function buildCtxMenu(items: { label: string; action: () => void }[], x: number, y: number) {
    // remove existing
    document.querySelectorAll('.ctxmenu').forEach(el => el.remove());
    const m = document.createElement('div');
    m.className = 'ctxmenu';
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    items.forEach((it, idx) => {
        if (it.label === '---') { const sep = document.createElement('div'); sep.className = 'sep'; m.appendChild(sep); return; }
        const d = document.createElement('div'); d.className = 'item'; d.textContent = it.label;
        d.addEventListener('click', () => { try { it.action(); } finally { m.remove(); } });
        m.appendChild(d);
    });
    document.body.appendChild(m);
    const close = () => m.remove();
    setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 0);
}

function onFileContextMenu(ev: MouseEvent, f: { path: string }) {
    ev.preventDefault();
    const x = ev.clientX, y = ev.clientY;
    const hasSelectedFiles = state.selectedFiles && state.selectedFiles.size > 0;
    const items: { label: string; action: () => void }[] = [];
    items.push({ label: 'Discard changes', action: async () => {
        if (!TAURI.has) return;
        const ok = window.confirm(`Discard all changes in \n${f.path}? This cannot be undone.`);
        if (!ok) return;
        try { await TAURI.invoke('git_discard_paths', { paths: [f.path] }); await Promise.allSettled([hydrateStatus()]); }
        catch { notify('Discard failed'); }
    }});
    if (hasSelectedFiles) {
        items.push({ label: 'Discard selected files', action: async () => {
            if (!TAURI.has) return;
            const paths = Array.from(state.selectedFiles);
            const ok = window.confirm(`Discard all changes in ${paths.length} selected file(s)? This cannot be undone.`);
            if (!ok) return;
            try { await TAURI.invoke('git_discard_paths', { paths }); await Promise.allSettled([hydrateStatus()]); }
            catch { notify('Discard failed'); }
        }});
    }
    buildCtxMenu(items, x, y);
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

async function renderCombinedDiff(paths: string[]) {
    if (!diffHeadPath || !diffEl) return;
    const files = Array.from(new Set(paths)).filter(Boolean);
    diffHeadPath.textContent = `Multiple files (${files.length})`;
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    let html = '';
    for (const p of files) {
        try {
            const lines = TAURI.has ? await TAURI.invoke<string[]>('git_diff_file', { path: p }) : [];
            html += `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">${escapeHtml(p)}</div></div></div>`;
            html += renderHunksWithSelection(lines || []);
        } catch {
            html += `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">${escapeHtml(p)} (failed to load diff)</div></div></div>`;
        }
    }
    diffEl.innerHTML = html || '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No diffs</div></div></div>';
}

function clearDiffSelection() {
    if (!listEl) return;
    if (state.diffSelectedFiles && state.diffSelectedFiles.size > 0) {
        state.diffSelectedFiles.clear();
        // Remove visual class from rows
        const rows = listEl.querySelectorAll<HTMLElement>('li.row.diffsel');
        rows.forEach(r => r.classList.remove('diffsel'));
    }
}

function updateCommitButton() {
    const btn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const summary = document.getElementById('commit-summary') as HTMLInputElement | null;
    const summaryFilled = (summary?.value.trim().length ?? 0) > 0;
    const hunksSelected = Object.keys((state as any).selectedHunksByFile || {})
        .some((k) => Array.isArray((state as any).selectedHunksByFile[k]) && (state as any).selectedHunksByFile[k].length > 0);
    const filesSelected = !!(state.selectedFiles && state.selectedFiles.size > 0);
    btn.disabled = !(summaryFilled && (hunksSelected || filesSelected));
}

// Convert an ISO/RFC3339 datetime string into a short relative phrase.
function formatTimeAgo(isoMaybe: string): string {
    try {
        const d = new Date(String(isoMaybe || '').trim());
        const t = d.getTime();
        if (!isFinite(t)) return (isoMaybe || '').trim();
        const now = Date.now();
        let sec = Math.max(0, Math.round((now - t) / 1000));
        if (sec < 45) return 'just now';
        if (sec < 90) return '1 minute ago';
        let min = Math.round(sec / 60);
        if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
        let hr = Math.round(min / 60);
        if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
        let day = Math.round(hr / 24);
        if (day === 1) return 'yesterday';
        if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
        let wk = Math.round(day / 7);
        if (wk === 1) return '1 week ago';
        if (wk < 5) return `${wk} weeks ago`;
        let mon = Math.round(day / 30);
        if (mon === 1) return '1 month ago';
        if (mon < 12) return `${mon} months ago`;
        let yr = Math.round(day / 365);
        return `${yr} year${yr === 1 ? '' : 's'} ago`;
    } catch {
        return (isoMaybe || '').trim();
    }
}
