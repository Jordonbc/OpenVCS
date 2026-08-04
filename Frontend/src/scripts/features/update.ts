// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { openModal } from '../ui/modals';
import { notify } from '../lib/notify';
import { ModalController } from '../lib/modalController';

interface UpdateStatus {
  available: boolean;
  version: string | null;
  current_version: string | null;
  body: string | null;
  date: string | null;
}

/** Update button states shown while the installer runs. */
type UpdateInstallPhase = 'idle' | 'downloading' | 'installing' | 'done';

/** Payload emitted by the backend while an update is downloading or unpacking. */
interface UpdateProgressEvent {
  kind: 'progress' | 'downloaded';
  received?: number;
  total?: number;
}

let updateInstallPhase: UpdateInstallPhase = 'idle';
let updateProgressListenerStarted = false;

/** Returns the update modal's install button when it is mounted. */
function getUpdateInstallButton(): HTMLButtonElement | null {
  const modal = document.getElementById('update-modal') as HTMLElement | null;
  return modal?.querySelector('#update-install') as HTMLButtonElement | null;
}

/** Returns the footer status element used for global busy indication. */
function getFooterStatus(): HTMLElement | null {
  return document.getElementById('status') as HTMLElement | null;
}

/** Applies busy styling to the footer status bar for update activity. */
function setUpdateBusy(text: string | null) {
  const statusEl = getFooterStatus();
  if (!statusEl) return;

  if (text) {
    statusEl.textContent = text;
    statusEl.classList.add('busy');
  } else {
    statusEl.classList.remove('busy');
  }
}

/** Formats the download button label for the current byte progress. */
function formatDownloadingLabel(received?: number, total?: number): string {
  const totalBytes = Number(total ?? 0);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 'Downloading…';

  const receivedBytes = Number(received ?? 0);
  const percent = Math.max(0, Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)));
  return `Downloading…${percent}%`;
}

/** Applies a visual state to the update modal's install button. */
function setUpdateInstallPhase(phase: UpdateInstallPhase, progress?: UpdateProgressEvent) {
  updateInstallPhase = phase;

  const installBtn = getUpdateInstallButton();
  if (!installBtn) return;

  installBtn.setAttribute('aria-busy', phase === 'idle' || phase === 'done' ? 'false' : 'true');

  switch (phase) {
    case 'idle':
      setUpdateBusy(null);
      installBtn.textContent = 'Install';
      installBtn.disabled = false;
      return;
    case 'downloading':
      setUpdateBusy('Downloading update…');
      installBtn.textContent = formatDownloadingLabel(progress?.received, progress?.total);
      installBtn.disabled = true;
      return;
    case 'installing':
      setUpdateBusy('Installing update…');
      installBtn.textContent = 'Installing';
      installBtn.disabled = true;
      return;
    case 'done':
      setUpdateBusy(null);
      installBtn.textContent = 'Done, please restart';
      installBtn.disabled = true;
  }
}

/** Starts listening for backend download progress events once per app session. */
function ensureUpdateProgressListener() {
  if (updateProgressListenerStarted) return;
  updateProgressListenerStarted = true;

  void TAURI.listen<UpdateProgressEvent>('update:progress', ({ payload }) => {
    if (!payload) return;

    if (payload.kind === 'progress') {
      if (updateInstallPhase === 'idle' || updateInstallPhase === 'downloading') {
        setUpdateInstallPhase('downloading', payload);
      }
      return;
    }

    if (payload.kind === 'downloaded') {
      setUpdateInstallPhase('installing');
    }
  }).catch(() => {
    updateProgressListenerStarted = false;
  });
}

/** Owns the update modal lifecycle: wires the install button and progress listeners once. */
export const updateController = new ModalController<void>('update-modal', {
  wire: (modal) => {

  ensureUpdateProgressListener();
  setUpdateInstallPhase('idle');

  const installBtn = modal.querySelector('#update-install') as HTMLButtonElement | null;
  installBtn?.addEventListener('click', async () => {
    try {
      setUpdateInstallPhase('downloading');
      notify('Downloading update…');
      await TAURI.invoke('updater_install_now');
      setUpdateInstallPhase('done');
      notify('Update installed. Please restart.');
    } catch {
      setUpdateInstallPhase('idle');
      notify('Update failed');
    }
  });
  },
});

/** Wires the update modal button and progress listeners. */
export function wireUpdate() {
  updateController.initOnce();
}

/** Opens the update modal with the latest version metadata. */
export async function showUpdateDialog(_data: any) {
  try {
    const status = await TAURI.invoke<UpdateStatus>('get_update_status');

    if (!status.available) {
      notify('Already up to date');
      return;
    }

    openModal('update-modal');
    setUpdateInstallPhase('idle');
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
