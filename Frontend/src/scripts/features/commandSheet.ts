// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/commandSheet.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { qs } from "../lib/dom";
import { openModal, closeModal, hydrate } from "../ui/modals";
import { ModalController } from "../lib/modalController";
import { populateSelect } from "../lib/forms";

/** Available command-sheet tabs. */
type Which = "clone" | "add";

/** Tuple: [backend_id, display_name] */
type BackendEntry = [string, string];
// Elements inside the modal
let root: HTMLElement | null = null;
let tabs: HTMLButtonElement[] = [];
let panels: Record<Which, HTMLElement> = {} as any;

let cloneUrl: HTMLInputElement | null = null;
let clonePath: HTMLInputElement | null = null;
let cloneBackend: HTMLSelectElement | null = null;
let doCloneBtn: HTMLButtonElement | null = null;

let addPath: HTMLInputElement | null = null;
let addBackend: HTMLSelectElement | null = null;
let doAddBtn: HTMLButtonElement | null = null;

/** Cached list of available VCS backends. */
let backendCache: BackendEntry[] = [];

/** Backend id the host reports as its ships-with default. */
let defaultBackendId = '';

// Slider indicator bits
let seg: HTMLElement | null = null;
let segIndicator: HTMLElement | null = null;


function setDisabled(id: string, on: boolean) {
    const b = qs<HTMLButtonElement>("#" + id, root || document);
    if (b) b.disabled = on;
}

async function validateClone() {
    const url = cloneUrl?.value.trim();
    const dest = clonePath?.value.trim();
    try {
        const res = await TAURI.invoke<{ ok: boolean; reason?: string }>("validate_clone_input", { url, dest });
        setDisabled("do-clone", !res?.ok);
        if (!res?.ok && res?.reason) notify(res.reason);
    } catch {
        setDisabled("do-clone", true);
    }
}

async function validateAdd() {
    const path = addPath?.value.trim();
    try {
        const res = await TAURI.invoke<{ ok: boolean; reason?: string }>("validate_add_path", { path });
        setDisabled("do-add", !res?.ok);
        if (!res?.ok && res?.reason) notify(res.reason);
    } catch {
        setDisabled("do-add", true);
    }
}

/* ---------------- slider indicator helpers ---------------- */

function ensureIndicator(): HTMLElement | null {
    if (!seg) return null;
    let ind = seg.querySelector<HTMLElement>(".seg-indicator");
    if (!ind) {
        ind = document.createElement("span");
        ind.className = "seg-indicator";
        ind.setAttribute("aria-hidden", "true");
        seg.prepend(ind);
    }
    return ind;
}

function positionIndicator() {
    if (!seg || !segIndicator) return;
    const active = seg.querySelector<HTMLButtonElement>(".seg-btn.active");
    if (!active) return;

    const segRect = seg.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(seg).paddingLeft || "0");

    const x = Math.max(0, Math.round(btnRect.left - segRect.left - padL));
    const w = Math.max(1, Math.round(btnRect.width));
    segIndicator.style.setProperty("--seg-x", `${x}px`);
    segIndicator.style.setProperty("--seg-w", `${w}px`);
}

/* ---------------- tabs/panels ---------------- */

function setSheet(which: Which) {
    // Tabs ARIA + active state + roving tabindex
    tabs.forEach((b) => {
        const on = (b.dataset.sheet as Which) === which;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
    });

    // Panels
    (["clone", "add"] as Which[]).forEach((k) => {
        panels[k].classList.toggle("hidden", k !== which);
    });

    // Reposition the slider after layout changes
    positionIndicator();
}

/** Opens the command sheet and selects an initial tab. */
export function openSheet(which: Which = 'clone') {
    openModal('command-modal');
    if (!root) bindCommandSheet();
    // Re-fetch backends and default on each open
    void populateBackendSelectors();
    setSheet(which);

    // Focus first relevant input without scrolling
    const focusId = which === 'clone' ? 'clone-url' : which === 'add' ? 'add-path' : null;
    if (focusId) setTimeout(() => root?.querySelector<HTMLInputElement>('#' + focusId)?.focus({ preventScroll: true }), 0);

    // Align the pill once frame is painted
    requestAnimationFrame(positionIndicator);
}

/** Closes the command sheet modal. */
export function closeSheet() {
    closeModal("command-modal");
}

