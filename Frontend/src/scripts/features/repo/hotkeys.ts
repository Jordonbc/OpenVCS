import { filterInput } from './context';

export function bindRepoHotkeys(
    commitBtn: HTMLButtonElement | null,
    openSheet: (w: 'clone' | 'add' | 'switch') => void,
    fetchAction?: () => void | Promise<void>
) {
    const filter = filterInput;
    if (!filter) return;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === 'f5') {
            e.preventDefault();
            if (fetchAction) Promise.resolve(fetchAction()).catch(() => {});
            return;
        }
        if (e.ctrlKey && key === 'f') { e.preventDefault(); filter.focus(); }
        if (e.ctrlKey && key === 'r') { e.preventDefault(); openSheet('switch'); }
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commitBtn?.click(); }
        if (e.key === 'Escape') {
            const about = document.getElementById('about-modal');
            if (about?.classList.contains('show')) about.classList.remove('show');
        }
    });
}
