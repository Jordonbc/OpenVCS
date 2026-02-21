// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/ui/modals.ts
import { qs } from "@scripts/lib/dom";
import { initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from "../lib/scrollbars";
import settingsHtml from "@modals/settings.html?raw";
import cmdHtml from "@modals/commandSheet.html?raw";
import aboutHtml from "@modals/about.html?raw";
import pluginPermissionsHtml from "@modals/plugin-permissions.html?raw";
import { wireSettings } from "../features/settings";
import repoSettingsHtml from "@modals/repo-settings.html?raw";
import { wireRepoSettings } from "../features/repoSettings";
import sshHostkeyHtml from "@modals/ssh-hostkey.html?raw";
import sshAuthHtml from "@modals/ssh-auth.html?raw";
import sshKeysHtml from "@modals/ssh-keys.html?raw";
import newBranchHtml from "@modals/new-branch.html?raw";
import { wireNewBranch } from "../features/newBranch";
import renameBranchHtml from "@modals/rename-branch.html?raw";
import { wireRenameBranch } from "../features/renameBranch";
import cherryPickHtml from "@modals/cherry-pick.html?raw";
import { wireCherryPick } from "../features/cherryPick";
import deleteBranchHtml from "@modals/delete-branch.html?raw";
import { wireDeleteBranchConfirm } from "../features/deleteBranchConfirm";
import setUpstreamHtml from "@modals/set-upstream.html?raw";
import { wireSetUpstream } from "../features/setUpstream";
import updateHtml from "@modals/update.html?raw";
import { wireUpdate } from "../features/update";
import stashConfirmHtml from "@modals/stash-confirm.html?raw";
import { wireStashConfirm } from "../features/stashConfirm";
import mergeHtml from "@modals/merge.html?raw";
import conflictsSummaryHtml from "@modals/conflicts-summary.html?raw";
import { wireSshKeys } from "../features/sshKeys";
import repoSwitchDrawerHtml from "@modals/repoSwitchDrawer.html?raw";

// Lazy fragments (only those NOT present at load)
const FRAGMENTS: Record<string, string> = {
    "settings-modal": settingsHtml,
    "about-modal": aboutHtml,
    "plugin-permissions-modal": pluginPermissionsHtml,
    "command-modal": cmdHtml,
    "repo-switch-drawer": repoSwitchDrawerHtml,
    "repo-settings-modal": repoSettingsHtml,
    "ssh-hostkey-modal": sshHostkeyHtml,
    "ssh-auth-modal": sshAuthHtml,
    "ssh-keys-modal": sshKeysHtml,
    "new-branch-modal": newBranchHtml,
    "rename-branch-modal": renameBranchHtml,
    "cherry-pick-modal": cherryPickHtml,
    "delete-branch-modal": deleteBranchHtml,
    "set-upstream-modal": setUpstreamHtml,
    "update-modal": updateHtml,
    "stash-confirm-modal": stashConfirmHtml,
    "merge-modal": mergeHtml,
    "conflicts-summary-modal": conflictsSummaryHtml,
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

function closeWithAnimation(id: string, el: HTMLElement) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
        closeModal(id);
        return;
    }
    const existing = (el as any).__animatedCloseTimer as number | undefined;
    if (existing) window.clearTimeout(existing);
    el.classList.add("is-closing");
    const delay = id === "repo-switch-drawer" ? 130 : 140;
    (el as any).__animatedCloseTimer = window.setTimeout(() => {
        el.classList.remove("is-closing");
        closeModal(id);
        (el as any).__animatedCloseTimer = undefined;
    }, delay);
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
    if (id === "ssh-hostkey-modal") {
        // wiring is done by the listener in the sshHostkey feature
    }
    if (id === "ssh-keys-modal") wireSshKeys();
    if (id === "new-branch-modal") wireNewBranch();
    if (id === "rename-branch-modal") wireRenameBranch();
    if (id === "cherry-pick-modal") wireCherryPick();
    if (id === "delete-branch-modal") wireDeleteBranchConfirm();
    if (id === "set-upstream-modal") wireSetUpstream();
    if (id === "update-modal") wireUpdate();
    if (id === "stash-confirm-modal") wireStashConfirm();

    const inserted = document.getElementById(id);
    if (inserted) initOverlayScrollbarsFor(inserted);
}

export function openModal(id: string): void {
    // Prefer existing element; only hydrate if missing
    let el = document.getElementById(id);
    if (!el) hydrate(id);
    el = document.getElementById(id);
    if (!el) return;

    if (!el.hasAttribute("aria-hidden")) el.setAttribute("aria-hidden", "true");
    el.classList.remove("is-closing");
    const existing = (el as any).__animatedCloseTimer as number | undefined;
    if (existing) {
        window.clearTimeout(existing);
        (el as any).__animatedCloseTimer = undefined;
    }
    el.setAttribute("aria-hidden", "false");
    lockScroll();
    refreshOverlayScrollbarsFor(el);

    // Click-to-close once
    if (!(el as any).__closeWired) {
        el.addEventListener("click", (evt) => {
            const t = evt.target as HTMLElement;
            const isBackdrop = t.classList?.contains("backdrop");
            const wantsClose = isBackdrop || !!t.closest("[data-close]");
            if (wantsClose) closeWithAnimation(id, el);
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

export function closeAllModals(): void {
    const openModals = Array.from(
        document.querySelectorAll<HTMLElement>(".modal[aria-hidden='false']")
    );
    for (const el of openModals) {
        const existing = (el as any).__animatedCloseTimer as number | undefined;
        if (existing) {
            window.clearTimeout(existing);
            (el as any).__animatedCloseTimer = undefined;
        }
        el.classList.remove("is-closing");
        el.setAttribute("aria-hidden", "true");
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
