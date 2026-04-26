// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { closeModal, hydrate, openModal } from '../ui/modals';
import { state } from '../state/state';
import { hydrateBranches, hydrateCommits, hydrateStatus } from './repo';

type CommitLike = { id?: string; msg?: string };

export function wireCherryPick() {
  const modal = document.getElementById('cherry-pick-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  const modalEl = modal;
  (modalEl as any).__wired = true;

  const commitEl = modalEl.querySelector<HTMLInputElement>('#cherry-pick-commit');
  const branchEl = modalEl.querySelector<HTMLSelectElement>('#cherry-pick-branch');
  const confirm = modalEl.querySelector<HTMLButtonElement>('#cherry-pick-confirm');

  function validate() {
    const commit = (modalEl.dataset.commit || '').trim();
    const branch = (branchEl?.value || '').trim();
    if (confirm) confirm.disabled = !(commit && branch);
  }

  branchEl?.addEventListener('change', validate);

  confirm?.addEventListener('click', async () => {
    const commit = (modalEl.dataset.commit || '').trim();
    const branch = (branchEl?.value || '').trim();
    if (!commit || !branch) return;
    try {
      await TAURI.invoke('git_cherry_pick_to_branch', { id: commit, branch });
      notify(`Cherry-picked onto ${branch}`);
      closeModal('cherry-pick-modal');
      await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits()]);
    } catch (e) {
      const msg = String(e || '').trim();
      notify(msg ? `Cherry-pick failed: ${msg}` : 'Cherry-pick failed');
    } finally {
      validate();
    }
  });

  (modalEl as any).setInitial = (commit: CommitLike, branches: string[], currentBranch?: string) => {
    const id = String(commit?.id || '').trim();
    const short = id ? id.slice(0, 7) : '';
    const msg = String(commit?.msg || '').trim();
    modalEl.dataset.commit = id;
    if (commitEl) commitEl.value = msg ? `${short} — ${msg}` : (short || id);

    const opts = (branches || []).slice().sort((a, b) => a.localeCompare(b));
    const current = String(currentBranch || '').trim();
    const preferred = opts.includes(current) ? current : (opts[0] || '');
    if (branchEl) {
      branchEl.innerHTML = [
        `<option value="" disabled ${preferred ? '' : 'selected'}>Select a branch…</option>`,
        ...opts.map((b) => `<option value="${b}">${b}</option>`),
      ].join('');
      if (preferred) branchEl.value = preferred;
    }

    validate();
    setTimeout(() => branchEl?.focus(), 0);
  };
}

export async function openCherryPick(commit: CommitLike) {
  hydrate('cherry-pick-modal');
  wireCherryPick();

  await hydrateBranches();
  const branches = (state.branches || [])
    .filter((b: any) => {
      const kind = String(b?.kind?.type || '').toLowerCase();
      const isRemote = kind === 'remote' || String(b?.full_ref || '').startsWith('refs/remotes/');
      return !isRemote;
    })
    .map((b: any) => String(b?.name || '').trim())
    .filter((s: string) => !!s);

  if (branches.length === 0) {
    notify('No local branches found');
    return;
  }

  const modal = document.getElementById('cherry-pick-modal') as any;
  modal?.setInitial?.(commit, branches, state.branch);
  openModal('cherry-pick-modal');
}
