import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { notify } from '../lib/notify';
import type { RepoSettings } from '../types';

export function openRepoSettings(){ openModal('repo-settings-modal'); }

export async function wireRepoSettings() {
    const modal = document.getElementById('repo-settings-modal') as HTMLElement | null;
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

    const nameInput  = modal.querySelector('#git-user-name') as HTMLInputElement | null;
    const emailInput = modal.querySelector('#git-user-email') as HTMLInputElement | null;
    const originInput= modal.querySelector('#git-origin-url') as HTMLInputElement | null;
    const saveBtn = modal.querySelector('#repo-settings-save') as HTMLButtonElement | null;

    if (TAURI.has) {
        try {
            const cfg = await TAURI.invoke<RepoSettings>('get_repo_settings');
            if (nameInput && cfg?.user_name) nameInput.value = cfg.user_name;
            if (emailInput && cfg?.user_email) emailInput.value = cfg.user_email;
            if (originInput && cfg?.origin_url) originInput.value = cfg.origin_url;
        } catch { /* ignore */ }
    }

    saveBtn?.addEventListener('click', async () => {
        const next: RepoSettings = {
            user_name: nameInput?.value || undefined,
            user_email: emailInput?.value || undefined,
            origin_url: originInput?.value || undefined,
        };
        try {
            if (TAURI.has) await TAURI.invoke('set_repo_settings', { cfg: next });
            closeModal('repo-settings-modal');
        } catch {
            notify('Failed to save repository settings');
        }
    });
}
