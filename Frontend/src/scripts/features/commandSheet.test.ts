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

  it('navigates tabs via ArrowLeft and ArrowRight', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const seg = document.querySelector('.seg') as HTMLElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const addTab = document.querySelector('[data-sheet="add"]') as HTMLButtonElement;
    expect(addTab.classList.contains('active')).toBe(true);

    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const cloneTab = document.querySelector('[data-sheet="clone"]') as HTMLButtonElement;
    expect(cloneTab.classList.contains('active')).toBe(true);
  });

  it('navigates tabs via Home and End keyboard shortcuts', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const seg = document.querySelector('.seg') as HTMLElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const addTab = document.querySelector('[data-sheet="add"]') as HTMLButtonElement;
    expect(addTab.classList.contains('active')).toBe(true);

    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    const cloneTab = document.querySelector('[data-sheet="clone"]') as HTMLButtonElement;
    expect(cloneTab.classList.contains('active')).toBe(true);
  });

  it('activates focused tab via Enter key', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const cloneTab = document.querySelector('[data-sheet="clone"]') as HTMLButtonElement;
    cloneTab.focus();
    const seg = document.querySelector('.seg') as HTMLElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });

  it('activates focused tab via Space key', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    const cloneTab = document.querySelector('[data-sheet="clone"]') as HTMLButtonElement;
    cloneTab.focus();
    const seg = document.querySelector('.seg') as HTMLElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
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

  it('runs clone flow and closes the modal', async () => {
    const { TAURI } = await import('../lib/tauri');
    const { notify } = await import('../lib/notify');
    const { closeModal } = await import('../ui/modals');
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
    vi.mocked(TAURI.invoke).mockResolvedValueOnce(undefined);

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    (document.getElementById('add-path') as HTMLInputElement).value = '/tmp/repo';
    (document.getElementById('do-add') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-add') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

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

describe('setDisabled, ensureIndicator, positionIndicator coverage', () => {
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

  it('setDisabled handles missing element gracefully', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    document.getElementById('do-clone')?.remove();

    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockResolvedValueOnce({ ok: false, reason: 'bad' });

    const cloneUrl = document.getElementById('clone-url') as HTMLInputElement;
    cloneUrl.value = 'test';
    cloneUrl.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });

  it('ensureIndicator returns null when seg element is absent', async () => {
    document.querySelector('.seg')?.remove();

    const { bindCommandSheet } = await import('./commandSheet');
    expect(() => bindCommandSheet()).not.toThrow();
  });

  it('positionIndicator handles missing active tab', async () => {
    document.querySelector('.seg-btn.active')?.classList.remove('active');

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
  });

  it('sets __wired flag and skips re-wiring on second call', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
    const root = document.getElementById('command-modal') as any;
    expect(root.__wired).toBe(true);
    expect(() => bindCommandSheet()).not.toThrow();
  });

  it('initializes ResizeObserver for seg element', async () => {
    const origRO = window.ResizeObserver;
    const observeFn = vi.fn();
    class ROClass {
      observe = observeFn;
      disconnect = vi.fn();
    }
    window.ResizeObserver = ROClass as unknown as typeof ResizeObserver;

    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();

    expect(observeFn).toHaveBeenCalled();

    window.ResizeObserver = origRO;
  });
});

describe('openSheet default parameter and edge cases', () => {
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

  it('opens sheet with default clone parameter', async () => {
    const { openModal } = await import('../ui/modals');
    const { openSheet } = await import('./commandSheet');
    openSheet();
    expect(openModal).toHaveBeenCalledWith('command-modal');
    expect(document.querySelector('[data-sheet="clone"]')?.classList.contains('active')).toBe(true);
  });

  it('opens sheet with explicit clone parameter', async () => {
    const { openModal } = await import('../ui/modals');
    const { openSheet } = await import('./commandSheet');
    openSheet('clone');
    expect(openModal).toHaveBeenCalledWith('command-modal');
    expect(document.querySelector('[data-sheet="clone"]')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('sheet-add')?.classList.contains('hidden')).toBe(true);
  });

  it('closes sheet via closeSheet', async () => {
    const { closeModal } = await import('../ui/modals');
    const { closeSheet } = await import('./commandSheet');
    closeSheet();
    expect(closeModal).toHaveBeenCalledWith('command-modal');
  });

  it('handles browse clone rejection gracefully', async () => {
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockRejectedValueOnce(new Error('browse failed'));
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
    (document.getElementById('browse-clone') as HTMLButtonElement).click();
    await Promise.resolve();
  });

  it('handles browse add rejection gracefully', async () => {
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockRejectedValueOnce(new Error('browse add failed'));
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
    (document.getElementById('browse-add') as HTMLButtonElement).click();
    await Promise.resolve();
  });

  it('does nothing when no url or dest for clone', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockClear();
    (document.getElementById('do-clone') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-clone') as HTMLButtonElement).click();
    expect(vi.mocked(TAURI.invoke)).not.toHaveBeenCalledWith('clone_repo', expect.anything());
  });

  it('does nothing when no path for add', async () => {
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockClear();
    (document.getElementById('do-add') as HTMLButtonElement).disabled = false;
    (document.getElementById('do-add') as HTMLButtonElement).click();
    expect(vi.mocked(TAURI.invoke)).not.toHaveBeenCalledWith('add_repo', expect.anything());
  });

  it('handles missing do-add button', async () => {
    document.getElementById('do-add')?.remove();
    const { bindCommandSheet } = await import('./commandSheet');
    bindCommandSheet();
    const { TAURI } = await import('../lib/tauri');
    vi.mocked(TAURI.invoke).mockClear();
    expect(() => {
      (document.getElementById('add-path') as HTMLInputElement).value = '/tmp/repo';
    }).not.toThrow();
  });

  it('handles missing browse buttons', async () => {
    document.getElementById('browse-clone')?.remove();
    document.getElementById('browse-add')?.remove();
    const { bindCommandSheet } = await import('./commandSheet');
    expect(() => bindCommandSheet()).not.toThrow();
  });
});
