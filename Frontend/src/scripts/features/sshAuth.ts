// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/sshAuth.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { closeModal } from '../ui/modals';
import { openRepoSettings } from './repoSettings';
import { openSshKeysModal } from './sshKeys';
import { ModalController } from '../lib/modalController';

type AuthPrompt = { host: string; remote: string; url: string; message?: string };

// One-time subscription guard for the backend auth-prompt event.
let wired = false;

/** The prompt currently shown in the SSH auth modal. */
let current: AuthPrompt | null = null;

/** Parsed parts of an SSH remote URL. */
type RemoteParts = { user: string | null; host: string; path: string };

/**
 * Parses the user, host, and path of an SSH remote URL without assuming a
 * username. Supports the `ssh://[user@]host[:port]/path`, `https://[user@]
 * host/path`, and scp-like `user@host:path` forms. Returns `null` when the
 * URL matches no known form or has an empty host/path after trimming.
 */
function parseRemoteParts(url: string): RemoteParts | null {
  const u = String(url || '').trim();
  if (!u) return null;

  // ssh://[user@]host[:port]/path
  const ssh = u.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::\d+)?\/(.+)$/);
  if (ssh) {
    const host = ssh[2].trim();
    const path = ssh[3].replace(/^\/+/, '').trim();
    if (host && path) return { user: ssh[1] ?? null, host, path };
  }

  // https://[user@]host/path
  const https = u.match(/^https:\/\/(?:([^@]+)@)?([^/]+)\/(.+)$/);
  if (https) {
    const host = https[2].trim();
    const path = https[3].replace(/^\/+/, '').trim();
    if (host && path) return { user: https[1] ?? null, host, path };
  }

  // user@host:path (scp-like; the user part is required)
  const scp = u.match(/^([^@]+)@([^:]+):(.+)$/);
  if (scp) {
    const host = scp[2].trim();
    const path = scp[3].replace(/^\/+/, '').trim();
    if (host && path) return { user: scp[1], host, path };
  }

  return null;
}

/**
 * Converts an SSH-style remote URL to its HTTPS equivalent. https:// and
 * http:// URLs are returned unchanged; ssh:// and scp-like URLs drop any
 * username and port, keeping only the host and path.
 */
function sshToHttps(url: string): string | null {
  const u = String(url || '').trim();
  if (!u) return null;
  if (u.startsWith('https://') || u.startsWith('http://')) return u;

  const parts = parseRemoteParts(u);
  if (!parts) return null;
  return `https://${parts.host}/${parts.path}`;
}

/** Owns the SSH auth modal lifecycle: wires once, fills the prompt per event. */
export const sshAuthController = new ModalController<AuthPrompt>('ssh-auth-modal', {
  wire: (modal) => {
    const httpsBtn = modal.querySelector<HTMLButtonElement>('#ssh-auth-switch-https');

    modal.querySelector<HTMLButtonElement>('#ssh-auth-ok')?.addEventListener('click', () => closeModal('ssh-auth-modal'));
    modal.querySelector<HTMLButtonElement>('#ssh-auth-open-remotes')?.addEventListener('click', () => {
      closeModal('ssh-auth-modal');
      openRepoSettings();
    });
    modal.querySelector<HTMLButtonElement>('#ssh-auth-ssh-keys')?.addEventListener('click', () => {
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
  },
  apply: (p, modal) => {
    current = p;
    const hostEl = modal.querySelector<HTMLElement>('#ssh-auth-host');
    const remoteEl = modal.querySelector<HTMLElement>('#ssh-auth-remote');
    const urlEl = modal.querySelector<HTMLElement>('#ssh-auth-url');
    const msgEl = modal.querySelector<HTMLElement>('#ssh-auth-msg');
    const httpsBtn = modal.querySelector<HTMLButtonElement>('#ssh-auth-switch-https');
    if (hostEl) hostEl.textContent = p.host || '';
    if (remoteEl) remoteEl.textContent = p.remote || '';
    if (urlEl) urlEl.textContent = p.url || '';
    if (msgEl) msgEl.textContent = p.message || '';
    const canConvert = !!sshToHttps(p.url);
    if (httpsBtn) httpsBtn.disabled = !canConvert;
  },
});

/** Subscribes to backend SSH auth prompts once and opens the modal on demand. */
export function initSshAuthPrompt(): void {
  if (wired) return;
  wired = true;

  TAURI.listen?.('ui:ssh-auth', (ev: any) => {
    const p = (ev?.payload || {}) as AuthPrompt;
    sshAuthController.open(p);
  });
}
