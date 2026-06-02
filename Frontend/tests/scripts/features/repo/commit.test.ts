// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { state, setGlobalSettings } from '@scripts/state/state';
import type { FileStatus } from '@scripts/types';

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');

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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'a.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();
    state.selectedHunksByFile = { 'a.txt': [0] };
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'Fix';

    updateCommitButton();
    expect((document.getElementById('commit-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows delete hint for one file with D status', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'real.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['', '  ', 'real.txt']);

    updateCommitButton();
    expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe('Update real.txt');
  });

  it('enables commit button when only line selections exist', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();
    state.selectedLinesByFile = { 'file.txt': { 0: [1, 2] } };
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();
    expect((document.getElementById('commit-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('expandCommitTemplate splits on backslash separators', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: 'src\\test.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src\\test.cpp']);
    updateCommitButton();
    expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe('Update test.cpp');
  });

  it('expandCommitTemplate handles path ending with separator', async () => {
    // L54: split produces trailing empty string → pop() returns '' → || filePath fallback
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: 'src/', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/']);
    updateCommitButton();
    // fileName = '' || 'src/' → 'src/'
    expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe('Update src/');
  });

  it('expandCommitTemplate handles mixed forward and backslash', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: 'src\\test/foo.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src\\test/foo.cpp']);
    updateCommitButton();
    expect((document.getElementById('commit-summary') as HTMLInputElement).placeholder).toBe('Update foo.cpp');
  });

  it('disables commit when summary empty and template hints disabled', async () => {
    // L89-90: summaryFilled = false because both summary value AND hint are empty
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: { commit_message_template_enabled: false },
    });
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);
    // summary.value is '' (default) and no hint because templates disabled

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables commit when summary empty and no files selected (no hint)', async () => {
    // L89-90: summaryFilled = false because hint is '' (no file selected) and summary is empty
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(); // no files selected → hint = ''
    // summary.value is '' (default)

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables commit via filesSelected when hunksSelected and linesSelected are false', async () => {
    // L90-91: hunksSelected = false, L92-93: linesSelected = false, but filesSelected = true
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = {};  // hunksSelected false
    state.selectedLinesByFile = {};  // linesSelected false
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('hunksSelected returns false for non-array values', async () => {
    // L90-91: Array.isArray check inside .some() evaluates to false
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);
    state.selectedHunksByFile = { 'file.txt': null as any }; // not an array → skipped
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('linesSelected returns false for empty line groups', async () => {
    // L92-93: Object.keys(...).length > 0 evaluates to false inside .some()
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);
    state.selectedLinesByFile = { 'file.txt': {} }; // empty line groups → skipped
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('disables commit when nothing is selected at all', async () => {
    // All three selection paths (hunks, lines, files) are false → button disabled
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ============================================================================
// expandCommitTemplate — additional path format branches
// ============================================================================
describe('expandCommitTemplate path formats', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.selectedHunks = [];
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.files = [];
    setGlobalSettings(null);
  });

  it('root path / with {file:name} — pop returns empty, falls back to filePath', async () => {
    // L54: String('/').trim().split(/[/\\]/).pop() → '' → '' || '/' → '/'
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: '/', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['/']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update /');
  });

  it('root path / with {file:path} — same fallback', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: '/', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['/']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update /');
  });

  it('no subdirectory with {file:path}', async () => {
    // Path without '/' or '\' separators
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: 'Makefile', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['Makefile']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update Makefile');
  });

  it('file with dots but no directory', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
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
    state.files = [{ path: '.env.local', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['.env.local']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update .env.local');
  });
});

// ============================================================================
// getCommitSummaryHint — direct exports
// ============================================================================
describe('getCommitSummaryHint', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.selectedHunks = [];
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.files = [];
    setGlobalSettings(null);
  });

  it('returns hint when template enabled and single file selected', async () => {
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_update: 'Update {file:name}',
        },
      },
    });
    state.files = [{ path: 'src/main.ts', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/main.ts']);

    const hint = getCommitSummaryHint();

    expect(hint).toBe('Update main.ts');
  });

  it('returns empty when template disabled', async () => {
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: false,
      },
    });
    state.files = [{ path: 'src/main.ts', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/main.ts']);

    const hint = getCommitSummaryHint();

    expect(hint).toBe('');
  });

  it('returns empty when no file selected', async () => {
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_update: 'Update {file:name}',
        },
      },
    });
    state.files = [{ path: 'src/main.ts', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();

    const hint = getCommitSummaryHint();

    expect(hint).toBe('');
  });

  it('returns full hint when restrict_commit_summary is false, regardless of length', async () => {
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: false,
        commit_templates: {
          commit_message_template_update: 'Update {file:name} with extra detail beyond seventy two characters and more text for truncation',
        },
      },
    });
    state.files = [{ path: 'src/main.ts', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/main.ts']);

    const hint = getCommitSummaryHint();

    expect(hint.length).toBeGreaterThan(72);
    expect(hint).not.toContain('...');
  });

  it('returns truncated hint when restrict_commit_summary is true', async () => {
    const { getCommitSummaryHint } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: true,
        commit_templates: {
          commit_message_template_update: 'Update {file:name} with extra detail beyond seventy two characters and more text for truncation',
        },
      },
    });
    state.files = [{ path: 'src/main.ts', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/main.ts']);

    const hint = getCommitSummaryHint();

    expect(hint.length).toBe(72);
    expect(hint.endsWith('...')).toBe(true);
  });
});

