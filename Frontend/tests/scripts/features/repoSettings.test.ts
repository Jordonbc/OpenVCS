// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock module dependencies
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
    TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/notify', () => ({
    notify: mockNotify,
}));

vi.mock('@scripts/ui/modals', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountModal(overrides?: {
    nameValue?: string;
    emailValue?: string;
    remotes?: Array<{ name: string; url: string }>;
}) {
    const remotesHtml = overrides?.remotes
        ? ''
        : '';
    document.body.innerHTML = `
        <div id="repo-settings-modal">
            <input id="user-name" value="${overrides?.nameValue ?? ''}" />
            <input id="user-email" value="${overrides?.emailValue ?? ''}" />
            <div id="remotes">${remotesHtml}</div>
            <button id="remote-add">Add Remote</button>
            <button id="repo-settings-save">Save</button>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockNotify.mockReset();
    mockOpenModal.mockReset();
    mockCloseModal.mockReset();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// openRepoSettings
// ---------------------------------------------------------------------------

describe('openRepoSettings', () => {
    async function load() {
        return import('@scripts/features/repoSettings');
    }

    it('opens the repo-settings-modal', async () => {
        const { openRepoSettings } = await load();
        openRepoSettings();
        expect(mockOpenModal).toHaveBeenCalledWith('repo-settings-modal');
    });
});

// ---------------------------------------------------------------------------
// wireRepoSettings – initialisation
// ---------------------------------------------------------------------------

describe('wireRepoSettings (initialisation)', () => {
    async function load() {
        return import('@scripts/features/repoSettings');
    }

    it('wires the __wired flag and does not re-wire', async () => {
        mountModal();
        const { wireRepoSettings } = await load();
        await wireRepoSettings();
        // Second call should be a no-op
        await wireRepoSettings();
        // Should still only have been called once from load
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('does nothing if modal is missing', async () => {
        const { wireRepoSettings } = await load();
        await wireRepoSettings();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('loads user name and email from backend into inputs', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: 'Test User',
            user_email: 'test@example.com',
            remotes: [],
        });
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const nameInput = document.getElementById('user-name') as HTMLInputElement;
        const emailInput = document.getElementById('user-email') as HTMLInputElement;
        expect(nameInput.value).toBe('Test User');
        expect(emailInput.value).toBe('test@example.com');
    });

    it('handles backend error gracefully', async () => {
        mountModal();
        mockInvoke.mockRejectedValueOnce(new Error('no repo'));
        const { wireRepoSettings } = await load();
        await expect(wireRepoSettings()).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// wireRepoSettings – remote rows
// ---------------------------------------------------------------------------

describe('wireRepoSettings (remote rows)', () => {
    async function load() {
        return import('@scripts/features/repoSettings');
    }

    it('loads remotes from backend and creates rows', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [
                { name: 'origin', url: 'ssh://host/org/repo' },
                { name: 'upstream', url: 'https://host/upstream.git' },
            ],
        });
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const remotesEl = document.getElementById('remotes')!;
        const rows = remotesEl.querySelectorAll('.remote-row');
        expect(rows.length).toBe(2);
        expect((rows[0].querySelector('.remote-name') as HTMLInputElement).value).toBe('origin');
        expect((rows[0].querySelector('.remote-url') as HTMLInputElement).value).toBe('ssh://host/org/repo');
        expect((rows[1].querySelector('.remote-name') as HTMLInputElement).value).toBe('upstream');
        expect((rows[1].querySelector('.remote-url') as HTMLInputElement).value).toBe('https://host/upstream.git');
    });

    it('does not synthesize a remote when remotes array is empty', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const remotesEl = document.getElementById('remotes')!;
        const rows = remotesEl.querySelectorAll('.remote-row');
        expect(rows.length).toBe(0);
    });

    it('adds a remote row when add button is clicked', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const addBtn = document.getElementById('remote-add') as HTMLButtonElement;
        addBtn.click();

        const remotesEl = document.getElementById('remotes')!;
        expect(remotesEl.querySelectorAll('.remote-row').length).toBe(1);
        // Second click
        addBtn.click();
        expect(remotesEl.querySelectorAll('.remote-row').length).toBe(2);
    });

    it('removes a remote row when remove button is clicked', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [
                { name: 'origin', url: 'ssh://host/org/repo' },
                { name: 'extra', url: 'https://extra.git' },
            ],
        });
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const remotesEl = document.getElementById('remotes')!;
        expect(remotesEl.querySelectorAll('.remote-row').length).toBe(2);

        const removeBtns = remotesEl.querySelectorAll('.remote-remove');
        (removeBtns[1] as HTMLButtonElement).click();

        expect(remotesEl.querySelectorAll('.remote-row').length).toBe(1);
        expect((remotesEl.querySelector('.remote-name') as HTMLInputElement).value).toBe('origin');
    });
});

// ---------------------------------------------------------------------------
// wireRepoSettings – save flow
// ---------------------------------------------------------------------------

describe('wireRepoSettings (save flow)', () => {
    async function load() {
        return import('@scripts/features/repoSettings');
    }

    it('saves settings and fetches when remotes changed', async () => {
        mountModal({ nameValue: 'User', emailValue: 'u@example.com' });
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
        mockInvoke.mockResolvedValueOnce(undefined); // vcs_fetch_all
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        // Add a remote row
        const addBtn = document.getElementById('remote-add') as HTMLButtonElement;
        addBtn.click();

        const remoteName = document.querySelector('.remote-name') as HTMLInputElement;
        const remoteUrl = document.querySelector('.remote-url') as HTMLInputElement;
        remoteName.value = 'origin';
        remoteUrl.value = 'ssh://host/org/repo';

        // Save
        const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
        saveBtn.click();

        // Wait for the async save
        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('set_repo_settings', {
                cfg: expect.objectContaining({
                    user_name: 'User',
                    user_email: 'u@example.com',
                    remotes: [{ name: 'origin', url: 'ssh://host/org/repo' }],
                }),
            });
        });

        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('vcs_fetch_all', {});
        });
        await vi.waitFor(() => {
            expect(saveBtn.textContent).toBe('Saved!');
        });
        expect(saveBtn.classList.contains('saved-state')).toBe(true);
    });

    it('shows saved state on save button after success', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
        mockInvoke.mockResolvedValueOnce(undefined); // vcs_fetch_all
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
        saveBtn.click();

        await vi.waitFor(() => {
            expect(saveBtn.textContent).toBe('Saved!');
        });
    });

    it('notifies on save failure', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        mockInvoke.mockRejectedValueOnce(new Error('save failed'));
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
        saveBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Failed to save repository settings');
        });
    });

    it('validates that remote entries have both name and URL', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        // Add an incomplete remote
        const addBtn = document.getElementById('remote-add') as HTMLButtonElement;
        addBtn.click();
        const remoteName = document.querySelector('.remote-name') as HTMLInputElement;
        remoteName.value = 'origin';
        // URL is empty

        const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
        saveBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Remote entries must include both name and URL');
        });
        // Should not have called invoke to save
        expect(mockInvoke).toHaveBeenCalledTimes(1); // only the initial load
    });

    it('skips vcs_fetch_all when remotes have not changed', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [{ name: 'origin', url: 'https://same.git' }],
        });
        mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
        saveBtn.click();

        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('set_repo_settings', expect.anything());
        });
        // vcs_fetch_all should not have been called
        const fetchCalls = mockInvoke.mock.calls.filter(
            (call: any[]) => call[0] === 'vcs_fetch_all',
        );
        expect(fetchCalls.length).toBe(0);
    });

    it('skips duplicate remote names', async () => {
        mountModal();
        mockInvoke.mockResolvedValueOnce({
            user_name: '',
            user_email: '',
            remotes: [],
        });
        mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
        const { wireRepoSettings } = await load();
        await wireRepoSettings();

        // Add two remotes with same name
        const addBtn = document.getElementById('remote-add') as HTMLButtonElement;
        addBtn.click();
        const rows = document.querySelectorAll('.remote-row');
        (rows[0].querySelector('.remote-name') as HTMLInputElement).value = 'origin';
        (rows[0].querySelector('.remote-url') as HTMLInputElement).value = 'git@host:one.git';

        addBtn.click();
        const rows2 = document.querySelectorAll('.remote-row');
        (rows2[1].querySelector('.remote-name') as HTMLInputElement).value = 'origin';
        (rows2[1].querySelector('.remote-url') as HTMLInputElement).value = 'git@host:two.git';

        const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
        saveBtn.click();

        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('set_repo_settings', {
                cfg: expect.objectContaining({
                    remotes: [{ name: 'origin', url: 'git@host:one.git' }],
                }),
            });
        });
    });

  it('ignores empty rows', async () => {
    mountModal();
    mockInvoke.mockResolvedValueOnce({
      user_name: '',
      user_email: '',
      remotes: [],
    });
    mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
    const { wireRepoSettings } = await load();
    await wireRepoSettings();

    // Add an empty row, then a real one
    const addBtn = document.getElementById('remote-add') as HTMLButtonElement;
    addBtn.click();

    addBtn.click();
    const rows = document.querySelectorAll('.remote-row');
    (rows[1].querySelector('.remote-name') as HTMLInputElement).value = 'origin';
    (rows[1].querySelector('.remote-url') as HTMLInputElement).value = 'git@host:real.git';

    const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_repo_settings', {
        cfg: expect.objectContaining({
          remotes: [{ name: 'origin', url: 'git@host:real.git' }],
        }),
      });
    });
  });

  it('handles all empty remote rows (both name and url empty)', async () => {
    mountModal();
    mockInvoke.mockResolvedValueOnce({
      user_name: '',
      user_email: '',
      remotes: [],
    });
    mockInvoke.mockResolvedValueOnce(undefined);
    const { wireRepoSettings } = await load();
    await wireRepoSettings();

    const addRemoteBtn = document.getElementById('remote-add') as HTMLButtonElement;
    addRemoteBtn.click();

    addRemoteBtn.click();

    const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_repo_settings', {
        cfg: expect.objectContaining({
          remotes: [],
        }),
      });
    });
    const fetchCalls = mockInvoke.mock.calls.filter(
      (call: any[]) => call[0] === 'vcs_fetch_all',
    );
    expect(fetchCalls.length).toBe(0);
  });

  it('does not fail when modal has no save button', async () => {
    document.body.innerHTML = `
      <div id="repo-settings-modal">
        <input id="user-name" value="" />
        <input id="user-email" value="" />
        <div id="remotes"></div>
        <button id="remote-add">Add Remote</button>
      </div>
    `;
    mockInvoke.mockResolvedValueOnce({
      user_name: '',
      user_email: '',
      remotes: [],
    });
    const { wireRepoSettings } = await load();
    await expect(wireRepoSettings()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// wireRepoSettings - fetch error and setTimeout reset
// ---------------------------------------------------------------------------

describe('wireRepoSettings (fetch error and timeout)', () => {
  async function load() {
    return import('@scripts/features/repoSettings');
  }

  it('handles vcs_fetch_all failure gracefully', async () => {
    mountModal({ nameValue: 'User', emailValue: 'u@example.com' });
    mockInvoke.mockResolvedValueOnce({
      user_name: '',
      user_email: '',
      remotes: [],
    });
    mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
    mockInvoke.mockRejectedValueOnce(new Error('fetch fail')); // vcs_fetch_all fails
    const { wireRepoSettings } = await load();
    await wireRepoSettings();

    // Add a remote row so remotes changed flag is set
    const addBtn = document.getElementById('remote-add') as HTMLButtonElement;
    addBtn.click();
    const remoteName = document.querySelector('.remote-name') as HTMLInputElement;
    const remoteUrl = document.querySelector('.remote-url') as HTMLInputElement;
    remoteName.value = 'origin';
    remoteUrl.value = 'ssh://host/org/repo';

    const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('vcs_fetch_all', {});
    });
  });

  it('resets save button text after timeout', async () => {
    vi.useFakeTimers();
    mountModal();
    mockInvoke.mockResolvedValueOnce({
      user_name: '',
      user_email: '',
      remotes: [],
    });
    mockInvoke.mockResolvedValueOnce(undefined); // set_repo_settings
    mockInvoke.mockResolvedValueOnce(undefined); // vcs_fetch_all
    const { wireRepoSettings } = await load();
    await wireRepoSettings();

    const saveBtn = document.getElementById('repo-settings-save') as HTMLButtonElement;
    saveBtn.click();

    await vi.advanceTimersByTimeAsync(100);

    expect(saveBtn.textContent).toBe('Saved!');
    expect(saveBtn.classList.contains('saved-state')).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(saveBtn.textContent).toBe('Save');
    expect(saveBtn.classList.contains('saved-state')).toBe(false);
    vi.useRealTimers();
  });
});
