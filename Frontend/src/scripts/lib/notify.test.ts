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
});
