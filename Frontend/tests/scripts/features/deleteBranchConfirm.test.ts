// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/ui/modals', () => ({
  closeModal: vi.fn(),
  hydrate: vi.fn(),
  openModal: vi.fn(),
}));

function mountDeleteBranchModal() {
  document.body.innerHTML = `
    <div id="delete-branch-modal" class="modal" aria-hidden="false">
      <div class="backdrop"></div>
      <div class="modal-content">
        <h2 id="delete-branch-title"></h2>
        <p id="delete-branch-hint"></p>
        <p id="delete-branch-message"></p>
        <p id="delete-branch-danger" hidden></p>
        <p id="delete-branch-name"></p>
        <button id="delete-branch-cancel-btn" data-close>Cancel</button>
        <button id="delete-branch-confirm-btn">Delete</button>
      </div>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  mountDeleteBranchModal();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('wireDeleteBranchConfirm', () => {
  it('sets __wired and skips on second call', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    const modal = document.getElementById('delete-branch-modal') as any;
    expect(modal.__wired).toBeUndefined();
    wireDeleteBranchConfirm();
    expect(modal.__wired).toBe(true);
    wireDeleteBranchConfirm();
    expect(modal.__wired).toBe(true);
  });

  it('does nothing when modal is missing', async () => {
    document.body.innerHTML = '';
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    expect(() => wireDeleteBranchConfirm()).not.toThrow();
  });
});

describe('setContent', () => {
  it('sets content for force delete', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    wireDeleteBranchConfirm();
    const modal = document.getElementById('delete-branch-modal') as any;

    modal.setContent({
      name: 'stale-branch',
      force: true,
      hint: 'This is permanent.',
      message: 'Really force delete this branch?',
    });

    const titleEl = document.getElementById('delete-branch-title') as HTMLElement;
    const hintEl = document.getElementById('delete-branch-hint') as HTMLElement;
    const messageEl = document.getElementById('delete-branch-message') as HTMLElement;
    const dangerEl = document.getElementById('delete-branch-danger') as HTMLElement;
    const nameEl = document.getElementById('delete-branch-name') as HTMLElement;
    const confirmBtn = document.getElementById('delete-branch-confirm-btn') as HTMLButtonElement;

    expect(titleEl.textContent).toBe('Force Delete Branch');
    expect(hintEl.textContent).toBe('This is permanent.');
    expect(messageEl.textContent).toBe('Really force delete this branch?');
    expect(nameEl.textContent).toBe('stale-branch');
    expect(dangerEl.hidden).toBe(false);
    expect(confirmBtn.textContent).toBe('Force delete');
    expect(confirmBtn.classList.contains('danger')).toBe(true);
    expect(confirmBtn.classList.contains('primary')).toBe(false);
  });

  it('sets content for normal delete', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    wireDeleteBranchConfirm();
    const modal = document.getElementById('delete-branch-modal') as any;

    modal.setContent({
      name: 'feature-branch',
      force: false,
    });

    const titleEl = document.getElementById('delete-branch-title') as HTMLElement;
    const hintEl = document.getElementById('delete-branch-hint') as HTMLElement;
    const dangerEl = document.getElementById('delete-branch-danger') as HTMLElement;
    const confirmBtn = document.getElementById('delete-branch-confirm-btn') as HTMLButtonElement;

    expect(titleEl.textContent).toBe('Delete Branch');
    expect(hintEl.textContent).toBe('This cannot be undone.');
    expect(dangerEl.hidden).toBe(true);
    expect(confirmBtn.textContent).toBe('Delete');
    expect(confirmBtn.classList.contains('primary')).toBe(true);
    expect(confirmBtn.classList.contains('danger')).toBe(false);
  });

  it('handles empty name with fallback dash', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    wireDeleteBranchConfirm();
    const modal = document.getElementById('delete-branch-modal') as any;

    modal.setContent({ name: '' });
    const nameEl = document.getElementById('delete-branch-name') as HTMLElement;
    expect(nameEl.textContent).toBe('—');
  });

  it('uses default message when not provided for force', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    wireDeleteBranchConfirm();
    const modal = document.getElementById('delete-branch-modal') as any;

    modal.setContent({ name: 'branch', force: true });
    const messageEl = document.getElementById('delete-branch-message') as HTMLElement;
    expect(messageEl.textContent).toBe('Force deleting permanently removes the local branch.');
  });

  it('uses default message when not provided for normal', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    wireDeleteBranchConfirm();
    const modal = document.getElementById('delete-branch-modal') as any;

    modal.setContent({ name: 'branch', force: false });
    const messageEl = document.getElementById('delete-branch-message') as HTMLElement;
    expect(messageEl.textContent).toBe('Deleting permanently removes the local branch.');
  });

  it('focuses cancel button after setContent', async () => {
    const { wireDeleteBranchConfirm } = await import('@scripts/features/deleteBranchConfirm');
    wireDeleteBranchConfirm();
    const modal = document.getElementById('delete-branch-modal') as any;
    const cancelBtn = document.getElementById('delete-branch-cancel-btn') as HTMLButtonElement;
    const focusSpy = vi.spyOn(cancelBtn, 'focus');

    modal.setContent({ name: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(focusSpy).toHaveBeenCalled();
  });
});

describe('confirmDeleteBranch', () => {
  it('resolves true via confirm button click', async () => {
    const { closeModal } = await import('@scripts/ui/modals');
    const { confirmDeleteBranch } = await import('@scripts/features/deleteBranchConfirm');
    const hydrate = (await import('@scripts/ui/modals')).hydrate;
    const openModal = (await import('@scripts/ui/modals')).openModal;

    const promise = confirmDeleteBranch({ name: 'my-branch' });

    expect(hydrate).toHaveBeenCalledWith('delete-branch-modal');
    expect(openModal).toHaveBeenCalledWith('delete-branch-modal');

    const confirmBtn = document.getElementById('delete-branch-confirm-btn') as HTMLButtonElement;
    confirmBtn.click();

    const result = await promise;
    expect(result).toBe(true);
    expect(closeModal).toHaveBeenCalledWith('delete-branch-modal');
  });

  it('resolves false via backdrop click', async () => {
    const { confirmDeleteBranch } = await import('@scripts/features/deleteBranchConfirm');

    const promise = confirmDeleteBranch({ name: 'my-branch' });

    const backdrop = document.querySelector('.backdrop') as HTMLElement;
    backdrop.click();

    const result = await promise;
    expect(result).toBe(false);
  });

  it('resolves false via escape key', async () => {
    const { confirmDeleteBranch } = await import('@scripts/features/deleteBranchConfirm');

    const promise = confirmDeleteBranch({ name: 'my-branch' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    const result = await promise;
    expect(result).toBe(false);
  });

  it('ignores escape key when modal is hidden', async () => {
    const { confirmDeleteBranch } = await import('@scripts/features/deleteBranchConfirm');

    const modal = document.getElementById('delete-branch-modal') as HTMLElement;
    modal.setAttribute('aria-hidden', 'true');

    const promise = confirmDeleteBranch({ name: 'my-branch' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    // Should not resolve, so wrap in timeout to check it stays pending
    const raced = await Promise.race([
      promise.then((v) => ({ resolved: true, value: v })),
      new Promise<{ resolved: false }>((r) => setTimeout(() => r({ resolved: false }), 50)),
    ]);
    expect(raced.resolved).toBe(false);
  });

  it('resolves false via cancel button (data-close)', async () => {
    const { confirmDeleteBranch } = await import('@scripts/features/deleteBranchConfirm');

    const promise = confirmDeleteBranch({ name: 'my-branch' });

    const cancelBtn = document.getElementById('delete-branch-cancel-btn') as HTMLButtonElement;
    cancelBtn.click();

    const result = await promise;
    expect(result).toBe(false);
  });
});
