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
        try {
            if (TAURI.has) await TAURI.invoke('commit_changes', { summary, description: commitDesc?.value || '' });
            notify(`Committed to ${state.branch}: ${summary}`);
            if (commitSummary) commitSummary.value = '';
            if (commitDesc)    commitDesc.value = '';
            // Status/commits will refresh at a higher layer on focus or after ops
        } catch { notify('Commit failed'); }
    });
}
