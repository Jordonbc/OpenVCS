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
        const hunksMap: Record<string, number[]> = (state as any).selectedHunksByFile || {};
        const linesMap: Record<string, Record<number, number[]>> = (state as any).selectedLinesByFile || {};
        const hasHunks = Object.keys(hunksMap).some(p => Array.isArray(hunksMap[p]) && hunksMap[p].length > 0);
        const selectedFiles = state.selectedFiles ? Array.from(state.selectedFiles) : [];
        const hasFiles = selectedFiles.length > 0;
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

            // Build a combined patch when any file has partial hunks/lines selected
            const partialFiles = Array.from(new Set([
                ...Object.keys(hunksMap).filter(p => Array.isArray(hunksMap[p]) && hunksMap[p].length > 0),
                ...Object.keys(linesMap).filter(p => linesMap[p] && Object.keys(linesMap[p] || {}).length > 0),
            ]));

            // Guard: libgit2 backend does not support partial-hunk commit (stage_patch)
            if (TAURI.has && partialFiles.length > 0) {
                try {
                    const cfg = await TAURI.invoke<any>('get_global_settings');
                    const backend = String(cfg?.git?.backend || 'system');
                    if (backend === 'libgit2') {
                        notify('Partial-hunk commits are not supported with the Libgit2 backend. Commit full files or switch to System backend in Settings.');
                        clearBusy('Ready');
                        return;
                    }
                } catch {}
            }

            // Build patch only from hunks; ignore selectedFiles for commit content per latest request
            let combinedPatch = '';
            for (const path of partialFiles) {
                let lines: string[] = [];
                try { lines = await TAURI.invoke<string[]>('git_diff_file', { path }); } catch {}
                if (!Array.isArray(lines) || lines.length === 0) continue;
                const selHunks = hunksMap[path] || [];
                const selLines = linesMap[path] || {};
                combinedPatch += buildPatchForSelected(path, lines, selHunks, selLines) + '\n';
            }
            // Full files: commit-selected files without partial hunks
            const fullFiles = selectedFiles.filter(f => !partialFiles.includes(f));
            if (TAURI.has) {
                if (combinedPatch.trim().length > 0 || fullFiles.length > 0) {
                    await TAURI.invoke('commit_patch_and_files', { summary, description, patch: combinedPatch, files: fullFiles });
                } else {
                    notify('Select files or hunks to commit');
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

    // Compose minimal header (avoid carrying index/mode lines that can corrupt apply)
    let out = `diff --git a/${normPath} b/${normPath}\n`;
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

    let out = `diff --git a/${normPath} b/${normPath}\n`;
    if (isAdd) out += `--- /dev/null\n+++ b/${normPath}\n`;
    else if (isDel) out += `--- a/${normPath}\n+++ /dev/null\n`;
    else out += `--- a/${normPath}\n+++ b/${normPath}\n`;

    const wantWhole = new Set<number>((hunkIndices || []).filter((n) => Number.isFinite(n)));
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h+1];
        const block = rest.slice(s, e);
        const header = block[0] || '';
        const m = /@@\s*-([0-9]+),?([0-9]*)\s*\+([0-9]+),?([0-9]*)\s*@@/.exec(header) || [] as any;
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
