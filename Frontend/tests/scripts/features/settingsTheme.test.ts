// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeSummary } from '@scripts/types';

// ---------------------------------------------------------------------------
// matchMedia shim – must run before any dynamic import of the SUT because
// settingsTheme.ts calls matchMedia at module scope.
// ---------------------------------------------------------------------------

let mockDarkMode = false;

function createMatchMediaMock(query: string) {
    return {
        matches: mockDarkMode,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
}

(globalThis as any).matchMedia = createMatchMediaMock;

// ---------------------------------------------------------------------------
// Mock the theme-registry module that settingsTheme imports from.
// ---------------------------------------------------------------------------

vi.mock('@scripts/themes', () => ({
    DEFAULT_LIGHT_THEME_ID: 'default-light',
    getAvailableThemes: vi.fn(),
    refreshAvailableThemes: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTheme(overrides: Partial<ThemeSummary> = {}): ThemeSummary {
    return {
        id: 'test-theme',
        name: 'Test Theme',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.resetModules();
    mockDarkMode = false;
    document.documentElement.dataset.animations = '';
});

afterEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.animations;
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// applyAnimationPreference
// ---------------------------------------------------------------------------

describe('applyAnimationPreference', () => {
    async function load() {
        return import('@scripts/features/settingsTheme');
    }

    it('sets animations to off when enabled is false', async () => {
        const { applyAnimationPreference } = await load();
        applyAnimationPreference(false);
        expect(document.documentElement.dataset.animations).toBe('off');
    });

    it('sets animations to on when enabled is true', async () => {
        const { applyAnimationPreference } = await load();
        applyAnimationPreference(true);
        expect(document.documentElement.dataset.animations).toBe('on');
    });

    it('sets animations to on when enabled is null', async () => {
        const { applyAnimationPreference } = await load();
        applyAnimationPreference(null);
        expect(document.documentElement.dataset.animations).toBe('on');
    });

    it('sets animations to on when enabled is undefined', async () => {
        const { applyAnimationPreference } = await load();
        applyAnimationPreference(undefined);
        expect(document.documentElement.dataset.animations).toBe('on');
    });
});

// ---------------------------------------------------------------------------
// modeForTheme
// ---------------------------------------------------------------------------

describe('modeForTheme', () => {
    async function loadThemesModule() {
        return import('@scripts/themes');
    }

    async function loadSut() {
        return import('@scripts/features/settingsTheme');
    }

    it('returns light for a theme with light appearance', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', appearance: 'light' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('my-theme')).toBe('light');
    });

    it('returns dark for a theme with dark appearance', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', appearance: 'dark' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('my-theme')).toBe('dark');
    });

    it('returns both appearance as system fallback (light)', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', appearance: 'both' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('my-theme')).toBe('light');
    });

    it('returns dark when theme has no appearance and system prefers dark', async () => {
        mockDarkMode = true;
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', appearance: undefined }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('my-theme')).toBe('dark');
    });

    it('returns light when theme has no appearance and system prefers light', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', appearance: undefined }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('my-theme')).toBe('light');
    });

    it('falls back to system default for unknown theme id', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('non-existent')).toBe('light');
    });

    it('uses DEFAULT_LIGHT_THEME_ID when given an empty string', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'default-light', appearance: 'light' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('')).toBe('light');
    });

    it('is case-insensitive when matching theme id', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'My-Theme', appearance: 'dark' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('my-theme')).toBe('dark');
    });

    it('falls back to DEFAULT_LIGHT_THEME_ID when given null themeId', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'default-light', appearance: 'light' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme(null as any)).toBe('light');
    });

    it('falls back to system default when theme id is whitespace', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('   ')).toBe('light');
    });

    it('handles theme with null id in lookup', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: null as any, name: 'Null ID Theme', appearance: 'dark' }),
            makeTheme({ id: 'valid-id', appearance: 'light' }),
        ]);

        const { modeForTheme } = await loadSut();
        expect(modeForTheme('valid-id')).toBe('light');
    });
});

// ---------------------------------------------------------------------------
// themeTooltip
// ---------------------------------------------------------------------------

describe('themeTooltip', () => {
    async function loadThemesModule() {
        return import('@scripts/themes');
    }

    async function loadSut() {
        return import('@scripts/features/settingsTheme');
    }

    const THEME_PACK_HINT =
        'Install a theme ZIP into the themes folder, or install a plugin that provides themes.';

    it('returns default hint for an unknown theme id', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([]);

        const { themeTooltip } = await loadSut();
        expect(themeTooltip('unknown')).toBe(THEME_PACK_HINT);
    });

    it('includes description, author and version in tooltip', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({
                id: 'my-theme',
                description: 'A cool theme',
                author: 'Jane Doe',
                version: '1.0.0',
            }),
        ]);

        const { themeTooltip } = await loadSut();
        const tip = themeTooltip('my-theme');
        expect(tip).toContain('A cool theme');
        expect(tip).toContain('Jane Doe');
        expect(tip).toContain('1.0.0');
    });

    it('returns hint when theme has empty description and no author/version', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'bare', description: '', author: '', version: '' }),
        ]);

        const { themeTooltip } = await loadSut();
        expect(themeTooltip('bare')).toBe(THEME_PACK_HINT);
    });

    it('returns description alone when author and version are empty', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'desc-only', description: 'Just a description', author: '', version: '' }),
        ]);

        const { themeTooltip } = await loadSut();
        expect(themeTooltip('desc-only')).toBe('Just a description');
    });

    it('is case-insensitive when matching theme id', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'Case-Theme', description: 'Case test' }),
        ]);

        const { themeTooltip } = await loadSut();
        expect(themeTooltip('case-theme')).toContain('Case test');
    });
});

