// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { openModal, closeModal } from '../ui/modals';
import { openRepoSettings } from './repoSettings';
import { openSshKeysModal } from './sshKeys';

type AuthPrompt = { host: string; remote: string; url: string; message?: string };

let wired = false;

function sshToHttps(url: string): string | null {
  const u = String(url || '').trim();
  if (!u) return null;
  if (u.startsWith('https://') || u.startsWith('http://')) return u;

  // git@host:owner/repo(.git)
  const scp = u.match(/^([^@]+)@([^:]+):(.+)$/);
  if (scp) {
    const host = scp[2].trim();
    const path = scp[3].replace(/^\/+/, '').trim();
    if (host && path) return `https://${host}/${path}`;
  }

  // ssh://user@host/owner/repo(.git)
  const ssh = u.match(/^ssh:\/\/([^@]+@)?([^/]+)\/(.+)$/);
  if (ssh) {
    const host = ssh[2].trim();
    const path = ssh[3].replace(/^\/+/, '').trim();
    if (host && path) return `https://${host}/${path}`;
  }

  return null;
}

function wireAuthModal() {
  const modal = document.getElementById('ssh-auth-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;

  const hostEl = modal.querySelector('#ssh-auth-host') as HTMLElement | null;
  const remoteEl = modal.querySelector('#ssh-auth-remote') as HTMLElement | null;
  const urlEl = modal.querySelector('#ssh-auth-url') as HTMLElement | null;
  const msgEl = modal.querySelector('#ssh-auth-msg') as HTMLElement | null;
  const okBtn = modal.querySelector('#ssh-auth-ok') as HTMLButtonElement | null;
  const remotesBtn = modal.querySelector('#ssh-auth-open-remotes') as HTMLButtonElement | null;
  const keysBtn = modal.querySelector('#ssh-auth-ssh-keys') as HTMLButtonElement | null;
  const httpsBtn = modal.querySelector('#ssh-auth-switch-https') as HTMLButtonElement | null;

  let current: AuthPrompt | null = null;

  (modal as any).__fill = (p: AuthPrompt) => {
    current = p;
    if (hostEl) hostEl.textContent = p.host || '';
    if (remoteEl) remoteEl.textContent = p.remote || '';
    if (urlEl) urlEl.textContent = p.url || '';
    if (msgEl) msgEl.textContent = p.message || '';
    const canConvert = !!sshToHttps(p.url);
    if (httpsBtn) httpsBtn.disabled = !canConvert;
  };

  okBtn?.addEventListener('click', () => closeModal('ssh-auth-modal'));
  remotesBtn?.addEventListener('click', () => {
    closeModal('ssh-auth-modal');
    openRepoSettings();
  });
  keysBtn?.addEventListener('click', () => {
    closeModal('ssh-auth-modal');
    openSshKeysModal();
  });
  httpsBtn?.addEventListener('click', async () => {
    if (!current) return;
    const https = sshToHttps(current.url);
    if (!https) return;
    httpsBtn.disabled = true;
    try {
      await TAURI.invoke('vcs_set_remote_url', { name: current.remote, url: https });
      notify(`Remote '${current.remote}' set to HTTPS`);
      closeModal('ssh-auth-modal');
    } catch (e) {
      notify(`Failed to update remote: ${String(e || '')}`.trim());
    } finally {
      httpsBtn.disabled = false;
    }
  });
}

export function initSshAuthPrompt() {
  if (wired) return;
  wired = true;

  TAURI.listen?.('ui:ssh-auth', (ev: any) => {
    const p = (ev?.payload || {}) as AuthPrompt;
    openModal('ssh-auth-modal');
    wireAuthModal();
    const modal = document.getElementById('ssh-auth-modal') as any;
    modal?.__fill?.(p);
  });
}
