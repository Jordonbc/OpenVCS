// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();
const mockHydrateBranches = vi.fn();

let sshHostkeyCb: ((ev: any) => void) | null = null;

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: {
    invoke: mockInvoke,
    listen: vi.fn((_event: string, cb: any) => {
      sshHostkeyCb = cb;
    }),
  },
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));

vi.mock('@scripts/ui/modals', () => ({
  openModal: mockOpenModal,
  closeModal: mockCloseModal,
  hydrate: vi.fn(),
}));

vi.mock('@scripts/features/repo/hydrate', () => ({
  hydrateBranches: mockHydrateBranches,
}));

function mountModal() {
  document.body.innerHTML = `
    <div id="ssh-hostkey-modal">
      <span id="ssh-hostkey-host"></span>
      <span id="ssh-hostkey-remote"></span>
      <span id="ssh-hostkey-url"></span>
      <span id="ssh-hostkey-msg"></span>
      <button id="ssh-hostkey-accept">Accept</button>
      <button id="ssh-hostkey-deny">Deny</button>
    </div>
  `;
}

function triggerSshHostkeyEvent(payload: Record<string, string> = {}) {
  sshHostkeyCb?.({ payload });
}

beforeEach(() => {
  vi.resetModules();
  sshHostkeyCb = null;
  mockInvoke.mockReset();
  mockNotify.mockReset();
  mockOpenModal.mockReset();
  mockCloseModal.mockReset();
  mockHydrateBranches.mockReset();
  document.body.innerHTML = '';
  (window as any).__openvcs_fillSshHostKeyModal = undefined;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (window as any).__openvcs_fillSshHostKeyModal = undefined;
});

describe('initSshHostkeyPrompt', () => {
  it('sets up listener and populates modal on event', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();

    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo.git', message: 'Key fingerprint: ...' });

    expect(mockOpenModal).toHaveBeenCalledWith('ssh-hostkey-modal');

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('example.com');
    expect(document.getElementById('ssh-hostkey-remote')!.textContent).toBe('origin');
    expect(document.getElementById('ssh-hostkey-url')!.textContent).toBe('git@example.com:repo.git');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('Key fingerprint: ...');
  });

  it('deny button closes the modal', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com' });

    const denyBtn = document.getElementById('ssh-hostkey-deny') as HTMLButtonElement;
    denyBtn.click();

    expect(mockCloseModal).toHaveBeenCalledWith('ssh-hostkey-modal');
  });

  it('accept button trusts host and fetches', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo.git' });

    const acceptBtn = document.getElementById('ssh-hostkey-accept') as HTMLButtonElement;
    acceptBtn.click();

    await vi.waitFor(() => {
      expect(mockHydrateBranches).toHaveBeenCalled();
    });
    expect(mockInvoke).toHaveBeenCalledWith('ssh_trust_host', { host: 'example.com' });
    expect(mockInvoke).toHaveBeenCalledWith('vcs_fetch_all', {});
    expect(mockNotify).toHaveBeenCalledWith('Trusted example.com');
    expect(mockCloseModal).toHaveBeenCalledWith('ssh-hostkey-modal');
  });

  it('accept button shows notify on failure', async () => {
    mountModal();
    mockInvoke.mockRejectedValue(new Error('permission denied'));

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: '' });

    const acceptBtn = document.getElementById('ssh-hostkey-accept') as HTMLButtonElement;
    acceptBtn.click();

    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Failed to trust host: Error: permission denied');
    });
  });

  it('wires the modal once across repeated events', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt, sshHostkeyController } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com' });
    expect(sshHostkeyController.isWired).toBe(true);
    triggerSshHostkeyEvent({ host: 'other.example' });
    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('other.example');
  });

  it('does nothing when modal element is missing', async () => {
    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    expect(() => triggerSshHostkeyEvent({ host: 'example.com' })).not.toThrow();
    expect(mockOpenModal).not.toHaveBeenCalled();
  });

  it('accept is no-op when current is null', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();

    const acceptBtn = document.getElementById('ssh-hostkey-accept') as HTMLButtonElement;
    await acceptBtn.click();

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('sets buttons disabled during accept busy state', async () => {
    mountModal();
    let resolveTrust: () => void;
    const trustPromise = new Promise<void>((resolve) => { resolveTrust = resolve; });
    mockInvoke.mockReturnValue(trustPromise);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com' });

    const acceptBtn = document.getElementById('ssh-hostkey-accept') as HTMLButtonElement;
    const denyBtn = document.getElementById('ssh-hostkey-deny') as HTMLButtonElement;

    acceptBtn.click();

    expect(acceptBtn.disabled).toBe(true);
    expect(denyBtn.disabled).toBe(true);

    resolveTrust!();
    await vi.waitFor(() => {
      expect(acceptBtn.disabled).toBe(false);
      expect(denyBtn.disabled).toBe(false);
    });
  });

  it('re-enables buttons on accept failure', async () => {
    mountModal();
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com' });

    const acceptBtn = document.getElementById('ssh-hostkey-accept') as HTMLButtonElement;
    const denyBtn = document.getElementById('ssh-hostkey-deny') as HTMLButtonElement;

    await acceptBtn.click();

    await vi.waitFor(() => {
      expect(acceptBtn.disabled).toBe(false);
      expect(denyBtn.disabled).toBe(false);
    });
  });

  it('does not re-wire on subsequent events', async () => {
    mountModal();
    const { initSshHostkeyPrompt, sshHostkeyController } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com' });
    triggerSshHostkeyEvent({ host: 'other.example' });
    expect(sshHostkeyController.isWired).toBe(true);
    (document.getElementById('ssh-hostkey-deny') as HTMLButtonElement).click();
    expect(mockCloseModal).toHaveBeenCalledTimes(1);
    expect(mockCloseModal).toHaveBeenCalledWith('ssh-hostkey-modal');
  });

  it('populates host and message for missing buttons modal', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo', message: 'Fingerprint: abc' });

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('example.com');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('Fingerprint: abc');
  });

  it('handles missing accept and deny buttons', async () => {
    document.body.innerHTML = `
      <div id="ssh-hostkey-modal">
        <span id="ssh-hostkey-host"></span>
        <span id="ssh-hostkey-msg"></span>
      </div>
    `;

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'testhost' });

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('testhost');
  });
});

