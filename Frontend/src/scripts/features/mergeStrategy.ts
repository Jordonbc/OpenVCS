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
}

export function promptMergeStrategy(branchName: string, targetBranch: string): Promise<string | null> {
  hydrate('merge-strategy-modal');
  wireMergeStrategyModal();

  const modal = document.getElementById('merge-strategy-modal');
  const hintEl = document.getElementById('merge-strategy-hint');
  if (hintEl) {
    hintEl.textContent = `Choose how to merge '${branchName}' into '${targetBranch}'.`;
  }

  return new Promise<string | null>((resolve) => {
    const prev = pendingResolve;
    pendingResolve = resolve;
    if (prev) prev(null);

    // Resolve with null on any dismiss path (backdrop click, cancel, Escape)
    const onClosed = () => {
      resolvePending(null);
      modal?.removeEventListener('modal:closed', onClosed);
    };
    modal?.addEventListener('modal:closed', onClosed);

    openModal('merge-strategy-modal');
  });
}
