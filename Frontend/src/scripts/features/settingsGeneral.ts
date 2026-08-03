// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GlobalSettings } from '../types';

import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID, getActiveThemeId } from '../themes';

/** Collects the General panel settings from the settings modal. */
export function collectGeneralSettings(
  root: HTMLElement,
  base: GlobalSettings,
  modeForTheme: (themeId: string) => 'light' | 'dark',
): GlobalSettings['general'] {
  const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const autoTheme = !!get<HTMLInputElement>('#set-theme-auto')?.checked;
  const themePack = get<HTMLSelectElement>('#set-theme')?.value || DEFAULT_LIGHT_THEME_ID;
  const theme = autoTheme ? 'system' : modeForTheme(themePack);

    return {
        ...base.general,
        theme,
        theme_pack: themePack || DEFAULT_LIGHT_THEME_ID,
        language: get<HTMLSelectElement>('#set-language')?.value,
    default_backend: get<HTMLSelectElement>('#set-default-backend')?.value || '',
    update_channel: get<HTMLSelectElement>('#set-update-channel')?.value || 'stable',
        reopen_last_repos: !!get<HTMLInputElement>('#set-reopen-last')?.checked,
        checks_on_launch: !!get<HTMLInputElement>('#set-checks-on-launch')?.checked,
        crash_reports: !!get<HTMLInputElement>('#set-crash-reports')?.checked,
    };
}

/** Loads the General panel settings into the settings modal form controls. */
export async function loadGeneralSettingsIntoForm(
  root: HTMLElement,
  cfg: GlobalSettings,
  toKebab: (value: unknown) => string,
  refreshDefaultBackendOptions: (modal: HTMLElement, cfg: GlobalSettings) => Promise<void>,
  rebuildThemePackOptions: (
    themeSelect: HTMLSelectElement,
    options: { desiredId: string; forceReload: boolean },
  ) => Promise<void>,
): Promise<void> {
  const get = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const themeSel = get<HTMLSelectElement>('#set-theme');
  const elAuto = get<HTMLInputElement>('#set-theme-auto');
  const themePref = (cfg.general?.theme || 'system') as 'system' | 'light' | 'dark';
  if (elAuto) elAuto.checked = themePref === 'system';
  if (themeSel) {
    let desiredId = String(cfg.general?.theme_pack || DEFAULT_LIGHT_THEME_ID);
    if (desiredId.trim().toLowerCase() === DEFAULT_THEME_ID) {
      desiredId = themePref === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
    }
    await rebuildThemePackOptions(themeSel, {
      desiredId,
      forceReload: true,
    });
    themeSel.disabled = themePref === 'system';
    if (themePref === 'system') {
      themeSel.value = getActiveThemeId() || themeSel.value;
    }
  }

  const elLang = get<HTMLSelectElement>('#set-language');
  if (elLang) elLang.value = toKebab(cfg.general?.language);
  await refreshDefaultBackendOptions(root, cfg);
  const elChan = get<HTMLSelectElement>('#set-update-channel');
  if (elChan) {
    elChan.value = toKebab(cfg.general?.update_channel);
  }
  const elReo = get<HTMLInputElement>('#set-reopen-last');
  if (elReo) elReo.checked = !!cfg.general?.reopen_last_repos;
  const elChk = get<HTMLInputElement>('#set-checks-on-launch');
  if (elChk) elChk.checked = !!cfg.general?.checks_on_launch;
  const elCrash = get<HTMLInputElement>('#set-crash-reports');
  if (elCrash) elCrash.checked = !!cfg.general?.crash_reports;
}
