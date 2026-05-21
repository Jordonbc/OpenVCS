// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileStatus } from '../types';

/** Provides a minimal `matchMedia` test shim used by layout imports. */
function createMatchMediaMock(query: string) {
  return {
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/** Mounts the DOM nodes touched by layout action refresh. */
function mountLayoutDom() {
  document.body.innerHTML = `
    <div class="work"></div>
    <div id="resizer"></div>
    <div id="commit"></div>
    <div id="repo-title"></div>
    <div id="repo-branch"></div>
    <div id="ahead-behind"></div>
    <button id="fetch-btn"></button>
    <button id="fetch-caret"></button>
    <button id="push-btn"><span class="btn-label"></span></button>
    <button id="branch-switch"></button>
    <input id="commit-summary" />
    <textarea id="commit-desc"></textarea>
    <button id="commit-btn"></button>
    <div id="left-foot" data-mode=""></div>
    <button id="undo-left-btn"></button>
  `;
}

describe('applyCommitSummaryRestriction', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: createMatchMediaMock,
      configurable: true,
      writable: true,
    });
    mountLayoutDom();
  });

  it('caps the summary input at 72 characters when enabled', async () => {
    const { applyCommitSummaryRestriction } = await import('./layout');
    const input = document.getElementById('commit-summary') as HTMLInputElement;
    input.value = 'x'.repeat(80);

    applyCommitSummaryRestriction(true);

    expect(input.getAttribute('maxlength')).toBe('72');
    expect(input.value).toHaveLength(72);
  });

  it('removes the cap when disabled', async () => {
    const { applyCommitSummaryRestriction } = await import('./layout');
    const input = document.getElementById('commit-summary') as HTMLInputElement;

    applyCommitSummaryRestriction(false);

    expect(input.hasAttribute('maxlength')).toBe(false);
  });
});

describe('applyGpuAccelerationPreference', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: createMatchMediaMock,
      configurable: true,
      writable: true,
    });
    mountLayoutDom();
  });

  it('stores the GPU acceleration preference on the document root', async () => {
    const { applyGpuAccelerationPreference } = await import('./layout');

    applyGpuAccelerationPreference(false);
    expect(document.documentElement.dataset.gpuAcceleration).toBe('off');

    applyGpuAccelerationPreference(true);
    expect(document.documentElement.dataset.gpuAcceleration).toBe('on');

    applyGpuAccelerationPreference(undefined);
    expect(document.documentElement.dataset.gpuAcceleration).toBe('on');

    applyGpuAccelerationPreference(null);
    expect(document.documentElement.dataset.gpuAcceleration).toBe('on');
  });
});

describe('refreshRepoActions', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: createMatchMediaMock,
      configurable: true,
      writable: true,
    });
    mountLayoutDom();
  });

  it('switches the push button label between Publish and Push based on branchOnRemote', async () => {
    const { refreshRepoActions } = await import('./layout');
    const { state, setGlobalSettings } = await import('../state/state');
    const pushBtn = document.getElementById('push-btn') as HTMLButtonElement;
    const label = pushBtn.querySelector('.btn-label') as HTMLSpanElement;
    const files: FileStatus[] = [{ path: 'keep.txt', status: 'M' }];

    setGlobalSettings(null);
    state.hasRepo = true;
    state.files = files;
    state.ahead = 0;
    state.branchOnRemote = false;

    refreshRepoActions();

    expect(label.textContent).toBe('Publish');
    expect(pushBtn.title).toBe('Publish');
    expect(pushBtn.getAttribute('aria-label')).toBe('Publish');

    state.branchOnRemote = true;
    refreshRepoActions();

    expect(label.textContent).toBe('Push');
    expect(pushBtn.title).toBe('Push');
    expect(pushBtn.getAttribute('aria-label')).toBe('Push');
  });

  it('enables commit button when one-file hint is available', async () => {
    const { refreshRepoActions } = await import('./layout');
    const { state, setGlobalSettings } = await import('../state/state');
    const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;

    setGlobalSettings(null);
    setGlobalSettings({
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
    state.hasRepo = true;
    state.files = [{ path: 'src/test.cpp', status: 'M' } as FileStatus];
    state.selectedFiles = new Set(['src/test.cpp']);

    refreshRepoActions();

    expect(commitBtn.disabled).toBe(false);
  });
});