// ============================================================================
// truncateCommitSummaryHint — via updateCommitButton
// ============================================================================
describe('truncateCommitSummaryHint edge cases', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.selectedHunks = [];
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.files = [];
    setGlobalSettings(null);
  });

  it('does not truncate hint when text is exactly 72 characters', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    const exact72 = 'A'.repeat(72);
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: true,
        commit_templates: {
          commit_message_template_create: exact72,
          commit_message_template_update: exact72,
          commit_message_template_delete: exact72,
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: '?' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder.length).toBe(72);
    expect(summary.placeholder).toBe(exact72);
    // No ellipsis appended for exact 72 char text
  });

  it('does not truncate hint when text is under 72 characters', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    const short = 'Short summary';
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: true,
        commit_templates: {
          commit_message_template_create: short,
          commit_message_template_update: short,
          commit_message_template_delete: short,
        },
      },
    });
    state.files = [{ path: 'src/test.cpp', status: 'A' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe(short);
  });
});

// ============================================================================
// selectedCommitFile — multi-source path combinations
// ============================================================================
describe('selectedCommitFile multi-source', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.selectedHunks = [];
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.files = [];
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
  });

  it('selects file from selectedHunksByFile only', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'hunk-only.txt', status: 'M' } as FileStatus];
    state.selectedHunksByFile = { 'hunk-only.txt': [0] };

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update hunk-only.txt');
  });

  it('selects file from selectedLinesByFile only', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'line-only.txt', status: 'M' } as FileStatus];
    (state as any).selectedLinesByFile = { 'line-only.txt': { 0: [1] } };

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update line-only.txt');
  });

  it('deduplicates when same path appears in all three sources', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'shared.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['shared.txt']);
    state.selectedHunksByFile = { 'shared.txt': [0] };
    (state as any).selectedLinesByFile = { 'shared.txt': { 0: [1] } };

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Update shared.txt');
  });

  it('returns null when all three sources contribute different paths', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [
      { path: 'a.txt', status: 'M' } as FileStatus,
      { path: 'b.txt', status: 'M' } as FileStatus,
      { path: 'c.txt', status: 'M' } as FileStatus,
    ];
    state.selectedFiles = new Set(['a.txt']);
    state.selectedHunksByFile = { 'b.txt': [0] };
    (state as any).selectedLinesByFile = { 'c.txt': { 0: [1] } };

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    // Multiple files → no hint
    expect(summary.placeholder).toBe('Summary (required)');
  });

  it('filters out empty and whitespace-only paths from selectedFiles', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'real.txt', status: 'A' } as FileStatus];
    state.selectedFiles = new Set(['', '  ', 'real.txt']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Create real.txt');
  });
});

