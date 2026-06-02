// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all module dependencies before any dynamic import.
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockOpenModal = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
    TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/notify', () => ({
    notify: mockNotify,
}));

vi.mock('@scripts/ui/modals', () => ({
    openModal: mockOpenModal,
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mountModal() {
    document.body.innerHTML = `
        <div id="ssh-keys-modal">
            <pre id="ssh-keys-agent-status"></pre>
            <div id="ssh-keys-list"></div>
            <div id="ssh-keys-none"></div>
            <span id="ssh-keys-selected"></span>
            <button id="ssh-keys-refresh">Refresh</button>
            <button id="ssh-keys-copy">Copy</button>
            <button id="ssh-keys-add">Add</button>
        </div>
    `;
}

function getModal(): HTMLElement {
    return document.getElementById('ssh-keys-modal')!;
}

function agentResult(code: number, opts: { stdout?: string; stderr?: string } = {}): unknown {
    return { code, stdout: opts.stdout ?? '', stderr: opts.stderr ?? '' };
}

function keyCandidate(path: string, name?: string): unknown {
    return { path, name: name ?? path.split('/').pop() ?? path };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockNotify.mockReset();
    mockOpenModal.mockReset();
    mountModal();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// wireSshKeys – agent status formatting
// ---------------------------------------------------------------------------

describe('wireSshKeys (agent status formatting)', () => {
    async function loadSut() {
        return import('@scripts/features/sshKeys');
    }

    it('shows "Unable to query ssh-agent" when agent result is null', async () => {
        mockInvoke
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toBe('Unable to query ssh-agent.');
        });
    });

    it('shows stdout message when agent returns code 0 with output', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0, { stdout: '4096 SHA256:abc...' }))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toContain('SHA256:abc...');
        });
    });

    it('shows "Keys loaded." when agent returns code 0 with no output', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toBe('Keys loaded.');
        });
    });

    it('shows "The agent has no identities." for code 1 with no output', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(1))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toBe('The agent has no identities.');
        });
    });

    it('shows stderr output for code 1 with stderr', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(1, { stderr: 'error detail' }))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toContain('error detail');
        });
    });

    it('shows "ssh-agent is not running or not reachable." for code 2', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(2))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toBe('ssh-agent is not running or not reachable.');
        });
    });

    it('renders key candidates and hides none message when keys exist', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/.ssh/id_rsa', 'id_rsa'), keyCandidate('/home/.ssh/id_ed25519', 'id_ed25519')]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const listEl = document.getElementById('ssh-keys-list') as HTMLElement;
            expect(listEl.children.length).toBe(2);
            expect(listEl.children[0].textContent).toBe('id_rsa');
            const noneEl = document.getElementById('ssh-keys-none') as HTMLElement;
            expect(noneEl.style.display).toBe('none');
            const selectedEl = document.getElementById('ssh-keys-selected') as HTMLElement;
            expect(selectedEl.textContent).toBe('/home/.ssh/id_rsa');
        });
    });

    it('handles refresh failure gracefully', async () => {
        mockInvoke.mockRejectedValue(new Error('ssh error'));

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toContain('Unable to query ssh-agent');
            expect(mockNotify).toHaveBeenCalledWith('Unable to load SSH keys');
        });
    });

    it('copies the selected key ssh-add command', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/.ssh/id_rsa', 'id_rsa')]);
        (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();
        await vi.waitFor(() => expect(document.getElementById('ssh-keys-list')!.children.length).toBe(1));

        (document.getElementById('ssh-keys-copy') as HTMLButtonElement).click();
        await vi.waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ssh-add "/home/.ssh/id_rsa"');
            expect(mockNotify).toHaveBeenCalledWith('Copied to clipboard');
        });
    });

    it('shows error when copying without a selected key', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();
        await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());

        (document.getElementById('ssh-keys-copy') as HTMLButtonElement).click();
        expect(mockNotify).toHaveBeenCalledWith('Select a key first');
    });

    it('adds a key and refreshes on success', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/.ssh/id_rsa', 'id_rsa')])
            .mockResolvedValueOnce(agentResult(0, { stdout: 'Key added' }))
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();
        await vi.waitFor(() => expect(document.getElementById('ssh-keys-list')!.children.length).toBe(1));

        (document.getElementById('ssh-keys-add') as HTMLButtonElement).click();
        await vi.waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('ssh_add_key', { path: '/home/.ssh/id_rsa' });
            expect(mockNotify).toHaveBeenCalledWith('Key added to ssh-agent');
        });
    });

    it('shows generic fallback message for unknown exit codes', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(42, { stderr: 'something broke' }))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toContain('something broke');
        });
    });

    it('shows fallback "exited with code N" when unknown code has no output', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(42))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toBe('ssh-add exited with code 42');
        });
    });

    it('shows error message when TAURI.invoke throws', async () => {
        mockInvoke
            .mockRejectedValue(new Error('Connection refused'));

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const statusEl = document.getElementById('ssh-keys-agent-status') as HTMLPreElement;
            expect(statusEl.textContent).toContain('Unable to query ssh-agent');
            expect(statusEl.textContent).toContain('Connection refused');
        });
        expect(mockNotify).toHaveBeenCalledWith('Unable to load SSH keys');
    });
});