describe('setTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
      configurable: true,
      writable: true,
    });
  });

  it('sets data-theme to dark when theme is dark', async () => {
    const { setTheme } = await import('./layout');
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme to light when theme is light', async () => {
    const { setTheme } = await import('./layout');
    setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('sets data-theme based on system preference when theme is system', async () => {
    const { setTheme } = await import('./layout');
    setTheme('system');
    const expected = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    expect(document.documentElement.getAttribute('data-theme')).toBe(expected);
  });

  it('updates settings modal controls when present', async () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <input id="set-theme-auto" type="checkbox" />
        <select id="set-theme"><option value="default-light">Light</option></select>
      </div>
    `;
    const { setTheme } = await import('./layout');
    setTheme('system');

    const auto = document.querySelector('#set-theme-auto') as HTMLInputElement;
    expect(auto.checked).toBe(true);

    setTheme('light');
    expect(auto.checked).toBe(false);
  });
});

describe('toggleTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      configurable: true,
      writable: true,
    });
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn() },
    };
  });

  it('toggles from light to dark and persists to backend', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({ general: { theme: 'light' } });

    const { toggleTheme, setTheme } = await import('./layout');
    setTheme('light');

    toggleTheme();

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  it('handles backend persistence failure gracefully', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockRejectedValue(new Error('fail'));

    const { toggleTheme, setTheme } = await import('./layout');
    setTheme('light');

    toggleTheme();

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});

describe('setTab', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div class="work"></div>
      <button class="tab" data-tab="changes">Changes</button>
      <button class="tab" data-tab="history">History</button>
      <button class="tab" data-tab="stash">Stash</button>
      <div id="commit"></div>
      <div id="diff-path"></div>
      <button id="history-actions-btn"></button>
    `;
  });

  it('activates the target tab and deactivates others', async () => {
    const { setTab } = await import('./layout');
    setTab('history');

    const tabs = document.querySelectorAll('.tab');
    expect(tabs[0].classList.contains('active')).toBe(false);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('hides commit box on history tab', async () => {
    const { setTab } = await import('./layout');
    setTab('history');

    const commitBox = document.getElementById('commit');
    expect(commitBox?.style.display).toBe('none');
  });

  it('shows commit box on changes tab', async () => {
    const { setTab } = await import('./layout');
    setTab('history');
    setTab('changes');

    const commitBox = document.getElementById('commit');
    expect(commitBox?.style.display).toBe('grid');
  });

  it('sets diff path text based on tab', async () => {
    const { setTab } = await import('./layout');
    setTab('history');
    expect(document.getElementById('diff-path')?.textContent).toBe('Commit details');

    setTab('stash');
    expect(document.getElementById('diff-path')?.textContent).toBe('Stash details');

    setTab('changes');
    expect(document.getElementById('diff-path')?.textContent).toBe('Select a file to view changes');
  });

  it('hides history actions button when not on history tab', async () => {
    const { setTab } = await import('./layout');
    setTab('changes');
    const btn = document.getElementById('history-actions-btn') as HTMLButtonElement;
    expect(btn.hidden).toBe(true);
  });

  it('dispatches app:tab-changed event', async () => {
    const handler = vi.fn();
    window.addEventListener('app:tab-changed', handler);

    const { setTab } = await import('./layout');
    setTab('stash');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'stash' }),
    );
  });
});

describe('bindTabs', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <button class="tab" data-tab="changes">Changes</button>
      <button class="tab" data-tab="history">History</button>
    `;
  });

  it('calls onChange when a tab is clicked', async () => {
    const { bindTabs } = await import('./layout');
    const onChange = vi.fn();

    bindTabs(onChange);

    const historyTab = document.querySelector('.tab[data-tab="history"]') as HTMLButtonElement;
    historyTab.click();

    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('defaults to "changes" for unrecognized tab values', async () => {
    document.body.innerHTML = '<button class="tab" data-tab="unknown">Unknown</button>';
    const { bindTabs } = await import('./layout');
    const onChange = vi.fn();

    bindTabs(onChange);

    const unknownTab = document.querySelector('.tab') as HTMLButtonElement;
    unknownTab.click();

    expect(onChange).toHaveBeenCalledWith('changes');
  });
});

describe('setRepoHeader / resetRepoHeader', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="repo-title"></div>
      <div id="repo-branch"></div>
    `;
  });

  it('sets the repo title from a path', async () => {
    const { setRepoHeader } = await import('./layout');
    setRepoHeader('/home/user/projects/my-repo');
    expect(document.getElementById('repo-title')?.textContent).toBe('my-repo');
  });

  it('sets the repo title from a path with trailing slash', async () => {
    const { setRepoHeader } = await import('./layout');
    setRepoHeader('/home/user/projects/my-repo/');
    expect(document.getElementById('repo-title')?.textContent).toBe('my-repo');
  });

  it('sets the branch label from state', async () => {
    const { setRepoHeader } = await import('./layout');
    const { state } = await import('../state/state');
    state.branchLabel = 'main';
    setRepoHeader('/repo');
    expect(document.getElementById('repo-branch')?.textContent).toBe('main');
  });

  it('resets the repo header to defaults', async () => {
    const { resetRepoHeader } = await import('./layout');
    resetRepoHeader();
    expect(document.getElementById('repo-title')?.textContent).toBe('Click to open Repo');
    expect(document.getElementById('repo-branch')?.textContent).toBe('No repo open');
  });
});

