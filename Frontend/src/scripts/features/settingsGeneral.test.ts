// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { collectGeneralSettings, loadGeneralSettingsIntoForm } from './settingsGeneral';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID } from '../themes';

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
        <input id="set-restrict-commit-summary" type="checkbox" checked />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const general = collectGeneralSettings(root, {}, () => 'dark');
    expect(general?.crash_reports).toBe(true);
    expect(general?.restrict_commit_summary).toBe(true);
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
        <input id="set-restrict-commit-summary" type="checkbox" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    await loadGeneralSettingsIntoForm(
      root,
      {
        general: {
          language: 'system',
          update_channel: 'stable',
          reopen_last_repos: true,
          checks_on_launch: true,
          crash_reports: true,
          restrict_commit_summary: true,
        },
      },
      (value) => String(value ?? ''),
      refreshDefaultBackendOptions,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(refreshDefaultBackendOptions).toHaveBeenCalledWith(root, expect.any(Object));
    expect((root.querySelector('#set-crash-reports') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#set-restrict-commit-summary') as HTMLInputElement).checked).toBe(true);
  });

  it('expands the default theme id to the light built-in theme in light mode', async () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="default" selected>Default</option></select>
        <select id="set-language"><option value="system">System</option></select>
        <select id="set-update-channel"><option value="stable">Stable</option></select>
        <input id="set-reopen-last" type="checkbox" />
        <input id="set-checks-on-launch" type="checkbox" />
        <input id="set-crash-reports" type="checkbox" />
        <input id="set-restrict-commit-summary" type="checkbox" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    const rebuildThemePackOptions = vi.fn().mockResolvedValue(undefined);

    await loadGeneralSettingsIntoForm(
      root,
      {
        general: {
          theme: 'light',
          theme_pack: DEFAULT_THEME_ID,
          language: 'system',
          update_channel: 'stable',
          reopen_last_repos: false,
          checks_on_launch: false,
          crash_reports: false,
          restrict_commit_summary: true,
        },
      },
      (value) => String(value ?? ''),
      refreshDefaultBackendOptions,
      rebuildThemePackOptions,
    );

    expect(rebuildThemePackOptions).toHaveBeenCalledWith(expect.any(HTMLSelectElement), {
      desiredId: DEFAULT_LIGHT_THEME_ID,
      forceReload: true,
    });
    expect((root.querySelector('#set-theme') as HTMLSelectElement).disabled).toBe(false);
  });

  it('expands the default theme id to the dark built-in theme in dark mode', async () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="default" selected>Default</option></select>
        <select id="set-language"><option value="system">System</option></select>
        <select id="set-update-channel"><option value="stable">Stable</option></select>
        <input id="set-reopen-last" type="checkbox" />
        <input id="set-checks-on-launch" type="checkbox" />
        <input id="set-crash-reports" type="checkbox" />
        <input id="set-restrict-commit-summary" type="checkbox" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    const rebuildThemePackOptions = vi.fn().mockResolvedValue(undefined);

    await loadGeneralSettingsIntoForm(
      root,
      {
        general: {
          theme: 'dark',
          theme_pack: DEFAULT_THEME_ID,
          language: 'system',
          update_channel: 'stable',
          reopen_last_repos: false,
          checks_on_launch: false,
          crash_reports: false,
          restrict_commit_summary: true,
        },
      },
      (value) => String(value ?? ''),
      refreshDefaultBackendOptions,
      rebuildThemePackOptions,
    );

    expect(rebuildThemePackOptions).toHaveBeenCalledWith(expect.any(HTMLSelectElement), {
      desiredId: DEFAULT_DARK_THEME_ID,
      forceReload: true,
    });
    expect((root.querySelector('#set-theme') as HTMLSelectElement).disabled).toBe(false);
  });

  it('disables theme selection when system theme is active', async () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="acme-theme" selected>Acme</option></select>
        <select id="set-language"><option value="system">System</option></select>
        <select id="set-update-channel"><option value="stable">Stable</option></select>
        <input id="set-reopen-last" type="checkbox" />
        <input id="set-checks-on-launch" type="checkbox" />
        <input id="set-crash-reports" type="checkbox" />
        <input id="set-restrict-commit-summary" type="checkbox" />
      </div>
    `;

    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    const rebuildThemePackOptions = vi.fn().mockResolvedValue(undefined);

    await loadGeneralSettingsIntoForm(
      root,
      {
        general: {
          theme: 'system',
          theme_pack: 'acme-theme',
          language: 'system',
          update_channel: 'stable',
          reopen_last_repos: false,
          checks_on_launch: false,
          crash_reports: false,
          restrict_commit_summary: true,
        },
      },
      (value) => String(value ?? ''),
      refreshDefaultBackendOptions,
      rebuildThemePackOptions,
    );

    expect(rebuildThemePackOptions).toHaveBeenCalledWith(expect.any(HTMLSelectElement), {
      desiredId: 'acme-theme',
      forceReload: true,
    });
    expect((root.querySelector('#set-theme') as HTMLSelectElement).disabled).toBe(true);
    expect((root.querySelector('#set-theme-auto') as HTMLInputElement).checked).toBe(true);
  });
});
