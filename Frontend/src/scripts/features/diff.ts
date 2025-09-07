import { qs } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';

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
        try {
            const description = commitDesc?.value || '';

            if (TAURI.has && hasHunks && state.currentFile) {
                const patch = buildPatchForSelectedHunks(state.currentFile, state.currentDiff, state.selectedHunks);
                if (!patch) { notify('No hunks selected'); return; }
                await TAURI.invoke('commit_patch', { summary, description, patch });
            } else if (TAURI.has && hasFiles) {
                const files = Array.from(state.selectedFiles);
                await TAURI.invoke('commit_selected', { summary, description, files });
            } else if (TAURI.has) {
                await TAURI.invoke('commit_changes', { summary, description });
            }
            notify(`Committed to ${state.branch}: ${summary}`);
            if (commitSummary) commitSummary.value = '';
            if (commitDesc)    commitDesc.value = '';
            // Clear selection state
            state.selectedFiles.clear();
            state.selectedHunks = [];
            state.currentDiff = [];
            state.currentFile = '' as any;
            // Status/commits will refresh at a higher layer on focus or after ops
        } catch { notify('Commit failed'); }
    });
}

// Construct a minimal patch for one file by combining the file header and selected hunks.
function buildPatchForSelectedHunks(path: string, lines: string[], hunkIndices: number[]): string {
    if (!Array.isArray(lines) || !lines.length || !hunkIndices.length) return '';
    // Identify header span and hunk boundaries
    const headerStart = lines.findIndex(l => l.startsWith('diff --git '));
    if (headerStart < 0) return '';
    let i = headerStart;
    const header: string[] = [];
    // Collect header lines up to first hunk header (starts with '@@')
    for (; i < lines.length; i++) { const ln = lines[i]; header.push(ln); if (ln.startsWith('@@')) break; }
    if (i >= lines.length) return '';
    // Find all hunk start indices
    const hStarts: number[] = [];
    for (let j = i; j < lines.length; j++) { if (lines[j].startsWith('@@')) hStarts.push(j); }
    hStarts.push(lines.length); // sentinel end
    // Build patch combining header (up to before first @@) and selected hunks
    const preHunkHeader = header.slice(0, header.findIndex(l => l.startsWith('@@'))).join('\n');
    let out = preHunkHeader ? preHunkHeader + '\n' : '';
    for (const idx of hunkIndices.sort((a,b)=>a-b)) {
        if (idx < 0 || idx >= hStarts.length - 1) continue;
        const start = hStarts[idx];
        const end = hStarts[idx+1];
        const chunk = lines.slice(start, end).join('\n');
        out += chunk + '\n';
    }
    return out.trimEnd() + '\n';
}
