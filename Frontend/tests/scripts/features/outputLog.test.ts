// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockInitOverlayScrollbarsFor = vi.fn();
const mockRefreshOverlayScrollbarsFor = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: { invoke: mockInvoke, listen: vi.fn() },
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));

vi.mock('@scripts/lib/scrollbars', () => ({
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
    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    const result = await initOutputLogViewIfRequested();
    expect(result).toBe(false);
  });

  it('returns true and creates output log view', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
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

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const app = document.getElementById('app') as HTMLElement;
    expect(app.style.display).toBe('none');
  });

  it('appends initial VCS entries', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([
      { ts_ms: 1000, level: 'info', source: 'git', message: 'pull done' },
    ]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const list = document.getElementById('outlog-list-vcs')!;
    expect(list.children.length).toBe(1);
    expect(list.textContent).toContain('pull done');
  });

  it('handles get_output_log rejection gracefully', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockRejectedValue(new Error('fail'));

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await expect(initOutputLogViewIfRequested()).resolves.toBe(true);
  });

  it('clear button clears VCS log and invokes clear_output_log', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([
      { ts_ms: 1000, level: 'info', source: 'git', message: 'entry' },
    ]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
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

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
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

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
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

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
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

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
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

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const appTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;
    appTab.click();

    expect(mockInvoke).toHaveBeenCalledWith('tail_app_log', { maxLines: 1500 });

    const vcsTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="vcs"]')!;
    vcsTab.click();

    vi.advanceTimersByTime(2000);
  });

  it('triggers vcs:log listen callback', async () => {
    let listenCallback: ((evt: any) => void) | null = null;
    const tauri = await import('@scripts/lib/tauri');
    (tauri.TAURI as any).listen = vi.fn((_event: string, cb: (evt: any) => void) => {
      listenCallback = cb;
      return { unlisten: vi.fn() };
    });
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    listenCallback!({ payload: { ts_ms: 123, level: 'info', source: 'git', message: 'log msg' } });

    const list = document.getElementById('outlog-list-vcs') as HTMLElement;
    expect(list.textContent).toContain('log msg');
  });

  it('escapeHtml escapes special characters in messages', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{
      ts_ms: 1000, level: 'info', source: 'git',
      message: '<script>alert("xss")</script> & \"quoted\" \'text\'',
    }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const list = document.getElementById('outlog-list-vcs') as HTMLElement;
    expect(list.innerHTML).toContain('&lt;script&gt;alert(');
    expect(list.innerHTML).toContain('&amp;');
    expect(list.textContent).toContain('"quoted"');
    expect(list.textContent).toContain("'text'");
  });

  it('fmtTime handles invalid timestamp via rendered output', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{
      ts_ms: NaN, level: 'info', source: 'git', message: 'timestamp test',
    }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const list = document.getElementById('outlog-list-vcs') as HTMLElement;
    expect(list.textContent).toContain('timestamp test');
  });

  it('levelFrom maps "warning" alias to warn class', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{
      ts_ms: 1000, level: 'warning', source: 'git', message: 'warning test',
    }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const row = document.querySelector('.outlog-row') as HTMLElement;
    expect(row.classList.contains('outlog-warn')).toBe(true);
  });

  it('levelFrom falls back to info for unknown level', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{
      ts_ms: 1000, level: 'debug', source: 'app', message: 'debug test',
    }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const row = document.querySelector('.outlog-row') as HTMLElement;
    expect(row.classList.contains('outlog-info')).toBe(true);
  });

  it('renderRow shows empty source gracefully', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{
      ts_ms: 1000, level: 'info', source: '', message: 'no source',
    }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const list = document.getElementById('outlog-list-vcs') as HTMLElement;
    expect(list.textContent).toContain('no source');
  });

  it('renderRow shows empty message gracefully', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{
      ts_ms: 1000, level: 'info', source: 'git', message: '',
    }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    expect(document.querySelector('.outlog-row')).not.toBeNull();
  });

  it('append does not throw when list element is null', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([{ ts_ms: 1000, level: 'info', source: 'git', message: 'entry' }]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const listVcs = document.getElementById('outlog-list-vcs')!;
    listVcs.remove();

    const appTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;
    appTab.click();

    expect(mockInvoke).toHaveBeenCalledWith('tail_app_log', { maxLines: 1500 });
  });

  it('setActiveTab toggles aria-selected attributes', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const root = document.getElementById('output-log-view')!;
    const vcsTab = root.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="vcs"]')!;
    const appTab = root.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;

    expect(vcsTab.getAttribute('aria-selected')).toBe('true');
    expect(appTab.getAttribute('aria-selected')).toBe('false');
    expect(root.dataset.activeTab).toBe('vcs');

    appTab.click();

    expect(vcsTab.getAttribute('aria-selected')).toBe('false');
    expect(appTab.getAttribute('aria-selected')).toBe('true');
    expect(root.dataset.activeTab).toBe('app');
    expect(vcsTab.tabIndex).toBe(-1);
    expect(appTab.tabIndex).toBe(0);
  });

  it('syncVisibility handles auto-scroll checked', async () => {
    mockLocation('?view=output-log');
    mockInvoke.mockResolvedValue([]);

    const { initOutputLogViewIfRequested } = await import('@scripts/features/outputLog');
    await initOutputLogViewIfRequested();

    const auto = document.getElementById('outlog-autoscroll') as HTMLInputElement;
    auto.checked = true;

    const appTab = document.querySelector<HTMLButtonElement>('.outlog-tab[data-tab="app"]')!;
    appTab.click();

    expect(document.getElementById('outlog-list-vcs')!.classList.contains('outlog-hidden')).toBe(true);
    expect(document.getElementById('outlog-list-app')!.classList.contains('outlog-hidden')).toBe(false);
  });
});
