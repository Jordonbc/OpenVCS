// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/setUpstream.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { closeModal } from "../ui/modals";
import { hydrateCommits, hydrateStatus } from "./repo";
import { ModalController } from "../lib/modalController";

/** Per-open state for the set-upstream modal. */
export interface SetUpstreamState {
  branch: string;
  upstreams: string[];
  currentUpstream?: string | null;
}

/** Enables the confirm button only when both branch and upstream are chosen. */
function validateSetUpstream(modal: HTMLElement): void {
  const branch = (modal.dataset.branch || "").trim();
  const selectEl = modal.querySelector<HTMLSelectElement>("#set-upstream-select");
  const confirm = modal.querySelector<HTMLButtonElement>("#set-upstream-confirm");
  const upstream = (selectEl?.value || "").trim();
  if (confirm) confirm.disabled = !(branch && upstream);
}

/** Owns the set-upstream modal lifecycle: wires once, applies state per open. */
export const setUpstreamController = new ModalController<SetUpstreamState>(
  "set-upstream-modal",
  {
    wire: (modal) => {
      const selectEl = modal.querySelector<HTMLSelectElement>("#set-upstream-select");
      selectEl?.addEventListener("change", () => validateSetUpstream(modal));
      modal.querySelector<HTMLButtonElement>("#set-upstream-confirm")?.addEventListener("click", async () => {
        const branch = (modal.dataset.branch || "").trim();
        const upstream = (selectEl?.value || "").trim();
        if (!branch || !upstream) return;
        try {
          await TAURI.invoke("vcs_set_upstream", { branch, upstream });
          notify(`Tracking '${upstream}'`);
          closeModal("set-upstream-modal");
          await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
          window.dispatchEvent(new CustomEvent("app:branches-updated"));
          window.dispatchEvent(new CustomEvent("app:status-updated"));
        } catch (e) {
          const msg = String(e || "").trim();
          notify(msg ? `Set upstream failed: ${msg}` : "Set upstream failed");
        }
      });
    },
    apply: (state, modal) => {
      modal.dataset.branch = state.branch;
      const branchEl = modal.querySelector<HTMLInputElement>("#set-upstream-branch");
      const selectEl = modal.querySelector<HTMLSelectElement>("#set-upstream-select");
      if (branchEl) branchEl.value = state.branch;
      if (selectEl) {
        const opts = (state.upstreams || []).slice().sort((a, b) => a.localeCompare(b));
        const existing = new Set(opts);

        // Prefer the branch's actual upstream when listed; fall back to the first remote.
        const preferred = state.currentUpstream && existing.has(state.currentUpstream)
          ? state.currentUpstream
          : (opts[0] || "");

        selectEl.innerHTML = [
          `<option value="" disabled ${preferred ? "" : "selected"}>Select a remote branch…</option>`,
          ...opts.map((u) => `<option value="${u}">${u}</option>`),
        ].join("");

        if (preferred) selectEl.value = preferred;
      }
      validateSetUpstream(modal);
      setTimeout(() => selectEl?.focus(), 0);
    },
  },
);

/** Wires the set-upstream modal once. No-op after the first call. */
export function wireSetUpstream(): void {
  setUpstreamController.initOnce();
}

/** Opens the set-upstream modal for the given branch and remote candidates. */
export function openSetUpstream(branch: string, upstreams: string[], currentUpstream?: string | null): void {
  setUpstreamController.open({ branch, upstreams, currentUpstream });
}
