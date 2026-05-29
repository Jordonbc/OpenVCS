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

  it('suppresses hint when template feature is disabled', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: false,
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

    expect(summary.placeholder).toBe('Summary (required)');
  });

  it('does not truncate when commit summary restriction is disabled', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: false,
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

    expect(summary.placeholder).toBe('Update test.cpp with extra detail beyond seventy two characters and more text for truncation');
    expect(summary.placeholder).not.toContain('...');
  });

  it('suppresses hint when multiple files are selected', async () => {
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
    state.files = [
      { path: 'src/test.cpp', status: 'M' } as FileStatus,
      { path: 'src/other.cpp', status: 'A' } as FileStatus,
    ];
    state.selectedFiles = new Set(['src/test.cpp', 'src/other.cpp']);
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Summary (required)');
  });

  it('expands file path placeholder', async () => {
    const { updateCommitButton } = await import('./commit');

    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:path}',
          commit_message_template_update: 'Update {file:path}',
          commit_message_template_delete: 'Delete {file:path}',
        },
      },
    });
    state.files = [{ path: 'src/deep/test.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/deep/test.cpp']);
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Update src/deep/test.cpp');
  });

  it('selects templates by status branch', async () => {
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
    const cases: Array<[FileStatus['status'], string]> = [
      ['A', 'Create test.cpp'],
      ['D', 'Delete test.cpp'],
      ['?', 'Create test.cpp'],
      ['??', 'Create test.cpp'],
      ['M', 'Update test.cpp'],
    ];

    for (const [status, expected] of cases) {
      state.files = [{ path: 'src/test.cpp', status } as FileStatus];
      state.selectedFiles = new Set(['src/test.cpp']);
      updateCommitButton();
      expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe(expected);
    }
  });

  it('keeps commit disabled without repo or changes', async () => {
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
    state.hasRepo = false;
    state.files = [];
    state.selectedFiles = new Set(['src/test.cpp']);
    const summary = document.getElementById('commit-summary') as HTMLInputElement;

    updateCommitButton();

    expect(summary.placeholder).toBe('Update test.cpp');
    expect((document.getElementById('commit-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables commit button when only hunks are selected without files', async () => {
    const { updateCommitButton } = await import('./commit');
    state.hasRepo = true;
    state.files = [{ path: 'a.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();
    state.selectedHunksByFile = { 'a.txt': [0] };
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'Fix';

    updateCommitButton();
    expect((document.getElementById('commit-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows delete hint for one file with D status', async () => {
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
    state.hasRepo = true;
    state.files = [{ path: 'removed.txt', status: 'D' } as FileStatus];
    state.selectedFiles = new Set(['removed.txt']);

    updateCommitButton();
    expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe('Delete removed.txt');
  });

  it('skips empty paths when determining selected commit file', async () => {
    const { updateCommitButton } = await import('./commit');
    state.hasRepo = true;
    state.files = [{ path: 'real.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['', '  ', 'real.txt']);

    updateCommitButton();
    expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe('Update real.txt');
  });

  it('enables commit button when only line selections exist', async () => {
    const { updateCommitButton } = await import('./commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();
    state.selectedLinesByFile = { 'file.txt': { 0: [1, 2] } };
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();
    expect((document.getElementById('commit-btn') as HTMLButtonElement).disabled).toBe(false);
  });
});
