// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/sshHostkey.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { closeModal } from '../ui/modals';
import { hydrateBranches } from './repo/hydrate';
import { ModalController } from '../lib/modalController';

type HostKeyPrompt = { host: string; remote: string; url: string; message?: string };

/** The prompt currently shown in the SSH host-key modal. */
let current: HostKeyPrompt | null = null;

/** Fills the modal content from the given host-key prompt. */
function fillHostKey(modal: HTMLElement, p: HostKeyPrompt): void {
  current = p;
  const hostEl = modal.querySelector<HTMLElement>('#ssh-hostkey-host');
  const remoteEl = modal.querySelector<HTMLElement>('#ssh-hostkey-remote');
  const urlEl = modal.querySelector<HTMLElement>('#ssh-hostkey-url');
  const msgEl = modal.querySelector<HTMLElement>('#ssh-hostkey-msg');
  if (hostEl) hostEl.textContent = p.host || '';
  if (remoteEl) remoteEl.textContent = p.remote || '';
  if (urlEl) urlEl.textContent = p.url || '';
  if (msgEl) msgEl.textContent = p.message || '';
}

/** Owns the SSH host-key modal lifecycle: wires once, fills the prompt per event. */
export const sshHostkeyController = new ModalController<HostKeyPrompt>('ssh-hostkey-modal', {
  wire: (modal) => {
    const acceptBtn = modal.querySelector<HTMLButtonElement>('#ssh-hostkey-accept');
    const denyBtn = modal.querySelector<HTMLButtonElement>('#ssh-hostkey-deny');

    function setBusy(on: boolean) {
      if (acceptBtn) acceptBtn.disabled = on;
      if (denyBtn) denyBtn.disabled = on;
    }

    denyBtn?.addEventListener('click', () => {
      closeModal('ssh-hostkey-modal');
      current = null;
    });

    acceptBtn?.addEventListener('click', async () => {
      if (!current) return;
      setBusy(true);
      try {
        await TAURI.invoke('ssh_trust_host', { host: current.host });
        await TAURI.invoke('vcs_fetch_all', {});
        await hydrateBranches();
        notify(`Trusted ${current.host}`);
        closeModal('ssh-hostkey-modal');
        current = null;
      } catch (e) {
        notify(`Failed to trust host: ${String(e || '')}`);
      } finally {
        setBusy(false);
      }
    });
  },
  apply: (p, modal) => fillHostKey(modal, p),
});

/** Subscribes to backend SSH host-key prompts and opens the modal on demand. */
export function initSshHostkeyPrompt(): void {
  TAURI.listen?.('ui:ssh-hostkey', (ev: any) => {
    const p = (ev?.payload || {}) as HostKeyPrompt;
    sshHostkeyController.open(p);
  });
}
