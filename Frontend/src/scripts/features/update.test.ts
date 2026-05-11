// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    const update = await import('./update');
    update.wireUpdate();

    await Promise.resolve();
    expect(listenCallback).toBeDefined();

    const button = document.getElementById('update-install') as HTMLButtonElement;
    button.click();

    expect(button.textContent).toBe('Downloading…');
    expect(button.disabled).toBe(true);

    listenCallback?.({ payload: { kind: 'progress', received: 73, total: 100 } });
    expect(button.textContent).toBe('Downloading…73%');

    listenCallback?.({ payload: { kind: 'downloaded' } });
    expect(button.textContent).toBe('Installing');

    resolveInstall?.();
    await Promise.resolve();

    expect(button.textContent).toBe('Done, please restart');
    expect(button.disabled).toBe(true);
  });
});
