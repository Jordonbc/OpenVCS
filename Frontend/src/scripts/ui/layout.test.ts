// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { applyCommitSummaryRestriction } from './layout';

describe('applyCommitSummaryRestriction', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="commit-summary" />';
  });

  it('caps the summary input at 72 characters when enabled', () => {
    const input = document.getElementById('commit-summary') as HTMLInputElement;
    input.value = 'x'.repeat(80);

    applyCommitSummaryRestriction(true);

    expect(input.getAttribute('maxlength')).toBe('72');
    expect(input.value).toHaveLength(72);
  });

  it('removes the cap when disabled', () => {
    const input = document.getElementById('commit-summary') as HTMLInputElement;

    applyCommitSummaryRestriction(false);

    expect(input.hasAttribute('maxlength')).toBe(false);
  });
});
