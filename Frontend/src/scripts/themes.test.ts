// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { getAvailableThemes } from './themes';

describe('getAvailableThemes', () => {
  it('returns a copy of the current theme list', () => {
    const first = getAvailableThemes();
    first.pop();

    const second = getAvailableThemes();

    expect(second.length).toBeGreaterThan(first.length);
  });
});
