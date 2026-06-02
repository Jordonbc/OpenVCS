// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }));

type ListenerCallback = (evt: { payload: unknown }) => void;
type TauriInvoke = <T = unknown>(cmd: string, args?: unknown) => Promise<T>;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  document.body.innerHTML = `
    <div id="status"></div>
    <div id="update-modal" aria-hidden="true">
      <button id="update-install" type="button">Install</button>
      <div id="update-version"></div>
      <div id="update-notes"></div>
    </div>
  `;
});

describe('wireUpdate', () => {
  it('shows the updater progress on the install button', async () => {
    let listenCallback: ListenerCallback | undefined;
    let resolveInstall: (() => void) | undefined;
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'updater_install_now') {
        return new Promise<void>((resolve) => {
          resolveInstall = resolve;
        });
      }

      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: true,
          version: '0.3.1-nightly.269',
          current_version: '0.3.1-nightly.268',
          body: 'Changes',
          date: '2026-05-05',
        });
      }

      return Promise.resolve(undefined);
    });
    const invoke = invokeMock as unknown as TauriInvoke;

    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke,
      },
      event: {
        listen: vi.fn((_event: string, cb: ListenerCallback) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();

    await Promise.resolve();
    expect(listenCallback).toBeDefined();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    const status = document.getElementById('status') as HTMLDivElement;
    button.click();

    expect(button.textContent).toBe('Downloading…');
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe('Downloading update…');
    expect(status.classList.contains('busy')).toBe(true);

    listenCallback?.({ payload: { kind: 'progress', received: 73, total: 100 } });
    expect(button.textContent).toBe('Downloading…73%');
    expect(status.textContent).toBe('Downloading update…');

    listenCallback?.({ payload: { kind: 'downloaded' } });
    expect(button.textContent).toBe('Installing');
    expect(status.textContent).toBe('Installing update…');

    resolveInstall?.();
    await Promise.resolve();

    expect(button.textContent).toBe('Done, please restart');
    expect(button.disabled).toBe(true);
    expect(status.classList.contains('busy')).toBe(false);
  });

  it('handles install failure by resetting to idle', async () => {
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'updater_install_now') return Promise.reject(new Error('install failed'));
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(button.textContent).toBe('Install');
    expect(button.disabled).toBe(false);
  });

  it('shows idle state initially', async () => {
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    expect(button.textContent).toBe('Install');
    expect(button.disabled).toBe(false);
  });

  it('handles missing modal gracefully', async () => {
    document.body.innerHTML = '<div id="status"></div>';
    const update = await import('@scripts/features/update');
    expect(() => update.wireUpdate()).not.toThrow();
  });
});

describe('showUpdateDialog', () => {
  it('shows update modal when update is available', async () => {
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: true,
          version: '1.0.0',
          current_version: '0.9.0',
          body: 'Release notes',
          date: '2026-01-01',
        });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    const openModalSpy = vi.spyOn(await import('@scripts/ui/modals'), 'openModal');

    await update.showUpdateDialog({});
    expect(openModalSpy).toHaveBeenCalledWith('update-modal');

    const verEl = document.getElementById('update-version') as HTMLElement;
    expect(verEl.textContent).toBe('Version 1.0.0');
    const notesEl = document.getElementById('update-notes') as HTMLElement;
    expect(notesEl.textContent).toBe('Release notes');
  });

  it('notifies user when already up to date', async () => {
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: false,
          version: null,
          current_version: '1.0.0',
          body: null,
          date: null,
        });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    await update.showUpdateDialog({});
    const { notify } = await import('@scripts/lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Already up to date');
  });

  it('handles get_update_status failure', async () => {
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') return Promise.reject(new Error('network error'));
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    await update.showUpdateDialog({});
    const { notify } = await import('@scripts/lib/notify');
    expect(vi.mocked(notify)).toHaveBeenCalledWith('Update check failed');
  });

  it('shows version placeholder when no version available', async () => {
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: true,
          version: null,
          current_version: '1.0.0',
          body: null,
          date: null,
        });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    await update.showUpdateDialog({});
    const verEl = document.getElementById('update-version') as HTMLElement;
    expect(verEl.textContent).toBe('Update available');
    const notesEl = document.getElementById('update-notes') as HTMLElement;
    expect(notesEl.textContent).toBe('(No changelog provided)');
  });
});

