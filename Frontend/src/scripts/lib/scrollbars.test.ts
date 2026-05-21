// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInstance = vi.hoisted(() => ({
  update: vi.fn(),
  destroy: vi.fn(),
}));

const mockInstancesMap = vi.hoisted(() => new Map<any, any>());

const mockOverlayScrollbars = vi.hoisted(() => vi.fn());

vi.mock('overlayscrollbars', () => ({
  OverlayScrollbars: mockOverlayScrollbars,
}));

import {
  initOverlayScrollbarsFor,
  refreshOverlayScrollbarsFor,
  destroyOverlayScrollbarsFor,
  initOverlayScrollbars,
} from './scrollbars';

beforeEach(() => {
  mockInstancesMap.clear();
  mockOverlayScrollbars.mockClear();
  mockOverlayScrollbars.mockImplementation((el: any, options?: any) => {
    if (options) {
      mockInstancesMap.set(el, mockInstance);
      return mockInstance;
    }
    return mockInstancesMap.get(el) ?? null;
  });
  mockInstance.update.mockClear();
  mockInstance.destroy.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function createScrollable(className: string, id?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  if (id) el.id = id;
  document.body.appendChild(el);
  return el;
}

describe('initOverlayScrollbarsFor', () => {
  it('initializes scrollable elements found in root', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el, expect.any(Object));
  });

  it('skips initialization if element already has instance', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    // First init: getInstance(el) + create(el, options)
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el, expect.any(Object));
    mockOverlayScrollbars.mockClear();

    // Second call should skip create (getInstance returns existing instance)
    initOverlayScrollbarsFor(document);
    expect(mockOverlayScrollbars).not.toHaveBeenCalledWith(el, expect.any(Object));
  });

  it('skips initialization if element has OS_ATTR attribute', () => {
    const el = createScrollable('conflict-code');
    el.setAttribute('data-overlayscrollbars-initialize', '1');
    initOverlayScrollbarsFor(document);
    // getInstance(el) is called (1-arg) but init should not proceed
    expect(mockOverlayScrollbars).not.toHaveBeenCalledWith(el, expect.any(Object));
  });

  it('removes attribute when OverlayScrollbars returns null', () => {
    const el = createScrollable('pop-list-scroll');
    mockOverlayScrollbars.mockReturnValue(null);
    initOverlayScrollbarsFor(document);
    expect(el.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
  });

  it('removes attribute when OverlayScrollbars throws', () => {
    const el = createScrollable('pop-list-scroll');
    mockOverlayScrollbars.mockImplementation(() => { throw new Error('init fail'); });
    initOverlayScrollbarsFor(document);
    expect(el.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
  });

  it('defaults root to document when not provided', () => {
    const el = createScrollable('plugins-list-scroll');
    initOverlayScrollbarsFor();
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el, expect.any(Object));
  });

  it('initializes elements when root is the scrollable element itself', () => {
    const el = createScrollable('conflict-code');
    initOverlayScrollbarsFor(el);
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el, expect.any(Object));
  });
});

describe('refreshOverlayScrollbarsFor', () => {
  it('calls update on existing instance', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    expect(mockInstance.update).not.toHaveBeenCalled();

    refreshOverlayScrollbarsFor(document);
    expect(mockInstance.update).toHaveBeenCalled();
  });

  it('re-initializes when instance has no update function', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    mockOverlayScrollbars.mockClear();

    // Clear the map so getInstance returns null
    mockInstancesMap.clear();
    // Remove marker attribute so initOne does not skip
    el.removeAttribute('data-overlayscrollbars-initialize');

    refreshOverlayScrollbarsFor(document);
    // Should have called init again: getInstance(el) + create(el, options)
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el, expect.any(Object));
  });

  it('handles update throwing gracefully', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);

    mockInstance.update.mockImplementation(() => { throw new Error('update fail'); });
    expect(() => refreshOverlayScrollbarsFor(document)).not.toThrow();
    expect(mockInstance.update).toHaveBeenCalled();
  });

  it('respects refresh minimum interval', () => {
    vi.useFakeTimers();
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    mockInstance.update.mockClear();

    vi.advanceTimersByTime(200);
    refreshOverlayScrollbarsFor(document);
    expect(mockInstance.update).toHaveBeenCalledTimes(1);

    // Immediate second call within 180ms should be rate-limited
    refreshOverlayScrollbarsFor(document);
    expect(mockInstance.update).toHaveBeenCalledTimes(1);

    // After waiting 180ms, next call should go through
    vi.advanceTimersByTime(180);
    refreshOverlayScrollbarsFor(document);
    expect(mockInstance.update).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('defaults root to document', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    mockInstance.update.mockClear();

    refreshOverlayScrollbarsFor();
    expect(mockInstance.update).toHaveBeenCalled();
  });
});

