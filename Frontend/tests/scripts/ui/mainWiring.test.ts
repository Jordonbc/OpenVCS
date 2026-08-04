// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Wiring regression test for the split main.ts modules.
//
// Boots the app shell (heavy/branching modules mocked to no-ops) and asserts:
//   1. No duplicate (element, event, handler-identity) registrations.
//   2. Title-bar buttons receive the expected handler identities.
//   3. app:* window events route to the shared updateFetchUI / menubar handlers.
//   4. All expected Tauri backend subscriptions are registered once each.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy/branching modules so boot() exercises only the wiring under test.
vi.mock('@scripts/features/repo', () => ({
  bindFilter: vi.fn(),
  bindRepoHotkeys: vi.fn(),
  hydrateSnapshot: vi.fn().mockResolvedValue(true),
  renderList: vi.fn(),
  wireRenderListCallbacks: vi.fn(),
  yieldToPaint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@scripts/plugins', () => ({
  initPlugins: vi.fn().mockResolvedValue(undefined),
  invokePluginAction: vi.fn().mockResolvedValue(undefined),
  runHook: vi.fn().mockResolvedValue({ cancelled: false }),
  runPluginAction: vi.fn().mockResolvedValue(true),
}));
vi.mock('@scripts/themes', () => ({
  DEFAULT_LIGHT_THEME_ID: 'openvcs-default',
  refreshAvailableThemes: vi.fn().mockResolvedValue([]),
  selectThemePack: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@scripts/lib/scrollbars', () => ({
  destroyOverlayScrollbarsFor: vi.fn(),
  initOverlayScrollbarsFor: vi.fn(),
  refreshOverlayScrollbarsFor: vi.fn(),
}));
vi.mock('@scripts/features/outputLog', () => ({
  initOutputLogViewIfRequested: vi.fn().mockResolvedValue(false),
}));
vi.mock('@scripts/lib/monitoring', () => ({
  syncFrontendMonitoring: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@scripts/ui/layout', () => ({
  applyCommitSummaryRestriction: vi.fn(),
  applyGpuAccelerationPreference: vi.fn(),
  bindLayoutActionState: vi.fn(),
  bindTabs: vi.fn(),
  initResizer: vi.fn(),
  refreshRepoActions: vi.fn(),
  setRepoHeader: vi.fn(),
  setTab: vi.fn(),
  setTheme: vi.fn(),
}));
vi.mock('@scripts/ui/menubar', () => ({
  clearPluginMenubarMenus: vi.fn(),
  initMenubar: vi.fn(),
  refreshPluginMenubarMenus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@scripts/features/commandSheet', () => ({
  bindCommandSheet: vi.fn(),
  closeSheet: vi.fn(),
  openSheet: vi.fn(),
}));
vi.mock('@scripts/features/repoSwitchDrawer', () => ({
  closeSwitchDrawer: vi.fn(),
  openSwitchDrawer: vi.fn(),
  registerDrawerActions: vi.fn(),
}));
vi.mock('@scripts/features/branches', () => ({ bindBranchUI: vi.fn() }));
vi.mock('@scripts/features/diff', () => ({ bindCommit: vi.fn() }));
vi.mock('@scripts/features/settings', () => ({
  applyAnimationPreference: vi.fn(),
  openSettings: vi.fn(),
}));
vi.mock('@scripts/features/sshHostkey', () => ({ initSshHostkeyPrompt: vi.fn() }));
vi.mock('@scripts/features/sshAuth', () => ({ initSshAuthPrompt: vi.fn() }));
vi.mock('@scripts/lib/cssVars', () => ({ applyAppearanceCssVars: vi.fn() }));

interface Registration {
  element: EventTarget;
  event: string;
  handler: unknown;
}

const registrations: Registration[] = [];
const APP_WINDOW_EVENTS = [
  'app:status-updated',
  'app:branches-updated',
  'app:repo-selected',
  'app:vcs-action-labels-updated',
  'app:repo-will-switch',
];
const TAURI_EVENTS = [
  'menu',
  'vcs-progress',
  'repo:selected',
  'status:set',
  'ui:update-available',
  'ui:open-settings',
  'ui:open-about',
  'ui:open-repo-settings',
];


/** Returns registrations whose (element, event, handler-identity) triple repeats. */
function findDuplicateRegistrations(regs: Registration[]): Registration[] {
  const seen = new Map<EventTarget, Map<string, Set<unknown>>>();
  const dupes: Registration[] = [];
  for (const r of regs) {
    let byEvent = seen.get(r.element);
    if (!byEvent) {
      byEvent = new Map();
      seen.set(r.element, byEvent);
    }
    let handlers = byEvent.get(r.event);
    if (!handlers) {
      handlers = new Set();
      byEvent.set(r.event, handlers);
    }
    if (handlers.has(r.handler)) dupes.push(r);
    else handlers.add(r.handler);
  }
  return dupes;
}

function clickHandlers(id: string): unknown[] {
  return registrations
    .filter((r) => r.element instanceof Element && r.element.id === id && r.event === 'click')
    .map((r) => r.handler);
}

