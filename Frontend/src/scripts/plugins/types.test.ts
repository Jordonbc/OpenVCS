// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

describe('plugins/types (type-only module)', () => {
  it('exports no runtime code at module level', async () => {
    const mod = await import('./types');
    const keys = Object.keys(mod);
    expect(keys.length).toBe(0);
  });
});
