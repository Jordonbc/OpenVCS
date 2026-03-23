// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/about.ts
import { openModal } from "@scripts/ui/modals";
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";

function q<T extends HTMLElement>(sel: string, root: ParentNode): T | null {
    return root.querySelector(sel) as T | null;
}

/** Sets an element's text content and hides it when the value is empty. */
function setOptionalText(element: HTMLElement | null, value: string): void {
    if (!element) return;

    element.textContent = value;
    element.style.display = value ? "" : "none";
}

/** Sets an optional link and hides it when no URL is available. */
function setOptionalLink(element: HTMLAnchorElement | null, href: string): void {
    if (!element) return;

    element.href = href;
    element.toggleAttribute("disabled", !href);
    element.style.display = href ? "" : "none";
}

/** Opens the About modal and hydrates its build metadata. */
export async function openAbout(): Promise<void> {
    // Ensure the fragment is injected & visible
    openModal("about-modal");

    const modal = document.getElementById("about-modal");
    if (!modal) return;

    try {
        const info = (TAURI.has ? await TAURI.invoke("about_info").catch(() => null) : null) as
            | {
            version?: string;
            build?: string;
            authors?: string;
            homepage?: string;
            repository?: string;
        }
            | null;

        const aboutLogo     = q<HTMLImageElement>("#about-logo", modal);
        const aboutVersion  = q<HTMLElement>("#about-version", modal);
        const aboutBuild    = q<HTMLElement>("#about-build", modal);
        const aboutAuthor   = q<HTMLElement>("#about-author", modal);
        const aboutHome     = q<HTMLAnchorElement>("#about-home", modal);
        const aboutRepo     = q<HTMLAnchorElement>("#about-repo", modal);
        const aboutLicenses = q<HTMLAnchorElement>("#about-licenses", modal);
        const authors = info?.authors
            ?.split(":")
            .map((author) => author.trim())
            .filter(Boolean)
            .join(", ");

        if (aboutLogo) {
            aboutLogo.onerror = () => {
                aboutLogo.style.display = "none";
            };
            aboutLogo.src = `${import.meta.env.BASE_URL}OpenVCS-40.png`;
        }
        if (aboutVersion) aboutVersion.textContent = info?.version ? `v${info.version}` : "";
        setOptionalText(aboutBuild, info?.build ?? "");
        setOptionalText(aboutAuthor, authors ? `By ${authors}` : "");

        setOptionalLink(aboutHome, info?.homepage || "");
        setOptionalLink(aboutRepo, info?.repository || "");

        if (aboutLicenses) {
            const rawRepo = info?.repository || "";
            const repo = rawRepo.replace(/\.git$/, "").replace(/\/+$/, "");
            const licenseUrl = repo ? `${repo}/blob/HEAD/LICENSE` : "";
            setOptionalLink(aboutLicenses, licenseUrl);
        }
    } catch {
        notify("Unable to load About");
    }
}
