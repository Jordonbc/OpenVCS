import { qsa, escapeHtml } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { TAURI } from '../../lib/tauri';
import { notify } from '../../lib/notify';
import { state, prefs, disableDefaultSelectAll } from '../../state/state';
import type { FileStatus, ConflictDetails } from '../../types';
import { buildPatchForSelectedHunks } from '../diff';
import { diffEl, diffHeadPath, diffMetaLfs, listEl } from './context';
import { updateCommitButton } from './commit';
import { hydrateStatus } from './hydrate';
import { getVisibleFiles, updateSelectAllState } from './selectionState';
import { openMergeModal, hasExternalMergeTool, launchExternalMergeTool } from '../conflicts';

function setLfsBadge(isLfs: boolean) {
    if (!diffMetaLfs) return;
    diffMetaLfs.hidden = !isLfs;
}

function scrollDiffToTop() {
    if (!diffEl) return;
    const host = diffEl.closest('.diff-scroll') as HTMLElement | null;
    const viewport = host?.querySelector<HTMLElement>('[data-overlayscrollbars-viewport]') || host || diffEl.parentElement || diffEl;
    if (viewport) {
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
    }
}

const BINARY_DIFF_INDICATORS = [
    /^binary files /i,
    /^git binary patch/i,
    /^literal /i,
];

function detectBinaryDiff(lines: string[] = []) {
    if (!Array.isArray(lines) || lines.length === 0) {
        return true;
    }
    const hasHunks = lines.some((line) => (line || '').startsWith('@@'));
    if (hasHunks) {
        return false;
    }
    return lines.some((line) =>
        BINARY_DIFF_INDICATORS.some((rx) => rx.test(String(line || '')))
    );
}

function renderBinaryDiffPlaceholder(path?: string) {
    const label = path ? ` (${escapeHtml(path)})` : '';
    return `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code binary-placeholder">Diff not supported on this file type${label}.</div></div></div>`;
}

export function highlightRow(index: number) {
    const rows = qsa<HTMLElement>((prefs.tab === 'history' ? '.row.commit' : '.row'), listEl || (undefined as any));
    rows.forEach((el, i) => el.classList.toggle('active', i === index));
}

export async function selectFile(file: FileStatus, index: number) {
    if (!diffHeadPath || !diffEl) return;
    highlightRow(index);
    setLfsBadge(false);
    const status = String(file.status || '').toUpperCase();
    if (status === 'U') {
        diffHeadPath.textContent = `${file.path || '(unknown file)'} (conflicted)`;
        await renderConflictView(file);
        return;
    }
    diffHeadPath.textContent = file.path || '(unknown file)';
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    scrollDiffToTop();

    

    try {
        if (TAURI.has && file.path) {
            TAURI.invoke<boolean>('git_lfs_is_tracked', { path: file.path })
                .then((isLfs) => setLfsBadge(!!isLfs))
                .catch(() => setLfsBadge(false));
        }
        let lines: string[] = [];
        if (TAURI.has && file.path) {
            lines = await TAURI.invoke<string[]>('git_diff_file', { path: file.path });
        }
        state.currentFile = file.path;
        state.currentDiff = lines || [];
        const isBinary = detectBinaryDiff(state.currentDiff);
        state.currentDiffBinary = isBinary;
        diffEl.innerHTML = isBinary
            ? renderBinaryDiffPlaceholder(file.path)
            : renderHunksWithSelection(state.currentDiff);
        scrollDiffToTop();
        
        if (!isBinary) {
            bindHunkToggles(diffEl);
        }

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
            const items: CtxItem[] = [];
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
            const hunksMap: Record<string, number[]> = (state as any).selectedHunksByFile || {};
            const filesWithSel = Object.keys(hunksMap).filter((k) => Array.isArray(hunksMap[k]) && hunksMap[k].length > 0);
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

        if (!state.currentDiffBinary) {
            const cached = (state as any).selectedHunksByFile?.[file.path] as number[] | undefined;
            if (Array.isArray(cached)) {
                state.selectedHunks = cached.slice();
                updateHunkCheckboxes();
            } else if (state.selectedFiles.has(file.path) || state.defaultSelectAll) {
                state.selectedHunks = allHunkIndices(state.currentDiff);
                updateHunkCheckboxes();
                const recExisting: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
                const root = diffEl as HTMLElement;
                const rec: Record<number, number[]> = { ...recExisting };
                state.selectedHunks.forEach((h) => {
                    if (rec[h] && rec[h].length > 0) return;
                    const boxes = root.querySelectorAll<HTMLInputElement>(`input.pick-line[data-hunk="${h}"]`);
                    const picked: number[] = [];
                    boxes.forEach((b) => {
                        b.checked = true;
                        picked.push(Number(b.dataset.line || -1));
                    });
                    if (picked.length > 0) rec[h] = Array.from(new Set(picked)).sort((a, b) => a - b);
                });
                (state as any).selectedLinesByFile[state.currentFile] = rec;
                updateHunkCheckboxes();
            } else {
                state.selectedHunks = [];
            }
        } else {
            state.selectedHunks = [];
            if (state.currentFile) {
                delete (state as any).selectedHunksByFile[state.currentFile];
                delete (state as any).selectedLinesByFile[state.currentFile];
            }
        }
        syncFileCheckboxWithHunks();
        updateCommitButton();
    } catch (e) {
        console.error(e);
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>';
        scrollDiffToTop();
    }
}

