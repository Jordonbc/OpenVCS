// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qsa, escapeHtml } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { TAURI } from '../../lib/tauri';
import { confirmBool } from '../../lib/confirm';
import { notify } from '../../lib/notify';
import { state, prefs, disableDefaultSelectAll, DiffMeta, HunkNodeRefs } from '../../state/state';
import type { FileStatus, ConflictDetails } from '../../types';
import { buildPatchForSelectedHunks } from '../diff';
import { diffEl, diffHeadPath, listEl } from './context';
import { updateCommitButton } from './commit';
import { hydrateStatus } from './hydrate';
import { getVisibleFiles, updateSelectAllState } from './selectionState';
import { openMergeModal, hasExternalMergeTool, launchExternalMergeTool } from '../conflicts';

/** Scrolls the current diff viewport back to the origin. */
function scrollDiffToTop() {
    if (!diffEl) return;
    const host = diffEl.closest('.diff-scroll') as HTMLElement | null;
    const viewport = host?.querySelector<HTMLElement>('.os-viewport, [data-overlayscrollbars-viewport]') || host || diffEl.parentElement || diffEl;
    if (viewport) {
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
    }
}

/** Regex markers that identify non-textual Git patches. */
const BINARY_DIFF_INDICATORS = [
    /^binary files /i,
    /^git binary patch/i,
    /^literal /i,
];

/** Returns true when the diff payload should be treated as binary. */
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

/** Renders a placeholder hunk for binary or unsupported file types. */
function renderBinaryDiffPlaceholder(path?: string) {
    const label = path ? ` (${escapeHtml(path)})` : '';
    return `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code binary-placeholder">Diff not supported on this file type${label}.</div></div></div>`;
}

