// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/deleteBranchConfirm.ts
import { closeModal } from "../ui/modals";
import { ModalController } from "../lib/modalController";

export interface DeleteBranchConfirmOptions {
  name: string;
  force?: boolean;
  message?: string;
  hint?: string;
}

let pendingResolve: ((ok: boolean) => void) | null = null;

function getModal(): HTMLElement | null {
  return document.getElementById("delete-branch-modal");
}

function resolvePending(ok: boolean) {
  if (!pendingResolve) return;
  const r = pendingResolve;
  pendingResolve = null;
  r(ok);
}

/** Owns the delete-branch confirmation modal: wires once, applies content per open. */
export const deleteBranchController = new ModalController<DeleteBranchConfirmOptions>(
  "delete-branch-modal",
  {
    wire: (modal) => {
      const confirmBtn = modal.querySelector<HTMLButtonElement>("#delete-branch-confirm-btn");

      modal.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        const wantsClose = t.classList?.contains("backdrop") || !!t.closest("[data-close]");
        if (wantsClose) resolvePending(false);
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const m = getModal();
        if (!m || m.getAttribute("aria-hidden") !== "false") return;
        resolvePending(false);
      });

      confirmBtn?.addEventListener("click", () => {
        resolvePending(true);
        closeModal("delete-branch-modal");
      });
    },
    apply: (opts, modal) => {
      const titleEl = modal.querySelector<HTMLElement>("#delete-branch-title");
      const hintEl = modal.querySelector<HTMLElement>("#delete-branch-hint");
      const messageEl = modal.querySelector<HTMLElement>("#delete-branch-message");
      const dangerEl = modal.querySelector<HTMLElement>("#delete-branch-danger");
      const nameEl = modal.querySelector<HTMLElement>("#delete-branch-name");
      const cancelBtn = modal.querySelector<HTMLButtonElement>("#delete-branch-cancel-btn");
      const confirmBtn = modal.querySelector<HTMLButtonElement>("#delete-branch-confirm-btn");

      const name = String(opts?.name || "").trim();
      const force = !!opts?.force;

      if (titleEl) titleEl.textContent = force ? "Force Delete Branch" : "Delete Branch";
      if (hintEl) hintEl.textContent = opts?.hint || "This cannot be undone.";
      if (messageEl) {
        messageEl.textContent =
          opts?.message ||
          (force
            ? "Force deleting permanently removes the local branch."
            : "Deleting permanently removes the local branch.");
      }
      if (nameEl) nameEl.textContent = name || "—";

      if (dangerEl) dangerEl.hidden = !force;
      if (confirmBtn) {
        confirmBtn.textContent = force ? "Force delete" : "Delete";
        confirmBtn.classList.toggle("danger", force);
        confirmBtn.classList.toggle("primary", !force);
      }
      setTimeout(() => cancelBtn?.focus(), 0);
    },
  },
);

/** Wires the delete-branch confirmation modal once. No-op after the first call. */
export function wireDeleteBranchConfirm(): void {
  deleteBranchController.initOnce();
}

/** Opens the delete-branch confirmation modal and resolves with the user's choice. */
export function confirmDeleteBranch(opts: DeleteBranchConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    resolvePending(false);
    pendingResolve = resolve;
    deleteBranchController.open(opts);
  });
}
