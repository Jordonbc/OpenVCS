// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';
import { hydrateStatus, hydrateCommits } from './repo';
import { runHook } from '../plugins';
import { getCommitSummaryHint } from './repo/commit';
import { yieldToPaint } from './repo';

export function bindCommit() {
    const commitBtn     = qs<HTMLButtonElement>('#commit-btn');
    const commitSummary = qs<HTMLInputElement>('#commit-summary');
    const commitDesc    = qs<HTMLTextAreaElement>('#commit-desc');

    commitBtn?.addEventListener('click', async () => {
        let summary = commitSummary?.value.trim() || getCommitSummaryHint() || '';
        if (!summary) { commitSummary?.focus(); notify('Summary is required'); return; }
        const hunksMap = state.selectedHunksByFile || {};
        const linesMap = state.selectedLinesByFile || {};
        const selectedFiles = Array.from(state.selectedFiles);
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = (msg?: string) => {
            if (statusEl) { statusEl.classList.remove('busy'); if (msg) statusEl.textContent = msg; }
        };
        try {
            setBusy('Committing…');
            await yieldToPaint();
            let description = commitDesc?.value || '';

            // Build a combined patch when any file has partial hunks/lines selected.
            const partialFiles = Array.from(new Set([
                ...Object.keys(hunksMap).filter(p => Array.isArray(hunksMap[p]) && hunksMap[p].length > 0),
                ...Object.keys(linesMap).filter(p => linesMap[p] && Object.keys(linesMap[p] || {}).length > 0),
            ]));

            const selectedUntrackedFiles = new Set(
                (state.files || [])
                    .filter((file: any) => String(file?.status || '').includes('?'))
                    .map((file: any) => String(file?.path || ''))
                    .filter(Boolean),
            );

            // Full-file selections are staged directly; partial selections are staged via patch.
            // Untracked files still need to be staged even if the UI has synthetic hunk state.
            const stagePaths = selectedFiles.filter(f => !partialFiles.includes(f) || selectedUntrackedFiles.has(f));

            // Build patch only from hunk and line selections.
            let combinedPatch = '';
            let partialLoadFailed = false;
            for (const path of partialFiles) {
                let lines: string[] = [];
                try {
                    lines = await TAURI.invoke<string[]>('vcs_diff_file', { path });
                } catch (error) {
                    partialLoadFailed = true;
                    console.error('Failed to load diff for selected file:', path, error);
                    break;
                }
                if (!Array.isArray(lines) || lines.length === 0) continue;
                const selHunks = hunksMap[path] || [];
                const selLines = linesMap[path] || {};
                combinedPatch += buildPatchForSelected(path, lines, selHunks, selLines) + '\n';
            }
            if (partialLoadFailed) {
                notify('Failed to read one or more selected diffs');
                return;
            }
            if (combinedPatch.trim().length > 0 || selectedFiles.length > 0) {
                const hookData = {
                    summary,
                    description,
                    branch: state.branch,
                    files: selectedFiles,
                    stagedFiles: stagePaths,
                    partialFiles,
                    patch: combinedPatch,
                };
                const pre = await runHook('preCommit', hookData);
                if (pre.cancelled) {
                    notify(pre.reason || 'Commit cancelled');
                    clearBusy('Ready');
                    return;
                }
                if (commitSummary?.maxLength === 72 && String(hookData.summary || '').length > 72) {
                    summary = String(hookData.summary || '').trim().slice(0, 72);
                    commitSummary.value = summary;
                } else {
                    summary = String(hookData.summary || '').trim() || summary;
                }
                hookData.summary = summary;
                description = String(hookData.description || '');
                await TAURI.invoke('commit_patch_and_files', {
                    summary,
                    description,
                    patch: combinedPatch,
                    files: selectedFiles,
                    stagePaths,
                });
                await runHook('onCommit', hookData);
            }
            else {
                notify('Select files or hunks to commit');
                return;
            }
            notify(`Committed to ${state.branch}: ${summary}`);
            if (commitSummary) commitSummary.value = '';
            if (commitDesc)    commitDesc.value = '';
            // Clear selection state
            state.selectedFiles.clear();
            state.selectedHunks = [];
            state.selectedHunksByFile = {};
            state.selectedLinesByFile = {};
            state.diffSelectedFiles.clear();
            state.currentDiff = [];
            state.currentFile = '';
            // Refresh status and commits immediately
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
            await runHook('postCommit', {
                summary,
                description,
                branch: state.branch,
                files: selectedFiles,
                stagedFiles: stagePaths,
                partialFiles,
            });
            clearBusy('Ready');
        } catch (e) { console.error('Commit failed:', e); notify('Commit failed'); }
        finally {
            clearBusy('Ready');
        }
    });
}

