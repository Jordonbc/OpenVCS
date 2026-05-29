// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('plugin state', () => {
  it('exports Maps for handlers, themes, context menus, settings', async () => {
    const mod = await import('./state');
    expect(mod.actionHandlers).toBeInstanceOf(Map);
    expect(mod.hookHandlers).toBeInstanceOf(Map);
    expect(mod.registeredThemePayloads).toBeInstanceOf(Map);
    expect(mod.registeredThemeSummaries).toBeInstanceOf(Map);
    expect(mod.contextMenuItems).toBeInstanceOf(Map);
    expect(mod.settingsSections).toBeInstanceOf(Map);
  });

  it('initialized starts false', async () => {
    const mod = await import('./state');
    expect(mod.initialized).toBe(false);
  });

  it('setInitialized updates the flag', async () => {
    const mod = await import('./state');
    expect(mod.initialized).toBe(false);
    mod.setInitialized(true);
    expect((await import('./state')).initialized).toBe(true);
  });

  it('disabledPlugins and enabledPlugins start empty', async () => {
    const mod = await import('./state');
    expect(mod.disabledPlugins.size).toBe(0);
    expect(mod.enabledPlugins.size).toBe(0);
  });

  it('setDisabledPlugins replaces the set', async () => {
    const mod = await import('./state');
    mod.setDisabledPlugins(new Set(['plugin-a']));
    expect((await import('./state')).disabledPlugins.has('plugin-a')).toBe(true);
  });

  it('setEnabledPlugins replaces the set', async () => {
    const mod = await import('./state');
    mod.setEnabledPlugins(new Set(['plugin-b']));
    expect((await import('./state')).enabledPlugins.has('plugin-b')).toBe(true);
  });
});