export async function selectStashDiff(selector: string) {
    if (!diffHeadPath || !diffEl) return;
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    scrollDiffToTop();
    try {
        let lines: string[] = [];
        if (TAURI.has && selector) {
            lines = await TAURI.invoke<string[]>('git_stash_show', { selector });
        }
        state.currentDiff = lines || [];
        diffEl.innerHTML = renderHunksReadonly(state.currentDiff);
        scrollDiffToTop();
    } catch (e) {
        console.warn('git_stash_show failed', e);
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load stash diff</div></div></div>';
        scrollDiffToTop();
    }
}

export async function renderCombinedDiff(paths: string[]) {
    if (!diffHeadPath || !diffEl) return;
    clearActiveRows();
    const files = Array.from(new Set(paths)).filter(Boolean);
    diffHeadPath.textContent = `Multiple files (${files.length})`;
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    scrollDiffToTop();
    let html = '';
    for (const p of files) {
        try {
            const lines = TAURI.has ? await TAURI.invoke<string[]>('git_diff_file', { path: p }) : [];
            html += `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">${escapeHtml(p)}</div></div></div>`;
            const fileLines = Array.isArray(lines) ? lines : [];
            if (detectBinaryDiff(fileLines)) {
                html += renderBinaryDiffPlaceholder(p);
            } else {
                html += renderHunksWithSelection(fileLines);
            }
        } catch {
            html += `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">${escapeHtml(p)} (failed to load diff)</div></div></div>`;
        }
    }
    diffEl.innerHTML = html || '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No diffs</div></div></div>';
    scrollDiffToTop();
}

export function clearDiffSelection() {
    if (!listEl) return;
    if (state.diffSelectedFiles && state.diffSelectedFiles.size > 0) {
        state.diffSelectedFiles.clear();
        const rows = listEl.querySelectorAll<HTMLElement>('li.row.diffsel');
        rows.forEach((r) => r.classList.remove('diffsel'));
    }
}

export function clearActiveRows() {
    if (!listEl) return;
    const rows = listEl.querySelectorAll<HTMLElement>('li.row.active');
    rows.forEach((r) => r.classList.remove('active'));
}

async function renderConflictView(file: FileStatus) {
    if (!diffEl) return;
    state.currentFile = file.path;
    state.currentDiff = [];
    state.selectedHunks = [];
    if ((state as any).selectedHunksByFile) {
        delete (state as any).selectedHunksByFile[file.path];
    }
    diffEl.innerHTML = '<div class="conflict-view"><div class="conflict-loading">Loading conflict…</div></div>';
    scrollDiffToTop();
    if (!TAURI.has) {
        diffEl.innerHTML = '<div class="conflict-view"><div class="conflict-error">Conflict details are only available in the desktop app.</div></div>';
        scrollDiffToTop();
        return;
    }
    try {
        const details = await TAURI.invoke<ConflictDetails>('git_conflict_details', { path: file.path });
        setLfsBadge(!!details?.lfs_pointer);
        diffEl.innerHTML = renderConflictMarkup(details);
        bindConflictActions(diffEl, file, details);
        scrollDiffToTop();
    } catch (err) {
        console.error(err);
        diffEl.innerHTML = '<div class="conflict-view"><div class="conflict-error">Failed to load conflict details.</div></div>';
        scrollDiffToTop();
    }
}

