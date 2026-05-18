// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { escapeHtml } from '../../lib/dom';
import { diffEl } from './context';

/** Scrolls the current diff viewport back to the origin. */
export function scrollDiffToTop() {
    if (!diffEl) return;
    const host = diffEl.closest('.diff-scroll') as HTMLElement | null;
    const viewport = host?.querySelector<HTMLElement>('.os-viewport, [data-overlayscrollbars-viewport]') || host || diffEl.parentElement || diffEl;
    if (viewport) {
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
    }
}

/** Regex markers that identify non-textual Git patches. */
const BINARY_DIFF_INDICATORS = [
    /^binary files /i,
    /^git binary patch/i,
    /^literal /i,
];

/** Returns true when the diff payload should be treated as binary. */
export function detectBinaryDiff(lines: string[] = []) {
    if (!Array.isArray(lines)) {
        return true;
    }
    if (lines.length === 0) {
        return false;
    }
    const hasHunks = lines.some((line) => (line || '').startsWith('@@'));
    if (hasHunks) {
        return false;
    }
    return lines.some((line) =>
        BINARY_DIFF_INDICATORS.some((rx) => rx.test(String(line || '')))
    );
}

/** Renders a placeholder hunk for binary or unsupported file types. */
export function renderBinaryDiffPlaceholder(path?: string) {
    const label = path ? ` (${escapeHtml(path)})` : '';
    return `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code binary-placeholder">Diff not supported on this file type${label}.</div></div></div>`;
}

/** Builds a synthetic unified diff for an untracked text file. */
export function buildUntrackedTextPatch(path: string, text: string): string[] {
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    const body = normalized.length ? normalized.split('\n') : [];
    if (body.length > 0 && body[body.length - 1] === '') body.pop();
    const out = [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${path}`,
        `@@ -0,0 +1,${body.length} @@`,
    ];
    for (const line of body) out.push(`+${line}`);
    return out;
}

/** Returns true when a status code represents an untracked file. */
export function isUntrackedStatus(status: string) {
    return String(status || '').includes('?');
}
