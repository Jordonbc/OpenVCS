// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GlobalSettings } from '../types';

/** Default commit hint for new files. */
export const DEFAULT_COMMIT_MESSAGE_CREATE = 'Create {file:name}';

/** Default commit hint for modified files. */
export const DEFAULT_COMMIT_MESSAGE_UPDATE = 'Update {file:name}';

/** Default commit hint for deleted files. */
export const DEFAULT_COMMIT_MESSAGE_DELETE = 'Delete {file:name}';

/** Collects commit-specific settings from the settings modal. */
export function collectCommitSettings(root: HTMLElement): GlobalSettings['commit'] {
  const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

  return {
    commit_message_template_enabled: !!get<HTMLInputElement>('#set-commit-message-template-enabled')?.checked,
    restrict_commit_summary: !!get<HTMLInputElement>('#set-restrict-commit-summary')?.checked,
  };
}

/** Collects commit template settings from the settings modal. */
export function collectCommitTemplateSettings(root: HTMLElement): NonNullable<NonNullable<GlobalSettings['commit']>['commit_templates']> {
  const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

  return {
    commit_message_template_create: get<HTMLInputElement>('#set-commit-message-template-create')?.value || '',
    commit_message_template_update: get<HTMLInputElement>('#set-commit-message-template-update')?.value || '',
    commit_message_template_delete: get<HTMLInputElement>('#set-commit-message-template-delete')?.value || '',
  };
}

/** Loads commit-specific settings into the settings modal form controls. */
export function loadCommitSettingsIntoForm(root: HTMLElement, cfg: GlobalSettings): void {
  const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const elEnabled = get<HTMLInputElement>('#set-commit-message-template-enabled');
  if (elEnabled) elEnabled.checked = cfg.commit?.commit_message_template_enabled !== false;
  const elRestrict = get<HTMLInputElement>('#set-restrict-commit-summary');
  if (elRestrict) elRestrict.checked = cfg.commit?.restrict_commit_summary !== false;
  const elCreate = get<HTMLInputElement>('#set-commit-message-template-create');
  if (elCreate) elCreate.value = cfg.commit?.commit_templates?.commit_message_template_create ?? DEFAULT_COMMIT_MESSAGE_CREATE;
  const elUpdate = get<HTMLInputElement>('#set-commit-message-template-update');
  if (elUpdate) elUpdate.value = cfg.commit?.commit_templates?.commit_message_template_update ?? DEFAULT_COMMIT_MESSAGE_UPDATE;
  const elDelete = get<HTMLInputElement>('#set-commit-message-template-delete');
  if (elDelete) elDelete.value = cfg.commit?.commit_templates?.commit_message_template_delete ?? DEFAULT_COMMIT_MESSAGE_DELETE;
}
