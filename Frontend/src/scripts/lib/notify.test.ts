// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Mounts the status bar before importing notify. */
function mountStatusBar() {
  document.body.innerHTML = '<div id="status">Ready</div>';
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mountStatusBar();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('notify', () => {
  it('updates status text and restores Ready later', async () => {
    const { notify } = await import('./notify');
    const status = document.getElementById('status') as HTMLElement;

    notify('Saving changes');
    expect(status.textContent).toBe('Saving changes');

    vi.advanceTimersByTime(2200);
    expect(status.textContent).toBe('Ready');
  });

  it('does not restore Ready while status is busy', async () => {
    const { notify } = await import('./notify');
    const status = document.getElementById('status') as HTMLElement;

    status.classList.add('busy');
    notify('Downloading update\u2026');
    expect(status.textContent).toBe('Downloading update\u2026');

    vi.advanceTimersByTime(2200);
    expect(status.textContent).toBe('Downloading update\u2026');
  });

  it('does not reset to Ready when text content was changed before timeout', async () => {
    const { notify } = await import('./notify');
    const status = document.getElementById('status') as HTMLElement;

    notify('First message');
    expect(status.textContent).toBe('First message');

    status.textContent = 'Second message';

    vi.advanceTimersByTime(2200);
    expect(status.textContent).toBe('Second message');
  });

  it('returns early when status element is missing', async () => {
    document.body.innerHTML = '';
    vi.resetModules();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { notify } = await import('./notify');
    notify('hidden message');

    expect(consoleSpy).toHaveBeenCalledWith('[notify] hidden message');
    expect(document.getElementById('status')).toBeNull();
  });
});
