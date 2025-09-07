export const qs = <T extends Element = Element>(sel: string, root: Document | Element = document): T | null =>
    root.querySelector(sel) as T | null;

export const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document): T[] =>
    Array.from(root.querySelectorAll(sel)) as T[];

export const setText = (el: Element | null | undefined, text: string) => { if (el) (el as HTMLElement).textContent = text; };
export const setValue = (el: HTMLInputElement | HTMLSelectElement | null | undefined, value: string | number) => {
    if (!el) return;
    (el as HTMLInputElement | HTMLSelectElement).value = String(value);
};
export const setChecked = (el: HTMLInputElement | null | undefined, on: boolean) => { if (el) el.checked = on; };

export const escapeHtml = (s: any) => String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;');

export const on = <K extends keyof DocumentEventMap>(target: Document | HTMLElement | Window, type: K, fn: (ev: DocumentEventMap[K]) => any) =>
    target.addEventListener(type, fn as any);

export const toKebab = (v: unknown) => String(v ?? '').toLowerCase().replace(/_/g, '-');
