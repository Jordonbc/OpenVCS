// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { collectGeneralSettings, loadGeneralSettingsIntoForm } from '@scripts/features/settingsGeneral';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID } from '@scripts/themes';

vi.mock('@scripts/themes', () => ({
  DEFAULT_DARK_THEME_ID: 'default-dark',
  DEFAULT_LIGHT_THEME_ID: 'default-light',
  DEFAULT_THEME_ID: 'default',
  getActiveThemeId: vi.fn(() => 'default-light'),
}));

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
      {
        general: {
          language: 'system',
          update_channel: 'stable',
          reopen_last_repos: true,
            checks_on_launch: true,
            crash_reports: true,
          },
        },
      (value) => String(value ?? ''),
      refreshDefaultBackendOptions,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(refreshDefaultBackendOptions).toHaveBeenCalledWith(root, expect.any(Object));
    expect((root.querySelector('#set-crash-reports') as HTMLInputElement).checked).toBe(true);
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

  it('handles missing theme select element', async () => {
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
      { general: { language: 'en', update_channel: 'stable' } } as any,
      (v) => String(v ?? ''),
      refreshDefaultBackendOptions,
      vi.fn().mockResolvedValue(undefined),
    );
    expect(refreshDefaultBackendOptions).toHaveBeenCalled();
  });

  it('handles missing language and update channel elements', async () => {
    document.body.innerHTML = '<div></div>';
    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    await loadGeneralSettingsIntoForm(
      root,
      { general: {} } as any,
      (v) => String(v ?? ''),
      refreshDefaultBackendOptions,
      vi.fn().mockResolvedValue(undefined),
    );
    expect(refreshDefaultBackendOptions).toHaveBeenCalled();
  });
});

describe('collectGeneralSettings - uncovered branches', () => {
  it('resolves theme from modeForTheme when auto is unchecked (line 16-17)', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="">Select</option></select>
      </div>
    `;
    const root = document.body.firstElementChild as HTMLElement;
    const modeForTheme = vi.fn(() => 'dark' as const);
    const general = collectGeneralSettings(root, {} as any, modeForTheme);
    expect(general?.theme).toBe('dark');
    expect(general?.theme_pack).toBe(DEFAULT_LIGHT_THEME_ID);
    expect(modeForTheme).toHaveBeenCalledWith(DEFAULT_LIGHT_THEME_ID);
  });

  it('falls back to defaults for missing select elements (lines 23-25)', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="my-theme">My Theme</option></select>
      </div>
    `;
    const root = document.body.firstElementChild as HTMLElement;
    const general = collectGeneralSettings(root, {} as any, () => 'dark');
    expect(general?.theme).toBe('dark');
    expect(general?.theme_pack).toBe('my-theme');
    expect(general?.default_backend).toBe('git');
    expect(general?.update_channel).toBe('stable');
  });

  it('uses fallback values when optional selects are missing', () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="my-theme">My Theme</option></select>
      </div>
    `;
    const root = document.body.firstElementChild as HTMLElement;
    const general = collectGeneralSettings(root, {} as any, () => 'dark');
    expect(general?.language).toBeUndefined();
    expect(general?.default_backend).toBe('git');
    expect(general?.update_channel).toBe('stable');
  });
});

describe('loadGeneralSettingsIntoForm - uncovered branches', () => {
  it('falls back to DEFAULT_LIGHT_THEME_ID when theme_pack is missing (line 49)', async () => {
    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="default">Default</option></select>
        <select id="set-language"><option value="system">System</option></select>
        <select id="set-update-channel"><option value="stable">Stable</option></select>
        <input id="set-reopen-last" type="checkbox" />
        <input id="set-checks-on-launch" type="checkbox" />
        <input id="set-crash-reports" type="checkbox" />
      </div>
    `;
    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    const rebuildThemePackOptions = vi.fn().mockResolvedValue(undefined);

    await loadGeneralSettingsIntoForm(
      root,
      { general: { theme: 'light', language: 'en', update_channel: 'stable' } } as any,
      (v) => String(v ?? ''),
      refreshDefaultBackendOptions,
      rebuildThemePackOptions,
    );

    expect(rebuildThemePackOptions).toHaveBeenCalledWith(expect.any(HTMLSelectElement), {
      desiredId: DEFAULT_LIGHT_THEME_ID,
      forceReload: true,
    });
  });

  it('keeps existing theme value when getActiveThemeId returns empty (line 59)', async () => {
    const themes = await import('@scripts/themes');
    vi.mocked(themes.getActiveThemeId).mockReturnValueOnce('');

    document.body.innerHTML = `
      <div>
        <input id="set-theme-auto" type="checkbox" checked />
        <select id="set-theme"><option value="my-theme" selected>My Theme</option></select>
        <select id="set-language"><option value="system">System</option></select>
        <select id="set-update-channel"><option value="stable">Stable</option></select>
        <input id="set-reopen-last" type="checkbox" />
        <input id="set-checks-on-launch" type="checkbox" />
        <input id="set-crash-reports" type="checkbox" />
      </div>
    `;
    const root = document.body.firstElementChild as HTMLElement;
    const refreshDefaultBackendOptions = vi.fn().mockResolvedValue(undefined);
    const rebuildThemePackOptions = vi.fn().mockResolvedValue(undefined);

    await loadGeneralSettingsIntoForm(
      root,
      { general: { theme: 'system', theme_pack: 'my-theme', language: 'en', update_channel: 'stable' } } as any,
      (v) => String(v ?? ''),
      refreshDefaultBackendOptions,
      rebuildThemePackOptions,
    );

    const themeSel = root.querySelector('#set-theme') as HTMLSelectElement;
    expect(themeSel.value).toBe('my-theme');
  });
});