// ---------------------------------------------------------------------------
// wireModalOnce - element null safety branches (setBusy, fill)
// ---------------------------------------------------------------------------

describe('wireModalOnce element null branches', () => {
  it('fill handles missing host element', async () => {
    document.body.innerHTML = `
      <div id="ssh-hostkey-modal">
        <span id="ssh-hostkey-remote"></span>
        <span id="ssh-hostkey-url"></span>
        <span id="ssh-hostkey-msg"></span>
        <button id="ssh-hostkey-accept">Accept</button>
        <button id="ssh-hostkey-deny">Deny</button>
      </div>
    `;
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo', message: 'Key: abc' });

    // Other elements still get filled despite missing host element
    expect(document.getElementById('ssh-hostkey-remote')!.textContent).toBe('origin');
    expect(document.getElementById('ssh-hostkey-url')!.textContent).toBe('git@example.com:repo');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('Key: abc');
  });

  it('fill handles missing remote element', async () => {
    document.body.innerHTML = `
      <div id="ssh-hostkey-modal">
        <span id="ssh-hostkey-host"></span>
        <span id="ssh-hostkey-url"></span>
        <span id="ssh-hostkey-msg"></span>
        <button id="ssh-hostkey-accept">Accept</button>
        <button id="ssh-hostkey-deny">Deny</button>
      </div>
    `;
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo', message: 'Key: abc' });

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('example.com');
    expect(document.getElementById('ssh-hostkey-url')!.textContent).toBe('git@example.com:repo');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('Key: abc');
  });

  it('fill handles missing url element', async () => {
    document.body.innerHTML = `
      <div id="ssh-hostkey-modal">
        <span id="ssh-hostkey-host"></span>
        <span id="ssh-hostkey-remote"></span>
        <span id="ssh-hostkey-msg"></span>
        <button id="ssh-hostkey-accept">Accept</button>
        <button id="ssh-hostkey-deny">Deny</button>
      </div>
    `;
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo', message: 'Key: abc' });

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('example.com');
    expect(document.getElementById('ssh-hostkey-remote')!.textContent).toBe('origin');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('Key: abc');
  });

  it('fill handles missing msg element', async () => {
    document.body.innerHTML = `
      <div id="ssh-hostkey-modal">
        <span id="ssh-hostkey-host"></span>
        <span id="ssh-hostkey-remote"></span>
        <span id="ssh-hostkey-url"></span>
        <button id="ssh-hostkey-accept">Accept</button>
        <button id="ssh-hostkey-deny">Deny</button>
      </div>
    `;
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com', remote: 'origin', url: 'git@example.com:repo' });

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('example.com');
    expect(document.getElementById('ssh-hostkey-remote')!.textContent).toBe('origin');
    expect(document.getElementById('ssh-hostkey-url')!.textContent).toBe('git@example.com:repo');
  });

  it('setBusy handles missing deny button during accept', async () => {
    document.body.innerHTML = `
      <div id="ssh-hostkey-modal">
        <span id="ssh-hostkey-host"></span>
        <span id="ssh-hostkey-remote"></span>
        <span id="ssh-hostkey-url"></span>
        <span id="ssh-hostkey-msg"></span>
        <button id="ssh-hostkey-accept">Accept</button>
      </div>
    `;
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: 'example.com' });

    const acceptBtn = document.getElementById('ssh-hostkey-accept') as HTMLButtonElement;
    acceptBtn.click();

    // Should not throw despite missing deny button
    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalled();
    });
  });

  it('fill converts null host value to empty string', async () => {
    mountModal();
    mockInvoke.mockResolvedValue(undefined);

    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    triggerSshHostkeyEvent({ host: null as any, remote: 'origin', url: '', message: '' });

    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('');
    expect(document.getElementById('ssh-hostkey-remote')!.textContent).toBe('origin');
    expect(document.getElementById('ssh-hostkey-url')!.textContent).toBe('');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// initSshHostkeyPrompt - event payload edge cases
// ---------------------------------------------------------------------------

describe('initSshHostkeyPrompt event edge cases', () => {
  it('handles event with null payload', async () => {
    mountModal();
    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    sshHostkeyCb?.({ payload: null });
    expect(mockOpenModal).toHaveBeenCalledWith('ssh-hostkey-modal');
  });

  it('handles event with undefined payload', async () => {
    mountModal();
    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    sshHostkeyCb?.({});
    expect(mockOpenModal).toHaveBeenCalledWith('ssh-hostkey-modal');
  });

  it('handles completely null event without crashing', async () => {
    mountModal();
    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    expect(() => sshHostkeyCb?.(null)).not.toThrow();
  });

  it('fills with empty strings when payload has no matching keys', async () => {
    mountModal();
    const { initSshHostkeyPrompt } = await import('@scripts/features/sshHostkey');
    initSshHostkeyPrompt();
    sshHostkeyCb?.({ payload: { unrelated: 'value' } });
    expect(document.getElementById('ssh-hostkey-host')!.textContent).toBe('');
    expect(document.getElementById('ssh-hostkey-msg')!.textContent).toBe('');
  });
});
