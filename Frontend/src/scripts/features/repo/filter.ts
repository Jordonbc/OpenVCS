// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { state, prefs, disableDefaultSelectAll } from '../../state/state';
import { filterInput, selectAllBox } from './context';
import { renderList } from './list';
import { getVisibleFiles } from './selectionState';
import { toggleSelectAll, isDragSelecting } from './interactions';

export function bindFilter() {
    filterInput?.addEventListener('input', () => {
        if (isDragSelecting()) return;
        renderList();
    });
    selectAllBox?.addEventListener('change', () => {
        if (prefs.tab !== 'changes') return;
        disableDefaultSelectAll();
        const files = getVisibleFiles();
        toggleSelectAll(Boolean(selectAllBox?.checked), files);
        renderList();
    });
}
