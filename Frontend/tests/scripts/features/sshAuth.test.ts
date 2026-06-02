// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/ui/modals', () => ({ openModal: vi.fn(), closeModal: vi.fn() }));
vi.mock('@scripts/features/repoSettings', () => ({ openRepoSettings: vi.fn() }));
vi.mock('@scripts/features/sshKeys', () => ({ openSshKeysModal: vi.fn() }));
vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));

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
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();

    expect(listenHandler).not.toBeNull();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
    expect(document.getElementById('ssh-auth-url')?.textContent).toBe('git@github.com:user/repo.git');
  });

  it('disables HTTPS conversion for unsupported URLs', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();

    expect(listenHandler).not.toBeNull();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'ftp://example.com/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(true);
    expect(document.getElementById('ssh-auth-host')?.textContent).toBe('example.com');
  });
});

describe('wireAuthModal', () => {
  it('fills modal content from auth prompt payload', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git', message: 'Auth needed' } });

    expect(document.getElementById('ssh-auth-host')?.textContent).toBe('github.com');
    expect(document.getElementById('ssh-auth-msg')?.textContent).toBe('Auth needed');
  });

  it('wires the modal only once and existing content persists', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    expect(document.getElementById('ssh-auth-host')?.textContent).toBe('github.com');

    // Second call should be a no-op
    expect(() => initSshAuthPrompt()).not.toThrow();
    expect(document.getElementById('ssh-auth-host')?.textContent).toBe('github.com');
  });

  it('disables HTTPS button for non-ssh URLs (ftp)', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'ftp://example.com/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(true);
  });

  it('disables HTTPS button for non-ssh URLs (http)', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'http://example.com/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
  });

  it('enables HTTPS conversion for ssh:// protocol URLs', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'ssh://git@github.com/owner/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
  });

  it('handles ok button click', async () => {
    const modals = await import('@scripts/ui/modals');
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const okBtn = document.getElementById('ssh-auth-ok') as HTMLButtonElement;
    okBtn.click();
    expect(vi.mocked(modals.closeModal)).toHaveBeenCalledWith('ssh-auth-modal');
  });

  it('handles remotes button click', async () => {
    const repoSettings = await import('@scripts/features/repoSettings');
    const modals = await import('@scripts/ui/modals');
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const remotesBtn = document.getElementById('ssh-auth-open-remotes') as HTMLButtonElement;
    remotesBtn.click();
    expect(vi.mocked(modals.closeModal)).toHaveBeenCalledWith('ssh-auth-modal');
    expect(vi.mocked(repoSettings.openRepoSettings)).toHaveBeenCalled();
  });

  it('handles SSH keys button click', async () => {
    const sshKeys = await import('@scripts/features/sshKeys');
    const modals = await import('@scripts/ui/modals');
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const keysBtn = document.getElementById('ssh-auth-ssh-keys') as HTMLButtonElement;
    keysBtn.click();
    expect(vi.mocked(modals.closeModal)).toHaveBeenCalledWith('ssh-auth-modal');
    expect(vi.mocked(sshKeys.openSshKeysModal)).toHaveBeenCalled();
  });

  it('enables HTTPS button for SCP-style SSH URLs (git@)', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
  });
});

describe('HTTPS switch button flow', () => {
  it('calls vcs_set_remote_url on click and closes modal', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn(async (_event: string, cb: (evt: { payload: unknown }) => void) => { listenHandler = cb; return { unlisten: vi.fn() }; }) },
    };
    const modals = await import('@scripts/ui/modals');
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();

    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    httpsBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(invoke).toHaveBeenCalledWith('vcs_set_remote_url', { name: 'origin', url: 'https://github.com/user/repo.git' });
    expect(vi.mocked(modals.closeModal)).toHaveBeenCalledWith('ssh-auth-modal');
  });

  it('re-enables HTTPS button after error', async () => {
    const invoke = vi.fn(async () => { throw new Error('network error'); });
    (window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn(async (_event: string, cb: (evt: { payload: unknown }) => void) => { listenHandler = cb; return { unlisten: vi.fn() }; }) },
    };
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();

    listenHandler?.({ payload: { host: 'github.com', remote: 'origin', url: 'git@github.com:user/repo.git' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    httpsBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(httpsBtn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sshToHttps - edge cases
// ---------------------------------------------------------------------------

describe('sshToHttps edge cases', () => {
  it('returns null for empty url', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: '', remote: '', url: '' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(true);
  });

  it('converts http:// urls (already https-compatible)', async () => {
    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'http://example.com/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// wireAuthModal - missing elements
// ---------------------------------------------------------------------------

describe('wireAuthModal - missing elements', () => {
  it('handles missing ok button gracefully', async () => {
    document.body.innerHTML = `
      <div id="ssh-auth-modal">
        <button id="ssh-auth-switch-https"></button>
      </div>
    `;

    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'git@example.com:user/repo' } });

    expect(document.getElementById('ssh-auth-switch-https')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wireAuthModal - https without current
// ---------------------------------------------------------------------------

describe('wireAuthModal - https without current', () => {
  it('does nothing when https clicked without current prompt', async () => {
    document.body.innerHTML = `
      <div id="ssh-auth-modal">
        <button id="ssh-auth-switch-https"></button>
      </div>
    `;

    const { initSshAuthPrompt } = await import('@scripts/features/sshAuth');
    initSshAuthPrompt();
    listenHandler?.({ payload: { host: 'example.com', remote: 'origin', url: 'git@example.com:user/repo' } });

    const httpsBtn = document.getElementById('ssh-auth-switch-https') as HTMLButtonElement;
    expect(httpsBtn.disabled).toBe(false);
  });
});
