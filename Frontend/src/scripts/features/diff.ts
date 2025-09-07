import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';
import { hydrateStatus, hydrateCommits } from './repo';

export function bindCommit() {
    const commitBtn     = qs<HTMLButtonElement>('#commit-btn');
    const commitSummary = qs<HTMLInputElement>('#commit-summary');
    const commitDesc    = qs<HTMLTextAreaElement>('#commit-desc');

    commitBtn?.addEventListener('click', async () => {
        const summary = commitSummary?.value.trim() || '';
        if (!summary) { commitSummary?.focus(); notify('Summary is required'); return; }
        const hasHunks = (state.selectedHunks || []).length > 0 && (state.currentDiff || []).length > 0;
        const selectedFiles = state.selectedFiles ? Array.from(state.selectedFiles) : [];
        const hasFiles = selectedFiles.length > 0;
        if (!hasHunks && !hasFiles) {
            notify('Select files or hunks to commit');
            return;
        }
        const statusEl = document.getElementById('status');
        const setBusy = (msg: string) => {
            if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
        };
        const clearBusy = (msg?: string) => {
            if (statusEl) { statusEl.classList.remove('busy'); if (msg) statusEl.textContent = msg; }
        };
        try {
            setBusy('Committing…');
            const description = commitDesc?.value || '';

            // Build a combined patch when any file has partial hunks selected, or when we want per-file control
            const hunksMap: Record<string, number[]> = (state as any).selectedHunksByFile || {};
            const partialFiles = Object.keys(hunksMap).filter(p => Array.isArray(hunksMap[p]) && hunksMap[p].length > 0);

            // Build patch only for partial files; collect full files separately
            let combinedPatch = '';
            for (const path of partialFiles) {
                let lines: string[] = [];
                try { lines = await TAURI.invoke<string[]>('git_diff_file', { path }); } catch {}
                if (!Array.isArray(lines) || lines.length === 0) continue;
                combinedPatch += buildPatchForSelectedHunks(path, lines, hunksMap[path]) + '\n';
            }

            // Full files are those selected that are not in partialFiles
            const fullFiles = selectedFiles.filter(f => !partialFiles.includes(f));

            if (TAURI.has) {
                if (combinedPatch.trim().length > 0 || fullFiles.length > 0) {
                    await TAURI.invoke('commit_patch_and_files', { summary, description, patch: combinedPatch, files: fullFiles });
                } else {
                    // Nothing explicitly selected; last resort: block and notify
                    notify('Nothing selected to commit');
                    return;
                }
            }
            notify(`Committed to ${state.branch}: ${summary}`);
            if (commitSummary) commitSummary.value = '';
            if (commitDesc)    commitDesc.value = '';
            // Clear selection state
            state.selectedFiles.clear();
            state.selectedHunks = [];
            state.currentDiff = [];
            state.currentFile = '' as any;
            // Refresh status and commits immediately
            await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
            clearBusy('Ready');
        } catch { notify('Commit failed'); }
        finally {
            clearBusy('Ready');
        }
    });
}

// Construct a minimal patch for one file by combining the file header and selected hunks.
function buildPatchForSelectedHunks(path: string, lines: string[], hunkIndices: number[]): string {
    if (!Array.isArray(lines) || !lines.length || !hunkIndices.length) return '';
    const normPath = String(path).replace(/\\/g, '/');
    // Locate all hunk starts
    const starts: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if ((lines[i] || '').startsWith('@@')) starts.push(i);
    }
    if (starts.length === 0) return '';
    starts.push(lines.length);

    // Compose minimal header (avoid carrying index/mode lines that can corrupt apply)
    let out = `diff --git a/${normPath} b/${normPath}\n` +
              `--- a/${normPath}\n` +
              `+++ b/${normPath}\n`;

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
