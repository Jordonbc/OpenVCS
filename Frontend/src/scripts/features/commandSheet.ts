// src/scripts/features/commandSheet.ts
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";
import { openModal, closeModal, hydrate } from "../ui/modals";

type Which = "clone" | "add" | "switch";

// Elements live inside the modal; we resolve them after hydrating
let root: HTMLElement | null = null;
let tabs: HTMLButtonElement[] = [];
let panels: Record<Which, HTMLElement> = {} as any;

let cloneUrl: HTMLInputElement | null = null;
let clonePath: HTMLInputElement | null = null;
let doCloneBtn: HTMLButtonElement | null = null;

let addPath: HTMLInputElement | null = null;
let doAddBtn: HTMLButtonElement | null = null;

let recentList: HTMLElement | null = null;

function el<T extends HTMLElement>(sel: string, r: ParentNode = document): T | null {
    return r.querySelector(sel) as T | null;
}

function setDisabled(id: string, on: boolean) {
    const b = el<HTMLButtonElement>("#" + id, root || document);
    if (b) b.disabled = on;
}

async function validateClone() {
    if (!TAURI.has) return;
    const url = cloneUrl?.value.trim();
    const dest = clonePath?.value.trim();
    try {
        const res = await TAURI.invoke<{ ok: boolean; reason?: string }>(
            "validate_clone_input",
            { url, dest }
        );
        setDisabled("do-clone", !res?.ok);
        if (!res?.ok && res?.reason) notify(res.reason);
    } catch {
        setDisabled("do-clone", true);
    }
}

async function validateAdd() {
    if (!TAURI.has) return;
    const path = addPath?.value.trim();
    try {
        const res = await TAURI.invoke<{ ok: boolean; reason?: string }>(
            "validate_add_path",
            { path }
        );
        setDisabled("do-add", !res?.ok);
        if (!res?.ok && res?.reason) notify(res.reason);
    } catch {
        setDisabled("do-add", true);
    }
}

function setSheet(which: Which) {
    tabs.forEach((b) => {
        const on = (b.dataset.sheet as Which) === which;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    (["clone", "add", "switch"] as Which[]).forEach((k) => {
        panels[k].classList.toggle("hidden", k !== which);
    });
}

export function openSheet(which: Which = "clone") {
    openModal("command-modal");
    // ensure we have the root (in case someone calls open before bind)
    if (!root) bindCommandSheet();
    setSheet(which);
    const focusId = which === "clone" ? "clone-url" : which === "add" ? "add-path" : null;
    if (focusId) setTimeout(() => root?.querySelector<HTMLInputElement>("#" + focusId)?.focus(), 0);
}

export function closeSheet() {
    closeModal("command-modal");
}

export function bindCommandSheet() {
    // Inject the fragment if not already present
    hydrate("command-modal");

    root = document.getElementById("command-modal");
    if (!root || (root as any).__wired) return;
    (root as any).__wired = true;

    // Resolve elements inside the modal
    tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".seg-btn[data-sheet]"));
    panels = {
        clone: root.querySelector("#sheet-clone") as HTMLElement,
        add: root.querySelector("#sheet-add") as HTMLElement,
        switch: root.querySelector("#sheet-switch") as HTMLElement,
    };

    cloneUrl = el<HTMLInputElement>("#clone-url", root);
    clonePath = el<HTMLInputElement>("#clone-path", root);
    doCloneBtn = el<HTMLButtonElement>("#do-clone", root);

    addPath = el<HTMLInputElement>("#add-path", root);
    doAddBtn = el<HTMLButtonElement>("#do-add", root);

    recentList = el<HTMLElement>("#recent-list", root);

    // Tab switching
    tabs.forEach((btn) =>
        btn.addEventListener("click", () => setSheet((btn.dataset.sheet as Which) || "clone"))
    );

    // Proto toggle (HTTPS/SSH)
    Array.from(root.querySelectorAll<HTMLButtonElement>("[data-proto]")).forEach((b) => {
        b.addEventListener("click", () => {
            Array.from(root!.querySelectorAll("[data-proto]")).forEach((x) =>
                x.classList.remove("active")
            );
            b.classList.add("active");
        });
    });

    // Validation
    cloneUrl?.addEventListener("input", validateClone);
    clonePath?.addEventListener("input", validateClone);
    addPath?.addEventListener("input", validateAdd);

    // Browse buttons
    el<HTMLButtonElement>("#browse-clone", root)?.addEventListener("click", async () => {
        if (!TAURI.has) return;
        try {
            const dir = await TAURI.invoke<string>("browse_directory", { purpose: "clone_dest" });
            if (dir && clonePath) {
                clonePath.value = dir;
                validateClone();
            }
        } catch {}
    });

    el<HTMLButtonElement>("#browse-add", root)?.addEventListener("click", async () => {
        if (!TAURI.has) return;
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
        try {
            if (TAURI.has) await TAURI.invoke("clone_repo", { url, dest });
            notify(`Cloned ${url} → ${dest}`);
            closeSheet();
        } catch {
            notify("Clone failed");
        }
    });

    doAddBtn?.addEventListener("click", async () => {
        const path = addPath?.value.trim();
        if (!path) return;
        try {
            if (TAURI.has) await TAURI.invoke("add_repo", { path });
            notify(`Added ${path}`);
            closeSheet();
        } catch {
            notify("Add failed");
        }
    });

    // Recents
    (async function loadRecents() {
        try {
            let recents: any[] = [];
            if (TAURI.has) {
                const fromRust = await TAURI.invoke<any[]>("list_recent_repos").catch(() => null);
                if (Array.isArray(fromRust)) recents = fromRust;
            }
            if (recentList) {
                recentList.innerHTML = (recents || [])
                    .map(
                        (r) => `
              <li data-path="${r.path}">
                <div>
                  <strong>${r.name || (r.path || "").split("/").pop() || ""}</strong>
                  <div class="path">${r.path || ""}</div>
                </div>
                <button class="tbtn" type="button" data-open>Open</button>
              </li>`
                    )
                    .join("");

                recentList.addEventListener("click", async (e) => {
                    const btn = (e.target as HTMLElement).closest("[data-open]") as HTMLElement | null;
                    if (!btn) return;
                    const li = (e.target as HTMLElement).closest("li") as HTMLElement | null;
                    if (!li) return;
                    const path = li.dataset.path!;
                    try {
                        if (TAURI.has) await TAURI.invoke("open_repo", { path });
                        notify(`Opened ${path}`);
                        closeSheet();
                    } catch {
                        notify("Open failed");
                    }
                });
            }
        } catch {}
    })();
}
