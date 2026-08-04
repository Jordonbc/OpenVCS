// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/cherryPick.ts
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { closeModal } from '../ui/modals';
import { state } from '../state/state';
import { hydrateBranches, hydrateCommits, hydrateStatus } from './repo';
import { ModalController } from '../lib/modalController';

type CommitLike = { id?: string; msg?: string };

/** Per-open state for the cherry-pick modal. */
export interface CherryPickState {
  commit: CommitLike;
  branches: string[];
  currentBranch?: string;
}

/** Enables the confirm button only when both commit and branch are set. */
function validateCherryPick(modal: HTMLElement): void {
  const commit = (modal.dataset.commit || '').trim();
  const branchEl = modal.querySelector<HTMLSelectElement>('#cherry-pick-branch');
  const confirm = modal.querySelector<HTMLButtonElement>('#cherry-pick-confirm');
  const branch = (branchEl?.value || '').trim();
  if (confirm) confirm.disabled = !(commit && branch);
}

/** Owns the cherry-pick modal lifecycle: wires once, applies state per open. */
export const cherryPickController = new ModalController<CherryPickState>(
  'cherry-pick-modal',
  {
    wire: (modal) => {
      const branchEl = modal.querySelector<HTMLSelectElement>('#cherry-pick-branch');
      branchEl?.addEventListener('change', () => validateCherryPick(modal));

      modal.querySelector<HTMLButtonElement>('#cherry-pick-confirm')?.addEventListener('click', async () => {
        const commit = (modal.dataset.commit || '').trim();
        const branch = (branchEl?.value || '').trim();
        if (!commit || !branch) return;
        try {
          await TAURI.invoke('vcs_cherry_pick_to_branch', { id: commit, branch });
          notify(`Cherry-picked onto ${branch}`);
          closeModal('cherry-pick-modal');
          await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits()]);
        } catch (e) {
          const msg = String(e || '').trim();
          notify(msg ? `Cherry-pick failed: ${msg}` : 'Cherry-pick failed');
        } finally {
          validateCherryPick(modal);
        }
      });
    },
    apply: (state, modal) => {
      const commit = state.commit || {};
      const id = String(commit?.id || '').trim();
      const short = id ? id.slice(0, 7) : '';
      const msg = String(commit?.msg || '').trim();
      modal.dataset.commit = id;
      const commitEl = modal.querySelector<HTMLInputElement>('#cherry-pick-commit');
      if (commitEl) commitEl.value = msg ? `${short} — ${msg}` : (short || id);

      const opts = (state.branches || []).slice().sort((a, b) => a.localeCompare(b));
      const current = String(state.currentBranch || '').trim();
      const preferred = opts.includes(current) ? current : (opts[0] || '');
      const branchEl = modal.querySelector<HTMLSelectElement>('#cherry-pick-branch');
      if (branchEl) {
        branchEl.innerHTML = [
          `<option value="" disabled ${preferred ? '' : 'selected'}>Select a branch…</option>`,
          ...opts.map((b) => `<option value="${b}">${b}</option>`),
        ].join('');
        if (preferred) branchEl.value = preferred;
      }

      validateCherryPick(modal);
      setTimeout(() => branchEl?.focus(), 0);
    },
  },
);

/** Wires the cherry-pick modal once. No-op after the first call. */
export function wireCherryPick(): void {
  cherryPickController.initOnce();
}

/** Opens the cherry-pick modal for the given commit, selecting a target branch. */
export async function openCherryPick(commit: CommitLike): Promise<void> {
  await hydrateBranches();
  const branches = (state.branches || [])
    .filter((b) => {
      const kind = String(b?.kind?.type || '').toLowerCase();
      const isRemote = kind === 'remote' || String(b?.full_ref || '').startsWith('refs/remotes/');
      return !isRemote;
    })
    .map((b) => String(b?.name || '').trim())
    .filter((s: string) => !!s);

  if (branches.length === 0) {
    notify('No local branches found');
    return;
  }

  cherryPickController.open({ commit, branches, currentBranch: state.branch });
}
