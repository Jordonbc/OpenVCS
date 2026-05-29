// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/tauri', () => ({
  TAURI: {
    invoke: vi.fn(),
  },
}));

vi.mock('../lib/notify', () => ({
  notify: vi.fn(),
}));

vi.mock('../ui/modals', () => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  hydrate: vi.fn(),
}));

vi.mock('./repoSelection', () => ({
  refreshRepoSummary: vi.fn().mockResolvedValue(undefined),
}));

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

class MutationObserverMock {
  constructor(private readonly callback: MutationCallback) {}

  observe = vi.fn(() => {
    this.callback([] as MutationRecord[], this as unknown as MutationObserver);
  });

  disconnect = vi.fn();
}

function mountCommandModal() {
  document.body.innerHTML = `
    <div id="command-modal">
      <div class="sheet-head">
        <div class="seg" style="padding-left: 4px">
          <button class="seg-btn active" data-sheet="clone" aria-selected="true" tabindex="0">Clone</button>
          <button class="seg-btn" data-sheet="add" aria-selected="false" tabindex="-1">Add</button>
        </div>
      </div>
      <section id="sheet-clone">
        <input id="clone-url" />
        <input id="clone-path" />
        <button id="browse-clone">Browse clone</button>
        <button id="do-clone" disabled>Clone</button>
      </section>
      <section id="sheet-add" class="hidden">
        <input id="add-path" />
        <button id="browse-add">Browse add</button>
        <button id="do-add" disabled>Add</button>
      </section>
    </div>
  `;

  const seg = document.querySelector('.seg') as HTMLElement;
  const cloneTab = document.querySelector('[data-sheet="clone"]') as HTMLElement;
  const addTab = document.querySelector('[data-sheet="add"]') as HTMLElement;
  seg.getBoundingClientRect = vi.fn(() => ({ left: 10, width: 200 }) as DOMRect);
  cloneTab.getBoundingClientRect = vi.fn(() => ({ left: 14, width: 80 }) as DOMRect);
  addTab.getBoundingClientRect = vi.fn(() => ({ left: 100, width: 70 }) as DOMRect);
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mountCommandModal();
  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  window.MutationObserver = MutationObserverMock as unknown as typeof MutationObserver;
});