// ---------------------------------------------------------------------------
// rebuildThemePackOptions
// ---------------------------------------------------------------------------

describe('rebuildThemePackOptions', () => {
    async function loadThemesModule() {
        return import('@scripts/themes');
    }

    async function loadSut() {
        return import('@scripts/features/settingsTheme');
    }

    function createSelect(): HTMLSelectElement {
        const select = document.createElement('select');
        document.body.appendChild(select);
        return select;
    }

    it('rebuilds options from available themes', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'theme-a', name: 'Theme A' }),
            makeTheme({ id: 'theme-b', name: 'Theme B' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'theme-a' });

        expect(select.options.length).toBe(2);
        expect(select.options[0].value).toBe('theme-a');
        expect(select.options[0].textContent).toBe('Theme A');
        expect(select.options[1].value).toBe('theme-b');
    });

    it('selects the matching theme by desiredId', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'theme-a', name: 'Theme A' }),
            makeTheme({ id: 'theme-b', name: 'Theme B' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'theme-b' });

        expect(select.value).toBe('theme-b');
    });

    it('falls back to default-light when desiredId does not match any theme', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'default-light', name: 'Default Light' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'non-existent' });

        expect(select.value).toBe('default-light');
    });

    it('falls back to the select current value when desiredId is not provided', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'theme-a', name: 'Theme A' }),
            makeTheme({ id: 'theme-b', name: 'Theme B' }),
        ]);

        const select = createSelect();
        select.innerHTML = `<option value="theme-b" selected>Theme B</option>`;
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select);

        expect(select.value).toBe('theme-b');
    });

    it('calls refreshAvailableThemes when forceReload is true', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([]);
        const refreshSpy = vi.mocked(themes.refreshAvailableThemes);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'default-light', forceReload: true });

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores refresh errors when forceReload fails', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'default-light', name: 'Default Light' }),
        ]);
        vi.mocked(themes.refreshAvailableThemes).mockRejectedValue(new Error('network error'));

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await expect(
            rebuildThemePackOptions(select, { desiredId: 'default-light', forceReload: true }),
        ).resolves.toBeUndefined();

        expect(select.options.length).toBe(1);
    });

    it('sets option titles via themeTooltip', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', name: 'My Theme', description: 'A description', author: 'Author' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'my-theme' });

        expect(select.options[0].title).toContain('A description');
        expect(select.options[0].title).toContain('Author');
    });

    it('clears previous <option> elements before rebuilding', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'theme-a', name: 'Theme A' }),
        ]);

        const select = createSelect();
        select.innerHTML = '<option value="old">Old</option>';

        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'theme-a' });

        expect(select.options.length).toBe(1);
        expect(select.options[0].value).toBe('theme-a');
    });

    it('includes version in the option label when present', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'v-theme', name: 'Versioned', version: '2.0.0' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'v-theme' });

        expect(select.options[0].textContent).toBe('Versioned (2.0.0)');
    });

    it('sets the select element title attribute via themeTooltip', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'my-theme', name: 'My Theme', description: 'Top pick' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: 'my-theme' });

        expect(select.title).toContain('Top pick');
    });

    it('falls back to default-light when both desiredId and selectEl.value are empty', async () => {
        const themes = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'default-light', name: 'Default Light' }),
            makeTheme({ id: 'theme-b', name: 'Theme B' }),
        ]);

        const select = createSelect();
        select.value = '';
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: '' });

        expect(select.value).toBe('default-light');
    });

    it('handles explicit null desiredId falls back to DEFAULT_LIGHT_THEME_ID', async () => {
        const themes = await loadThemesModule();
        const { DEFAULT_LIGHT_THEME_ID } = await loadThemesModule();
        vi.mocked(themes.getAvailableThemes).mockReturnValue([
            makeTheme({ id: 'theme-a', name: 'Theme A' }),
            makeTheme({ id: DEFAULT_LIGHT_THEME_ID, name: 'Default Light' }),
        ]);

        const select = createSelect();
        const { rebuildThemePackOptions } = await loadSut();
        await rebuildThemePackOptions(select, { desiredId: null });

        expect(select.value).toBe(DEFAULT_LIGHT_THEME_ID);
    });
});
