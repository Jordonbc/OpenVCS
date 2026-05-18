// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qs, setText } from './dom';

const statusEl = qs<HTMLElement>('#status');

/**
 * Display a notification message in the status bar.
 * @param text - Message to display
 */
export function notify(text: string) {
    console.log(`[notify] ${text}`);
    if (!statusEl) return;
    setText(statusEl, text);
    setTimeout(() => {
        if (statusEl.textContent === text && !statusEl.classList.contains('busy')) setText(statusEl, 'Ready');
    }, 2200);
}
