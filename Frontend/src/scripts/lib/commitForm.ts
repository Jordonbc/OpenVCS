// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Prefill the commit summary and description inputs from an undone commit
 * message. The first line becomes the summary; the remainder (if any) becomes
 * the description. Input events are dispatched so form validation updates.
 *
 * @param msg - Full commit message of the undone commit
 */
export function prefillCommitForm(msg: string): void {
    const summaryEl = document.getElementById('commit-summary') as HTMLInputElement | null;
    const descEl = document.getElementById('commit-desc') as HTMLTextAreaElement | null;
    const firstNl = msg.indexOf('\n');
    if (firstNl === -1) {
        if (summaryEl) { summaryEl.value = msg; summaryEl.dispatchEvent(new Event('input', { bubbles: true })); }
    } else {
        if (summaryEl) { summaryEl.value = msg.slice(0, firstNl).trim(); summaryEl.dispatchEvent(new Event('input', { bubbles: true })); }
        if (descEl) { descEl.value = msg.slice(firstNl + 1).trim(); descEl.dispatchEvent(new Event('input', { bubbles: true })); }
    }
}
