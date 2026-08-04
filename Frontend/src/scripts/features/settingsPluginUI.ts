// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { ensurePluginSettingsLoaded } from './settingsPluginPanels';
import { renderPluginMenus } from './settingsPluginNav';

// ---------------------------------------------------------------------------
// Public API facade
// ---------------------------------------------------------------------------

export { renderPluginMenus } from './settingsPluginNav';
export { collectPluginSettingsFromPanel } from './settingsPluginPanels';

/** Activates a settings section by its data-section identifier, showing/hiding nav and panels. */
export function activateSection(modal: HTMLElement, section: string): void {
    const nav = modal.querySelector('#settings-nav');
    const panels = modal.querySelector('#settings-panels');
    if (!nav || !panels) return;

    const safeSection = (() => {
        const requested = String(section || '').trim();
        if (requested && nav.querySelector<HTMLElement>(`[data-section="${requested}"]`)) return requested;
        return 'general';
    })();

    const btn = nav.querySelector<HTMLElement>(`[data-section="${safeSection}"]`);
    nav.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
    });
    panels.querySelectorAll<HTMLElement>('.panel-form').forEach((p) => {
        p.classList.toggle('hidden', p.getAttribute('data-panel') !== safeSection);
    });

    // Keep footer actions hidden for action-only plugin menu panels.
    const actions = modal.querySelector<HTMLElement>('.sheet-actions');
    const activePanel = panels.querySelector<HTMLElement>(
        `.panel-form[data-panel="${CSS.escape(safeSection)}"]`,
    );
    const isPluginMenuPanel = activePanel?.getAttribute('data-plugin-menu') === 'true';
    const isPluginSettingsPanel = activePanel?.getAttribute('data-plugin-settings') === 'true';
    const hideActions = safeSection === 'plugins' || (isPluginMenuPanel && !isPluginSettingsPanel);
    if (actions) actions.classList.toggle('hidden', hideActions);

    if (isPluginSettingsPanel && activePanel) {
        const pluginId = String(activePanel.dataset.pluginId || '').trim();
        if (pluginId) {
            ensurePluginSettingsLoaded(modal, pluginId, safeSection).catch(() => {});
        }
    }
}
