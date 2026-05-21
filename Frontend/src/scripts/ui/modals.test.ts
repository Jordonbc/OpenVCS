// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/scrollbars', () => ({
  initOverlayScrollbarsFor: vi.fn(),
  refreshOverlayScrollbarsFor: vi.fn(),
}));

function mountRoot() {
  document.body.innerHTML = '<div id="modals-root"></div>';
}

describe('hydrate', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('adds existing element id to loaded set', async () => {
    document.body.innerHTML = '<div id="existing-modal"></div>';
    const { hydrate } = await import('./modals');
    expect(() => hydrate('existing-modal')).not.toThrow();
  });

  it('throws when no fragment is registered for unknown id', async () => {
    mountRoot();
    const { hydrate } = await import('./modals');
    expect(() => hydrate('unknown-modal')).toThrow('No fragment registered for unknown-modal');
  });

  it('does nothing when root is missing', async () => {
    const { hydrate } = await import('./modals');
    expect(() => hydrate('settings-modal')).not.toThrow();
  });
});

describe('openModal', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = '';
  });

  it('opens a modal by setting aria-hidden to false', async () => {
    const { openModal } = await import('./modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('test-modal');

    const modal = document.getElementById('test-modal');
    expect(modal?.getAttribute('aria-hidden')).toBe('false');
  });

  it('locks scroll when opening', async () => {
    const { openModal } = await import('./modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('test-modal');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('wires click-to-close on first open', async () => {
    vi.useFakeTimers();
    const { openModal, closeModal } = await import('./modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('test-modal');
    const modal = document.getElementById('test-modal')!;

    const backdrop = modal.querySelector('.backdrop') as HTMLElement;
    backdrop.click();

    vi.advanceTimersByTime(200);

    expect(modal.getAttribute('aria-hidden')).toBe('true');
    vi.useRealTimers();
  });

  it('does not re-wire close handler on subsequent opens', async () => {
    const { openModal, closeModal } = await import('./modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('test-modal');
    closeModal('test-modal');
    openModal('test-modal');

    const modal = document.getElementById('test-modal')!;
    expect(modal.getAttribute('aria-hidden')).toBe('false');
  });
});

describe('closeModal', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = 'hidden';
  });

  it('sets aria-hidden to true and unlocks scroll', async () => {
    const { closeModal } = await import('./modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="false"></div>';

    closeModal('test-modal');

    const modal = document.getElementById('test-modal');
    expect(modal?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.style.overflow).toBe('');
  });

  it('does nothing when modal is not found', async () => {
    const { closeModal } = await import('./modals');
    expect(() => closeModal('nonexistent')).not.toThrow();
  });
});

describe('closeAllModals', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = 'hidden';
  });

  it('closes all open modals and resets scroll lock', async () => {
    const { closeAllModals } = await import('./modals');
    document.body.innerHTML += `
      <div id="modal1" class="modal" aria-hidden="false"></div>
      <div id="modal2" class="modal" aria-hidden="false"></div>
    `;

    closeAllModals();

    expect(document.getElementById('modal1')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.getElementById('modal2')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.style.overflow).toBe('');
  });
});

describe('declarative opener (data-modal-open)', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('opens a modal when a data-modal-open element is clicked', async () => {
    document.body.innerHTML = `
      <div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>
      <button data-modal-open="#test-modal">Open</button>
    `;

    await import('./modals');

    const btn = document.querySelector('[data-modal-open]') as HTMLElement;
    btn.click();

    const modal = document.getElementById('test-modal');
    expect(modal?.getAttribute('aria-hidden')).toBe('false');
  });
});

describe('ESC key closes top modal', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the top-most open modal on Escape keydown', async () => {
    document.body.innerHTML = `
      <div id="modal1" class="modal" aria-hidden="false"><div class="backdrop"></div></div>
    `;

    await import('./modals');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(200);

    const modal = document.getElementById('modal1');
    expect(modal?.getAttribute('aria-hidden')).toBe('true');
    vi.useRealTimers();
  });

  it('ignores non-Escape keys', async () => {
    const { closeModal } = await import('./modals');
    document.body.innerHTML = `
      <div id="modal1" class="modal" aria-hidden="false"></div>
    `;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    // Modal should remain open
    expect(document.getElementById('modal1')?.getAttribute('aria-hidden')).toBe('false');
  });
});

describe('scroll lock counting', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = '';
  });

  it('supports multiple open modals', async () => {
    const { openModal, closeModal } = await import('./modals');
    document.body.innerHTML += `
      <div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>
      <div id="m2" class="modal" aria-hidden="true"><div class="backdrop"></div></div>
    `;

    openModal('m1');
    expect(document.body.style.overflow).toBe('hidden');

    openModal('m2');
    expect(document.body.style.overflow).toBe('hidden');

    closeModal('m1');
    expect(document.body.style.overflow).toBe('hidden');

    closeModal('m2');
    expect(document.body.style.overflow).toBe('');
  });
});

// ---------------------------------------------------------------------------
// closeWithAnimation
// ---------------------------------------------------------------------------

describe('closeWithAnimation', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = 'hidden';
  });

  it('closes modal via backdrop with animation', async () => {
    vi.useFakeTimers();

    const { openModal } = await import('./modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('m1');
    const modal = document.getElementById('m1') as HTMLElement;
    expect(modal.getAttribute('aria-hidden')).toBe('false');

    const backdrop = modal.querySelector('.backdrop') as HTMLElement;
    backdrop.click();
    expect(modal.classList.contains('is-closing')).toBe(true);

    vi.advanceTimersByTime(200);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(modal.classList.contains('is-closing')).toBe(false);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// closeAllModals with animation timer
// ---------------------------------------------------------------------------

describe('closeAllModals with animation timer', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = 'hidden';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears animation timers when closing all modals', async () => {
    vi.useFakeTimers();

    const { openModal, closeAllModals } = await import('./modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');

    const modal = document.getElementById('m1') as HTMLElement;
    const backdrop = modal.querySelector('.backdrop') as HTMLElement;
    backdrop.click();

    closeAllModals();

    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(modal.classList.contains('is-closing')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});

// ---------------------------------------------------------------------------
// openModal with no aria-hidden
// ---------------------------------------------------------------------------

describe('openModal no aria-hidden', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = '';
  });

  it('handles modal without aria-hidden attribute', async () => {
    const { openModal } = await import('./modals');
    document.body.innerHTML += '<div id="m1" class="modal"><div class="backdrop"></div></div>';

    openModal('m1');
    const modal = document.getElementById('m1') as HTMLElement;
    expect(modal.getAttribute('aria-hidden')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// hydrate - with already-in-DOM modal
// ---------------------------------------------------------------------------

describe('hydrate with existing modal', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('adds id to loaded set when modal exists', async () => {
    document.body.innerHTML += '<div id="existing-test-modal"></div>';
    const { hydrate } = await import('./modals');
    expect(() => hydrate('existing-test-modal')).not.toThrow();
    // Second call should not throw either (idempotent)
    expect(() => hydrate('existing-test-modal')).not.toThrow();
  });

  it('re-throws for unknown id with root present', async () => {
    const { hydrate } = await import('./modals');
    expect(() => hydrate('nothing-here')).toThrow('No fragment registered for nothing-here');
  });
});
