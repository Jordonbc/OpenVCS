import { filterInput } from './context';

export function bindRepoHotkeys(commitBtn: HTMLButtonElement | null, openSheet: (w: 'clone' | 'add' | 'switch') => void) {
    if (!filterInput) return;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && key === 'f') { e.preventDefault(); filterInput.focus(); }
        if (e.ctrlKey && key === 'r') { e.preventDefault(); openSheet('switch'); }
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commitBtn?.click(); }
        if (e.key === 'Escape') {
            const about = document.getElementById('about-modal');
            if (about?.classList.contains('show')) about.classList.remove('show');
        }
    });
}