function renderConflictMarkup(details: ConflictDetails) {
    const binary = !!details.binary || !!details.lfs_pointer;
    const header = `<div class="conflict-header"><div class="conflict-title">Merge conflict</div>${renderConflictActions(binary)}</div>`;
    const body = binary ? renderBinaryConflictBody(details) : renderTextConflictBody(details);
    const pathAttr = escapeHtml(details.path || '');
    return `<div class="conflict-view" data-conflict-path="${pathAttr}" data-conflict-binary="${binary ? '1' : '0'}">${header}${body}</div>`;
}

function renderConflictActions(binary: boolean) {
    const mergeBtn = binary ? '' : '<button class="btn" data-conflict-action="merge">Merge…</button>';
    return `<div class="conflict-actions">
        <button class="btn" data-conflict-action="ours">Use Mine</button>
        <button class="btn" data-conflict-action="theirs">Use Theirs</button>
        ${mergeBtn}
    </div>`;
}

function renderBinaryConflictBody(details: ConflictDetails) {
    const note = details.lfs_pointer
        ? 'This file is managed by Git LFS. Choose which version to keep.'
        : 'This file is binary. Choose which version to keep.';
    return `<div class="conflict-body"><div class="conflict-note">${escapeHtml(note)}</div></div>`;
}

function renderTextConflictBody(details: ConflictDetails) {
    return `<div class="conflict-body"><div class="conflict-panels">
        ${renderConflictPane('Mine', details.ours)}
        ${renderConflictPane('Theirs', details.theirs)}
    </div></div>`;
}

function renderConflictPane(label: string, value?: string | null) {
    const safeLabel = escapeHtml(label);
    const hasText = typeof value === 'string' && value.length > 0;
    const body = hasText
        ? `<pre class="conflict-code">${escapeHtml(value || '')}</pre>`
        : '<div class="conflict-empty">(empty)</div>';
    return `<section class="conflict-pane"><header>${safeLabel}</header>${body}</section>`;
}

