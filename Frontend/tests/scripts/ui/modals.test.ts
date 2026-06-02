// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/lib/scrollbars', () => ({
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
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('existing-modal')).not.toThrow();
  });

  it('throws when no fragment is registered for unknown id', async () => {
    mountRoot();
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('unknown-modal')).toThrow('No fragment registered for unknown-modal');
  });

  it('does nothing when root is missing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
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
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('test-modal');

    const modal = document.getElementById('test-modal');
    expect(modal?.getAttribute('aria-hidden')).toBe('false');
  });

  it('locks scroll when opening', async () => {
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';

    openModal('test-modal');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('wires click-to-close on first open', async () => {
    vi.useFakeTimers();
    const { openModal, closeModal } = await import('@scripts/ui/modals');
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
    const { openModal, closeModal } = await import('@scripts/ui/modals');
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
    const { closeModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="test-modal" class="modal" aria-hidden="false"></div>';

    closeModal('test-modal');

    const modal = document.getElementById('test-modal');
    expect(modal?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.style.overflow).toBe('');
  });

  it('does nothing when modal is not found', async () => {
    const { closeModal } = await import('@scripts/ui/modals');
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
    const { closeAllModals } = await import('@scripts/ui/modals');
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

    await import('@scripts/ui/modals');

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

    await import('@scripts/ui/modals');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(200);

    const modal = document.getElementById('modal1');
    expect(modal?.getAttribute('aria-hidden')).toBe('true');
    vi.useRealTimers();
  });

  it('ignores non-Escape keys', async () => {
    const { closeModal } = await import('@scripts/ui/modals');
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
    const { openModal, closeModal } = await import('@scripts/ui/modals');
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

    const { openModal } = await import('@scripts/ui/modals');
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

    const { openModal, closeAllModals } = await import('@scripts/ui/modals');
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
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal"><div class="backdrop"></div></div>';

    openModal('m1');
    const modal = document.getElementById('m1') as HTMLElement;
    expect(modal.getAttribute('aria-hidden')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// hydrate - with already-in-DOM modal
// ---------------------------------------------------------------------------

describe('closeWithAnimation reduce-motion', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('closes without animation when reduce-motion preferred', async () => {
    vi.useFakeTimers();
    const origMM = window.matchMedia;
    window.matchMedia = vi.fn((q: string) => ({
      matches: q.includes('reduced-motion'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) as any;
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');
    (document.querySelector('.backdrop') as HTMLElement).click();
    expect(document.getElementById('m1')!.getAttribute('aria-hidden')).toBe('true');
    window.matchMedia = origMM; vi.useRealTimers();
  });
});

describe('openModal clears pending animation timer', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears timer when reopening before close animation completes', async () => {
    vi.useFakeTimers();
    const origMM = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any;
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');
    (document.querySelector('.backdrop') as HTMLElement).click();
    openModal('m1');
    expect(document.getElementById('m1')!.getAttribute('aria-hidden')).toBe('false');
    window.matchMedia = origMM; vi.useRealTimers();
  });
});

describe('hydrate specific modals', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  it('hydrates settings-modal', async () => { const { hydrate } = await import('@scripts/ui/modals'); expect(() => hydrate('settings-modal')).not.toThrow(); });
  it('hydrates about-modal', async () => { const { hydrate } = await import('@scripts/ui/modals'); expect(() => hydrate('about-modal')).not.toThrow(); });
  it('hydrates update-modal', async () => { const { hydrate } = await import('@scripts/ui/modals'); expect(() => hydrate('update-modal')).not.toThrow(); });
});

describe('closeModal already closed', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  it('no-ops for already hidden modal', async () => {
    const { closeModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"></div>';
    closeModal('m1');
    expect(document.getElementById('m1')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('closeAllModals no open modals', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  it('no-ops when no modals are open', async () => {
    const { closeAllModals } = await import('@scripts/ui/modals');
    expect(() => closeAllModals()).not.toThrow();
  });
});

describe('hydrate with existing modal', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('adds id to loaded set when modal exists', async () => {
    document.body.innerHTML += '<div id="existing-test-modal"></div>';
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('existing-test-modal')).not.toThrow();
    // Second call should not throw either (idempotent)
    expect(() => hydrate('existing-test-modal')).not.toThrow();
  });

  it('re-throws for unknown id with root present', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('nothing-here')).toThrow('No fragment registered for nothing-here');
  });
});

describe('hydrate already-loaded modal', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });

  it('does nothing when modal id was already hydrated', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    hydrate('settings-modal');
    document.body.innerHTML = '<div id="modals-root"></div>';
    expect(() => hydrate('settings-modal')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setModalHidden - no attribute change
// ---------------------------------------------------------------------------

describe('setModalHidden attribute no-change', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('does nothing when aria-hidden already matches target', async () => {
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    // Open once (sets to false)
    openModal('m1');
    // Dispatches modal:opened event once
    const modal = document.getElementById('m1')!;
    const openedSpy = vi.fn();
    const closedSpy = vi.fn();
    modal.addEventListener('modal:opened', openedSpy);
    modal.addEventListener('modal:closed', closedSpy);
    // Open again while already open - setModalHidden called with hidden=false, wasHidden=false
    openModal('m1');
    expect(openedSpy).not.toHaveBeenCalled();
    expect(closedSpy).not.toHaveBeenCalled();
  });

  it('dispatches modal:closed when closing', async () => {
    const { openModal, closeModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');
    const modal = document.getElementById('m1')!;
    const closedSpy = vi.fn();
    modal.addEventListener('modal:closed', closedSpy);
    closeModal('m1');
    expect(closedSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatches modal:opened when opening from hidden state', async () => {
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    const modal = document.getElementById('m1')!;
    const openedSpy = vi.fn();
    modal.addEventListener('modal:opened', openedSpy);
    openModal('m1');
    expect(openedSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// closeWithAnimation with existing timer
// ---------------------------------------------------------------------------

describe('closeWithAnimation existing timer', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears pending animation timer when closing again', async () => {
    vi.useFakeTimers();
    const origMM = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any;
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');

    const modal = document.getElementById('m1') as HTMLElement;
    // Simulate a pending close timer
    (modal as any).__animatedCloseTimer = 1;

    // Clicking backdrop while timer is pending should clear it and restart
    const backdrop = document.querySelector('.backdrop') as HTMLElement;
    backdrop.click();
    expect((modal as any).__animatedCloseTimer).not.toBe(1);
    expect(modal.classList.contains('is-closing')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    window.matchMedia = origMM;
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// closeWithAnimation for repo-switch-drawer (different delay)
// ---------------------------------------------------------------------------

describe('closeWithAnimation repo-switch-drawer', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('closes repo-switch-drawer with 130ms delay', async () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any;
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="repo-switch-drawer" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('repo-switch-drawer');

    (document.querySelector('.backdrop') as HTMLElement).click();
    expect(document.getElementById('repo-switch-drawer')!.classList.contains('is-closing')).toBe(true);

    vi.advanceTimersByTime(130);
    expect(document.getElementById('repo-switch-drawer')!.getAttribute('aria-hidden')).toBe('true');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// closeWithAnimation reduce-motion fix test
// ---------------------------------------------------------------------------

describe('closeWithAnimation reduce-motion precise', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not add is-closing class when reduce-motion is active', async () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn((q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)',
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as any;
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');

    (document.querySelector('.backdrop') as HTMLElement).click();
    const el = document.getElementById('m1') as HTMLElement;
    // Should skip animation and close immediately
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.classList.contains('is-closing')).toBe(false);
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any;
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// openModal - hydrate does not find element (root missing)
// ---------------------------------------------------------------------------

describe('openModal hydrate missing element', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('returns early when hydrate cannot create element', async () => {
    const { openModal } = await import('@scripts/ui/modals');
    // No modals-root, so hydrate can't inject
    expect(() => openModal('settings-modal')).not.toThrow();
    expect(document.getElementById('settings-modal')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// openModal - modal already has aria-hidden attribute
// ---------------------------------------------------------------------------

describe('openModal already has aria-hidden', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
    document.body.style.overflow = '';
  });

  it('does not re-set aria-hidden when already present', async () => {
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="false"><div class="backdrop"></div></div>';
    // Call openModal on already-open modal
    openModal('m1');
    const modal = document.getElementById('m1')!;
    expect(modal.getAttribute('aria-hidden')).toBe('false');
    // wasHidden is false, so lockScroll should NOT be called
    expect(document.body.style.overflow).toBe('');
  });
});

// ---------------------------------------------------------------------------
// openModal clears pending __animatedCloseTimer
// ---------------------------------------------------------------------------

describe('openModal clears close animation timer', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears __animatedCloseTimer when reopening during animation', async () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any;
    const { openModal } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');

    const modal = document.getElementById('m1') as HTMLElement;
    (modal as any).__animatedCloseTimer = 12345;

    openModal('m1');
    expect((modal as any).__animatedCloseTimer).toBeUndefined();
    expect(modal.getAttribute('aria-hidden')).toBe('false');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// data-modal-open with various edge cases
// ---------------------------------------------------------------------------

describe('declarative opener edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('ignores click when data-modal-open is empty after hash removal', async () => {
    document.body.innerHTML = `
      <div id="test-modal" class="modal" aria-hidden="true"></div>
      <button data-modal-open="#">Open</button>
    `;
    await import('@scripts/ui/modals');
    const btn = document.querySelector('[data-modal-open]') as HTMLElement;
    btn.click();
    // Modal should remain hidden since id is empty after # replacement
    expect(document.getElementById('test-modal')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores click on element without data-modal-open attribute', async () => {
    document.body.innerHTML = `
      <div id="test-modal" class="modal" aria-hidden="true"></div>
      <button>No open attr</button>
    `;
    await import('@scripts/ui/modals');
    const btn = document.querySelector('button') as HTMLElement;
    btn.click();
    expect(document.getElementById('test-modal')?.getAttribute('aria-hidden')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// ESC key edge cases
// ---------------------------------------------------------------------------

describe('ESC key edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('does nothing when no open modals exist', async () => {
    await import('@scripts/ui/modals');
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
  });

  it('does nothing when top modal has no id', async () => {
    document.body.innerHTML = '<div class="modal" aria-hidden="false"></div>';
    await import('@scripts/ui/modals');
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// hydrate wiring for additional modal types
// ---------------------------------------------------------------------------

describe('hydrate wiring for specific modals', () => {
  beforeEach(() => {
    vi.resetModules();
    mountRoot();
  });

  it('hydrates repo-settings-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('repo-settings-modal')).not.toThrow();
  });

  it('hydrates new-branch-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('new-branch-modal')).not.toThrow();
  });

  it('hydrates rename-branch-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('rename-branch-modal')).not.toThrow();
  });

  it('hydrates cherry-pick-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('cherry-pick-modal')).not.toThrow();
  });

  it('hydrates confirm-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('confirm-modal')).not.toThrow();
  });

  it('hydrates set-upstream-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('set-upstream-modal')).not.toThrow();
  });

  it('hydrates stash-confirm-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('stash-confirm-modal')).not.toThrow();
  });

  it('hydrates merge-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('merge-modal')).not.toThrow();
  });

  it('hydrates conflicts-summary-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('conflicts-summary-modal')).not.toThrow();
  });

  it('hydrates ssh-keys-modal without throwing', async () => {
    const { hydrate } = await import('@scripts/ui/modals');
    expect(() => hydrate('ssh-keys-modal')).not.toThrow();
  });
});

describe('closeAllModals with existing timers', () => {
  beforeEach(() => { vi.resetModules(); mountRoot(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears pending animation timers before closing', async () => {
    vi.useFakeTimers();
    const { openModal, closeAllModals } = await import('@scripts/ui/modals');
    document.body.innerHTML += '<div id="m1" class="modal" aria-hidden="true"><div class="backdrop"></div></div>';
    openModal('m1');

    const modal = document.getElementById('m1') as HTMLElement;
    (modal as any).__animatedCloseTimer = 12345;

    closeAllModals();
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(modal.classList.contains('is-closing')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});
