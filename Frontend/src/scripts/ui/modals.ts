// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/ui/modals.ts
import { qs } from "@scripts/lib/dom";
import { initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from "../lib/scrollbars";
import settingsHtml from "@modals/settings.html?raw";
import cmdHtml from "@modals/commandSheet.html?raw";
import aboutHtml from "@modals/about.html?raw";
import repoSettingsHtml from "@modals/repo-settings.html?raw";
import sshHostkeyHtml from "@modals/ssh-hostkey.html?raw";
import sshAuthHtml from "@modals/ssh-auth.html?raw";
import sshKeysHtml from "@modals/ssh-keys.html?raw";
import newBranchHtml from "@modals/new-branch.html?raw";
import renameBranchHtml from "@modals/rename-branch.html?raw";
import cherryPickHtml from "@modals/cherry-pick.html?raw";
import deleteBranchHtml from "@modals/delete-branch.html?raw";
import confirmHtml from "@modals/confirm.html?raw";
import setUpstreamHtml from "@modals/set-upstream.html?raw";
import updateHtml from "@modals/update.html?raw";
import stashConfirmHtml from "@modals/stash-confirm.html?raw";
import mergeHtml from "@modals/merge.html?raw";
import mergeStrategyHtml from "@modals/merge-strategy.html?raw";
import conflictsSummaryHtml from "@modals/conflicts-summary.html?raw";
import repoSwitchDrawerHtml from "@modals/repoSwitchDrawer.html?raw";
import errorHtml from "@modals/error.html?raw";

// Lazy fragments (only those NOT present at load)
const FRAGMENTS: Record<string, string> = {
    "settings-modal": settingsHtml,
    "about-modal": aboutHtml,
    "command-modal": cmdHtml,
    "repo-switch-drawer": repoSwitchDrawerHtml,
    "repo-settings-modal": repoSettingsHtml,
    "ssh-hostkey-modal": sshHostkeyHtml,
    "ssh-auth-modal": sshAuthHtml,
    "ssh-keys-modal": sshKeysHtml,
    "new-branch-modal": newBranchHtml,
    "rename-branch-modal": renameBranchHtml,
    "cherry-pick-modal": cherryPickHtml,
    "confirm-modal": confirmHtml,
    "delete-branch-modal": deleteBranchHtml,
    "set-upstream-modal": setUpstreamHtml,
    "update-modal": updateHtml,
    "stash-confirm-modal": stashConfirmHtml,
    "merge-modal": mergeHtml,
    "merge-strategy-modal": mergeStrategyHtml,
    "conflicts-summary-modal": conflictsSummaryHtml,
    "error-modal": errorHtml,
};

const loaded = new Set<string>();
/** Returns the modal root where lazily-hydrated fragments are injected. */
function getRoot(): HTMLElement | null {
    return qs<HTMLElement>('#modals-root');
}

// Per-element close-animation timer and click-to-close wiring (typed
// replacements for the former ad-hoc per-element animation flags).
const closeAnimationTimers = new WeakMap<HTMLElement, number>();
const closeClickWired = new WeakSet<HTMLElement>();

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

/** Updates a modal's hidden state and emits lifecycle events when visibility changes. */
function setModalHidden(el: HTMLElement, hidden: boolean) {
    const wasHidden = el.getAttribute("aria-hidden") !== "false";
    const nextHidden = hidden ? "true" : "false";
    if (el.getAttribute("aria-hidden") !== nextHidden) {
        el.setAttribute("aria-hidden", nextHidden);
    }
    if (!hidden && wasHidden) {
        el.dispatchEvent(new CustomEvent("modal:opened"));
    }
    if (hidden && !wasHidden) {
        el.dispatchEvent(new CustomEvent("modal:closed"));
    }
    return wasHidden;
}

function closeWithAnimation(id: string, el: HTMLElement) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
        closeModal(id);
        return;
    }
    const existing = closeAnimationTimers.get(el);
    if (existing) window.clearTimeout(existing);
    el.classList.add("is-closing");
    const delay = id === "repo-switch-drawer" ? 130 : 140;
    closeAnimationTimers.set(el, window.setTimeout(() => {
        el.classList.remove("is-closing");
        closeAnimationTimers.delete(el);
        closeModal(id);
    }, delay));
}

