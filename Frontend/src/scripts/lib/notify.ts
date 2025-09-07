import { qs, setText } from './dom';

const statusEl = qs<HTMLElement>('#status');

export function notify(text: string) {
    if (!statusEl) return;
    setText(statusEl, text);
    setTimeout(() => {
        if (statusEl.textContent === text) setText(statusEl, 'Ready');
    }, 2200);
}
