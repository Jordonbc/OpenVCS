// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { refreshAll } from '../lib/async';
import { showError } from './errorModal';
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
        commitBtn?.classList.add('committing');
        let summary = commitSummary?.value.trim() || getCommitSummaryHint() || '';
        if (!summary) { commitBtn?.classList.remove('committing'); commitSummary?.focus(); notify('Summary is required'); return; }
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

            // Build structured selections when any file has partial hunks/lines selected.
            // The plugin handles diff format parsing internally — the frontend only
            // sends which hunks/lines the user selected.
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

            // Full-file selections are staged directly; partial selections go through the plugin.
            // Untracked files still need to be staged even if the UI has synthetic hunk state.
            const stagePaths = selectedFiles.filter(f => !partialFiles.includes(f) || selectedUntrackedFiles.has(f));

            // Build structured selection objects — NO diff format parsing in the frontend.
            const selections: Array<{ path: string; whole_hunks: number[]; partial_hunks: Record<number, number[]> }> = [];
            for (const path of partialFiles) {
                const selHunks = hunksMap[path] || [];
                const selLines = linesMap[path] || {};
                selections.push({ path, whole_hunks: selHunks, partial_hunks: selLines });
            }

            if (selectedFiles.length > 0) {
                const hookData = {
                    summary,
                    description,
                    branch: state.branch,
                    files: selectedFiles,
                    stagedFiles: stagePaths,
                    partialFiles,
                    selections,
                };
                const pre = await runHook('preCommit', hookData);
                if (pre.cancelled) {
                    notify(pre.reason || 'Commit cancelled');
                    clearBusy('Ready');
                    commitBtn?.classList.remove('committing');
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
                await TAURI.invoke('commit_selection', {
                    summary,
                    description,
                    selections,
                    stagePaths,
                });
                await runHook('onCommit', hookData);
            }
            else {
                commitBtn?.classList.remove('committing');
                notify('Select files or hunks to commit');
                return;
            }
            notify(`Committed to ${state.branch}: ${summary}`);
            if (commitSummary) {
                commitSummary.value = '';
                commitSummary.dispatchEvent(new Event('input', { bubbles: true }));
            }
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
            await refreshAll([hydrateStatus, hydrateCommits]);
            await runHook('postCommit', {
                summary,
                description,
                branch: state.branch,
                files: selectedFiles,
                stagedFiles: stagePaths,
                partialFiles,
            });
            clearBusy('Ready');
        } catch (e) {
            const msg = String(e || '').trim();
            console.error('Commit failed:', msg);
            showError('Commit failed', msg || 'Could not complete commit.');
        }
        finally {
            commitBtn?.classList.remove('committing');
            clearBusy('Ready');
        }
    });
}

// Construct a minimal patch for one file by combining the file header and selected hunks.
// BLOCKED-CROSS-REPO VCS-06: patch-text builder kept ONLY for hunk discard via
// `vcs_discard_patch` (see diffView.ts). Replacement is a generic `discard_selections`
// method (SDK + plugin, cross-repo). Do NOT delete; do NOT use for staging.

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


