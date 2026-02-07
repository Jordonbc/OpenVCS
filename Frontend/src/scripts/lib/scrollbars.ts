import { OverlayScrollbars } from 'overlayscrollbars';

// Use the official attribute name so OverlayScrollbars can hide native scrollbars
// during initialization to reduce flicker.
const OS_ATTR = 'data-overlayscrollbars-initialize';
const SCROLLABLE_SELECTOR = [
  '.pop-list-scroll',
  '.plugins-list-scroll',
  '#command-modal .recent',
  '#repo-settings-modal .sheet-body',
  '#new-branch-modal .sheet-body',
  '#stash-confirm-modal .sheet-body',
  '#stash-confirm-modal #stash-file-container',
  '#ssh-keys-modal .ssh-box',
  '.merge-readonly',
  '.conflict-code',
].join(', ');

const OVERLAY_OPTIONS = {
  overflow: {
    x: 'hidden' as const,
    y: 'scroll' as const,
  },
  update: {
    // Disable the built-in observers so only our explicit refresh logic runs.
    debounce: {
      mutation: null,
      resize: null,
      event: null,
      env: null,
    },
    elementEvents: null,
  },
  scrollbars: {
    theme: 'os-theme-openvcs',
    autoHide: 'never' as const,
  },
};
const REFRESH_MIN_INTERVAL_MS = 180;
const lastRefreshAt = new WeakMap<HTMLElement, number>();

function getInstance(el: HTMLElement): any | null {
  try {
    return (OverlayScrollbars as any)(el) as any;
  } catch {
    return null;
  }
}

function initOne(el: HTMLElement) {
  const existing = getInstance(el);
  if (existing) return;
  if (el.hasAttribute(OS_ATTR)) return;

  el.setAttribute(OS_ATTR, '1');
  try {
    const instance = OverlayScrollbars(el, OVERLAY_OPTIONS);
    // If initialization didn't yield an instance, restore native scrollbars.
    if (!instance) el.removeAttribute(OS_ATTR);
  } catch {
    // If initialization fails for any reason, remove the marker so we can retry later.
    el.removeAttribute(OS_ATTR);
  }
}

function refreshOne(el: HTMLElement) {
  const now = Date.now();
  const last = lastRefreshAt.get(el) || 0;
  if (now - last < REFRESH_MIN_INTERVAL_MS) return;
  lastRefreshAt.set(el, now);

  const instance = getInstance(el);
  if (instance && typeof instance.update === 'function') {
    try {
      instance.update();
      return;
    } catch {
      // fall through to re-init
    }
  }
  initOne(el);
}

function destroyOne(el: HTMLElement) {
  const instance = getInstance(el);
  if (instance && typeof instance.destroy === 'function') {
    try {
      instance.destroy();
    } catch {
      // ignore
    }
  }
  if (el.hasAttribute(OS_ATTR)) el.removeAttribute(OS_ATTR);
}

function isVisibleForInit(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (el.closest('.modal[aria-hidden="true"]')) return false;
  if (el.closest('.popover[hidden]')) return false;
  return true;
}

function queryScrollableElements(root: ParentNode, includeHidden = false): HTMLElement[] {
  const out = new Set<HTMLElement>();
  if (root instanceof HTMLElement && root.matches(SCROLLABLE_SELECTOR)) {
    out.add(root);
  }
  try {
    root.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR).forEach((el) => out.add(el));
  } catch {
    // ignore
  }
  const all = Array.from(out);
  return includeHidden ? all : all.filter(isVisibleForInit);
}

export function initOverlayScrollbarsFor(root: ParentNode = document) {
  queryScrollableElements(root).forEach(initOne);
}

export function refreshOverlayScrollbarsFor(root: ParentNode = document) {
  queryScrollableElements(root).forEach(refreshOne);
}

export function destroyOverlayScrollbarsFor(target: string | ParentNode = document) {
  if (typeof target === 'string') {
    let els: HTMLElement[] = [];
    try {
      els = Array.from(document.querySelectorAll<HTMLElement>(target));
    } catch {
      els = [];
    }
    els.forEach(destroyOne);
    return;
  }
  queryScrollableElements(target, true).forEach(destroyOne);
}

// Backward-compatible alias.
export const initOverlayScrollbars = initOverlayScrollbarsFor;