/** Builds a synthetic unified diff for an untracked text file. */
function buildUntrackedTextPatch(path: string, text: string): string[] {
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    const body = normalized.length ? normalized.split('\n') : [];
    if (body.length > 0 && body[body.length - 1] === '') body.pop();
    const out = [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${path}`,
        `@@ -0,0 +1,${body.length} @@`,
    ];
    for (const line of body) out.push(`+${line}`);
    return out;
}

/** Highlights a row in the left list for the current tab. */
export function highlightRow(index: number) {
    const rows = qsa<HTMLElement>((prefs.tab === 'history' ? '.row.commit' : '.row'), listEl || (undefined as any));
    rows.forEach((el, i) => el.classList.toggle('active', i === index));
}

/** Loads and renders the selected file diff with selection state restored. */
export async function selectFile(file: FileStatus, index: number) {
    if (!diffHeadPath || !diffEl) return;
    if (!state.diffDirty && state.currentFile === file.path) {
        highlightRow(index);
        return;
    }
    highlightRow(index);
    const status = String(file.status || '').toUpperCase();
    if (status === 'U') {
        diffHeadPath.textContent = `${file.path || '(unknown file)'} (conflicted)`;
        await renderConflictView(file);
        state.diffDirty = false;
        return;
    }
    diffHeadPath.textContent = file.path || '(unknown file)';
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    scrollDiffToTop();

    

    try {
        let lines: string[] = [];
        if (file.path) {
            lines = await TAURI.invoke<string[]>('vcs_diff_file', { path: file.path });
        }
        if (status === '?' && file.path && (!Array.isArray(lines) || lines.length === 0)) {
            try {
                const text = await TAURI.invoke<string>('read_repo_file_text', { path: file.path });
                lines = buildUntrackedTextPatch(file.path, text || '');
            } catch {
                lines = [
                    `diff --git a/${file.path} b/${file.path}`,
                    'new file mode 100644',
                    '--- /dev/null',
                    `+++ b/${file.path}`,
                    '@@ -0,0 +1,0 @@',
                ];
            }
        }
        state.currentFile = file.path;
        state.currentDiff = lines || [];
        const isBinary = detectBinaryDiff(state.currentDiff);
        state.currentDiffBinary = isBinary;
        if (isBinary) {
            state.currentDiffMeta = null;
            state.currentDiffHunkNodes = new Map();
            diffEl.innerHTML = renderBinaryDiffPlaceholder(file.path);
        } else {
            const fragment = buildDiffFragment(state.currentDiff);
            diffEl.innerHTML = '';
            diffEl.appendChild(fragment);
            bindHunkToggles(diffEl);
        }
        scrollDiffToTop();

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
                const ok = await confirmBool('Discard this hunk? This cannot be undone.');
                if (!ok) return;
                try {
                    const patch = buildPatchForSelectedHunks(file.path, state.currentDiff, [hi]);
                    if (patch) {
                        await TAURI.invoke('vcs_discard_patch', { patch });
                        await Promise.allSettled([hydrateStatus()]);
                    }
                } catch (e) { console.error('Discard failed:', e); notify('Discard failed'); }
            }});
            const selected = (state as any).selectedHunksByFile?.[file.path] as number[] | undefined;
            if (Array.isArray(selected) && selected.length > 0) {
                items.push({ label: 'Discard selected hunks (this file)', action: async () => {
                    const ok = await confirmBool(`Discard ${selected.length} selected hunk(s) in this file? This cannot be undone.`);
                    if (!ok) return;
                    try {
                        const patch = buildPatchForSelectedHunks(file.path, state.currentDiff, selected);
                        if (patch) {
                            await TAURI.invoke('vcs_discard_patch', { patch });
                            await Promise.allSettled([hydrateStatus()]);
                        }
                    } catch (e) { console.error('Discard failed:', e); notify('Discard failed'); }
                }});
            }
            const hunksMap: Record<string, number[]> = (state as any).selectedHunksByFile || {};
            const filesWithSel = Object.keys(hunksMap).filter((k) => Array.isArray(hunksMap[k]) && hunksMap[k].length > 0);
            if (filesWithSel.length > 0) {
                items.push({ label: 'Discard selected hunks (all files)', action: async () => {
                    const ok = await confirmBool(`Discard selected hunks across ${filesWithSel.length} file(s)? This cannot be undone.`);
                    if (!ok) return;
                    try {
                        let patch = '';
                        for (const p of filesWithSel) {
                            let lines: string[] = [];
                            try { lines = await TAURI.invoke<string[]>('vcs_diff_file', { path: p }); } catch {}
                            if (!Array.isArray(lines) || lines.length === 0) continue;
                            patch += buildPatchForSelectedHunks(p, lines, hunksMap[p]) + '\n';
                        }
                        if (patch.trim()) {
                            await TAURI.invoke('vcs_discard_patch', { patch });
                            await Promise.allSettled([hydrateStatus()]);
                        }
                    } catch (e) { console.error('Discard failed:', e); notify('Discard failed'); }
                }});
            }
            buildCtxMenu(items, x, y);
        };
        diffEl.addEventListener('contextmenu', onCtx, { once: true });

        if (!state.currentDiffBinary) {
            const cached = (state as any).selectedHunksByFile?.[file.path] as number[] | undefined;
            const hunkNodes = state.currentDiffHunkNodes;
            if (Array.isArray(cached)) {
                state.selectedHunks = cached.slice();
                updateHunkCheckboxes();
            } else if (state.selectedFiles.has(file.path) || state.defaultSelectAll) {
                state.selectedHunks = allHunkIndices(state.currentDiff);
                updateHunkCheckboxes();
                const recExisting: Record<number, number[]> = (state as any).selectedLinesByFile[state.currentFile] || {};
                const rec: Record<number, number[]> = { ...recExisting };
                state.selectedHunks.forEach((h) => {
                    if (rec[h] && rec[h].length > 0) return;
                    const picked: number[] = [];
                    const refs = hunkNodes.get(h);
                    Object.keys(refs?.lineCheckboxes || {}).forEach((ln) => {
                        const idx = Number(ln);
                        if (idx < 0) return;
                        const box = refs?.lineCheckboxes[idx];
                        if (!box) return;
                        box.checked = true;
                        picked.push(idx);
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
        state.diffDirty = false;
    } catch (e) {
        console.error(e);
        state.currentDiffMeta = null;
        state.currentDiffHunkNodes = new Map();
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>';
        scrollDiffToTop();
    }
}

/** Loads and renders a stash diff in read-only mode. */
export async function selectStashDiff(selector: string) {
    if (!diffHeadPath || !diffEl) return;
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    scrollDiffToTop();
    try {
        let lines: string[] = [];
        if (selector) {
            lines = await TAURI.invoke<string[]>('vcs_stash_show', { selector });
        }
        state.currentDiff = lines || [];
        diffEl.innerHTML = renderHunksReadonly(state.currentDiff);
        scrollDiffToTop();
    } catch (e) {
        console.warn('vcs_stash_show failed', e);
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load stash diff</div></div></div>';
        scrollDiffToTop();
    }
}

/** Renders diffs for multiple files in a single combined view. */
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
            const lines = await TAURI.invoke<string[]>('vcs_diff_file', { path: p });
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

/** Clears multi-file diff selection state from the list. */
export function clearDiffSelection() {
    if (!listEl) return;
    if (state.diffSelectedFiles && state.diffSelectedFiles.size > 0) {
        state.diffSelectedFiles.clear();
        const rows = listEl.querySelectorAll<HTMLElement>('li.row.diffsel');
        rows.forEach((r) => r.classList.remove('diffsel'));
    }
}

/** Removes active styling from all rows in the file list. */
export function clearActiveRows() {
    if (!listEl) return;
    const rows = listEl.querySelectorAll<HTMLElement>('li.row.active');
    rows.forEach((r) => r.classList.remove('active'));
}

/** Loads and renders conflict details and resolution actions. */
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
    const body = binary ? renderBinaryConflictBody(details) : renderTextConflictBody(details);
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
function renderBinaryConflictBody(details: ConflictDetails) {
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
    disableDefaultSelectAll();
    if (on) state.selectedFiles.add(path);
    else state.selectedFiles.delete(path);
    if (state.currentFile && state.currentFile === path && !state.currentDiffBinary) {
        const hunkNodes = state.currentDiffHunkNodes;
        if (on) {
            state.selectedHunks = allHunkIndices(state.currentDiff);
            (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
            const rec: Record<number, number[]> = {};
            hunkNodes.forEach((refs, idx) => {
                if (refs.hunkCheckbox) {
                    refs.hunkCheckbox.checked = true;
                    refs.hunkCheckbox.indeterminate = false;
                }
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
                if (refs.hunkCheckbox) {
                    refs.hunkCheckbox.checked = false;
                    refs.hunkCheckbox.indeterminate = false;
                }
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
        if (refs.hunkCheckbox) {
            refs.hunkCheckbox.checked = isSelected;
            refs.hunkCheckbox.indeterminate = false;
        }
        refs.hunkEl.classList.toggle('picked', isSelected);
        if (state.currentFile) {
            const lines = rec[idx] || [];
            Object.entries(refs.lineCheckboxes).forEach(([key, box]) => {
                const lineIdx = Number(key);
                const checked = Array.isArray(lines) && lines.includes(lineIdx);
                box.checked = checked;
            });
            if (refs.hunkCheckbox) {
                const total = state.currentDiffMeta?.changeCounts[idx] ?? Object.keys(refs.lineCheckboxes).length;
                const chosen = lines.length;
                refs.hunkCheckbox.checked = total > 0 && chosen === total;
                refs.hunkCheckbox.indeterminate = chosen > 0 && chosen < total;
            }
        } else {
            Object.values(refs.lineCheckboxes).forEach((box) => { box.checked = false; });
            if (refs.hunkCheckbox) refs.hunkCheckbox.indeterminate = false;
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

/** Routes checkbox changes to hunk-level or line-level handlers. */
function handleDiffInputChange(ev: Event) {
    const target = ev.target as HTMLInputElement | null;
    if (!target || !(target instanceof HTMLInputElement)) return;
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
    refs?.hunkEl?.classList.toggle('picked', input.checked);
    if (refs?.hunkCheckbox) {
        refs.hunkCheckbox.indeterminate = false;
        refs.hunkCheckbox.checked = input.checked;
    }
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
    const hunkBox = refs?.hunkCheckbox;
    if (hunkBox) {
        hunkBox.checked = total > 0 && next.length === total;
        hunkBox.indeterminate = next.length > 0 && next.length < total;
        if (hunkBox.checked) {
            if (!state.selectedHunks.includes(hunk)) state.selectedHunks.push(hunk);
        } else {
            state.selectedHunks = state.selectedHunks.filter((i) => i !== hunk);
        }
        refs?.hunkEl?.classList.toggle('picked', hunkBox.checked);
    }
    if (state.currentFile) {
        (state as any).selectedHunksByFile[state.currentFile] = state.selectedHunks.slice();
    }
    syncFileCheckboxWithHunks();
    updateSelectAllState(getVisibleFiles());
    updateCommitButton();
}

/** Syncs the file-level checkbox to current hunk and line selections. */
function syncFileCheckboxWithHunks() {
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

/** Returns contiguous hunk indices derived from unified diff lines. */
export function allHunkIndices(lines: string[]) {
    const meta = state.currentDiffMeta;
    if (meta && meta.totalHunks > 0) {
        return Array.from({ length: meta.totalHunks }, (_, i) => i);
    }
    if (!Array.isArray(lines) || !lines.length) return [] as number[];
    const idx = lines.findIndex((l) => l.startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
    return starts.map((_, i) => i);
}

/** Parses diff lines into reusable metadata for hunk rendering. */
function buildDiffMeta(lines: string[]): DiffMeta {
    const idx = lines.findIndex((l) => (l || '').startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if ((l || '').startsWith('@@')) starts.push(i); });
    if (starts.length === 0) return {
        offset: Math.max(0, idx),
        rest,
        starts,
        changeCounts: [],
        totalHunks: 0,
    };
    starts.push(rest.length);
    const changeCounts: number[] = [];
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const block = rest.slice(s + 1, e);
        const cnt = block.reduce((acc, ln) => {
            const first = (ln || '')[0] || ' ';
            return acc + ((first === '+' || first === '-') ? 1 : 0);
        }, 0);
        changeCounts[h] = cnt;
    }
    return {
        offset: Math.max(0, idx),
        rest,
        starts,
        changeCounts,
        totalHunks: Math.max(0, starts.length - 1),
    };
}

/** Builds a DOM fragment for diff hunks and caches node references. */
function buildDiffFragment(lines: string[]): DocumentFragment {
    const meta = buildDiffMeta(lines);
    state.currentDiffMeta = meta;
    const fragment = document.createDocumentFragment();
    const nodes = new Map<number, HunkNodeRefs>();
    if (meta.totalHunks <= 0) {
        const empty = document.createElement('div');
        empty.className = 'hunk';
        const hline = document.createElement('div');
        hline.className = 'hline';
        const gutter = document.createElement('div');
        gutter.className = 'gutter';
        const code = document.createElement('div');
        code.className = 'code';
        code.textContent = 'No textual hunks to display';
        hline.appendChild(gutter);
        hline.appendChild(code);
        empty.appendChild(hline);
        fragment.appendChild(empty);
        state.currentDiffHunkNodes = nodes;
        return fragment;
    }
    for (let h = 0; h < meta.totalHunks; h++) {
        const s = meta.starts[h];
        const e = meta.starts[h + 1];
        const hunkLines = meta.rest.slice(s, e);
        const offset = meta.offset + s;
        const hunkEl = document.createElement('div');
        hunkEl.className = 'hunk';
        hunkEl.dataset.hunkIndex = String(h);

        const header = document.createElement('div');
        header.className = 'hline';
        const gutter = document.createElement('div');
        gutter.className = 'gutter';
        const label = document.createElement('label');
        label.className = 'pick-toggle';
        const hunkCheckbox = document.createElement('input');
        hunkCheckbox.type = 'checkbox';
        hunkCheckbox.className = 'pick-hunk';
        hunkCheckbox.dataset.hunk = String(h);
        label.appendChild(hunkCheckbox);
        const srHunk = document.createElement('span');
        srHunk.className = 'sr-only';
        srHunk.textContent = 'Include hunk';
        label.appendChild(srHunk);
        gutter.appendChild(label);
        header.appendChild(gutter);
        const codeHeader = document.createElement('div');
        codeHeader.className = 'code';
        header.appendChild(codeHeader);
        hunkEl.appendChild(header);

        const lineCheckboxes: Record<number, HTMLInputElement> = {};
        hunkLines.forEach((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const lineRow = document.createElement('div');
            lineRow.className = `hline${first === '+' ? ' add' : first === '-' ? ' del' : ''}`;
            const lineGutter = document.createElement('div');
            lineGutter.className = 'gutter';
            if (first === '+' || first === '-') {
                const lineLabel = document.createElement('label');
                lineLabel.className = 'pick-toggle';
                const lineCheckbox = document.createElement('input');
                lineCheckbox.type = 'checkbox';
                lineCheckbox.className = 'pick-line';
                lineCheckbox.dataset.hunk = String(h);
                lineCheckbox.dataset.line = String(i);
                lineLabel.appendChild(lineCheckbox);
                const srLine = document.createElement('span');
                srLine.className = 'sr-only';
                srLine.textContent = 'Include line';
                lineLabel.appendChild(srLine);
                lineGutter.appendChild(lineLabel);
                lineCheckboxes[i] = lineCheckbox;
            }
            lineGutter.appendChild(document.createTextNode(String(offset + i + 1)));
            const code = document.createElement('div');
            code.className = 'code';
            code.innerHTML = escapeHtml(String(ln || ''));
            lineRow.appendChild(lineGutter);
            lineRow.appendChild(code);
            hunkEl.appendChild(lineRow);
        });
        nodes.set(h, { hunkEl, hunkCheckbox, lineCheckboxes });
        fragment.appendChild(hunkEl);
    }
    state.currentDiffHunkNodes = nodes;
    return fragment;
}

/** Renders diff hunks as HTML with selectable hunk and line checkboxes. */
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

/** Renders diff hunks as static, read-only HTML. */
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

/** Renders one read-only diff line row. */
function hline(ln: string, n: number) {
    const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
    const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
    return `<div class="hline ${t}"><div class="gutter">${n}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
}

/** Updates a list row checkbox for a specific file path. */
export function updateListCheckboxForPath(path: string, checked: boolean, indeterminate: boolean) {
    if (!listEl || !path) return;
    const selector = `li.row[data-path="${path.replace(/(["\\])/g, '\\$1')}"] input.pick`;
    const cb = listEl.querySelector<HTMLInputElement>(selector);
    if (cb) {
        cb.checked = checked;
        (cb as any).indeterminate = indeterminate;
    }
}