/** Owns the command-sheet modal lifecycle: wires event handlers once. */
export const commandSheetController = new ModalController<void>("command-modal", {
  wire: (modal) => {
    root = modal;


    // Resolve elements inside the modal
    seg = root.querySelector(".sheet-head .seg") as HTMLElement | null;
    tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".sheet-head .seg .seg-btn"));
    panels = {
        clone: root.querySelector("#sheet-clone") as HTMLElement,
        add: root.querySelector("#sheet-add") as HTMLElement,
    };

    segIndicator = ensureIndicator();

    cloneUrl = qs<HTMLInputElement>("#clone-url", root);
    clonePath = qs<HTMLInputElement>("#clone-path", root);
    doCloneBtn = qs<HTMLButtonElement>("#do-clone", root);
    cloneBackend = qs<HTMLSelectElement>("#clone-backend", root);

    addPath = qs<HTMLInputElement>("#add-path", root);
    addBackend = qs<HTMLSelectElement>("#add-backend", root);
    doAddBtn = qs<HTMLButtonElement>("#do-add", root);

    // Tab switching (click)
    tabs.forEach((btn) => {
        btn.addEventListener("click", () => setSheet((btn.dataset.sheet as Which) || "clone"));
    });

    // Keyboard navigation on the tablist
    seg?.addEventListener("keydown", (e: KeyboardEvent) => {
        const idx = tabs.findIndex((t) => t.classList.contains("active"));
        let next = idx;
        switch (e.key) {
            case "ArrowLeft": next = (idx - 1 + tabs.length) % tabs.length; break;
            case "ArrowRight": next = (idx + 1) % tabs.length; break;
            case "Home": next = 0; break;
            case "End": next = tabs.length - 1; break;
            case "Enter":
            case " ":
                (document.activeElement as HTMLElement)?.click();
                e.preventDefault();
                return;
            default: return;
        }
        e.preventDefault();
        tabs[next].focus();
        tabs[next].click();
    });

    // Validation
    cloneUrl?.addEventListener("input", validateClone);
    clonePath?.addEventListener("input", validateClone);
    addPath?.addEventListener("input", validateAdd);

    // Browse buttons
    qs<HTMLButtonElement>("#browse-clone", root)?.addEventListener("click", async () => {
        try {
            const dir = await TAURI.invoke<string>("browse_directory", { purpose: "clone_dest" });
            if (dir && clonePath) {
                clonePath.value = dir;
                validateClone();
            }
        } catch {}
    });

    qs<HTMLButtonElement>("#browse-add", root)?.addEventListener("click", async () => {
        try {
            const dir = await TAURI.invoke<string>("browse_directory", { purpose: "add_repo" });
            if (dir && addPath) {
                addPath.value = dir;
                validateAdd();
            }
        } catch {}
    });

    // Actions
    doCloneBtn?.addEventListener("click", async () => {
        const url = cloneUrl?.value.trim();
        const dest = clonePath?.value.trim();
        if (!url || !dest) return;
        const backendId = cloneBackend?.value || "";
        if (!backendId) { notify("No VCS backend selected"); return; }
        try {
            await TAURI.invoke("clone_repo", { url, dest, backendId });
            notify(`Cloned ${url} → ${dest}`);
            closeSheet();
        } catch {
            notify("Clone failed");
        }
    });

    doAddBtn?.addEventListener("click", async () => {
        const path = addPath?.value.trim();
        const backendId = addBackend?.value || "";
        if (!path) return;
        if (!backendId) { notify("No VCS backend selected"); return; }
        try {
            await TAURI.invoke("add_repo", { path, backendId });
            notify(`Added ${path}`);
            closeSheet();
        } catch {
            notify("Add failed");
        }
    });

    // Keep the slider aligned on layout changes to the header
    if (seg) {
        const ro = new ResizeObserver(() => positionIndicator());
        ro.observe(seg);
    }
    // Realign when modal visibility toggles (aria-hidden/class)
    const mo = new MutationObserver(() => {
        requestAnimationFrame(positionIndicator);
    });
    mo.observe(root, { attributes: true, attributeFilter: ["aria-hidden", "class"] });

  },
});

/** Wires command-sheet controls and action handlers once. */
export function bindCommandSheet() {
    // Inject the fragment if not already present
    hydrate("command-modal");
    commandSheetController.initOnce();
}

/** Fetches available VCS backends and populates both selectors. */
async function populateBackendSelectors() {
    try {
        const res = await TAURI.invoke<{ backends: BackendEntry[]; default_backend_id: string }>('list_vcs_backends_cmd');
        backendCache = (Array.isArray(res?.backends) ? res.backends : []).filter(([id]) => id.trim().length > 0);
        defaultBackendId = String(res?.default_backend_id || '').trim();
    } catch {
        backendCache = [];
    }

    if (backendCache.length === 0) {
        // Keep existing static options from HTML (e.g. hardcoded <option> for tests)
        return;
    }

    // Get default backend from settings
    let defaultBackend = '';
    try {
        const cfg = await TAURI.invoke<{ general?: { default_backend?: string } }>('get_global_settings');
        defaultBackend = String(cfg?.general?.default_backend || '').trim();
    } catch {}

    const backendOpts = backendCache.map(([id, name]) => [id, name || id] as const);

    [cloneBackend, addBackend].forEach((sel) => {
        if (!sel) return;
        // Set default backend if configured and available
        const preferred = (defaultBackend && backendCache.some(([id]) => id === defaultBackend))
            ? defaultBackend
            : (defaultBackendId && backendCache.some(([id]) => id === defaultBackendId))
                ? defaultBackendId
                : '';
        populateSelect(sel, backendOpts, preferred);
        sel.disabled = backendOpts.length <= 1;
    });
}

/** Returns the currently selected backend id from the active tab, or the first available. */
export function getSelectedBackendId(): string {
    const active = document.querySelector(".seg-btn.active[data-sheet]") as HTMLElement | null;
    const which = active?.dataset.sheet as Which | undefined;
    if (which === "clone" && cloneBackend?.value) return cloneBackend.value;
    if (which === "add" && addBackend?.value) return addBackend.value;
    return backendCache[0]?.[0] || "";
}
