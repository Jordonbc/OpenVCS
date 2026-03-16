// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/deleteBranchConfirm.ts
import { closeModal, hydrate, openModal } from "../ui/modals";

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

export function wireDeleteBranchConfirm() {
  const modal = getModal();
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;

  const titleEl = modal.querySelector<HTMLElement>("#delete-branch-title");
  const hintEl = modal.querySelector<HTMLElement>("#delete-branch-hint");
  const messageEl = modal.querySelector<HTMLElement>("#delete-branch-message");
  const dangerEl = modal.querySelector<HTMLElement>("#delete-branch-danger");
  const nameEl = modal.querySelector<HTMLElement>("#delete-branch-name");
  const cancelBtn = modal.querySelector<HTMLButtonElement>("#delete-branch-cancel-btn");
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

  (modal as any).setContent = (opts: DeleteBranchConfirmOptions) => {
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
  };
}

export function confirmDeleteBranch(opts: DeleteBranchConfirmOptions): Promise<boolean> {
  hydrate("delete-branch-modal");
  wireDeleteBranchConfirm();

  const modal = getModal() as any;
  modal?.setContent?.(opts);
  return new Promise<boolean>((resolve) => {
    resolvePending(false);
    pendingResolve = resolve;
    openModal("delete-branch-modal");
  });
}
