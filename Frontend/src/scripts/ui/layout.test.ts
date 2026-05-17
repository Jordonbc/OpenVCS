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