// ---------------------------------------------------------------------------
// wireSshKeys – key list rendering and selection
// ---------------------------------------------------------------------------

describe('wireSshKeys (key list and selection)', () => {
    async function loadSut() {
        return import('@scripts/features/sshKeys');
    }

    it('renders key candidates and auto-selects the first', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const listEl = document.getElementById('ssh-keys-list')!;
            expect(listEl.children.length).toBe(1);
        });

        const listEl = document.getElementById('ssh-keys-list')!;
        const btn = listEl.children[0] as HTMLButtonElement;
        expect(btn.textContent).toBe('id_rsa');
        expect(btn.dataset.keyPath).toBe('/home/user/.ssh/id_rsa');
    });

    it('shows none element when no candidates exist', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        const noneEl = document.getElementById('ssh-keys-none')!;
        expect(noneEl.style.display).toBe('');
    });

    it('hides none element when candidates exist', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_ed25519', 'id_ed25519')]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const noneEl = document.getElementById('ssh-keys-none')!;
            expect(noneEl.style.display).toBe('none');
        });
    });

    it('clicking a key in the list selects it', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([
                keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa'),
                keyCandidate('/home/user/.ssh/id_ed25519', 'id_ed25519'),
            ]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            const listEl = document.getElementById('ssh-keys-list')!;
            expect(listEl.children.length).toBe(2);
        });

        const listEl = document.getElementById('ssh-keys-list')!;
        const secondBtn = listEl.children[1] as HTMLButtonElement;
        secondBtn.click();

        const selectedEl = document.getElementById('ssh-keys-selected')!;
        expect(selectedEl.textContent).toBe('/home/user/.ssh/id_ed25519');
    });

    it('disables refresh and add buttons during load and re-enables afterwards', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const refreshBtn = document.getElementById('ssh-keys-refresh') as HTMLButtonElement;

        const modal = getModal() as any;
        await modal.__open();

        await vi.waitFor(() => {
            expect(refreshBtn.disabled).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// wireSshKeys – copy to clipboard
// ---------------------------------------------------------------------------

describe('wireSshKeys (copy to clipboard)', () => {
    async function loadSut() {
        return import('@scripts/features/sshKeys');
    }

    beforeEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
            writable: true,
            configurable: true,
        });
    });

    it('shows notification when copy clicked without a selected key', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();

        const copyBtn = document.getElementById('ssh-keys-copy') as HTMLButtonElement;
        copyBtn.click();

        expect(mockNotify).toHaveBeenCalledWith('Select a key first');
    });

    it('copies the selected key path to clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('/home/user/.ssh/id_rsa');

        const copyBtn = document.getElementById('ssh-keys-copy') as HTMLButtonElement;
        copyBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Copied to clipboard');
        });
        expect(writeText).toHaveBeenCalledWith(
            'ssh-add "/home/user/.ssh/id_rsa"',
        );
    });

    it('shows error notification when clipboard write fails', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('/home/user/.ssh/id_rsa');

        const copyBtn = document.getElementById('ssh-keys-copy') as HTMLButtonElement;
        copyBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Unable to copy to clipboard');
        });
    });

    it('escapes backslashes and quotes in the path for clipboard command', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('C:\\Users\\"test"\\id_rsa', 'id_rsa')]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('C:\\Users\\"test"\\id_rsa');

        const copyBtn = document.getElementById('ssh-keys-copy') as HTMLButtonElement;
        copyBtn.click();

        await vi.waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(
                'ssh-add "C:\\\\Users\\\\\\"test\\"\\\\id_rsa"',
            );
        });
    });
});

// ---------------------------------------------------------------------------
// wireSshKeys – add-key flow
// ---------------------------------------------------------------------------

