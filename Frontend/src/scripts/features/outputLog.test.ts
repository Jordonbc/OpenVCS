// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockInitOverlayScrollbarsFor = vi.fn();
const mockRefreshOverlayScrollbarsFor = vi.fn();

vi.mock('../lib/tauri', () => ({
  TAURI: { invoke: mockInvoke, listen: vi.fn() },
}));

vi.mock('../lib/notify', () => ({
  notify: mockNotify,
}));

vi.mock('../lib/scrollbars', () => ({
  initOverlayScrollbarsFor: mockInitOverlayScrollbarsFor,
  refreshOverlayScrollbarsFor: mockRefreshOverlayScrollbarsFor,
}));

function mockLocation(qs: string) {
  const url = new URL(`http://localhost:3000/${qs.replace(/^\?/, '') ? `?${qs.replace(/^\?/, '')}` : ''}`);
  Object.defineProperty(window, 'location', {
    value: url,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockInvoke.mockReset();
  mockNotify.mockReset();
  mockInitOverlayScrollbarsFor.mockReset();
  mockRefreshOverlayScrollbarsFor.mockReset();
  document.body.innerHTML = '<div id="app"></div>';
  mockLocation('');
});

describe('initOutputLogViewIfRequested', () => {
  it('returns false when view param is not output-log', async () => {
    const { initOutputLogViewIfRequested } = await import('./outputLog');
    const result = await initOutputLogViewIfRequested();
    expect(result).toBe(false);
  });

  it('returns true and creates output log view', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    const result = await initOutputLogViewIfRequested();

    expect(result).toBe(true);
    expect(document.getElementById('output-log-view')).not.toBeNull();
    expect(document.getElementById('outlog-list-vcs')).not.toBeNull();
    expect(document.getElementById('outlog-list-app')).not.toBeNull();
    expect(document.getElementById('outlog-autoscroll')).not.toBeNull();
    expect(document.getElementById('outlog-clear')).not.toBeNull();
    expect(mockInitOverlayScrollbarsFor).toHaveBeenCalled();
    expect(mockRefreshOverlayScrollbarsFor).toHaveBeenCalled();
  });

  it('hides #app when view is output-log', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const app = document.getElementById('app') as HTMLElement;
    expect(app.style.display).toBe('none');
  });

  it('appends initial VCS entries', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([
      { ts_ms: 1000, level: 'info', source: 'git', message: 'pull done' },
    ]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const list = document.getElementById('outlog-list-vcs')!;
    expect(list.children.length).toBe(1);
    expect(list.textContent).toContain('pull done');
  });

  it('handles get_output_log rejection gracefully', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await expect(initOutputLogViewIfRequested()).resolves.toBe(true);
  });

  it('clear button clears VCS log and invokes clear_output_log', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([
      { ts_ms: 1000, level: 'info', source: 'git', message: 'entry' },
    ]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const clearBtn = document.getElementById('outlog-clear') as HTMLButtonElement;
    clearBtn.click();

    expect(mockInvoke).toHaveBeenCalledWith('clear_output_log');
    const list = document.getElementById('outlog-list-vcs')!;
    expect(list.children.length).toBe(0);
  });

  it('clear button for app tab invokes clear_app_log', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const appTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;
    appTab.click();

    mockInvoke.mockClear();
    const clearBtn = document.getElementById('outlog-clear') as HTMLButtonElement;
    clearBtn.click();

    expect(mockInvoke).toHaveBeenCalledWith('clear_app_log');
  });

  it('handles clear rejection gracefully', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const clearBtn = document.getElementById('outlog-clear') as HTMLButtonElement;
    clearBtn.click();

    await vi.waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith('Failed to clear output log');
    });
  });

  it('tab switching changes active tab and syncs visibility', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const root = document.getElementById('output-log-view')!;
    expect(root.dataset.activeTab).toBe('vcs');
    expect(document.getElementById('outlog-list-vcs')!.classList.contains('outlog-hidden')).toBe(false);
    expect(document.getElementById('outlog-list-app')!.classList.contains('outlog-hidden')).toBe(true);

    const appTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;
    appTab.click();

    expect(root.dataset.activeTab).toBe('app');
    expect(document.getElementById('outlog-list-vcs')!.classList.contains('outlog-hidden')).toBe(true);
    expect(document.getElementById('outlog-list-app')!.classList.contains('outlog-hidden')).toBe(false);
  });

  it('autoscroll checkbox when unchecked prevents auto-scroll', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const auto = document.getElementById('outlog-autoscroll') as HTMLInputElement;
    auto.checked = false;

    const vcsTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="vcs"]')!;
    vcsTab.click();

    expect(mockRefreshOverlayScrollbarsFor).toHaveBeenCalled();
  });

  it('starts app polling and stops on tab switch back to vcs', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('./outputLog');
    await initOutputLogViewIfRequested();

    const appTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;
    appTab.click();

    expect(mockInvoke).toHaveBeenCalledWith('tail_app_log', { maxLines: 1500 });

    const vcsTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="vcs"]')!;
    vcsTab.click();

    vi.advanceTimersByTime(2000);
  });
});
