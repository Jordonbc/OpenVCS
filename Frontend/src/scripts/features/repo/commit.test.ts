// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { state, setGlobalSettings } from '../../state/state';
import type { FileStatus } from '../../types';

/** Mounts the minimal DOM touched by commit button refresh. */
function mountCommitDom() {
  document.body.innerHTML = `
    <input id="commit-summary" />
    <button id="commit-btn"></button>
  `;
}

describe('updateCommitButton', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.selectedHunks = [];
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.files = [];
    setGlobalSettings(null);
  });

  it('shows create hint for one selected file', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:name}',
          commit_message_template_update: 'Update {file:name}',
          commit_message_template_delete: 'Delete {file:name}',
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: '?' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.value).toBe('');
    expect(summary.placeholder).toBe('Create test.cpp');
  });

  it('uses hint when summary box empty on commit', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:name}',
          commit_message_template_update: 'Update {file:name}',
          commit_message_template_delete: 'Delete {file:name}',
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Update test.cpp');
    expect(summary.value).toBe('');
  });

  it('shows hint for one partially selected file', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:name}',
          commit_message_template_update: 'Update {file:name}',
          commit_message_template_delete: 'Delete {file:name}',
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: 'M' } as FileStatus];
    state.selectedHunksByFile = { 'src/test.cpp': [0] };
    state.selectedLinesByFile = { 'src/test.cpp': { 0: [1] } };
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Update test.cpp');
    expect(summary.value).toBe('');
  });

  it('clears hint when nothing selected', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:name}',
          commit_message_template_update: 'Update {file:name}',
          commit_message_template_delete: 'Delete {file:name}',
        },
      },
    });
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Summary (required)');
    expect(summary.value).toBe('');
  });

  it('truncates overlong hints when summary cap is enabled', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:name}',
          commit_message_template_update: 'Update {file:name} with extra detail beyond seventy two characters and more text for truncation',
          commit_message_template_delete: 'Delete {file:name}',
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toHaveLength(72);
    expect(summary.placeholder.endsWith('...')).toBe(true);
    expect(summary.placeholder.startsWith('Update test.cpp with extra detail beyond seventy two')).toBe(true);
  });

  it('does not fall back to default for empty template strings', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: '',
          commit_message_template_update: '',
          commit_message_template_delete: '',
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Summary (required)');
  });
});
