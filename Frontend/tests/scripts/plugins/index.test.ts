// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/plugins/runtime', () => ({
  applyPluginSettingsSections: 'mocked-applyPluginSettingsSections',
  getRegisteredThemeSummaries: 'mocked-getRegisteredThemeSummaries',
  getRegisteredThemePayload: 'mocked-getRegisteredThemePayload',
  runHook: 'mocked-runHook',
  runPluginAction: 'mocked-runPluginAction',
  getPluginContextMenuItems: 'mocked-getPluginContextMenuItems',
  initPlugins: 'mocked-initPlugins',
  reloadPlugins: 'mocked-reloadPlugins',
}));

vi.mock('@scripts/plugins/modal', () => ({
  handlePluginActionResult: 'mocked-handlePluginActionResult',
  invokePluginAction: 'mocked-invokePluginAction',
}));

describe('plugins index barrel', () => {
  it('re-exports runtime functions', async () => {
    const mod = await import('@scripts/plugins/index');
    expect(mod.applyPluginSettingsSections).toBe('mocked-applyPluginSettingsSections');
    expect(mod.getRegisteredThemeSummaries).toBe('mocked-getRegisteredThemeSummaries');
    expect(mod.getRegisteredThemePayload).toBe('mocked-getRegisteredThemePayload');
    expect(mod.runHook).toBe('mocked-runHook');
    expect(mod.runPluginAction).toBe('mocked-runPluginAction');
    expect(mod.getPluginContextMenuItems).toBe('mocked-getPluginContextMenuItems');
    expect(mod.initPlugins).toBe('mocked-initPlugins');
    expect(mod.reloadPlugins).toBe('mocked-reloadPlugins');
  });

  it('re-exports modal functions', async () => {
    const mod = await import('@scripts/plugins/index');
    expect(mod.handlePluginActionResult).toBe('mocked-handlePluginActionResult');
    expect(mod.invokePluginAction).toBe('mocked-invokePluginAction');
  });
});
