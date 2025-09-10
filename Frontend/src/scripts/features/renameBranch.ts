// src/scripts/features/renameBranch.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { closeModal, hydrate, openModal } from "../ui/modals";

export function wireRenameBranch() {
  const modal = document.getElementById('rename-branch-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;

  const currentEl = modal.querySelector<HTMLInputElement>('#rename-branch-current');
  const nameEl    = modal.querySelector<HTMLInputElement>('#rename-branch-name');
  const confirm   = modal.querySelector<HTMLButtonElement>('#rename-branch-confirm');

  function validate() {
    const oldName = (modal?.dataset.oldBranch || '').trim();
    const newName = (nameEl?.value || '').trim();
    const ok = !!newName && newName !== oldName;
    if (confirm) confirm.disabled = !ok;
  }

  nameEl?.addEventListener('input', validate);
  nameEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm?.click(); }
  });

  confirm?.addEventListener('click', async () => {
    const oldName = (modal?.dataset.oldBranch || '').trim();
    const newName = (nameEl?.value || '').trim();
    if (!oldName || !newName || oldName === newName) return;
    try {
      if (TAURI.has) await TAURI.invoke('git_rename_branch', { old_name: oldName, new_name: newName });
      notify(`Renamed '${oldName}' → '${newName}'`);
      // Ask the rest of the app to refresh branch UI
      window.dispatchEvent(new CustomEvent('app:repo-selected'));
      closeModal('rename-branch-modal');
    } catch (e) {
      notify(`Rename failed${e ? `: ${e}` : ''}`);
    }
  });

  // Expose a small API for initializing the modal per open
  (modal as any).setInitial = (oldName: string) => {
    modal.dataset.oldBranch = oldName;
    if (currentEl) currentEl.value = oldName;
    if (nameEl) { nameEl.value = oldName; setTimeout(() => { nameEl.focus(); nameEl.select(); validate(); }, 0); }
  };
}

export function openRenameBranch(oldName: string) {
  // Ensure modal exists and is wired
  hydrate('rename-branch-modal');
  wireRenameBranch();
  const modal = document.getElementById('rename-branch-modal') as any;
  modal?.setInitial?.(oldName);
  openModal('rename-branch-modal');
}

