// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qsa, escapeHtml } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { TAURI } from '../../lib/tauri';
import { confirmBool } from '../../lib/confirm';
import { notify } from '../../lib/notify';
import { isConflictStatus, state, prefs } from '../../state/state';
import type { FileStatus } from '../../types';
import type { RepoFileMeta } from '../../types';
import { buildPatchForSelectedHunks } from '../diff';
import { diffEl, diffHeadPath, diffHeadMeta, diffLineEndingEl, diffEncodingEl, diffBomEl, listEl } from './context';
import { updateCommitButton } from './commit';
import { ensureConflictStatusesLoaded, hydrateStatus } from './hydrate';
import {
    scrollDiffToTop,
    detectBinaryDiff,
    renderBinaryDiffPlaceholder,
    buildUntrackedTextPatch,
    isUntrackedStatus,
} from './diffBinary';
import { renderConflictView } from './diffConflicts';
import { buildDiffFragment, allHunkIndices, renderHunksReadonly } from './diffFragment';
import { bindHunkToggles, updateHunkCheckboxes, syncFileCheckboxWithHunks } from './diffSelection';

/** Updates the diff header metadata chips for the selected file. */
export function updateDiffHeaderMeta(meta: RepoFileMeta | null) {
    state.currentFileMeta = meta;
    if (diffHeadMeta) {
        diffHeadMeta.setAttribute('aria-label', meta ? 'Selected file metadata' : 'No file metadata available');
    }
    if (diffLineEndingEl) {
        diffLineEndingEl.textContent = meta ? formatLineEnding(meta.line_ending) : '—';
    }
    if (diffEncodingEl) {
        diffEncodingEl.textContent = meta ? formatEncoding(meta.encoding) : '—';
    }
    if (diffBomEl) {
        diffBomEl.hidden = !meta?.bom;
    }
}

/** Formats a raw line-ending label for the header chip. */
function formatLineEnding(lineEnding: string) {
    const value = String(lineEnding || '').trim().toUpperCase();
    if (!value) return '—';
    if (value === 'MIXED') return 'LF ↔ CRLF';
    if (value === 'NONE') return '—';
    if (value === 'BINARY') return 'Binary';
    return value;
}

/** Formats a raw encoding label for the header chip. */
function formatEncoding(encoding: string) {
    const value = String(encoding || '').trim().toUpperCase();
    if (!value) return '—';
    if (value === 'UTF-16LE') return 'UTF-16 LE';
    if (value === 'UTF-16BE') return 'UTF-16 BE';
    if (value === 'BINARY') return 'Binary';
    return value;
}

// Re-exports for module consumers
export { toggleFilePick, updateHunkCheckboxes, updateListCheckboxForPath } from './diffSelection';
export { allHunkIndices, renderHunksReadonly, renderHunksWithSelection } from './diffFragment';

/** Highlights a row in the left list for the current tab. */
export function highlightRow(index: number) {
    const rows = qsa<HTMLElement>((prefs.tab === 'history' ? '.row.commit' : '.row'), listEl || (undefined as any));
    rows.forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });
}

/** Loads and renders the selected file diff with selection state restored. */
export async function selectFile(file: FileStatus, index: number) {
    if (!diffHeadPath || !diffEl) return;
    if (!state.diffDirty && state.currentFile === file.path) {
        highlightRow(index);
        return;
    }
    highlightRow(index);
    await ensureConflictStatusesLoaded();
    const status = String(file.status || '').toUpperCase();
    if (isConflictStatus(status)) {
        diffHeadPath.textContent = `${file.path || '(unknown file)'} (conflicted)`;
        updateDiffHeaderMeta(null);
        await renderConflictView(file);
        state.diffDirty = false;
        return;
    }
    diffHeadPath.textContent = file.path || '(unknown file)';
    updateDiffHeaderMeta(null);
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';
    scrollDiffToTop();


    try {
        const metaPromise = file.path
            ? TAURI.invoke<RepoFileMeta>('read_repo_file_meta', { path: file.path }).catch(() => null)
            : Promise.resolve(null);
        let lines: string[] = [];
        if (file.path) {
            lines = await TAURI.invoke<string[]>('vcs_diff_file', { path: file.path });
        }
        if (isUntrackedStatus(status) && file.path && (!Array.isArray(lines) || lines.length === 0)) {
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
        state.currentFileMeta = await metaPromise;
        updateDiffHeaderMeta(state.currentFileMeta);
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
        updateDiffHeaderMeta(null);
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>';
        scrollDiffToTop();
    }
}

/** Loads and renders a stash diff in read-only mode. */
export async function selectStashDiff(selector: string) {
    if (!diffHeadPath || !diffEl) return;
    updateDiffHeaderMeta(null);
    state.currentFileMeta = null;
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
        updateDiffHeaderMeta(null);
        diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load stash diff</div></div></div>';
        scrollDiffToTop();
    }
}

/** Renders diffs for multiple files in a single combined view. */
export async function renderCombinedDiff(paths: string[]) {
    if (!diffHeadPath || !diffEl) return;
    clearActiveRows();
    updateDiffHeaderMeta(null);
    state.currentFileMeta = null;
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
                html += renderHunksReadonly(fileLines);
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
        rows.forEach((r) => {
            r.classList.remove('diffsel');
        });
    }
}

/** Removes active styling from all rows in the file list. */
export function clearActiveRows() {
    if (!listEl) return;
    const rows = listEl.querySelectorAll<HTMLElement>('li.row.active');
    rows.forEach((r) => {
        r.classList.remove('active');
    });
}
