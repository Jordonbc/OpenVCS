// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
export type CtxItem = { label: string; action?: () => void | Promise<void> };

/**
 * Render a lightweight context menu at the given screen coordinates.
 * Items with label '---' render a separator.
 */
export function buildCtxMenu(items: CtxItem[], x: number, y: number) {
  // remove existing
  document.querySelectorAll('.ctxmenu').forEach((el) => {
    el.remove();
  });
  const m = document.createElement('div');
  m.className = 'ctxmenu';
  // Position gets clamped to viewport after measuring.
  m.style.left = `${Math.round(x)}px`;
  m.style.top = `${Math.round(y)}px`;
  // Normalize separators: remove leading/trailing, collapse consecutive.
  const normalized: CtxItem[] = [];
  let lastWasSep = true; // start as true to drop leading separators
  for (const it of items) {
    const isSep = it.label === '---';
    if (isSep) {
      if (!lastWasSep) { normalized.push(it); }
    } else {
      normalized.push(it);
    }
    lastWasSep = isSep;
  }
  // Drop trailing separator if present
  if (normalized.length > 0 && normalized[normalized.length - 1].label === '---') {
    normalized.pop();
  }
  normalized.forEach((it) => {
    if (it.label === '---') {
      const sep = document.createElement('div');
      sep.className = 'sep';
      m.appendChild(sep);
      return;
    }
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = it.label;
    d.addEventListener('click', () => {
      try {
        const result = it.action?.();
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch((err) => {
            console.error('Context menu action failed:', err);
          });
        }
      } catch (err) {
        console.error('Context menu action failed:', err);
      } finally {
        m.remove();
      }
    });
    m.appendChild(d);
  });
  document.body.appendChild(m);

  // Clamp (and prefer flipping) so the menu never renders off-screen.
  try {
    const margin = 8;
    const rect = m.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    let left = x;
    let top = y;

    // Prefer opening to the left/up when near edges.
    if (left + rect.width > vw - margin && left - rect.width >= margin) {
      left = left - rect.width;
    }
    if (top + rect.height > vh - margin && top - rect.height >= margin) {
      top = top - rect.height;
    }

    // Final clamp.
    left = Math.max(margin, Math.min(vw - rect.width - margin, left));
    top = Math.max(margin, Math.min(vh - rect.height - margin, top));

    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
  } catch {
    // ignore
  }
  const close = () => m.remove();
  setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 0);
}
