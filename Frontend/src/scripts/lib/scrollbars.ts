import { OverlayScrollbars } from 'overlayscrollbars';

// Use the official attribute name so OverlayScrollbars can hide native scrollbars
// during initialization to reduce flicker.
const OS_ATTR = 'data-overlayscrollbars-initialize';

function initOne(el: HTMLElement) {
  if (el.hasAttribute(OS_ATTR)) return;
  el.setAttribute(OS_ATTR, '1');
  try {
    const instance = OverlayScrollbars(el, {
      overflow: {
        x: 'hidden',
        y: 'scroll',
      },
      scrollbars: {
        theme: 'os-theme-openvcs',
        autoHide: 'never',
      },
    });
    // If initialization didn't yield an instance, restore native scrollbars.
    if (!instance) el.removeAttribute(OS_ATTR);
  } catch {
    // If initialization fails for any reason, remove the marker so we can retry later.
    el.removeAttribute(OS_ATTR);
  }
}

function queryScrollableElements(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        // Main panes (use wrappers so re-rendering content doesn't destroy OS structure)
        '.list-scroll',
        '.diff-scroll',
        // Popovers/menus that scroll (use wrappers)
        '.pop-list-scroll',
      ].join(','),
    ),
  );
}

export function initOverlayScrollbars(root: ParentNode = document) {
  queryScrollableElements(root).forEach(initOne);
}

export function observeOverlayScrollbars() {
  initOverlayScrollbars();
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.matches?.('[class], [id]')) initOverlayScrollbars(n);
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return () => obs.disconnect();
}
