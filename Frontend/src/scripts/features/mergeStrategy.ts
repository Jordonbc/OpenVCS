// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { closeModal, hydrate, openModal } from '../ui/modals';

let wired = false;
let pendingResolve: ((strategy: string | null) => void) | null = null;

function resolvePending(strategy: string | null) {
  if (!pendingResolve) return;
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve(strategy);
}

function wireMergeStrategyModal() {
  if (wired) return;
  wired = true;
  const modal = document.getElementById('merge-strategy-modal');
  if (!modal) return;

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
}

export function promptMergeStrategy(
  branchName: string,
  targetBranch: string,
  supported: string[],
): Promise<string | null> {
  hydrate('merge-strategy-modal');
  wireMergeStrategyModal();

  const modal = document.getElementById('merge-strategy-modal');
  const hintEl = document.getElementById('merge-strategy-hint');
  if (hintEl) {
    hintEl.textContent = `Choose how to merge '${branchName}' into '${targetBranch}'.`;
  }

  // Show only options for strategies the backend supports
  const options = modal?.querySelectorAll<HTMLElement>('.merge-strategy-option');
  if (options) {
    const supportedSet = new Set(supported);
    for (const opt of options) {
      const strat = opt.getAttribute('data-strategy');
      const visible = strat ? supportedSet.has(strat) : false;
      opt.style.display = visible ? '' : 'none';
    }
  }

  return new Promise<string | null>((resolve) => {
    const prev = pendingResolve;
    pendingResolve = resolve;
    if (prev) prev(null);
    openModal('merge-strategy-modal');
  });
}
