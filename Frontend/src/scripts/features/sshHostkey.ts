// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { openModal, closeModal } from '../ui/modals';
import { hydrateBranches } from './repo/hydrate';

type HostKeyPrompt = { host: string; remote: string; url: string; message?: string };

let wired = false;

function wireModalOnce() {
  const modal = document.getElementById('ssh-hostkey-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;
  wired = true;

  const hostEl = modal.querySelector('#ssh-hostkey-host') as HTMLElement | null;
  const remoteEl = modal.querySelector('#ssh-hostkey-remote') as HTMLElement | null;
  const urlEl = modal.querySelector('#ssh-hostkey-url') as HTMLElement | null;
  const msgEl = modal.querySelector('#ssh-hostkey-msg') as HTMLElement | null;
  const acceptBtn = modal.querySelector('#ssh-hostkey-accept') as HTMLButtonElement | null;
  const denyBtn = modal.querySelector('#ssh-hostkey-deny') as HTMLButtonElement | null;

  let current: HostKeyPrompt | null = null;

  function setBusy(on: boolean) {
    if (acceptBtn) acceptBtn.disabled = on;
    if (denyBtn) denyBtn.disabled = on;
  }

  function fill(p: HostKeyPrompt) {
    current = p;
    if (hostEl) hostEl.textContent = p.host || '';
    if (remoteEl) remoteEl.textContent = p.remote || '';
    if (urlEl) urlEl.textContent = p.url || '';
    if (msgEl) msgEl.textContent = p.message || '';
  }

  denyBtn?.addEventListener('click', () => {
    closeModal('ssh-hostkey-modal');
    current = null;
  });

  acceptBtn?.addEventListener('click', async () => {
    if (!TAURI.has || !current) return;
    setBusy(true);
    try {
      await TAURI.invoke('ssh_trust_host', { host: current.host });
      await TAURI.invoke('git_fetch_all', {});
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

  (window as any).__openvcs_fillSshHostKeyModal = fill;
}

export function initSshHostkeyPrompt() {
  if (!TAURI.has) return;

  TAURI.listen?.('ui:ssh-hostkey', (ev: any) => {
    const p = (ev?.payload || {}) as HostKeyPrompt;
    openModal('ssh-hostkey-modal');
    // ensure modal exists before wiring/filling
    wireModalOnce();
    const fill = (window as any).__openvcs_fillSshHostKeyModal as ((p: HostKeyPrompt) => void) | undefined;
    fill?.(p);
  });
}
