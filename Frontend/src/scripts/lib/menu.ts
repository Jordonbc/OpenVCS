export type CtxItem = { label: string; action?: () => void | Promise<void> };

/**
 * Render a lightweight context menu at the given screen coordinates.
 * Items with label '---' render a separator.
 */
export function buildCtxMenu(items: CtxItem[], x: number, y: number) {
  // remove existing
  document.querySelectorAll('.ctxmenu').forEach(el => el.remove());
  const m = document.createElement('div');
  m.className = 'ctxmenu';
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  items.forEach((it) => {
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
          (result as Promise<void>).catch(() => {});
        }
      } finally {
        m.remove();
      }
    });
    m.appendChild(d);
  });
  document.body.appendChild(m);
  const close = () => m.remove();
  setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 0);
}
