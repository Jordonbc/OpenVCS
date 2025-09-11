// src/scripts/features/about.ts
import { openModal } from "@scripts/ui/modals";
import { TAURI } from "../lib/tauri";
import { notify } from "../lib/notify";

function q<T extends HTMLElement>(sel: string, root: ParentNode): T | null {
    return root.querySelector(sel) as T | null;
}

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
            homepage?: string;
            repository?: string;
        }
            | null;

        const aboutVersion  = q<HTMLElement>("#about-version", modal);
        const aboutBuild    = q<HTMLElement>("#about-build", modal);
        const aboutHome     = q<HTMLAnchorElement>("#about-home", modal);
        const aboutRepo     = q<HTMLAnchorElement>("#about-repo", modal);
        const aboutLicenses = q<HTMLAnchorElement>("#about-licenses", modal);

        if (aboutVersion) aboutVersion.textContent = info?.version ? `v${info.version}` : "";
        if (aboutBuild)   aboutBuild.textContent   = info?.build ?? "";

        if (aboutHome) {
            aboutHome.href = info?.homepage || "#";
            aboutHome.toggleAttribute("disabled", !info?.homepage);
        }
        if (aboutRepo) {
            aboutRepo.href = info?.repository || "#";
            aboutRepo.toggleAttribute("disabled", !info?.repository);
        }

        if (aboutLicenses) {
            const rawRepo = info?.repository || "";
            const repo = rawRepo.replace(/\.git$/, "").replace(/\/+$/, "");
            const licenseUrl = repo ? `${repo}/blob/HEAD/LICENSE` : "#";
            aboutLicenses.href = licenseUrl;
            aboutLicenses.toggleAttribute("disabled", !repo);
        }
    } catch {
        notify("Unable to load About");
    }
}
