import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { hydrate, openModal, closeModal } from '../ui/modals';
import { hydrateStatus } from './repo';
import type { FileStatus, ConflictDetails, GlobalSettings } from '../types';

let mergeModalWired = false;
let currentConflict: { path: string; details: ConflictDetails } | null = null;

const externalToolState = {
    loaded: false,
    enabled: false,
};

async function ensureMergeModal() {
    hydrate('merge-modal');
    if (mergeModalWired) return;
    const modal = document.getElementById('merge-modal') as HTMLElement | null;
    if (!modal) return;

    const applyBtn = modal.querySelector<HTMLButtonElement>('#merge-apply');
    applyBtn?.addEventListener('click', async () => {
        if (!TAURI.has) { notify('Saving merges requires the desktop app.'); return; }
        if (!currentConflict) { notify('No conflict selected.'); return; }
        const textarea = modal.querySelector<HTMLTextAreaElement>('#merge-result');
        const content = textarea?.value ?? '';
        const path = currentConflict.path;
        try {
            await TAURI.invoke('git_save_merge_result', { path, content });
            notify('Saved merge result');
            closeModal('merge-modal');
            await Promise.allSettled([hydrateStatus()]);
        } catch (err) {
            console.error(err);
            notify('Failed to save merge result');
        }
    });

    mergeModalWired = true;
}

function setPreText(root: HTMLElement, selector: string, value?: string | null) {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.textContent = value ?? '';
}

export async function openMergeModal(file: FileStatus, details: ConflictDetails) {
    await ensureMergeModal();
    const modal = document.getElementById('merge-modal') as HTMLElement | null;
    if (!modal) return;

    currentConflict = { path: file.path, details };

    const pathLabel = modal.querySelector<HTMLElement>('#merge-path');
    if (pathLabel) pathLabel.textContent = file.path || '(unknown file)';

    const base = details.base ?? '';
    const ours = details.ours ?? '';
    const theirs = details.theirs ?? '';
    setPreText(modal, '#merge-base', base);
    setPreText(modal, '#merge-ours', ours);
    setPreText(modal, '#merge-theirs', theirs);

    const textarea = modal.querySelector<HTMLTextAreaElement>('#merge-result');
    if (textarea) {
        textarea.value = ours || theirs || base || '';
    }

    openModal('merge-modal');
}

async function ensureExternalMergeConfig() {
    if (externalToolState.loaded || !TAURI.has) return;
    try {
        const cfg = await TAURI.invoke<GlobalSettings>('get_global_settings');
        const tool = cfg?.diff?.external_merge;
        externalToolState.enabled = !!(tool && tool.enabled && (tool.path || '').trim().length > 0);
    } catch (err) {
        console.error('Failed to load merge tool config', err);
        externalToolState.enabled = false;
    } finally {
        externalToolState.loaded = true;
    }
}

export async function hasExternalMergeTool(): Promise<boolean> {
    if (!TAURI.has) return false;
    await ensureExternalMergeConfig();
    return externalToolState.enabled;
}

export async function launchExternalMergeTool(path: string): Promise<void> {
    if (!TAURI.has) { notify('Launching merge tools requires the desktop app.'); return; }
    if (!(await hasExternalMergeTool())) {
        notify('No custom merge tool configured');
        return;
    }
    try {
        await TAURI.invoke('git_launch_merge_tool', { path });
        notify('Opened custom merge tool');
    } catch (err) {
        console.error(err);
        notify('Failed to open merge tool');
    }
}