// Construct a minimal patch for one file by combining the file header and selected hunks.
export function buildPatchForSelectedHunks(path: string, lines: string[], hunkIndices: number[]): string {
    if (!Array.isArray(lines) || !lines.length || !hunkIndices.length) return '';
    const normPath = String(path).replace(/\\/g, '/');

    // Identify prelude and hunks
    const firstHunk = lines.findIndex(l => (l || '').startsWith('@@'));
    const prelude = firstHunk >= 0 ? lines.slice(0, firstHunk) : [];

    // Locate all hunk starts
    const starts: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if ((lines[i] || '').startsWith('@@')) starts.push(i);
    }
    if (starts.length === 0) return '';
    starts.push(lines.length);

    // Determine file action by inspecting original diff prelude
    const isAdd = prelude.some(l => l.startsWith('--- /dev/null'));
    const isDel = prelude.some(l => l.startsWith('+++ /dev/null'));
    const headerExtras = prelude.filter((l) =>
        !!l &&
        !l.startsWith('diff --git') &&
        !l.startsWith('--- ') &&
        !l.startsWith('+++ ')
    );

    // Compose header and preserve any mode/index metadata Git included
    let out = `diff --git a/${normPath} b/${normPath}\n`;
    if (headerExtras.length) out += headerExtras.join('\n') + '\n';
    if (isAdd) {
        out += `--- /dev/null\n+++ b/${normPath}\n`;
    } else if (isDel) {
        out += `--- a/${normPath}\n+++ /dev/null\n`;
    } else {
        out += `--- a/${normPath}\n+++ b/${normPath}\n`;
    }

    // Append selected hunks in order
    const sorted = [...hunkIndices].sort((a,b)=>a-b);
    for (const h of sorted) {
        if (h < 0 || h >= starts.length - 1) continue;
        const s = starts[h];
        const e = starts[h+1];
        const chunk = lines.slice(s, e).join('\n');
        out += chunk + '\n';
    }
    return out.trimEnd() + '\n';
}

// Build a patch combining whole selected hunks and per-line selections (unidiff-zero mini-hunks).
function buildPatchForSelected(path: string, lines: string[], hunkIndices: number[] = [], selLines: Record<number, number[]> = {}): string {
    const normPath = String(path).replace(/\\/g, '/');
    const firstHunk = lines.findIndex(l => (l || '').startsWith('@@'));
    const prelude = firstHunk >= 0 ? lines.slice(0, firstHunk) : [];
    const rest = firstHunk >= 0 ? lines.slice(firstHunk) : [];

    let starts: number[] = [];
    for (let i = 0; i < rest.length; i++) { if ((rest[i] || '').startsWith('@@')) starts.push(i); }
    if (starts.length === 0) return '';
    starts.push(rest.length);

    const isAdd = prelude.some(l => l.startsWith('--- /dev/null'));
    const isDel = prelude.some(l => l.startsWith('+++ /dev/null'));
    const headerExtras = prelude.filter((l) =>
        !!l &&
        !l.startsWith('diff --git') &&
        !l.startsWith('--- ') &&
        !l.startsWith('+++ ')
    );

    let out = `diff --git a/${normPath} b/${normPath}\n`;
    if (headerExtras.length) out += headerExtras.join('\n') + '\n';
    if (isAdd) out += `--- /dev/null\n+++ b/${normPath}\n`;
    else if (isDel) out += `--- a/${normPath}\n+++ /dev/null\n`;
    else out += `--- a/${normPath}\n+++ b/${normPath}\n`;

    const wantWhole = new Set<number>((hunkIndices || []).filter((n) => Number.isFinite(n)));
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h+1];
        const block = rest.slice(s, e);
        const header = block[0] || '';
        const m = /@@\s*-([0-9]+),?([0-9]*)\s*\+([0-9]+),?([0-9]*)\s*@@/.exec(header);
        if (!m) continue;
        const aStart = parseInt(m[1] || '0', 10) || 0;
        const cStart = parseInt(m[3] || '0', 10) || 0;
        const content = block.slice(1);

        if (wantWhole.has(h)) {
            out += header + '\n' + content.join('\n') + '\n';
            continue;
        }
        const picksRaw = (selLines && Array.isArray(selLines[h])) ? selLines[h] : (selLines && selLines[h] ? selLines[h] : []);
        // Adjust indices: UI stores data-line relative to the full block (including header at 0)
        const picksAdj = Array.isArray(picksRaw) ? picksRaw.map((i) => i - 1).filter((i) => i >= 0 && i < content.length) : [];
        const pickSet = new Set<number>(picksAdj || []);
        if (pickSet.size === 0) continue;

        // prefix counts to compute old/new positions
        const prefOld: number[] = new Array(content.length + 1).fill(0);
        const prefNew: number[] = new Array(content.length + 1).fill(0);
        for (let i = 0; i < content.length; i++) {
            const ch = (content[i] || '')[0] || ' ';
            prefOld[i+1] = prefOld[i] + (ch === '+' ? 0 : 1); // old advances on ' ' or '-'
            prefNew[i+1] = prefNew[i] + (ch === '-' ? 0 : 1); // new advances on ' ' or '+'
        }

        // group consecutive selected lines into mini-hunks
        const sorted = Array.from(pickSet).sort((x,y)=>x-y);
        let group: number[] = [];
        const flush = () => {
            if (group.length === 0) return;
            const i0 = group[0];
            const old_start = aStart + prefOld[i0];
            const new_start = cStart + prefNew[i0];
            const slice = group.map(i => content[i]);
            const old_count = slice.filter(l => (l||'')[0] === '-').length;
            const new_count = slice.filter(l => (l||'')[0] === '+').length;
            out += `@@ -${old_start},${old_count} +${new_start},${new_count} @@\n`;
            out += slice.join('\n') + '\n';
            group = [];
        };
        for (let i = 0; i < sorted.length; i++) {
            if (group.length === 0) { group.push(sorted[i]); continue; }
            if (sorted[i] === group[group.length - 1] + 1) group.push(sorted[i]);
            else { flush(); group.push(sorted[i]); }
        }
        flush();
    }
    return out.trimEnd() + '\n';
}
