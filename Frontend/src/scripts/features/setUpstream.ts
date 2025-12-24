import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { closeModal, hydrate, openModal } from "../ui/modals";
import { hydrateCommits, hydrateStatus } from "./repo";

export function wireSetUpstream() {
  const modal = document.getElementById("set-upstream-modal") as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  const modalEl = modal;
  (modalEl as any).__wired = true;

  const branchEl = modalEl.querySelector<HTMLInputElement>("#set-upstream-branch");
  const selectEl = modalEl.querySelector<HTMLSelectElement>("#set-upstream-select");
  const confirm = modalEl.querySelector<HTMLButtonElement>("#set-upstream-confirm");

  function validate() {
    const branch = (modalEl.dataset.branch || "").trim();
    const upstream = (selectEl?.value || "").trim();
    if (confirm) confirm.disabled = !(branch && upstream);
  }

  selectEl?.addEventListener("change", validate);

  confirm?.addEventListener("click", async () => {
    const branch = (modalEl.dataset.branch || "").trim();
    const upstream = (selectEl?.value || "").trim();
    if (!branch || !upstream) return;
    try {
      if (!TAURI.has) {
        notify("Set upstream requires the desktop app");
        return;
      }
      await TAURI.invoke("git_set_upstream", { branch, upstream });
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

  (modal as any).setInitial = (branch: string, upstreams: string[]) => {
    modalEl.dataset.branch = branch;
    if (branchEl) branchEl.value = branch;
    if (selectEl) {
      const opts = (upstreams || []).slice().sort((a, b) => a.localeCompare(b));
      const existing = new Set(opts);

      // Prefer origin/<branch> when present, else first branch-suffix match, else first option.
      const preferred = existing.has(`origin/${branch}`)
        ? `origin/${branch}`
        : (opts.find((u) => u.endsWith(`/${branch}`)) || opts[0] || "");

      selectEl.innerHTML = [
        `<option value="" disabled ${preferred ? "" : "selected"}>Select a remote branch…</option>`,
        ...opts.map((u) => `<option value="${u}">${u}</option>`),
      ].join("");

      if (preferred) selectEl.value = preferred;
    }
    validate();
    setTimeout(() => selectEl?.focus(), 0);
  };
}

export function openSetUpstream(branch: string, upstreams: string[]) {
  hydrate("set-upstream-modal");
  wireSetUpstream();
  const modal = document.getElementById("set-upstream-modal") as any;
  modal?.setInitial?.(branch, upstreams);
  openModal("set-upstream-modal");
}
