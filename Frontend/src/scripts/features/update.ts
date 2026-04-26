// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { notify } from '../lib/notify';

interface UpdateStatus {
  available: boolean;
  version: string | null;
  current_version: string | null;
  body: string | null;
  date: string | null;
}

export function wireUpdate() {
  const modal = document.getElementById('update-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;

  const installBtn = modal.querySelector('#update-install') as HTMLButtonElement | null;
  installBtn?.addEventListener('click', async () => {
    try {
      notify('Downloading update…');
      await TAURI.invoke('updater_install_now');
      notify('Update installed. Restart to apply.');
      closeModal('update-modal');
    } catch {
      notify('Update failed');
    }
  });
}

export async function showUpdateDialog(_data: any) {
  try {
    const status = await TAURI.invoke<UpdateStatus>('get_update_status');

    if (!status.available) {
      notify('Already up to date');
      return;
    }

    openModal('update-modal');
    const modal = document.getElementById('update-modal') as HTMLElement | null;
    if (!modal) return;
    const verEl = modal.querySelector('#update-version');
    const notesEl = modal.querySelector('#update-notes');
    const v = status.version || '';
    const body = String(status.body || '').trim();
    if (verEl) verEl.textContent = v ? `Version ${v}` : 'Update available';
    if (notesEl) (notesEl as HTMLElement).textContent = body || '(No changelog provided)';
  } catch {
    notify('Update check failed');
  }
}
