// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/mergeStrategy.ts
import { closeModal } from '../ui/modals';
import { ModalController } from '../lib/modalController';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { confirmBool } from '../lib/confirm';
import { state } from '../state/state';
import { hydrateStatus } from './repo';
import { setTab } from '../ui/layout';
import { openConflictsSummary } from './conflicts';
import type { FileStatus } from '../types';

let pendingResolve: ((strategy: string | null) => void) | null = null;

function resolvePending(strategy: string | null) {
  if (!pendingResolve) return;
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve(strategy);
}

/** Per-open state for the merge-strategy picker modal. */
export interface MergeStrategyState {
  branchName: string;
  targetBranch: string;
  supported: string[];
}

/** Owns the merge-strategy modal lifecycle: wires once, shows options per prompt. */
export const mergeStrategyController = new ModalController<MergeStrategyState>(
  'merge-strategy-modal',
  {
    wire: (modal) => {
      const options = modal.querySelectorAll<HTMLElement>('.merge-strategy-option');
      for (const opt of options) {
        const handler = () => {
          const strategy = opt.getAttribute('data-strategy');
          resolvePending(strategy);
          closeModal('merge-strategy-modal');
        };
        opt.addEventListener('click', handler);
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handler();
          }
        });
      }

      // Single persistent listener for all dismiss paths — never leaks
      modal.addEventListener('modal:closed', () => resolvePending(null));
    },
    apply: (state, modal) => {
      const hintEl = document.getElementById('merge-strategy-hint');
      if (hintEl) {
        hintEl.textContent = `Choose how to merge '${state.branchName}' into '${state.targetBranch}'.`;
      }

      // Show only options for strategies the backend supports
      const options = modal?.querySelectorAll<HTMLElement>('.merge-strategy-option');
      if (options) {
        const supportedSet = new Set(state.supported);
        for (const opt of options) {
          const strat = opt.getAttribute('data-strategy');
          const visible = strat ? supportedSet.has(strat) : false;
          opt.style.display = visible ? '' : 'none';
        }
      }
    },
  },
);

/** Prompts the user to pick a merge strategy and resolves with their choice. */
export function promptMergeStrategy(
  branchName: string,
  targetBranch: string,
  supported: string[],
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const prev = pendingResolve;
    pendingResolve = resolve;
    if (prev) prev(null);
    mergeStrategyController.open({ branchName, targetBranch, supported });
  });
}

/**
 * Merges `branchName` into `currentBranch`, choosing a strategy via the picker
 * when the backend supports advanced strategies (squash/rebase) or falling back
 * to a plain confirmation otherwise. Handles busy UI and conflict surfacing.
 *
 * @param branchName - Branch to merge from
 * @param currentBranch - Branch to merge into
 * @param onMerged - Refresh callback invoked after a successful merge
 */
export async function mergeBranchWithStrategy(
  branchName: string,
  currentBranch: string,
  onMerged: () => Promise<void> | void,
): Promise<void> {
  if (branchName === currentBranch) {
    notify('Cannot merge a branch into itself');
    return;
  }
  const strategies = await TAURI.invoke<string[]>('vcs_merge_strategies').catch(() => []);
  const hasAdvanced = strategies.some(s => s === 'squash' || s === 'rebase');
  const strategy = hasAdvanced
    ? await promptMergeStrategy(branchName, currentBranch, strategies)
    : (await confirmBool(`Merge '${branchName}' into '${currentBranch}'?`) ? 'merge' : null);
  if (!strategy) return;

  const statusEl = document.getElementById('status');
  const setBusy = (msg: string) => {
    if (statusEl) { statusEl.textContent = msg; statusEl.classList.add('busy'); }
  };
  const clearBusy = () => {
    if (statusEl) statusEl.classList.remove('busy');
  };

  try {
    setBusy('Merging…');
    await TAURI.invoke('vcs_merge_branch', { name: branchName, strategy });
    clearBusy();
    notify(`Merged branch '${branchName}' into '${currentBranch}'`);
    await onMerged();
  } catch (e) {
    clearBusy();
    const msg = String(e || '');
    const looksLikeConflict =
      /CONFLICT/i.test(msg) ||
      /Automatic merge failed/i.test(msg) ||
      /fix conflicts and then commit/i.test(msg);

    if (looksLikeConflict) {
      notify('Merge conflict detected');
      await hydrateStatus();
      setTab('changes');
      await openConflictsSummary((state.files || []) as FileStatus[]);
      return;
    }

    notify(`Merge failed${msg ? `: ${msg}` : ''}`);
  }
}
