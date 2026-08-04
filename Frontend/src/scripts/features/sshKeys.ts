// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/sshKeys.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { copyText } from '../lib/clipboard';
import { ModalController } from '../lib/modalController';

type SshCommandOutput = { code: number; stdout: string; stderr: string };
type SshKeyCandidate = { path: string; name: string };

let selectedPath = '';

function fmtAgentStatus(out: SshCommandOutput | null | undefined): string {
  if (!out) return 'Unable to query ssh-agent.';
  const msg = [out.stdout, out.stderr].filter(Boolean).join('\n').trim();
  if (out.code === 0) return msg || 'Keys loaded.';
  if (out.code === 1) return msg || 'The agent has no identities.';
  if (out.code === 2) return msg || 'ssh-agent is not running or not reachable.';
  return msg || `ssh-add exited with code ${out.code}`;
}


/** Marks the currently selected key path inside the modal. */
function setSelected(modal: HTMLElement, path: string) {
  selectedPath = String(path || '').trim();
  const selectedEl = modal.querySelector<HTMLElement>('#ssh-keys-selected');
  if (selectedEl) selectedEl.textContent = selectedPath || '';
  const listEl = modal.querySelector<HTMLElement>('#ssh-keys-list');
  if (!listEl) return;
  listEl.querySelectorAll<HTMLElement>('[data-key-path]').forEach((el) => {
    el.classList.toggle('primary', el.dataset.keyPath === selectedPath);
  });
}

/** Reloads agent status and key candidates into the modal. */
async function refreshKeys(modal: HTMLElement) {
  const statusEl = modal.querySelector<HTMLElement>('#ssh-keys-agent-status');
  const listEl = modal.querySelector<HTMLElement>('#ssh-keys-list');
  const noneEl = modal.querySelector<HTMLElement>('#ssh-keys-none');
  const refreshBtn = modal.querySelector<HTMLButtonElement>('#ssh-keys-refresh');
  const addBtn = modal.querySelector<HTMLButtonElement>('#ssh-keys-add');
  if (refreshBtn) refreshBtn.disabled = true;
  if (addBtn) addBtn.disabled = true;
  try {
    const [agent, keys] = await Promise.all([
      TAURI.invoke<SshCommandOutput>('ssh_agent_list_keys'),
      TAURI.invoke<SshKeyCandidate[]>('ssh_key_candidates'),
    ]);

    if (statusEl) statusEl.textContent = fmtAgentStatus(agent);

    const list = Array.isArray(keys) ? keys : [];
    if (listEl) {
      listEl.innerHTML = '';
      for (const k of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tbtn';
        btn.dataset.keyPath = k.path;
        btn.textContent = k.name;
        btn.title = k.path;
        btn.addEventListener('click', () => setSelected(modal, k.path));
        listEl.appendChild(btn);
      }
    }
    if (noneEl) noneEl.style.display = list.length ? 'none' : '';
    if (!selectedPath && list[0]?.path) setSelected(modal, list[0].path);
  } catch (e) {
    if (statusEl) statusEl.textContent = `Unable to query ssh-agent: ${String(e || '')}`.trim();
    notify('Unable to load SSH keys');
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
    if (addBtn) addBtn.disabled = false;
  }
}

/** Per-open state for the SSH keys modal. */
export interface SshKeysState {
  preselectPath?: string;
}

/** Owns the SSH keys modal lifecycle: wires once, refreshes state per open. */
export const sshKeysController = new ModalController<SshKeysState>('ssh-keys-modal', {
  wire: (modal) => {
    const refreshBtn = modal.querySelector<HTMLButtonElement>('#ssh-keys-refresh');
    const copyBtn = modal.querySelector<HTMLButtonElement>('#ssh-keys-copy');
    const addBtn = modal.querySelector<HTMLButtonElement>('#ssh-keys-add');

    refreshBtn?.addEventListener('click', () => void refreshKeys(modal));
    copyBtn?.addEventListener('click', () => {
      if (!selectedPath) { notify('Select a key first'); return; }
      void copyText(`ssh-add "${selectedPath.replace(/[\\"]/g, (ch) => '\\' + ch)}"`, { success: 'Copied to clipboard', failure: 'Unable to copy to clipboard' });
    });
    addBtn?.addEventListener('click', async () => {
      if (!selectedPath) { notify('Select a key first'); return; }
      if (addBtn) addBtn.disabled = true;
      try {
        const out = await TAURI.invoke<SshCommandOutput>('ssh_add_key', { path: selectedPath });
        const msg = [out.stdout, out.stderr].filter(Boolean).join('\n').trim();
        if (out.code === 0) {
          notify('Key added to ssh-agent');
          await refreshKeys(modal);
        } else if (/ssh_askpass_exec|askpass.*no such file or directory|enter passphrase|bad passphrase|passphrase/i.test(msg)) {
          notify('Passphrase prompt app missing; install ssh-askpass or ksshaskpass, or run ssh-add in a terminal');
        } else {
          notify(msg || `ssh-add failed (code ${out.code})`);
        }
      } catch (e) {
        notify(`ssh-add failed: ${String(e || '')}`.trim());
      } finally {
        if (addBtn) addBtn.disabled = false;
      }
    });
  },
  apply: (state, modal) => {
    if (state.preselectPath) setSelected(modal, state.preselectPath);
    void refreshKeys(modal);
  },
});

/** Wires the SSH keys modal once. No-op after the first call. */
export function wireSshKeys(): void {
  sshKeysController.initOnce();
}

/** Opens the SSH keys modal, optionally pre-selecting a key path. */
export function openSshKeysModal(preselectPath?: string): void {
  sshKeysController.open({ preselectPath });
}
