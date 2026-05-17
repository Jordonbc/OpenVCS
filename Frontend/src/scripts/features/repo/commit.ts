// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { globalSettings, state } from '../../state/state';
import type { FileStatus } from '../../types';
import {
    DEFAULT_COMMIT_MESSAGE_CREATE,
    DEFAULT_COMMIT_MESSAGE_DELETE,
    DEFAULT_COMMIT_MESSAGE_UPDATE,
} from '../settingsCommit';

/** Returns the single file involved in commit selection, if exactly one. */
function selectedCommitFile(): string | null {
    const paths = new Set<string>();
    for (const path of Array.from(state.selectedFiles || [])) {
        const trimmed = String(path || '').trim();
        if (trimmed) paths.add(trimmed);
    }
    for (const [path, hunks] of Object.entries((state as any).selectedHunksByFile || {})) {
        if (Array.isArray(hunks) && hunks.length > 0) {
            const trimmed = String(path || '').trim();
            if (trimmed) paths.add(trimmed);
        }
    }
    for (const [path, lineGroups] of Object.entries((state as any).selectedLinesByFile || {})) {
        if (lineGroups && Object.keys(lineGroups).length > 0) {
            const trimmed = String(path || '').trim();
            if (trimmed) paths.add(trimmed);
        }
    }
    if (paths.size !== 1) return null;
    return Array.from(paths)[0] || null;
}

/** Returns status for one selected file, or null when unknown. */
function selectedCommitFileStatus(filePath: string): string {
    const file = (state.files || []).find((entry: FileStatus) => String(entry?.path || '') === filePath);
    return String(file?.status || '').trim().toUpperCase();
}

/** Returns commit hint template for one selected file. */
function selectedCommitTemplate(filePath: string): string {
    const status = selectedCommitFileStatus(filePath);
    if (status === 'A' || status === '?' || status.includes('?')) {
        return globalSettings?.commit?.commit_templates?.commit_message_template_create || DEFAULT_COMMIT_MESSAGE_CREATE;
    }
    if (status === 'D') {
        return globalSettings?.commit?.commit_templates?.commit_message_template_delete || DEFAULT_COMMIT_MESSAGE_DELETE;
    }
    return globalSettings?.commit?.commit_templates?.commit_message_template_update || DEFAULT_COMMIT_MESSAGE_UPDATE;
}

/** Expands commit template placeholders for one selected file. */
function expandCommitTemplate(template: string, filePath: string): string {
    const fileName = String(filePath || '').trim().split(/[/\\]/).pop() || filePath;
    return template
        .split('{file:name}').join(fileName)
        .split('{file:path}').join(filePath);
}

/** Truncates long commit summary text with an ellipsis. */
function truncateCommitSummaryHint(text: string): string {
    const clean = String(text || '');
    if (clean.length <= 72) return clean;
    return `${clean.slice(0, 69)}...`;
}

/** Returns commit message hint when single-file prefill applies. */
export function getCommitSummaryHint(): string {
    const filePath = selectedCommitFile();
    const enabled = globalSettings?.commit?.commit_message_template_enabled !== false;
    if (!filePath || !enabled) return '';
    const hint = expandCommitTemplate(selectedCommitTemplate(filePath), filePath);
    if (globalSettings?.commit?.restrict_commit_summary === false) return hint;
    return truncateCommitSummaryHint(hint);
}

export function updateCommitButton() {
    const btn = document.getElementById('commit-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const summary = document.getElementById('commit-summary') as HTMLInputElement | null;
    const hint = getCommitSummaryHint();

    if (summary) {
        summary.placeholder = hint || 'Summary (required)';
    }

    const summaryFilled = (summary?.value.trim().length ?? 0) > 0 || !!hint;
    const hunksSelected = Object.keys((state as any).selectedHunksByFile || {})
        .some((k) => Array.isArray((state as any).selectedHunksByFile[k]) && (state as any).selectedHunksByFile[k].length > 0);
    const linesSelected = Object.keys((state as any).selectedLinesByFile || {})
        .some((k) => !!(state as any).selectedLinesByFile[k] && Object.keys((state as any).selectedLinesByFile[k] || {}).length > 0);
    const filesSelected = !!(state.selectedFiles && state.selectedFiles.size > 0);
    btn.disabled = !(summaryFilled && (hunksSelected || linesSelected || filesSelected));
}
