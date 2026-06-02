// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="status">Ready</div>';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('setStatus', () => {
  it('updates the status text', async () => {
    const { setStatus } = await import('@scripts/lib/status');
    setStatus('Working...');
    expect(document.getElementById('status')!.textContent).toBe('Working...');
  });

  it('does nothing when status element is missing', async () => {
    document.body.innerHTML = '';
    vi.resetModules();
    const { setStatus } = await import('@scripts/lib/status');
    expect(() => setStatus('ignored')).not.toThrow();
  });
});