describe('destroyOverlayScrollbarsFor', () => {
  it('destroys instances for matching string selector', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    expect(mockInstance.destroy).not.toHaveBeenCalled();

    destroyOverlayScrollbarsFor('.pop-list-scroll');
    expect(mockInstance.destroy).toHaveBeenCalled();
    expect(el.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
  });

  it('handles string selector with no matches gracefully', () => {
    expect(() => destroyOverlayScrollbarsFor('.non-existent')).not.toThrow();
  });

  it('skips destroy when instance is null (falsy branch)', () => {
    const el = createScrollable('pop-list-scroll');
    el.setAttribute('data-overlayscrollbars-initialize', '1');
    destroyOverlayScrollbarsFor('.pop-list-scroll');
    expect(mockInstance.destroy).not.toHaveBeenCalled();
    expect(el.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
  });

  it('destroyOne skips attribute removal when no OS_ATTR present', () => {
    const el = createScrollable('pop-list-scroll');
    mockInstancesMap.set(el, mockInstance);
    destroyOverlayScrollbarsFor('.pop-list-scroll');
    expect(mockInstance.destroy).toHaveBeenCalled();
    expect(el.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
  });

  it('handles destroy throwing gracefully', () => {
    const el = createScrollable('pop-list-scroll');
    el.setAttribute('data-overlayscrollbars-initialize', '1');
    mockInstancesMap.set(el, mockInstance);
    mockInstance.destroy.mockImplementation(() => { throw new Error('destroy fail'); });
    expect(() => destroyOverlayScrollbarsFor('.pop-list-scroll')).not.toThrow();
    expect(mockInstance.destroy).toHaveBeenCalled();
  });

  it('handles invalid string selector via catch', () => {
    // An invalid CSS selector will cause querySelectorAll to throw
    expect(() => destroyOverlayScrollbarsFor('###invalid' as any)).not.toThrow();
  });

  it('destroys instances for ParentNode including hidden elements', () => {
    const el = createScrollable('pop-list-scroll');

    // Manually set up an instance to simulate what initOne does
    el.setAttribute('data-overlayscrollbars-initialize', '1');
    mockInstancesMap.set(el, mockInstance);

    mockInstance.destroy.mockClear();
    destroyOverlayScrollbarsFor(document);
    // document as ParentNode uses includeHidden=true
    expect(mockInstance.destroy).toHaveBeenCalled();
    expect(el.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
  });

  it('defaults target to document', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    mockInstance.destroy.mockClear();

    destroyOverlayScrollbarsFor();
    expect(mockInstance.destroy).toHaveBeenCalled();
  });
});

describe('initOverlayScrollbars (alias)', () => {
  it('is an alias for initOverlayScrollbarsFor', () => {
    expect(initOverlayScrollbars).toBe(initOverlayScrollbarsFor);
  });
});

describe('isVisibleForInit (internal behavior)', () => {
  it('returns true for connected visible elements', () => {
    const el = createScrollable('pop-list-scroll');
    initOverlayScrollbarsFor(document);
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el, expect.any(Object));
  });

  it('filters out elements inside hidden popovers', () => {
    const popover = document.createElement('div');
    popover.className = 'popover';
    popover.setAttribute('hidden', '');
    const inner = document.createElement('div');
    inner.className = 'pop-list-scroll';
    popover.appendChild(inner);
    document.body.appendChild(popover);

    initOverlayScrollbarsFor(document);
    expect(mockOverlayScrollbars).not.toHaveBeenCalledWith(inner, expect.any(Object));
  });

  it('filters out elements inside hidden modals', () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div');
    inner.className = 'pop-list-scroll';
    modal.appendChild(inner);
    document.body.appendChild(modal);

    initOverlayScrollbarsFor(document);
    expect(mockOverlayScrollbars).not.toHaveBeenCalledWith(inner, expect.any(Object));
  });

  it('filters out disconnected scrollable root via isVisibleForInit', () => {
    const detached = document.createElement('div');
    detached.className = 'pop-list-scroll';

    initOverlayScrollbarsFor(detached);
    expect(mockOverlayScrollbars).not.toHaveBeenCalledWith(detached, expect.any(Object));
  });
});

describe('queryScrollableElements (internal behavior)', () => {
  it('matches multiple scrollable selectors', () => {
    const el1 = createScrollable('pop-list-scroll');
    const el2 = createScrollable('conflict-code');
    const el3 = createScrollable('merge-readonly');

    initOverlayScrollbarsFor(document);
    // Should have initialized all three
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el1, expect.any(Object));
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el2, expect.any(Object));
    expect(mockOverlayScrollbars).toHaveBeenCalledWith(el3, expect.any(Object));
  });

  it('filters out detached elements', () => {
    const detached = document.createElement('div');
    detached.className = 'pop-list-scroll';
    // Not appended to document

    initOverlayScrollbarsFor(document);
    expect(mockOverlayScrollbars).not.toHaveBeenCalledWith(detached, expect.any(Object));
  });

});
