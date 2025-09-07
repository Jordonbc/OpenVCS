import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { notify } from '../lib/notify';
import type { RepoSettings } from '../types';

export function openRepoSettings(){ openModal('repo-settings-modal'); }

export async function wireRepoSettings() {
    const modal = document.getElementById('repo-settings-modal') as HTMLElement | null;
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

    const input = modal.querySelector('#default-branch') as HTMLInputElement | null;
    const saveBtn = modal.querySelector('#repo-settings-save') as HTMLButtonElement | null;

    if (TAURI.has) {
        try {
            const cfg = await TAURI.invoke<RepoSettings>('get_repo_settings');
            if (input && cfg?.default_branch) input.value = cfg.default_branch;
        } catch { /* ignore */ }
    }

    saveBtn?.addEventListener('click', async () => {
        const next: RepoSettings = { default_branch: input?.value || '' };
        try {
            if (TAURI.has) await TAURI.invoke('set_repo_settings', { cfg: next });
            closeModal('repo-settings-modal');
        } catch {
            notify('Failed to save repository settings');
        }
    });
}
