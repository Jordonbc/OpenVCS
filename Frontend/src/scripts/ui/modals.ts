// src/scripts/ui/modals.ts
import { qs } from "@scripts/lib/dom";
import settingsHtml from "@modals/settings.html?raw";
import cmdHtml from "@modals/commandSheet.html?raw";
import aboutHtml from "@modals/about.html?raw";
import { wireSettings } from "../features/settings";
import repoSettingsHtml from "@modals/repo-settings.html?raw";
import { wireRepoSettings } from "../features/repoSettings";
import newBranchHtml from "@modals/new-branch.html?raw";
import { wireNewBranch } from "../features/newBranch";
import renameBranchHtml from "@modals/rename-branch.html?raw";
import { wireRenameBranch } from "../features/renameBranch";
import updateHtml from "@modals/update.html?raw";
import { wireUpdate } from "../features/update";

// Lazy fragments (only those NOT present at load)
const FRAGMENTS: Record<string, string> = {
    "settings-modal": settingsHtml,
    "about-modal": aboutHtml,
    "command-modal": cmdHtml,
    "repo-settings-modal": repoSettingsHtml,
    "new-branch-modal": newBranchHtml,
    "rename-branch-modal": renameBranchHtml,
    "update-modal": updateHtml,
};

const loaded = new Set<string>();
const root = qs<HTMLElement>("#modals-root");

// scroll lock counter (supports multiple modals)
let openCount = 0;
function lockScroll() {
    openCount++;
    document.body.style.overflow = "hidden";
}
function unlockScroll() {
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.style.overflow = "";
}

export function hydrate(id: string): void {
    // If it's already in the DOM, treat as loaded and skip
    const existing = document.getElementById(id);
    if (existing) {
        loaded.add(id);
        return;
    }
    if (!root || loaded.has(id)) return;

    const html = FRAGMENTS[id];
    if (!html) {
        // Nothing to inject and no existing node -> real error
        throw new Error(`No fragment registered for ${id}`);
    }

    root.insertAdjacentHTML("beforeend", html);
    loaded.add(id);

    if (id === "settings-modal") wireSettings();
    if (id === "repo-settings-modal") wireRepoSettings();
    if (id === "new-branch-modal") wireNewBranch();
    if (id === "rename-branch-modal") wireRenameBranch();
    if (id === "update-modal") wireUpdate();
}

export function openModal(id: string): void {
    // Prefer existing element; only hydrate if missing
    let el = document.getElementById(id);
    if (!el) hydrate(id);
    el = document.getElementById(id);
    if (!el) return;

    if (!el.hasAttribute("aria-hidden")) el.setAttribute("aria-hidden", "true");
    el.setAttribute("aria-hidden", "false");
    lockScroll();

    // Click-to-close once
    if (!(el as any).__closeWired) {
        el.addEventListener("click", (evt) => {
            const t = evt.target as HTMLElement;
            const isBackdrop = t.classList?.contains("backdrop");
            const wantsClose = isBackdrop || !!t.closest("[data-close]");
            if (wantsClose) closeModal(id);
        });
        (el as any).__closeWired = true;
    }
}

export function closeModal(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.getAttribute("aria-hidden") !== "true") {
        el.setAttribute("aria-hidden", "true");
        unlockScroll();
    }
}

// Declarative opener: <button data-modal-open="#about-modal">
document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement)?.closest(
        "[data-modal-open]"
    ) as HTMLElement | null;
    if (!target) return;
    const id = (target.getAttribute("data-modal-open") || "").replace(/^#/, "");
    if (id) openModal(id);
});

// ESC closes the top-most open modal
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openModals = Array.from(
        document.querySelectorAll<HTMLElement>(".modal[aria-hidden='false']")
    );
    const top = openModals.at(-1);
    if (top?.id) closeModal(top.id);
});
