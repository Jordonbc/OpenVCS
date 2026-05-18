// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { GlobalSettings } from '../types';
import {
  collectCommitSettings,
  collectCommitTemplateSettings,
  loadCommitSettingsIntoForm,
  DEFAULT_COMMIT_MESSAGE_CREATE,
  DEFAULT_COMMIT_MESSAGE_UPDATE,
  DEFAULT_COMMIT_MESSAGE_DELETE,
} from './settingsCommit';

describe('collectCommitSettings', () => {
  it('captures commit template controls from the commit settings panel', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-commit-message-template-enabled" type="checkbox" checked />
        <input id="set-restrict-commit-summary" type="checkbox" checked />
        <input id="set-commit-message-template-create" type="text" value="Create {file:name}" />
        <input id="set-commit-message-template-update" type="text" value="Update {file:name}" />
        <input id="set-commit-message-template-delete" type="text" value="Delete {file:name}" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const commit = collectCommitSettings(root);

    expect(commit?.commit_message_template_enabled).toBe(true);
    expect(commit?.restrict_commit_summary).toBe(true);
  });

  it('captures commit template controls from the commit templates panel', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-commit-message-template-create" type="text" value="Create {file:name}" />
        <input id="set-commit-message-template-update" type="text" value="Update {file:name}" />
        <input id="set-commit-message-template-delete" type="text" value="Delete {file:name}" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const commitTemplates = collectCommitTemplateSettings(root);

    expect(commitTemplates?.commit_message_template_create).toBe('Create {file:name}');
    expect(commitTemplates?.commit_message_template_update).toBe('Update {file:name}');
    expect(commitTemplates?.commit_message_template_delete).toBe('Delete {file:name}');
  });
});

describe('loadCommitSettingsIntoForm', () => {
  it('loads commit template controls into the commit settings panel', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-commit-message-template-enabled" type="checkbox" />
        <input id="set-restrict-commit-summary" type="checkbox" />
        <input id="set-commit-message-template-create" type="text" />
        <input id="set-commit-message-template-update" type="text" />
        <input id="set-commit-message-template-delete" type="text" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    loadCommitSettingsIntoForm(root, {
      commit: {
        commit_message_template_enabled: true,
        restrict_commit_summary: true,
        commit_templates: {
          commit_message_template_create: 'Create {file:name}',
          commit_message_template_update: 'Update {file:name}',
          commit_message_template_delete: 'Delete {file:name}',
        },
      },
    });

    expect((root.querySelector('#set-commit-message-template-enabled') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#set-restrict-commit-summary') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#set-commit-message-template-create') as HTMLInputElement).value).toBe('Create {file:name}');
    expect((root.querySelector('#set-commit-message-template-update') as HTMLInputElement).value).toBe('Update {file:name}');
    expect((root.querySelector('#set-commit-message-template-delete') as HTMLInputElement).value).toBe('Delete {file:name}');
  });

  it('falls back to default template when config is missing', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-commit-message-template-enabled" type="checkbox" />
        <input id="set-commit-message-template-create" type="text" />
        <input id="set-commit-message-template-update" type="text" />
        <input id="set-commit-message-template-delete" type="text" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    loadCommitSettingsIntoForm(root, {} as GlobalSettings);

    expect((root.querySelector('#set-commit-message-template-create') as HTMLInputElement).value).toBe(DEFAULT_COMMIT_MESSAGE_CREATE);
    expect((root.querySelector('#set-commit-message-template-update') as HTMLInputElement).value).toBe(DEFAULT_COMMIT_MESSAGE_UPDATE);
    expect((root.querySelector('#set-commit-message-template-delete') as HTMLInputElement).value).toBe(DEFAULT_COMMIT_MESSAGE_DELETE);
  });
});
