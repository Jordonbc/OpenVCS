// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/repoSelection.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state } from '../state/state';

type RepoSummary = { path: string; current_branch: string; branches: { name: string }[] };

export async function refreshRepoSummary() {
    try {
        const info = await TAURI.invoke<RepoSummary>('get_repo_summary');
        state.branch = info.current_branch || '';
        state.branches = Array.isArray(info.branches) ? info.branches : [];
        const repoBranch = document.querySelector<HTMLElement>('#repo-branch');
        if (repoBranch) repoBranch.textContent = state.branch || '—';
        window.dispatchEvent(new CustomEvent('app:repo-selected', { detail: { path: info.path } }));
    } catch {
        notify('Failed to refresh repo summary');
    }
}
