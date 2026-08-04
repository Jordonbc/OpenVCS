// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import './lib/logger';
import { qs } from './lib/dom';
import { boot } from './features/boot';
import { closeFetchPopover, defaultFetchAction, openFetchPopover, pushChanges } from './features/fetchActions';
import { runMenuAction } from './features/menuDispatcher';
import { undoCommit } from './features/repoEvents';
import { openSheet } from './features/commandSheet';
import { openSwitchDrawer } from './features/repoSwitchDrawer';

// Title bar actions
const fetchBtn = qs<HTMLButtonElement>('#fetch-btn');
const fetchCaret = qs<HTMLButtonElement>('#fetch-caret');
const fetchPop = qs<HTMLElement>('#fetch-pop');
const pushBtn  = qs<HTMLButtonElement>('#push-btn');
const cloneBtn = qs<HTMLButtonElement>('#clone-btn');
const repoSwitch = qs<HTMLButtonElement>('#repo-switch');
const commitBtn = qs<HTMLButtonElement>('#commit-btn');
const undoLeftBtn = qs<HTMLButtonElement>('#undo-left-btn');

// title actions
fetchBtn?.addEventListener('click', () => { defaultFetchAction().catch((err) => console.warn('Fetch action failed:', err)); });
fetchCaret?.addEventListener('click', (e) => {
    if (!fetchPop) return;
    if (fetchPop.hidden) openFetchPopover(); else closeFetchPopover();
    e.stopPropagation();
});
pushBtn?.addEventListener('click', pushChanges);
cloneBtn?.addEventListener('click', () => openSheet('clone'));
repoSwitch?.addEventListener('click', () => openSwitchDrawer());
document.getElementById('plugin-title-actions')?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]') || null;
    const action = target?.dataset.action || '';
    if (!action) return;
    runMenuAction(action).catch(() => {});
});

// No dynamic undo insertion; the inline button lives in the commit panel
undoLeftBtn?.addEventListener('click', undoCommit);

boot();
