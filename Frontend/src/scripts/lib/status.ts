// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { qs, setText } from './dom';

const statusEl = qs<HTMLElement>('#status');

/**
 * Updates the footer status text.
 * @param text - Status text to display.
 */
export function setStatus(text: string) {
  if (!statusEl) return;
  setText(statusEl, text);
}