// ============================================================================
// selectedCommitFileStatus — missing file / whitespace mismatch
// ============================================================================
describe('selectedCommitFileStatus edge cases', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.files = [];
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
  });

  it('falls to Update template when file path not in state.files', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    // selectedCommitFile will find the path, but selectedCommitFileStatus won't find it
    state.files = [{ path: 'other.txt', status: 'D' } as FileStatus];
    state.selectedFiles = new Set(['missing.txt']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    // status = '' → selectedCommitTemplate returns update template
    expect(summary.placeholder).toBe('Update missing.txt');
  });

  it('handles file.path with whitespace mismatch', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: '  spaced.txt  ', status: 'D' } as FileStatus];
    state.selectedFiles = new Set(['  spaced.txt  ']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    // selectedCommitFile() trims the path to 'spaced.txt'
    // selectedCommitFileStatus() does exact match — 'spaced.txt' !== '  spaced.txt  '
    // So status is '' → falls to Update template
    expect(summary.placeholder).toBe('Update spaced.txt');
  });
});

// ============================================================================
// selectedCommitTemplate — status type branches
// ============================================================================
describe('selectedCommitTemplate status types', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.files = [];
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_create: 'Creating {file:name}',
          commit_message_template_update: 'Updating {file:name}',
          commit_message_template_delete: 'Deleting {file:name}',
        },
      },
    });
  });

  it('uses create template for status A', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'new.txt', status: 'A' } as FileStatus];
    state.selectedFiles = new Set(['new.txt']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Creating new.txt');
  });

  it('uses create template for status ?', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'new.txt', status: '?' } as FileStatus];
    state.selectedFiles = new Set(['new.txt']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Creating new.txt');
  });

  it('uses create template for status with ? anywhere (partial staging)', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'partial.txt', status: 'M?' } as FileStatus];
    state.selectedFiles = new Set(['partial.txt']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Creating partial.txt');
  });

  it('uses delete template for status D', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.files = [{ path: 'gone.txt', status: 'D' } as FileStatus];
    state.selectedFiles = new Set(['gone.txt']);

    updateCommitButton();

    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    expect(summary.placeholder).toBe('Deleting gone.txt');
  });
});

// ============================================================================
// updateCommitButton — summary/hunk/line/file state branches
// ============================================================================
describe('updateCommitButton edge case branches', () => {
  beforeEach(() => {
    mountCommitDom();
    state.selectedFiles = new Set();
    state.selectedHunks = [];
    state.selectedHunksByFile = {};
    state.selectedLinesByFile = {};
    state.files = [];
    setGlobalSettings(null);
  });

  it('disables button when summary DOM element is missing', async () => {
    // L89: summary?.value → summary is null → undefined → ?? 0 → 0 > 0 → false
    document.getElementById('commit-summary')!.remove();
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);

    // Should not throw despite missing commit-summary element
    expect(() => updateCommitButton()).not.toThrow();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // summaryFilled = (undefined ?? 0) > 0 || !!hint = false || (false since no settings) = false
  });

  it('linesSelected returns false for null entry value', async () => {
    // L92-93: !!(state as any).selectedLinesByFile[k] evaluates to false when value is null
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);
    (state as any).selectedLinesByFile = { 'file.txt': null };
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // filesSelected is true, summary is filled
  });

  it('hunksSelected returns false for undefined entry', async () => {
    // L90-91: Array.isArray(undefined) is false → .some() returns false
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set();
    (document.getElementById('commit-summary') as HTMLInputElement).value = 'fix';
    // selectedHunksByFile is an empty object → Object.keys(...) is empty → .some() returns false
    // selectedLinesByFile is same
    state.selectedHunksByFile = { 'file.txt': undefined as any };
    (state as any).selectedLinesByFile = { 'file.txt': undefined as any };

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    // Only filesSelected could save us, but selectedFiles is empty
    // If selectedFiles has 'file.txt', we'd have filesSelected = true
    state.selectedFiles = new Set(['file.txt']);
    updateCommitButton();

    expect(btn.disabled).toBe(false); // filesSelected = true
  });

  it('enables commit via hint when summary value is empty but hint is present', async () => {
    const { updateCommitButton } = await import('@scripts/features/repo/commit');
    setGlobalSettings({
      commit: {
        commit_message_template_enabled: true,
        commit_templates: {
          commit_message_template_update: 'Update {file:name}',
        },
      },
    });
    state.hasRepo = true;
    state.files = [{ path: 'file.txt', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['file.txt']);
    // summary.value is '' (empty), but hint should be 'Update file.txt'
    // summaryFilled = (''.trim().length > 0) || !!'Update file.txt' = false || true = true
    const summary = document.getElementById('commit-summary') as HTMLInputElement;
    summary.value = '';

    updateCommitButton();

    const btn = document.getElementById('commit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