describe('wireUpdate button state transitions', () => {
  it('transitions through all install phases via button click', async () => {
    let resolveInstall: (() => void) | undefined;
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'updater_install_now') {
        return new Promise<void>((resolve) => { resolveInstall = resolve; });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    const status = document.getElementById('status') as HTMLElement;

    // Initially idle
    expect(button.textContent).toBe('Install');
    expect(button.disabled).toBe(false);

    // Click to start download
    button.click();
    expect(button.textContent).toBe('Downloading…');
    expect(button.disabled).toBe(true);
    expect(status.classList.contains('busy')).toBe(true);

    // Complete the install
    resolveInstall?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(button.textContent).toBe('Done, please restart');
    expect(button.disabled).toBe(true);
    expect(status.classList.contains('busy')).toBe(false);
  });
});

describe('ensureUpdateProgressListener', () => {
  it('does not start listener twice', async () => {
    let listenCalls = 0;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn(async () => { listenCalls++; return { unlisten: vi.fn() }; }) },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await new Promise((r) => setTimeout(r, 0));
    const initialCount = listenCalls;

    update.wireUpdate();
    expect(listenCalls).toBe(initialCount);
  });

  it('handles progress events correctly', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();

    // progress during downloading
    listenCallback?.({ payload: { kind: 'progress', received: 30, total: 100 } });
    expect(button.textContent).toBe('Downloading…30%');

    // downloaded completes
    listenCallback?.({ payload: { kind: 'downloaded' } });
    expect(button.textContent).toBe('Installing');
  });

  it('handles progress with zero total', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };
    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();

    // progress with zero/invalid total should show generic downloading text
    listenCallback?.({ payload: { kind: 'progress', received: 0, total: 0 } });
    expect(button.textContent).toBe('Downloading…');
  });
});

describe('ensureUpdateProgressListener rejects', () => {
  it('handles listener registration failure', async () => {
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn(() => Promise.reject(new Error('listen failed'))),
      },
    };
    const update = await import('@scripts/features/update');
    // Should not throw - errors are caught
    expect(() => update.wireUpdate()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('missing UI elements', () => {
  it('handles missing status element', async () => {
    document.body.innerHTML = '<div id="update-modal"><button id="update-install">Install</button></div>';
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };
    const update = await import('@scripts/features/update');
    update.wireUpdate();
    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('handles missing update-install button gracefully', async () => {
    document.body.innerHTML = '<div id="update-modal"><div id="update-version"></div></div>';
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };
    const update = await import('@scripts/features/update');
    expect(() => update.wireUpdate()).not.toThrow();
  });
});

// ===========================================================================
// Branch coverage: ensureUpdateProgressListener phase checks (lines 103-109)
// ===========================================================================
describe('ensureUpdateProgressListener phase checks', () => {
  it('handles progress event while installPhase is idle', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    expect(button.textContent).toBe('Install');

    // Send progress while phase is still idle (before button click)
    listenCallback?.({ payload: { kind: 'progress', received: 50, total: 100 } });
    expect(button.textContent).toBe('Downloading…50%');
  });

  it('ignores progress event while installPhase is installing', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    let resolveInstall: (() => void) | undefined;
    const invokeMock: TauriInvoke = vi.fn((cmd: string) => {
      if (cmd === 'updater_install_now') return new Promise<void>((r) => { resolveInstall = r; });
      return Promise.resolve(undefined);
    }) as unknown as TauriInvoke;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();

    // Simulate downloaded to move to installing phase
    listenCallback?.({ payload: { kind: 'downloaded' } });
    expect(button.textContent).toBe('Installing');

    // Progress while installing should be ignored
    listenCallback?.({ payload: { kind: 'progress', received: 80, total: 100 } });
    expect(button.textContent).toBe('Installing');

    // Complete the install
    resolveInstall?.();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('ignores progress event while installPhase is done', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    let resolveInstall: (() => void) | undefined;
    const invokeMock: TauriInvoke = vi.fn((cmd: string) => {
      if (cmd === 'updater_install_now') return new Promise<void>((r) => { resolveInstall = r; });
      return Promise.resolve(undefined);
    }) as unknown as TauriInvoke;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();
    listenCallback?.({ payload: { kind: 'downloaded' } });

    // Complete the install to reach 'done' phase
    resolveInstall?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(button.textContent).toBe('Done, please restart');

    // Progress while done should be ignored (button stays at done)
    listenCallback?.({ payload: { kind: 'progress', received: 90, total: 100 } });
    expect(button.textContent).toBe('Done, please restart');
  });

  it('handles payload with unknown kind (neither progress nor downloaded)', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    expect(button.textContent).toBe('Install');

    // Unknown kind should be ignored without error
    listenCallback?.({ payload: { kind: 'unknown_event' } });
    expect(button.textContent).toBe('Install');

    // Followed by valid progress still works
    listenCallback?.({ payload: { kind: 'progress', received: 10, total: 100 } });
    expect(button.textContent).toBe('Downloading…10%');
  });

  it('handles null payload gracefully', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    // Null/undefined payload should not crash
    listenCallback?.({ payload: null });
    listenCallback?.({ payload: undefined });
  });
});