function waitForBoot(): Promise<void> {
  // The last thing boot() wires is bindFetchPopover's window 'keydown' listener.
  return vi.waitFor(() => {
    expect(registrations.some((r) => r.element === window && r.event === 'keydown')).toBe(true);
  });
}

let origAdd: typeof EventTarget.prototype.addEventListener;
let origWindowAdd: typeof window.addEventListener;
let invokeMock: ReturnType<typeof vi.fn>;
let listenMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  registrations.length = 0;
  origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (typeof callback === 'function') {
      registrations.push({ element: this, event: type, handler: callback });
    }
    return origAdd.call(this, type, callback, options);
  } as typeof EventTarget.prototype.addEventListener;

  // jsdom's Window has its own addEventListener, separate from EventTarget.prototype.
  origWindowAdd = window.addEventListener;
  window.addEventListener = function (
    this: Window,
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (typeof callback === 'function') {
      registrations.push({ element: this, event: type, handler: callback });
    }
    return origWindowAdd.call(this, type, callback as EventListenerOrEventListenerObject, options);
  } as typeof window.addEventListener;

  document.body.innerHTML = `
    <button id="fetch-btn"></button>
    <button id="fetch-caret"></button>
    <div id="fetch-pop"></div>
    <ul id="fetch-list"></ul>
    <button id="push-btn"></button>
    <button id="clone-btn"></button>
    <button id="repo-switch"></button>
    <button id="commit-btn"></button>
    <button id="undo-left-btn"></button>
    <div id="plugin-title-actions"></div>
  `;

  invokeMock = vi.fn(async (cmd: string) => {
    if (cmd === 'get_global_settings') return {};
    return null;
  });
  listenMock = vi.fn().mockResolvedValue({ unlisten: vi.fn() });
  (window as any).__TAURI__ = {
    core: { invoke: invokeMock },
    event: { listen: listenMock },
  };
  vi.resetModules();
});

afterEach(() => {
  EventTarget.prototype.addEventListener = origAdd;
  window.addEventListener = origWindowAdd;
  delete (window as any).__TAURI__;
  document.body.innerHTML = '';
  registrations.length = 0;
});

describe('main wiring (split modules)', () => {
  it('registers no duplicate (element, event, handler) triples across the split modules', async () => {
    await import('@scripts/main');
    await waitForBoot();

    expect(findDuplicateRegistrations(registrations)).toEqual([]);

    for (const ev of APP_WINDOW_EVENTS) {
      expect(registrations.filter((r) => r.element === window && r.event === ev)).toHaveLength(1);
    }
    expect(registrations.filter((r) => r.element === window && r.event === 'focus')).toHaveLength(1);
    expect(registrations.filter((r) => r.element === window && r.event === 'resize')).toHaveLength(1);
    expect(registrations.filter((r) => r.element === document && r.event === 'visibilitychange')).toHaveLength(1);
    // ui/modals registers its own module-scope document click; fetchPopover adds a second,
    // distinct handler. findDuplicateRegistrations above already guards same-handler dupes.
    expect(registrations.filter((r) => r.element === document && r.event === 'click').length).toBeGreaterThanOrEqual(1);

    const listened = listenMock.mock.calls.map((c) => c[0]);
    expect(listened).toHaveLength(TAURI_EVENTS.length);
    for (const ev of TAURI_EVENTS) {
      expect(listened).toContain(ev);
    }
  });

  it('wires the expected handler identities to the title-bar buttons', async () => {
    const { pushChanges } = await import('@scripts/features/fetchActions');
    const { undoCommit } = await import('@scripts/features/repoEvents');
    await import('@scripts/main');
    await waitForBoot();

    expect(clickHandlers('push-btn')).toEqual([pushChanges]);
    expect(clickHandlers('undo-left-btn')).toEqual([undoCommit]);
    expect(clickHandlers('fetch-btn')).toHaveLength(1);
    expect(clickHandlers('fetch-caret')).toHaveLength(1);
    expect(clickHandlers('clone-btn')).toHaveLength(1);
    expect(clickHandlers('repo-switch')).toHaveLength(1);
    expect(clickHandlers('plugin-title-actions')).toHaveLength(1);
  });

  it('routes app window events to updateFetchUI and menubar-clearing handlers', async () => {
    const { updateFetchUI } = await import('@scripts/features/fetchActions');
    const { clearPluginMenubarMenus } = await import('@scripts/ui/menubar');
    await import('@scripts/main');
    await waitForBoot();

    for (const ev of ['app:status-updated', 'app:branches-updated', 'app:repo-selected', 'app:vcs-action-labels-updated']) {
      const handler = registrations.find((r) => r.element === window && r.event === ev)?.handler;
      expect(handler).toBe(updateFetchUI);
    }
    const willSwitch = registrations.find((r) => r.element === window && r.event === 'app:repo-will-switch')?.handler;
    expect(willSwitch).toBe(clearPluginMenubarMenus);
  });
});
