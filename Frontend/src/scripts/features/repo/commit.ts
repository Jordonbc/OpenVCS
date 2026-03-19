// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { state } from '../../state/state';

export function updateCommitButton() {
    const btn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const summary = document.getElementById('commit-summary') as HTMLInputElement | null;
    const summaryFilled = (summary?.value.trim().length ?? 0) > 0;
    const hunksSelected = Object.keys((state as any).selectedHunksByFile || {})
        .some((k) => Array.isArray((state as any).selectedHunksByFile[k]) && (state as any).selectedHunksByFile[k].length > 0);
    const linesSelected = Object.keys((state as any).selectedLinesByFile || {})
        .some((k) => !!(state as any).selectedLinesByFile[k] && Object.keys((state as any).selectedLinesByFile[k] || {}).length > 0);
    const filesSelected = !!(state.selectedFiles && state.selectedFiles.size > 0);
    btn.disabled = !(summaryFilled && (hunksSelected || linesSelected || filesSelected));
}
