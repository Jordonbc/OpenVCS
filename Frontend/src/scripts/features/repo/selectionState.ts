import { prefs, state } from '../../state/state';
import { filterInput, selectAllBox } from './context';
import type { FileStatus } from '../../types';

export function getVisibleFiles(): FileStatus[] {
    if (prefs.tab !== 'changes') return [];
    const q = (filterInput?.value || '').trim().toLowerCase();
    return (state.files || []).filter((f) => !q || (f.path || '').toLowerCase().includes(q));
}

export function updateSelectAllState(visible: FileStatus[]) {
    if (!selectAllBox) return;
    if (prefs.tab !== 'changes') {
        selectAllBox.indeterminate = false;
        selectAllBox.checked = false;
        return;
    }
    const total = visible.length;
    if (total === 0) {
        selectAllBox.indeterminate = false;
        selectAllBox.checked = false;
        return;
    }
    const selected = visible.filter((f) => state.selectedFiles.has(f.path)).length;
    selectAllBox.indeterminate = selected > 0 && selected < total;
    selectAllBox.checked = selected === total;
}