function bindConflictActions(root: HTMLElement, file: FileStatus, details: ConflictDetails) {
    const container = root.querySelector('.conflict-view') as HTMLElement | null;
    if (!container) return;

    const resolve = async (side: 'ours' | 'theirs') => {
        if (!TAURI.has) { notify('Resolving conflicts requires the desktop app.'); return; }
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-conflict-action]');
        buttons.forEach((b) => { b.disabled = true; });
        container.setAttribute('data-busy', '1');
        try {
            await TAURI.invoke('git_resolve_conflict_side', { path: file.path, side });
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

function clearAllFileSelections() {
    if (!listEl) return;
    const rows = listEl.querySelectorAll<HTMLElement>('li.row');
    rows.forEach((row) => {
        row.classList.remove('picked');
        const cb = row.querySelector<HTMLInputElement>('input.pick');
        if (cb) { cb.checked = false; (cb as any).indeterminate = false; }
    });
}

export function toggleFilePick(path: string, on: boolean) {
    if (!path) return;
    disableDefaultSelectAll();
    if (on) state.selectedFiles.add(path);
    else state.selectedFiles.delete(path);
    if (state.currentFile && state.currentFile === path) {
        if (on) {
            state.selectedHunks = allHunkIndices(state.currentDiff);
            (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
            const root = diffEl as HTMLElement;
            const rec: Record<number, number[]> = {};
            const lineBoxes = root.querySelectorAll<HTMLInputElement>('input.pick-line');
            lineBoxes.forEach((b) => {
                const h = Number(b.dataset.hunk || -1);
                const l = Number(b.dataset.line || -1);
                if (h < 0 || l < 0) return;
                (rec[h] ||= []).push(l);
                b.checked = true;
            });
            Object.keys(rec).forEach((k) => {
                rec[Number(k)] = Array.from(new Set(rec[Number(k)])).sort((a, b) => a - b);
            });
            (state as any).selectedLinesByFile[state.currentFile] = rec;
        } else {
            state.selectedHunks = [];
            delete (state as any).selectedHunksByFile[state.currentFile];
            const root = diffEl as HTMLElement;
            const lineBoxes = root.querySelectorAll<HTMLInputElement>('input.pick-line');
            lineBoxes.forEach((b) => { b.checked = false; });
            delete (state as any).selectedLinesByFile[state.currentFile];
        }
        updateHunkCheckboxes();
    }
    updateCommitButton();
}

export function updateHunkCheckboxes() {
    const root = diffEl as HTMLElement;
    if (!root) return;
    const boxes = root.querySelectorAll<HTMLInputElement>('input.pick-hunk');
    boxes.forEach((b) => {
        const idx = Number(b.dataset.hunk || -1);
        const on = state.selectedHunks.includes(idx);
        b.checked = on;
        const hk = b.closest('.hunk') as HTMLElement | null;
        if (hk) hk.classList.toggle('picked', on);
    });
    if (state.currentFile) {
        const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
        const lboxes = root.querySelectorAll<HTMLInputElement>('input.pick-line');
        lboxes.forEach((b) => {
            const h = Number(b.dataset.hunk || -1);
            const l = Number(b.dataset.line || -1);
            const on = Array.isArray(rec[h]) && rec[h].includes(l);
            b.checked = on;
        });
    }
}

function bindHunkToggles(root: HTMLElement) {
    const boxes = root.querySelectorAll<HTMLInputElement>('input.pick-hunk');
    boxes.forEach((b) => {
        b.addEventListener('change', () => {
            const clearedImplicit = disableDefaultSelectAll(true);
            if (clearedImplicit) clearAllFileSelections();
            const idx = Number(b.dataset.hunk || -1);
            if (b.checked) {
                if (!state.selectedHunks.includes(idx)) state.selectedHunks.push(idx);
            } else {
                state.selectedHunks = state.selectedHunks.filter((i) => i !== idx);
            }
            if (state.currentFile) {
                (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
                const linesInHunk = Array.from(root.querySelectorAll<HTMLInputElement>(`input.pick-line[data-hunk="${idx}"]`));
                const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
                if (b.checked) {
                    const picked: number[] = [];
                    linesInHunk.forEach((el) => { el.checked = true; picked.push(Number(el.dataset.line || -1)); });
                    rec[idx] = Array.from(new Set([...(rec[idx] || []), ...picked])).sort((a, b) => a - b);
                } else {
                    linesInHunk.forEach((el) => { el.checked = false; });
                    delete rec[idx];
                }
                (state as any).selectedLinesByFile[state.currentFile] = rec;
            }
            syncFileCheckboxWithHunks();
            updateSelectAllState(getVisibleFiles());
            updateCommitButton();
            const hk = b.closest('.hunk') as HTMLElement | null;
            if (hk) hk.classList.toggle('picked', b.checked);
        });
    });

    const lineBoxes = root.querySelectorAll<HTMLInputElement>('input.pick-line');
    lineBoxes.forEach((b) => {
        b.addEventListener('change', () => {
            const clearedImplicit = disableDefaultSelectAll(true);
            if (clearedImplicit) clearAllFileSelections();
            const hunk = Number(b.dataset.hunk || -1);
            const line = Number(b.dataset.line || -1);
            if (!state.currentFile || hunk < 0 || line < 0) return;
            const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
            const cur = new Set<number>(rec[hunk] || []);
            if (b.checked) cur.add(line);
            else cur.delete(line);
            rec[hunk] = Array.from(cur).sort((a, b) => a - b);
            if (rec[hunk].length === 0) delete rec[hunk];
            (state as any).selectedLinesByFile[state.currentFile] = rec;

            const hunkBox = root.querySelector<HTMLInputElement>(`input.pick-hunk[data-hunk="${hunk}"]`);
            if (hunkBox) {
                const total = root.querySelectorAll<HTMLInputElement>(`input.pick-line[data-hunk="${hunk}"]`).length;
                const sel = rec[hunk]?.length || 0;
                (hunkBox as any).indeterminate = sel > 0 && sel < total;
                hunkBox.checked = sel === total && total > 0;
                const idx = Number(hunkBox.dataset.hunk || -1);
                if (sel === total && total > 0) {
                    if (!state.selectedHunks.includes(idx)) state.selectedHunks.push(idx);
                } else {
                    state.selectedHunks = state.selectedHunks.filter((i) => i !== idx);
                }
                if (state.currentFile) {
                    (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
                }
            }
            syncFileCheckboxWithHunks();
            updateSelectAllState(getVisibleFiles());
            updateCommitButton();
        });
    });
}

function syncFileCheckboxWithHunks() {
    if (!state.currentFile) return;
    if (state.currentDiffBinary) {
        const on = state.selectedFiles.has(state.currentFile);
        updateListCheckboxForPath(state.currentFile, on, false);
        return;
    }
    const totalHunks = allHunkIndices(state.currentDiff).length;
    const selHunks = (state.selectedHunks || []).length;
    if (totalHunks === 0) {
        updateListCheckboxForPath(state.currentFile, false, false);
        state.selectedFiles.delete(state.currentFile);
        return;
    }
    const rec: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
    const lines = state.currentDiff || [];
    const first = lines.findIndex((l) => (l || '').startsWith('@@'));
    const rest = first >= 0 ? lines.slice(first) : [];
    const starts: number[] = [];
    for (let i = 0; i < rest.length; i++) { if ((rest[i] || '').startsWith('@@')) starts.push(i); }
    starts.push(rest.length);
    const changeCounts: number[] = [];
    for (let h = 0; h < Math.max(0, starts.length - 1); h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const block = rest.slice(s + 1, e);
        const cnt = block.reduce((acc, ln) => {
            const ch = (ln || '')[0] || ' ';
            return acc + ((ch === '+' || ch === '-') ? 1 : 0);
        }, 0);
        changeCounts[h] = cnt;
    }
    const hasAnyLineSel = Object.keys(rec).length > 0;
    const hasPartialLineSel = Object.keys(rec).some((k) => {
        const h = Number(k);
        const chosen = Array.isArray(rec[h]) ? rec[h].length : 0;
        const total = changeCounts[h] || 0;
        return chosen > 0 && chosen < total;
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

export function allHunkIndices(lines: string[]) {
    if (!Array.isArray(lines) || !lines.length) return [] as number[];
    const idx = lines.findIndex((l) => l.startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
    return starts.map((_, i) => i);
}

export function renderHunksWithSelection(lines: string[]) {
    if (!lines || !lines.length) return '';
    let idx = lines.findIndex((l) => l.startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
    starts.push(rest.length);
    if (starts.length <= 1) {
        return '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No textual hunks to display</div></div></div>';
    }
    let html = '';
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const hunkLines = rest.slice(s, e);
        const offset = (idx >= 0 ? idx : 0) + s;
        const body = hunkLines.map((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const isChange = first === '+' || first === '-';
            const lineCheckbox = isChange ? `<label class="pick-toggle"><input type="checkbox" class="pick-line" data-hunk="${h}" data-line="${i}" /><span class="sr-only">Include line</span></label>` : '';
            const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
            return `<div class="hline ${t}"><div class="gutter">${lineCheckbox}${offset + i + 1}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
        }).join('');
        html += `<div class="hunk" data-hunk-index="${h}"><div class="hline"><div class="gutter"><label class="pick-toggle"><input type="checkbox" class="pick-hunk" data-hunk="${h}" /><span class="sr-only">Include hunk</span></label></div><div class="code"></div></div>${body}</div>`;
    }
    return html;
}

export function renderHunksReadonly(lines: string[]) {
    if (!lines || !lines.length) return '';
    let idx = lines.findIndex((l) => l.startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
    starts.push(rest.length);
    if (starts.length <= 1) {
        return '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No textual hunks to display</div></div></div>';
    }
    let html = '';
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const hunkLines = rest.slice(s, e);
        const offset = (idx >= 0 ? idx : 0) + s;
        html += `<div class="hunk">${hunkLines.map((ln, i) => hline(ln, offset + i + 1)).join('')}</div>`;
    }
    return html;
}

function hline(ln: string, n: number) {
    const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
    const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
    return `<div class="hline ${t}"><div class="gutter">${n}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
}

export function updateListCheckboxForPath(path: string, checked: boolean, indeterminate: boolean) {
    if (!listEl || !path) return;
    const selector = `li.row[data-path="${path.replace(/(["\\])/g, '\\$1')}"] input.pick`;
    const cb = listEl.querySelector<HTMLInputElement>(selector);
    if (cb) {
        cb.checked = checked;
        (cb as any).indeterminate = indeterminate;
    }
}