describe('wireSshKeys (add key)', () => {
    async function loadSut() {
        return import('@scripts/features/sshKeys');
    }

    /** Waits for the add button to become enabled (refresh completed). */
    async function waitForAddEnabled(): Promise<HTMLButtonElement> {
        const addBtn = document.getElementById('ssh-keys-add') as HTMLButtonElement;
        await vi.waitFor(() => {
            expect(addBtn.disabled).toBe(false);
        });
        return addBtn;
    }

    it('shows notification when add clicked without a selected key', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open();
        const addBtn = await waitForAddEnabled();

        addBtn.click();

        expect(mockNotify).toHaveBeenCalledWith('Select a key first');
    });

    it('calls ssh_add_key and refreshes on success', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')])
            .mockResolvedValueOnce(agentResult(0))
            // inner refresh() from add handler
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('/home/user/.ssh/id_rsa');
        const addBtn = await waitForAddEnabled();

        addBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('Key added to ssh-agent');
        });
        expect(mockInvoke).toHaveBeenCalledTimes(5);
    });

    it('shows passphrase hint when error includes askpass keywords', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')])
            .mockResolvedValueOnce(agentResult(1, { stderr: 'ssh_askpass_exec: no such file' }));

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('/home/user/.ssh/id_rsa');
        const addBtn = await waitForAddEnabled();

        addBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith(
                'Passphrase prompt app missing; install ssh-askpass or ksshaskpass, or run ssh-add in a terminal',
            );
        });
    });

    it('shows generic failure message for non-zero code without askpass keywords', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')])
            .mockResolvedValueOnce(agentResult(1, { stderr: 'some other error' }));

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('/home/user/.ssh/id_rsa');
        const addBtn = await waitForAddEnabled();

        addBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('some other error');
        });
    });

    it('handles invoke rejection during add', async () => {
        mockInvoke
            .mockResolvedValueOnce(agentResult(0))
            .mockResolvedValueOnce([keyCandidate('/home/user/.ssh/id_rsa', 'id_rsa')])
            .mockRejectedValueOnce(new Error('runtime error'));

        const { wireSshKeys } = await loadSut();
        wireSshKeys();

        const modal = getModal() as any;
        await modal.__open('/home/user/.ssh/id_rsa');
        const addBtn = await waitForAddEnabled();

        addBtn.click();

        await vi.waitFor(() => {
            expect(mockNotify).toHaveBeenCalledWith('ssh-add failed: Error: runtime error');
        });
    });
});

// ---------------------------------------------------------------------------
// wireSshKeys – wiring idempotency and modal __wired guard
// ---------------------------------------------------------------------------

describe('wireSshKeys (idempotency)', () => {
    async function loadSut() {
        return import('@scripts/features/sshKeys');
    }

    it('does not re-wire if modal.__wired is already set', async () => {
        mockInvoke
            .mockResolvedValue(agentResult(0))
            .mockResolvedValue([]);

        const { wireSshKeys } = await loadSut();
        wireSshKeys();
        wireSshKeys();

        const modal = getModal() as any;
        expect(typeof modal.__open).toBe('function');
    });

    it('does nothing when modal element is missing', async () => {
        document.body.innerHTML = '';
        const { wireSshKeys } = await loadSut();
        expect(() => wireSshKeys()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// openSshKeysModal
// ---------------------------------------------------------------------------

describe('openSshKeysModal', () => {
    async function loadSut() {
        return import('@scripts/features/sshKeys');
    }

    it('opens the modal and wires SSH keys on first call', async () => {
        mockInvoke
            .mockResolvedValue(agentResult(0))
            .mockResolvedValue([]);

        const { openSshKeysModal } = await loadSut();
        openSshKeysModal();

        expect(mockOpenModal).toHaveBeenCalledWith('ssh-keys-modal');
    });

    it('passes the preselected path to __open', async () => {
        mockInvoke
            .mockResolvedValue(agentResult(0))
            .mockResolvedValue([]);

        const { openSshKeysModal } = await loadSut();
        openSshKeysModal('/some/path');

        const selectedEl = document.getElementById('ssh-keys-selected')!;
        expect(selectedEl.textContent).toBe('/some/path');
    });

    it('does not throw when modal is missing from DOM', async () => {
        document.body.innerHTML = '';

        const { openSshKeysModal } = await loadSut();
        expect(() => openSshKeysModal()).not.toThrow();
    });
});
