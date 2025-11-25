import { state, prefs, disableDefaultSelectAll } from '../../state/state';
import { filterInput, selectAllBox } from './context';
import { renderList } from './list';
import { getVisibleFiles } from './selectionState';
import { toggleSelectAll } from './interactions';

export function bindFilter() {
    filterInput?.addEventListener('input', () => renderList());
    selectAllBox?.addEventListener('change', () => {
        if (prefs.tab !== 'changes') return;
        state.defaultSelectAll = false;
        const files = getVisibleFiles();
        toggleSelectAll(Boolean(selectAllBox?.checked), files);
        renderList();
    });
}