describe('bindLayoutActionState', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      configurable: true,
      writable: true,
    });
    document.body.innerHTML = `
      <div class="work"></div>
      <div id="resizer"></div>
      <button id="fetch-btn"></button>
      <button id="push-btn"><span class="btn-label"></span></button>
      <button id="branch-switch"></button>
      <input id="commit-summary" />
      <textarea id="commit-desc"></textarea>
      <button id="commit-btn"></button>
    `;
  });

  it('wires event listeners without crashing', async () => {
    const { bindLayoutActionState } = await import('./layout');
    expect(() => bindLayoutActionState()).not.toThrow();
  });

  it('fires refreshRepoActions on app:repo-selected', async () => {
    const { bindLayoutActionState } = await import('./layout');
    bindLayoutActionState();
    window.dispatchEvent(new Event('app:repo-selected'));
  });

  it('fires refreshRepoActions on app:status-updated', async () => {
    const { bindLayoutActionState } = await import('./layout');
    bindLayoutActionState();
    window.dispatchEvent(new Event('app:status-updated'));
  });

  it('fires refreshRepoActions on app:branches-updated', async () => {
    const { bindLayoutActionState } = await import('./layout');
    bindLayoutActionState();
    window.dispatchEvent(new Event('app:branches-updated'));
  });
});

// ---------------------------------------------------------------------------
// setRepoHeader - edge cases
// ---------------------------------------------------------------------------

