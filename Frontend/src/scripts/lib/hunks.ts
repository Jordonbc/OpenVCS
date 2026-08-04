// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import type { HunkNodeRefs } from '../state/state';

/**
 * Collect the line indices selectable in a hunk, checking each line checkbox.
 *
 * @param refs - Hunk DOM node references (may be undefined for a missing hunk)
 * @returns Sorted, deduplicated line indices of the hunk's selectable lines
 */
export function collectHunkLineIndices(refs: HunkNodeRefs | undefined): number[] {
    const picked: number[] = [];
    Object.entries(refs?.lineCheckboxes || {}).forEach(([key, box]) => {
        const lineIdx = Number(key);
        if (lineIdx < 0) return;
        picked.push(lineIdx);
        box.checked = true;
    });
    return Array.from(new Set(picked)).sort((a, b) => a - b);
}
