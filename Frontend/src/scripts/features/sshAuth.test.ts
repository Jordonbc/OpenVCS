// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/modals', () => ({ openModal: vi.fn(), closeModal: vi.fn() }));
vi.mock('./repoSettings', () => ({ openRepoSettings: vi.fn() }));
vi.mock('./sshKeys', () => ({ openSshKeysModal: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

let listenHandler: ((evt: { payload: unknown }) => void) | null = null;

/** Mounts the SSH auth modal used by the prompt wiring. */
function mountSshAuthModal() {
  document.body.innerHTML = `
    <div id="ssh-auth-modal">
      <span id="ssh-auth-host"></span>
      <span id="ssh-auth-remote"></span>
      <span id="ssh-auth-url"></span>
      <span id="ssh-auth-msg"></span>
      <button id="ssh-auth-ok"></button>
      <button id="ssh-auth-open-remotes"></button>
      <button id="ssh-auth-ssh-keys"></button>
      <button id="ssh-auth-switch-https"></button>
    </div>
  `;
}

/** Installs a mocked Tauri runtime before module import. */
function installTauriMock() {
  listenHandler = null;
  (window as any).__TAURI__ = {
    core: {
      invoke: vi.fn(async () => null),
    },
    event: {
      listen: vi.fn(async (_event: string, cb: (evt: { payload: unknown }) => void) => {
        listenHandler = cb;
        return { unlisten: vi.fn() };
      }),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  mountSshAuthModal();
  installTauriMock();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__TAURI__;
  vi.restoreAllMocks();
});

describe('initSshAuthPrompt', () => {
  it('enables HTTPS conversion for SCP-style SSH URLs', async () => {
    const { initSshAuthPrompt } = await import('./sshAuth');
    initSshAuthPrompt();

    expect(listenHandler).not.toBeNull();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
    expect(document.getElementById('ssh-auth-url')?.textContent).toBe('git@github.com:user/repo.git');
  });

  it('disables HTTPS conversion for unsupported URLs', async () => {
    const { initSshAuthPrompt } = await import('./sshAuth');
    initSshAuthPrompt();

    expect(listenHandler).not.toBeNull();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'ftp://example.com/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(true);
    expect(document.getElementById('ssh-auth-host')?.textContent).toBe('example.com');
  });
});