describe('bindCommandSheet', () => {
  it('validates clone inputs and surfaces backend rejection reasons', async () => {
    const { TAURI } = await import('../lib/tauri');
    const { notify } = await import('../lib/notify');
    vi.mocked(TAURI.invoke).mockResolvedValueOnce({ ok: false, reason: 'Bad clone input' });

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const cloneUrl = document.getElementById('clone-url') as HTMLInputElement;
    cloneUrl.value = 'https://example.com/repo.git';
    cloneUrl.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(TAURI.invoke).toHaveBeenCalledWith('validate_clone_input', {
      url: 'https://example.com/repo.git',
      dest: '',
    });
    expect(document.getElementById('do-clone')).toHaveProperty('disabled', true);
    expect(notify).toHaveBeenCalledWith('Bad clone input');
  });

  it('switches tabs via keyboard navigation and updates panel visibility', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const seg = document.querySelector('.seg') as HTMLElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    const addTab = document.querySelector('[data-sheet="add"]') as HTMLButtonElement;
    expect(addTab.classList.contains('active')).toBe(true);
    expect(addTab.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('sheet-clone')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('sheet-add')?.classList.contains('hidden')).toBe(false);
  });

  it('ignores unsupported keyboard shortcuts on the segment control', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const cloneTab = document.querySelector('[data-sheet="clone"]') as HTMLButtonElement;
    const seg = document.querySelector('.seg') as HTMLElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(cloneTab.classList.contains('active')).toBe(true);
  });

  it('opens the requested sheet and focuses the first relevant input', async () => {
    const { openModal } = await import('../ui/modals');
    const focusSpy = vi.spyOn(document.getElementById('add-path') as HTMLInputElement, 'focus');
    const { openSheet } = await import('./commandSheet');

    openSheet('add');
    vi.runAllTimers();

    expect(openModal).toHaveBeenCalledWith('command-modal');
    expect(document.querySelector('[data-sheet="add"]')?.classList.contains('active')).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('runs clone flow, refreshes summary, and closes the modal', async () => {
    const { TAURI } = await import('../lib/tauri');
    const { notify } = await import('../lib/notify');
    const { closeModal } = await import('../ui/modals');
    const { refreshRepoSummary } = await import('./repoSelection');
    vi.mocked(TAURI.invoke)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(undefined);

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('clone-url') as HTMLInputElement).value = 'https://example.com/repo.git';
    (document.getElementById('clone-path') as HTMLInputElement).value = '/tmp/repo';
    (document.getElementById('do-clone') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-clone') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(TAURI.invoke).toHaveBeenCalledWith('clone_repo', {
      url: 'https://example.com/repo.git',
      dest: '/tmp/repo',
    });
    expect(refreshRepoSummary).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Cloned https://example.com/repo.git → /tmp/repo');
    expect(closeModal).toHaveBeenCalledWith('command-modal');
  });

  it('notifies when add fails', async () => {
    const { TAURI } = await import('../lib/tauri');
    const { notify } = await import('../lib/notify');
    vi.mocked(TAURI.invoke).mockRejectedValueOnce(new Error('nope'));

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('add-path') as HTMLInputElement).value = '/tmp/repo';
    (document.getElementById('do-add') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-add') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(TAURI.invoke).toHaveBeenCalledWith('add_repo', { path: '/tmp/repo' });
    expect(notify).toHaveBeenCalledWith('Add failed');
  });

  it('runs add flow successfully and closes the modal', async () => {
    const { TAURI } = await import('../lib/tauri');
    const { notify } = await import('../lib/notify');
    const { closeModal } = await import('../ui/modals');
    const { refreshRepoSummary } = await import('./repoSelection');
    vi.mocked(TAURI.invoke).mockResolvedValueOnce(undefined);

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('add-path') as HTMLInputElement).value = '/tmp/repo';
    (document.getElementById('do-add') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-add') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshRepoSummary).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Added /tmp/repo');
    expect(closeModal).toHaveBeenCalledWith('command-modal');
  });

  it('disables actions when validation commands reject', async () => {
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke)
      .mockRejectedValueOnce(new Error('clone validation failed'))
      .mockRejectedValueOnce(new Error('add validation failed'));

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('clone-path') as HTMLInputElement).value = '/tmp/clone';
    (document.getElementById('clone-path') as HTMLInputElement).dispatchEvent(
      new Event('input', { bubbles: true }),
    );
    await Promise.resolve();

    (document.getElementById('add-path') as HTMLInputElement).value = '/tmp/add';
    (document.getElementById('add-path') as HTMLInputElement).dispatchEvent(
      new Event('input', { bubbles: true }),
    );
    await Promise.resolve();

    expect(document.getElementById('do-clone')).toHaveProperty('disabled', true);
    expect(document.getElementById('do-add')).toHaveProperty('disabled', true);
  });

  it('notifies when clone fails after submission', async () => {
    const { TAURI } = await import('../lib/tauri');
    const { notify } = await import('../lib/notify');
    vi.mocked(TAURI.invoke).mockRejectedValueOnce(new Error('clone failed'));

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('clone-url') as HTMLInputElement).value = 'https://example.com/repo.git';
    (document.getElementById('clone-path') as HTMLInputElement).value = '/tmp/repo';
    (document.getElementById('do-clone') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-clone') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('Clone failed');
  });

  it('populates browse actions and revalidates chosen directories', async () => {
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke)
      .mockResolvedValueOnce('/repos/clone-target')
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce('/repos/existing')
      .mockResolvedValueOnce({ ok: true });

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('browse-clone') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect((document.getElementById('clone-path') as HTMLInputElement).value).toBe('/repos/clone-target');

    (document.getElementById('browse-add') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect((document.getElementById('add-path') as HTMLInputElement).value).toBe('/repos/existing');
  });
});
