// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/fetchPopover.ts
// Fetch/Pull popover interaction wiring: menuitem dispatch and close-on-outside.
// Extracted from main.ts (single-responsibility module).

import { qs } from '../lib/dom';
import { closeFetchPopover, fetchAllRemotesOnly, fetchAndPull, fetchOnly } from './fetchActions';

const fetchPop = qs<HTMLElement>('#fetch-pop');
const fetchList = qs<HTMLElement>('#fetch-list');

/** Wires the Fetch/Pull popover menu and dismiss interactions (outside click, resize, Escape). */
function bindFetchPopover() {
    fetchList?.addEventListener('click', (e) => {
        const li = (e.target as HTMLElement).closest('li[data-action]') as HTMLElement | null;
        if (!li) return;
        if (li.getAttribute('aria-disabled') === 'true') return;
        const action = li.dataset.action || '';
        closeFetchPopover();
        if (action === 'fetch-only') fetchOnly().catch((err) => console.warn('Fetch only failed:', err));
        else if (action === 'fetch-all') fetchAllRemotesOnly().catch((err) => console.warn('Fetch all failed:', err));
        else if (action === 'pull') fetchAndPull().catch((err) => console.warn('Pull failed:', err));
    });

    document.addEventListener('click', (e) => {
        if (!fetchPop || fetchPop.hidden) return;
        const target = e.target as Node;
        const split = document.getElementById('fetch-split');
        if (fetchPop.contains(target)) return;
        if (split && split.contains(target)) return;
        closeFetchPopover();
    });

    window.addEventListener('resize', closeFetchPopover);
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (fetchPop && !fetchPop.hidden) closeFetchPopover();
    });
}

export { bindFetchPopover };
