// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCtxMenu } from './menu';

describe('buildCtxMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders items with correct labels', () => {
    buildCtxMenu([
      { label: 'Item 1' },
      { label: 'Item 2' },
    ], 100, 200);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu).not.toBeNull();
    const items = menu.querySelectorAll('.item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Item 1');
    expect(items[1].textContent).toBe('Item 2');
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
  });

  it('renders separator elements for --- items', () => {
    buildCtxMenu([
      { label: 'A' },
      { label: '---' },
      { label: 'B' },
    ], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    const seps = menu.querySelectorAll('.sep');
    expect(seps).toHaveLength(1);
    const items = menu.querySelectorAll('.item');
    expect(items).toHaveLength(2);
  });

  it('normalizes leading separators', () => {
    buildCtxMenu([
      { label: '---' },
      { label: '---' },
      { label: 'Item' },
    ], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    // Only the item should be rendered (all leading seps removed)
    expect(menu.querySelectorAll('.item')).toHaveLength(1);
    expect(menu.querySelectorAll('.sep')).toHaveLength(0);
  });

  it('normalizes trailing separators', () => {
    buildCtxMenu([
      { label: 'Item' },
      { label: '---' },
      { label: '---' },
    ], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu.querySelectorAll('.item')).toHaveLength(1);
    expect(menu.querySelectorAll('.sep')).toHaveLength(0);
  });

  it('collapses consecutive separators into one', () => {
    buildCtxMenu([
      { label: 'A' },
      { label: '---' },
      { label: '---' },
      { label: '---' },
      { label: 'B' },
    ], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu.querySelectorAll('.sep')).toHaveLength(1);
    expect(menu.querySelectorAll('.item')).toHaveLength(2);
  });

  it('handles empty items array', () => {
    buildCtxMenu([], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu.children).toHaveLength(0);
  });

  it('handles all-separator array (normalized to empty)', () => {
    buildCtxMenu([
      { label: '---' },
      { label: '---' },
    ], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu.children).toHaveLength(0);
  });

  it('removes existing ctxmenu before creating a new one', () => {
    buildCtxMenu([{ label: 'First' }], 0, 0);
    buildCtxMenu([{ label: 'Second' }], 0, 0);

    const menus = document.querySelectorAll('.ctxmenu');
    expect(menus).toHaveLength(1);
    expect(menus[0].querySelector('.item')!.textContent).toBe('Second');
  });

  it('calls action on click and removes menu', () => {
    const action = vi.fn();
    buildCtxMenu([{ label: 'Click Me', action }], 0, 0);

    const item = document.querySelector('.item') as HTMLElement;
    item.click();

    expect(action).toHaveBeenCalledOnce();
    expect(document.querySelector('.ctxmenu')).toBeNull();
  });

  it('handles action without action defined', () => {
    buildCtxMenu([{ label: 'No Action' }], 0, 0);

    const item = document.querySelector('.item') as HTMLElement;
    expect(() => item.click()).not.toThrow();
    expect(document.querySelector('.ctxmenu')).toBeNull();
  });

  it('removes menu when action throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    buildCtxMenu([{ label: 'Error', action: () => { throw new Error('oops'); } }], 0, 0);

    const item = document.querySelector('.item') as HTMLElement;
    expect(() => item.click()).not.toThrow();
    expect(document.querySelector('.ctxmenu')).toBeNull();
  });

  it('handles async action returning a promise with catch', () => {
    const action = vi.fn().mockRejectedValue(new Error('async fail'));
    buildCtxMenu([{ label: 'Async', action }], 0, 0);

    const item = document.querySelector('.item') as HTMLElement;
    expect(() => item.click()).not.toThrow();
    expect(action).toHaveBeenCalledOnce();
    // Menu removed synchronously in finally block
    expect(document.querySelector('.ctxmenu')).toBeNull();
  });

  it('appends menu to document body', () => {
    buildCtxMenu([{ label: 'Test' }], 10, 20);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu.parentElement).toBe(document.body);
  });

  it('clamps position within viewport', () => {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 200, height: 100, top: 0, left: 0,
      bottom: 100, right: 200, x: 0, y: 0,
      toJSON: () => ({}),
    })) as unknown as typeof Element.prototype.getBoundingClientRect;

    const origInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const origInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });

    // Position off-screen
    buildCtxMenu([{ label: 'Clamped' }], 5000, 5000);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    const left = parseInt(menu.style.left, 10);
    const top = parseInt(menu.style.top, 10);

    // Must be clamped within viewport minus margin
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(800 - 200 - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(600 - 100 - 8);

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    if (origInnerWidth) Object.defineProperty(window, 'innerWidth', origInnerWidth);
    if (origInnerHeight) Object.defineProperty(window, 'innerHeight', origInnerHeight);
  });

  it('flips position when near right edge with room to flip left', () => {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 200, height: 100, top: 0, left: 0,
      bottom: 100, right: 200, x: 0, y: 0,
      toJSON: () => ({}),
    })) as unknown as typeof Element.prototype.getBoundingClientRect;

    const origInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

    // Position near right edge
    // left=1000, width=200, vw=1024: 1000+200=1200 > 1024-8=1016, and 1000-200=800 >= 8 → flip
    buildCtxMenu([{ label: 'Flip' }], 1000, 500);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    const left = parseInt(menu.style.left, 10);

    // Should be flipped to x - rect.width (1000-200=800), then clamped
    expect(left).toBeLessThan(1000);

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    if (origInnerWidth) Object.defineProperty(window, 'innerWidth', origInnerWidth);
  });

  it('flips position when near bottom edge with room to flip up', () => {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 150, height: 80, top: 0, left: 0,
      bottom: 80, right: 150, x: 0, y: 0,
      toJSON: () => ({}),
    })) as unknown as typeof Element.prototype.getBoundingClientRect;

    const origInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });

    // Position near bottom edge
    // top=580, height=80, vh=600: 580+80=660 > 600-8=592, and 580-80=500 >= 8 → flip
    buildCtxMenu([{ label: 'Flip' }], 100, 580);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    const top = parseInt(menu.style.top, 10);

    // Should be flipped to y - rect.height (580-80=500), then clamped
    expect(top).toBeLessThan(580);

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    if (origInnerHeight) Object.defineProperty(window, 'innerHeight', origInnerHeight);
  });

  it('falls back to 0 when both window and documentElement dimensions are zero', () => {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 100, height: 50, top: 0, left: 0,
      bottom: 50, right: 100, x: 0, y: 0,
      toJSON: () => ({}),
    })) as unknown as typeof Element.prototype.getBoundingClientRect;

    const origInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const origInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const origClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    const origClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 0, configurable: true });

    expect(() => buildCtxMenu([{ label: 'Zero' }], 100, 100)).not.toThrow();

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    if (origInnerWidth) Object.defineProperty(window, 'innerWidth', origInnerWidth);
    if (origInnerHeight) Object.defineProperty(window, 'innerHeight', origInnerHeight);
    if (origClientWidth) Object.defineProperty(document.documentElement, 'clientWidth', origClientWidth);
    if (origClientHeight) Object.defineProperty(document.documentElement, 'clientHeight', origClientHeight);
  });

  it('uses documentElement dimensions when window dimensions are zero', () => {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 100, height: 50, top: 0, left: 0,
      bottom: 50, right: 100, x: 0, y: 0,
      toJSON: () => ({}),
    })) as unknown as typeof Element.prototype.getBoundingClientRect;

    const origInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const origInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const origClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    const origClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1024, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 768, configurable: true });

    expect(() => buildCtxMenu([{ label: 'Doc' }], 100, 100)).not.toThrow();

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    if (origInnerWidth) Object.defineProperty(window, 'innerWidth', origInnerWidth);
    if (origInnerHeight) Object.defineProperty(window, 'innerHeight', origInnerHeight);
    if (origClientWidth) Object.defineProperty(document.documentElement, 'clientWidth', origClientWidth);
    if (origClientHeight) Object.defineProperty(document.documentElement, 'clientHeight', origClientHeight);
  });

  it('handles clamping errors gracefully (getBoundingClientRect throws)', () => {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = vi.fn(() => {
      throw new Error('measurement failed');
    }) as unknown as typeof Element.prototype.getBoundingClientRect;

    expect(() => buildCtxMenu([{ label: 'Safe' }], 100, 100)).not.toThrow();

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu).toBeTruthy();
    // Position stays at original x/y when clamping fails
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('100px');

    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
  });

  it('sets up click-to-close listener after timeout', () => {
    vi.useFakeTimers();
    buildCtxMenu([{ label: 'Close' }], 0, 0);

    const menu = document.querySelector('.ctxmenu') as HTMLElement;
    expect(menu).toBeTruthy();

    // Advance the setTimeout(0) which adds the document click listener
    vi.advanceTimersByTime(0);

    // Verify document click removes menu
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.ctxmenu')).toBeNull();

    vi.useRealTimers();
  });
});
