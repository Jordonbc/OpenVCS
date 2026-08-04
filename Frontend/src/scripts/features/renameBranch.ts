// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/renameBranch.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { closeModal } from "../ui/modals";
import { ModalController } from "../lib/modalController";

/** Per-open state for the rename-branch modal. */
export interface RenameBranchState {
  oldName: string;
}

/** Enables the confirm button only when the new name is valid and different. */
function validateRename(modal: HTMLElement): void {
  const oldName = (modal.dataset.oldBranch || "").trim();
  const nameEl = modal.querySelector<HTMLInputElement>("#rename-branch-name");
  const confirm = modal.querySelector<HTMLButtonElement>("#rename-branch-confirm");
  const newName = (nameEl?.value || "").trim();
  if (confirm) confirm.disabled = !newName || newName === oldName;
}

/** Owns the rename-branch modal lifecycle: wires once, applies state per open. */
export const renameBranchController = new ModalController<RenameBranchState>(
  "rename-branch-modal",
  {
    wire: (modal) => {
      const nameEl = modal.querySelector<HTMLInputElement>("#rename-branch-name");
      const confirm = modal.querySelector<HTMLButtonElement>("#rename-branch-confirm");

      nameEl?.addEventListener("input", () => validateRename(modal));
      nameEl?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); confirm?.click(); }
      });

      confirm?.addEventListener("click", async () => {
        const oldName = (modal.dataset.oldBranch || "").trim();
        const newName = (nameEl?.value || "").trim();
        if (!oldName || !newName || oldName === newName) return;
        try {
          await TAURI.invoke("vcs_rename_branch", { old_name: oldName, new_name: newName });
          notify(`Renamed '${oldName}' → '${newName}'`);
          // Ask the rest of the app to refresh branch UI
          window.dispatchEvent(new CustomEvent("app:repo-selected"));
          closeModal("rename-branch-modal");
        } catch (e) {
          notify(`Rename failed${e ? `: ${e}` : ''}`);
        }
      });
    },
    apply: (state, modal) => {
      modal.dataset.oldBranch = state.oldName;
      const currentEl = modal.querySelector<HTMLInputElement>("#rename-branch-current");
      const nameEl = modal.querySelector<HTMLInputElement>("#rename-branch-name");
      if (currentEl) currentEl.value = state.oldName;
      if (nameEl) {
        nameEl.value = state.oldName;
        setTimeout(() => {
          nameEl.focus();
          nameEl.select();
          validateRename(modal);
        }, 0);
      }
    },
  },
);

/** Wires the rename-branch modal once. No-op after the first call. */
export function wireRenameBranch(): void {
  renameBranchController.initOnce();
}

/** Opens the rename modal pre-filled with the branch being renamed. */
export function openRenameBranch(oldName: string): void {
  renameBranchController.open({ oldName });
}
