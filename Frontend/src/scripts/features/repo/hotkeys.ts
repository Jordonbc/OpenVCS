// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { filterInput } from './context';
import { disableDefaultSelectAll, prefs, state } from '../../state/state';
import { getVisibleFiles } from './selectionState';
import { toggleSelectAll } from './interactions';
import { renderList } from './list';

export function bindRepoHotkeys(
    commitBtn: HTMLButtonElement | null,
    openSwitchDrawer: () => void,
    fetchAction?: () => void | Promise<void>
) {
    window.addEventListener('keydown', (e) => {
        const active = document.activeElement as HTMLElement | null;
        const activeTag = (active?.tagName || '').toLowerCase();
        const inEditable =
            activeTag === 'input' ||
            activeTag === 'textarea' ||
            Boolean(active?.isContentEditable);
        const modalOpen = Boolean(document.querySelector('.modal[aria-hidden="false"]'));
        const chord = e.ctrlKey || e.metaKey;

        const key = e.key.toLowerCase();
        if (key === 'f5') {
            e.preventDefault();
            if (fetchAction) Promise.resolve(fetchAction()).catch(() => {});
            return;
        }
        if (chord && key === 'f') { e.preventDefault(); filterInput?.focus(); }
        if (chord && key === 'r') { e.preventDefault(); openSwitchDrawer(); }
        if (chord && e.key === 'Enter') { e.preventDefault(); commitBtn?.click(); }

        if (chord && key === 'a' && !e.shiftKey && !e.altKey && !inEditable) {
            e.preventDefault(); // prevent browser "select all text" behavior
            if (modalOpen) return;
            if (prefs.tab !== 'changes') return;
            const visible = getVisibleFiles();
            if (visible.length === 0) return;
            const selected = visible.filter((f) => f.path && state.selectedFiles.has(f.path)).length;
            const allSelected = selected === visible.length;
            disableDefaultSelectAll();
            toggleSelectAll(!allSelected, visible);
            renderList();
        }

        if (e.key === 'Escape') {
            const about = document.getElementById('about-modal');
            if (about?.classList.contains('show')) about.classList.remove('show');
        }
    });
}