// ===========================================================================
// Branch coverage: showUpdateDialog with missing elements (lines 154, 160)
// ===========================================================================
describe('showUpdateDialog missing elements', () => {
  it('handles missing modal element after openModal (line 154)', async () => {
    // Remove update-modal so getElementById returns null on line 153
    document.body.innerHTML = '<div id="status"></div>';
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: true,
          version: '1.0.0',
          current_version: '0.9.0',
          body: 'Release notes',
          date: '2026-01-01',
        });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    await expect(update.showUpdateDialog({})).resolves.toBeUndefined();
  });

  it('handles missing update-notes element (line 160)', async () => {
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="update-modal" aria-hidden="true">
        <button id="update-install" type="button">Install</button>
        <div id="update-version"></div>
      </div>
    `;
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: true,
          version: '1.0.0',
          current_version: '0.9.0',
          body: 'Release notes',
          date: '2026-01-01',
        });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };
    const { openModal } = await import('@scripts/ui/modals');
    vi.spyOn(await import('@scripts/ui/modals'), 'openModal');

    const update = await import('@scripts/features/update');
    await expect(update.showUpdateDialog({})).resolves.toBeUndefined();
    const verEl = document.getElementById('update-version') as HTMLElement;
    expect(verEl.textContent).toBe('Version 1.0.0');
  });

  it('shows fallback text when notesEl exists but body is empty string', async () => {
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'get_update_status') {
        return Promise.resolve({
          available: true,
          version: '2.0.0',
          current_version: '1.0.0',
          body: '',
          date: '2026-06-01',
        });
      }
      return Promise.resolve(undefined);
    });
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock as unknown as TauriInvoke },
      event: { listen: vi.fn(async () => ({ unlisten: vi.fn() })) },
    };

    const update = await import('@scripts/features/update');
    await update.showUpdateDialog({});
    const notesEl = document.getElementById('update-notes') as HTMLElement;
    expect(notesEl.textContent).toBe('(No changelog provided)');
  });
});

// ===========================================================================
// Branch coverage: formatDownloadingLabel edge cases
// ===========================================================================
describe('formatDownloadingLabel edge cases', () => {
  it('handles negative total in progress', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();

    // Negative total → formatDownloadingLabel returns 'Downloading…'
    listenCallback?.({ payload: { kind: 'progress', received: 30, total: -1 } });
    expect(button.textContent).toBe('Downloading…');
  });

  it('handles NaN/undefined received in progress', async () => {
    let listenCallback: ((evt: { payload: unknown }) => void) | undefined;
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: vi.fn((_event: string, cb: (evt: { payload: unknown }) => void) => {
          listenCallback = cb;
          return Promise.resolve({ unlisten: vi.fn() });
        }),
      },
    };

    const update = await import('@scripts/features/update');
    update.wireUpdate();
    await Promise.resolve();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();

    // Undefined received/total → generic Downloading…
    listenCallback?.({ payload: { kind: 'progress' } });
    expect(button.textContent).toBe('Downloading…');
  });
});