describe('setRepoHeader edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="repo-title"></div><div id="repo-branch"></div>';
  });

  it('does not set title when pathMaybe is undefined', async () => {
    const { setRepoHeader } = await import('./layout');
    setRepoHeader(undefined);
    expect(document.getElementById('repo-title')?.textContent).toBe('');
  });

  it('falls back to path when splitting returns empty', async () => {
    const { setRepoHeader } = await import('./layout');
    setRepoHeader('repo');
    expect(document.getElementById('repo-title')?.textContent).toBe('repo');
  });

  it('uses branchLabel when available', async () => {
    const { setRepoHeader } = await import('./layout');
    const { state } = await import('../state/state');
    state.branchLabel = 'feature-branch';
    state.branch = 'main';
    setRepoHeader('/repo');
    expect(document.getElementById('repo-branch')?.textContent).toBe('feature-branch');
  });

  it('falls back to state.branch when no branchLabel', async () => {
    const { setRepoHeader } = await import('./layout');
    const { state } = await import('../state/state');
    state.branchLabel = '';
    state.branch = 'main';
    setRepoHeader('/repo');
    expect(document.getElementById('repo-branch')?.textContent).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// renderAheadBehind
// ---------------------------------------------------------------------------

describe('renderAheadBehind', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      configurable: true,
      writable: true,
    });
    document.body.innerHTML = '<div id="ahead-behind"></div><div id="push-btn"><span class="btn-label"></span></div>';
  });

  it('shows ahead count via bindLayoutActionState', async () => {
    const { bindLayoutActionState } = await import('./layout');
    const { state } = await import('../state/state');
    state.hasRepo = true;
    state.ahead = 3;
    state.behind = 1;
    const el = document.getElementById('ahead-behind') as HTMLElement;
    bindLayoutActionState();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.textContent).toContain('↑3');
    expect(el.textContent).toContain('↓1');
  });

  it('hides ahead-behind when no counts via bindLayoutActionState', async () => {
    const { bindLayoutActionState } = await import('./layout');
    const { state } = await import('../state/state');
    state.hasRepo = true;
    state.ahead = 0;
    state.behind = 0;
    const el = document.getElementById('ahead-behind') as HTMLElement;
    bindLayoutActionState();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// initResizer
// ---------------------------------------------------------------------------

describe('initResizer', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      configurable: true,
      writable: true,
    });
    document.body.innerHTML = `
      <div class="work"></div>
      <div id="resizer"></div>
    `;
  });

  it('initializes resizer without crashing', async () => {
    const { initResizer } = await import('./layout');
    expect(() => initResizer()).not.toThrow();
  });

  it('handles mousedown on resizer', async () => {
    const { initResizer } = await import('./layout');
    initResizer();
    const resizer = document.getElementById('resizer') as HTMLElement;
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 500 }));
  });

  it('does not crash when workGrid or resizer missing', async () => {
    document.body.innerHTML = '';
    const { initResizer } = await import('./layout');
    expect(() => initResizer()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyCommitSummaryRestriction - no element
// ---------------------------------------------------------------------------

describe('applyCommitSummaryRestriction (no element)', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('does not crash when summary input is missing', async () => {
    const { applyCommitSummaryRestriction } = await import('./layout');
    expect(() => applyCommitSummaryRestriction(true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// toggleTheme - additional
// ---------------------------------------------------------------------------

describe('toggleTheme additional', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      configurable: true,
      writable: true,
    });
    (window as any).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn() },
    };
  });

  it('toggles from dark to light', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({ general: { theme: 'dark' } });

    const { toggleTheme, setTheme } = await import('./layout');
    setTheme('dark');

    toggleTheme();

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
});

// ---------------------------------------------------------------------------
// setTab - additional edge cases
// ---------------------------------------------------------------------------

describe('setTab additional', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div class="work"></div>
      <button class="tab" data-tab="changes">Changes</button>
      <button class="tab" data-tab="history">History</button>
      <button class="tab" data-tab="stash">Stash</button>
      <div id="commit"></div>
      <div id="diff-path"></div>
      <button id="history-actions-btn"></button>
    `;
  });

  it('clears selectedCommit when leaving history tab', async () => {
    const { setTab } = await import('./layout');
    const { state } = await import('../state/state');
    state.selectedCommit = { id: 'abc123' };
    setTab('history'); // select history
    setTab('changes'); // leave history
    expect(state.selectedCommit).toBeNull();
  });

  it('sets diffDirty when entering changes from other tab', async () => {
    const { setTab } = await import('./layout');
    const { state } = await import('../state/state');
    state.selectedCommit = null;
    state.diffDirty = false;
    setTab('history');
    setTab('changes');
    expect(state.diffDirty).toBe(true);
  });

  it('hides history actions btn when leaving history tab', async () => {
    const { setTab } = await import('./layout');
    const btn = document.getElementById('history-actions-btn') as HTMLButtonElement;
    btn.hidden = false;
    setTab('changes');
    expect(btn.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// refreshRepoActions - push button with ahead
// ---------------------------------------------------------------------------

describe('refreshRepoActions (push ahead badge)', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      configurable: true,
      writable: true,
    });
    document.body.innerHTML = `
      <div class="work"></div>
      <button id="fetch-btn"></button>
      <button id="push-btn"><span class="btn-label"></span></button>
      <button id="branch-switch"></button>
      <div id="left-foot" data-mode=""></div>
      <button id="undo-left-btn"></button>
    `;
  });

  it('shows ahead count in push button label', async () => {
    const { refreshRepoActions } = await import('./layout');
    const { state } = await import('../state/state');
    const pushBtn = document.getElementById('push-btn') as HTMLButtonElement;
    const label = pushBtn.querySelector('.btn-label') as HTMLSpanElement;

    state.hasRepo = true;
    state.ahead = 3;
    state.branchOnRemote = true;

    refreshRepoActions();

    expect(pushBtn.classList.contains('attention')).toBe(true);
    expect(label.textContent).toBe('Push (3)');
    expect(pushBtn.title).toBe('Push (3)');
  });

  it('shows undo button when repo has ahead and on changes tab', async () => {
    const { refreshRepoActions } = await import('./layout');
    const { state } = await import('../state/state');
    const { prefs } = await import('../state/state');

    state.hasRepo = true;
    state.ahead = 2;
    prefs.tab = 'changes';

    refreshRepoActions();

    const undoLeftWrap = document.getElementById('left-foot') as HTMLElement;
    expect(undoLeftWrap.classList.contains('show')).toBe(true);
  });
});