export function hydrate(id: string): void {
    // If it's already in the DOM, treat as loaded and skip
    const existing = document.getElementById(id);
    if (existing) {
        loaded.add(id);
        return;
    }
    const root = getRoot();
    if (!root || loaded.has(id)) return;

    const html = FRAGMENTS[id];
    if (!html) {
        // Nothing to inject and no existing node -> real error
        throw new Error(`No fragment registered for ${id}`);
    }

    root.insertAdjacentHTML("beforeend", html);
    loaded.add(id);

    void wireModalFragment(id);
    const inserted = document.getElementById(id);
    if (inserted) initOverlayScrollbarsFor(inserted);
}

/**
 * Wires the feature event handlers for a lazily-hydrated modal fragment.
 * Loaded dynamically so feature modules never create an import cycle with the
 * modal shell they depend on.
 */
async function wireModalFragment(id: string): Promise<void> {
    switch (id) {
        case "settings-modal": (await import("../features/settings")).wireSettings(); break;
        case "repo-settings-modal": (await import("../features/repoSettings")).wireRepoSettings(); break;
        // ssh-hostkey-modal: wiring is done by the listener in the sshHostkey feature
        case "ssh-keys-modal": (await import("../features/sshKeys")).wireSshKeys(); break;
        case "new-branch-modal": (await import("../features/newBranch")).wireNewBranch(); break;
        case "rename-branch-modal": (await import("../features/renameBranch")).wireRenameBranch(); break;
        case "cherry-pick-modal": (await import("../features/cherryPick")).wireCherryPick(); break;
        case "confirm-modal": (await import("../features/confirmModal")).wireConfirmModal(); break;
        case "delete-branch-modal": (await import("../features/deleteBranchConfirm")).wireDeleteBranchConfirm(); break;
        case "set-upstream-modal": (await import("../features/setUpstream")).wireSetUpstream(); break;
        case "update-modal": (await import("../features/update")).wireUpdate(); break;
        case "stash-confirm-modal": (await import("../features/stashConfirm")).wireStashConfirm(); break;
    }
}

export function openModal(id: string): void {
    // Prefer existing element; only hydrate if missing
    let el = document.getElementById(id);
    if (!el) hydrate(id);
    el = document.getElementById(id);
    if (!el) return;

    if (!el.hasAttribute("aria-hidden")) el.setAttribute("aria-hidden", "true");
    el.classList.remove("is-closing");
    const existing = closeAnimationTimers.get(el);
    if (existing) {
        window.clearTimeout(existing);
        closeAnimationTimers.delete(el);
    }
    const wasHidden = setModalHidden(el, false);
    if (wasHidden) lockScroll();
    refreshOverlayScrollbarsFor(el);

    // Click-to-close once
    if (!closeClickWired.has(el)) {
        el.addEventListener("click", (evt) => {
            const t = evt.target as HTMLElement;
            const isBackdrop = t.classList?.contains("backdrop");
            const wantsClose = isBackdrop || !!t.closest("[data-close]");
            if (wantsClose) closeWithAnimation(id, el);
        });
        closeClickWired.add(el);
    }
}

export function closeModal(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.getAttribute("aria-hidden") !== "true") {
        setModalHidden(el, true);
        unlockScroll();
    }
}

export function closeAllModals(): void {
    const openModals = Array.from(
        document.querySelectorAll<HTMLElement>(".modal[aria-hidden='false']")
    );
    for (const el of openModals) {
        const existing = closeAnimationTimers.get(el);
        if (existing) {
            window.clearTimeout(existing);
            closeAnimationTimers.delete(el);
        }
        el.classList.remove("is-closing");
        setModalHidden(el, true);
    }
    openCount = 0;
    document.body.style.overflow = "";
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
    if (top?.id) closeWithAnimation(top.id, top);
});
