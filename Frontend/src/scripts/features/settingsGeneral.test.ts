// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { collectGeneralSettings, loadGeneralSettingsIntoForm } from './settingsGeneral';

describe('collectGeneralSettings', () => {
  it('captures the crash report toggle from the general settings panel', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" checked />
        <select id="set-theme"><option value="default" selected>Default</option></select>
        <select id="set-language"><option value="system" selected>System</option></select>
        <select id="set-default-backend"><option value="git" selected>Git</option></select>
        <select id="set-update-channel"><option value="stable" selected>Stable</option></select>
        <input id="set-reopen-last" type="checkbox" checked />
        <input id="set-checks-on-launch" type="checkbox" checked />
        <input id="set-crash-reports" type="checkbox" checked />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const general = collectGeneralSettings(root, {}, () => 'dark');
    expect(general?.crash_reports).toBe(true);
    expect(general?.theme).toBe('system');
  });
});

describe('loadGeneralSettingsIntoForm', () => {
  it('loads the crash report toggle into the general settings panel', async () => {
    document.body.innerHTML = `
      <div>
        <select id="set-language"><option value="system">System</option></select>
        <select id="set-update-channel"><option value="stable">Stable</option></select>
        <input id="set-reopen-last" type="checkbox" />
        <input id="set-checks-on-launch" type="checkbox" />
        <input id="set-crash-reports" type="checkbox" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    await loadGeneralSettingsIntoForm(
      root,
      { general: { language: 'system', update_channel: 'stable', reopen_last_repos: true, checks_on_launch: true, crash_reports: true } },
      (value) => String(value ?? ''),
      refreshDefaultBackendOptions,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(refreshDefaultBackendOptions).toHaveBeenCalledWith(root, expect.any(Object));
    expect((root.querySelector('#set-crash-reports') as HTMLInputElement).checked).toBe(true);
  });
});
