// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scripts/ui/modals', () => ({
  closeModal: vi.fn(),
  hydrate: vi.fn(),
  openModal: vi.fn(),
}));

function mountConfirmModal() {
  document.body.innerHTML = `
    <div id="confirm-modal" aria-hidden="true">
      <div id="confirm-modal-title"></div>
      <div id="confirm-modal-hint"></div>
      <div id="confirm-modal-message"></div>
      <button id="confirm-modal-cancel-btn">Cancel</button>
      <button id="confirm-modal-confirm-btn">Confirm</button>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  mountConfirmModal();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('wireConfirmModal', () => {
  it('wires the modal and does not re-wire', async () => {
    const { wireConfirmModal, confirmModalController } = await import('@scripts/features/confirmModal');
    wireConfirmModal();
    // Second call should be idempotent
    wireConfirmModal();
    expect(confirmModalController.isWired).toBe(true);
  });

  it('does nothing when modal is missing', async () => {
    document.body.innerHTML = '';
    const { wireConfirmModal } = await import('@scripts/features/confirmModal');
    // Should not throw
    expect(() => wireConfirmModal()).not.toThrow();
  });

  it('uses default labels when confirmLabel and cancelLabel are empty', async () => {
    const { confirmWithModal } = await import('@scripts/features/confirmModal');
    const { openModal } = await import('@scripts/ui/modals');

    confirmWithModal({ title: 'T', hint: 'H', message: 'M', confirmLabel: '   ', cancelLabel: undefined as any, danger: true });
    await vi.waitFor(() => expect(openModal).toHaveBeenCalled());

    const modal = document.getElementById('confirm-modal') as HTMLElement;
    expect(modal.querySelector('#confirm-modal-confirm-btn')?.textContent).toBe('Confirm');
    expect(modal.querySelector('#confirm-modal-cancel-btn')?.textContent).toBe('Cancel');
  });

  it('does not throw when modal:closed fires with no pending confirm', async () => {
    const { wireConfirmModal } = await import('@scripts/features/confirmModal');
    wireConfirmModal();
    const modal = document.getElementById('confirm-modal') as HTMLElement;
    expect(() => modal.dispatchEvent(new Event('modal:closed'))).not.toThrow();
  });
});

describe('setContent', () => {
  it('sets default values when options are minimal', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: 'Test message' });

    expect(document.getElementById('confirm-modal-title')?.textContent).toBe('Confirm action');
    expect(document.getElementById('confirm-modal-hint')?.textContent).toBe('This cannot be undone.');
    expect(document.getElementById('confirm-modal-message')?.textContent).toBe('Test message');
    expect(document.getElementById('confirm-modal-cancel-btn')?.textContent).toBe('Cancel');
    expect(document.getElementById('confirm-modal-confirm-btn')?.textContent).toBe('Confirm');
  });

  it('applies custom options including danger style', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({
      title: 'Delete file?',
      message: 'Are you sure?',
      hint: 'File will be permanently deleted.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      danger: true,
    });

    expect(document.getElementById('confirm-modal-title')?.textContent).toBe('Delete file?');
    expect(document.getElementById('confirm-modal-hint')?.textContent).toBe('File will be permanently deleted.');
    expect(document.getElementById('confirm-modal-confirm-btn')?.textContent).toBe('Delete');
    expect(document.getElementById('confirm-modal-cancel-btn')?.textContent).toBe('Keep');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.classList.contains('danger')).toBe(true);
    expect(confirmBtn.classList.contains('primary')).toBe(false);
  });

  it('sets primary class when not danger', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: 'Test', danger: false });
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn.classList.contains('primary')).toBe(true);
    expect(confirmBtn.classList.contains('danger')).toBe(false);
  });

  it('trims whitespace from title and hint, defaults when empty', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: 'Test', title: '   ', hint: '   ' });
    expect(document.getElementById('confirm-modal-title')?.textContent).toBe('Confirm action');
    expect(document.getElementById('confirm-modal-hint')?.textContent).toBe('This cannot be undone.');
  });

  it('focuses the cancel button', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn') as HTMLButtonElement;
    const focusSpy = vi.spyOn(cancelBtn, 'focus');
    confirmModalController.open({ message: 'Test' });
    await new Promise((r) => setTimeout(r, 0));
    expect(focusSpy).toHaveBeenCalled();
  });

  it('handles missing title element gracefully', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    document.getElementById('confirm-modal-title')?.remove();
    expect(() => confirmModalController.open({ message: 'Test', title: 'Custom' })).not.toThrow();
  });

  it('handles missing hint element gracefully', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    document.getElementById('confirm-modal-hint')?.remove();
    expect(() => confirmModalController.open({ message: 'Test', hint: 'Hint' })).not.toThrow();
  });

  it('handles missing message element gracefully', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    document.getElementById('confirm-modal-message')?.remove();
    expect(() => confirmModalController.open({ message: 'Msg' })).not.toThrow();
  });

  it('handles missing cancel button gracefully', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    document.getElementById('confirm-modal-cancel-btn')?.remove();
    expect(() => confirmModalController.open({ message: 'Test' })).not.toThrow();
  });
});

describe('setContent additional edge cases', () => {
  it('falls back to default cancelLabel when cancelLabel is whitespace only', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: 'Test', cancelLabel: '   ' });
    expect(document.getElementById('confirm-modal-cancel-btn')?.textContent).toBe('Cancel');
  });

  it('trims surrounding whitespace from cancelLabel', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: 'Test', cancelLabel: '  No  ' });
    expect(document.getElementById('confirm-modal-cancel-btn')?.textContent).toBe('No');
  });

  it('handles missing confirm button gracefully in setContent', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    document.getElementById('confirm-modal-confirm-btn')?.remove();
    expect(() => confirmModalController.open({ message: 'Test', danger: true })).not.toThrow();
  });

  it('handles missing title, hint, and message simultaneously', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    document.getElementById('confirm-modal-title')?.remove();
    document.getElementById('confirm-modal-hint')?.remove();
    document.getElementById('confirm-modal-message')?.remove();
    expect(() => confirmModalController.open({ message: 'M' })).not.toThrow();
  });

  it('uses default confirmLabel when trimmed confirmLabel is empty', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: 'Test', confirmLabel: '   ' });
    expect(document.getElementById('confirm-modal-confirm-btn')?.textContent).toBe('Confirm');
  });
});

describe('confirm button handler', () => {
  it('resolves true and closes modal on confirm click', async () => {
    const modals = await import('@scripts/ui/modals');
    const { wireConfirmModal } = await import('@scripts/features/confirmModal');
    wireConfirmModal();
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn') as HTMLButtonElement;

    const { confirmWithModal } = await import('@scripts/features/confirmModal');
    const promise = confirmWithModal({ message: 'Test' });

    confirmBtn.click();
    await Promise.resolve();

    expect(vi.mocked(modals.closeModal)).toHaveBeenCalledWith('confirm-modal');
    const result = await promise;
    expect(result).toBe(true);
  });
});

describe('modal:closed handler', () => {
  it('resolves false when modal closed event fires', async () => {
    const { wireConfirmModal, confirmWithModal } = await import('@scripts/features/confirmModal');
    wireConfirmModal();
    const modal = document.getElementById('confirm-modal') as HTMLElement;

    const promise = confirmWithModal({ message: 'Test' });
    modal.dispatchEvent(new Event('modal:closed'));

    const result = await promise;
    expect(result).toBe(false);
  });
});

describe('confirmWithModal', () => {
  it('hydrates, wires, opens modal and returns a promise', async () => {
    const modals = await import('@scripts/ui/modals');
    const { confirmWithModal } = await import('@scripts/features/confirmModal');

    const promise = confirmWithModal({ message: 'Confirm?' });
    expect(vi.mocked(modals.hydrate)).toHaveBeenCalledWith('confirm-modal');
    expect(vi.mocked(modals.openModal)).toHaveBeenCalledWith('confirm-modal');
    expect(promise).toBeInstanceOf(Promise);
  });

  it('closes previous pending promise with false when called again', async () => {
    const { confirmWithModal } = await import('@scripts/features/confirmModal');

    const first = confirmWithModal({ message: 'First' });
    confirmWithModal({ message: 'Second' });

    const firstResult = await first;
    expect(firstResult).toBe(false);
  });
});

describe('cancel button click handler', () => {
  it('wires cancel click to close modal', async () => {
    const { wireConfirmModal, confirmWithModal } = await import('@scripts/features/confirmModal');
    wireConfirmModal();
    const modal = document.getElementById('confirm-modal') as HTMLElement;

    const promise = confirmWithModal({ message: 'Test' });

    // Simulate what happens when modal is closed
    modal.dispatchEvent(new Event('modal:closed'));

    const result = await promise;
    expect(result).toBe(false);
  });
});

describe('confirmModal wiring edge cases', () => {
  it('wires without confirm button (null branch of confirmBtn?. listener)', async () => {
    document.body.innerHTML = `
      <div id="confirm-modal" aria-hidden="true">
        <div id="confirm-modal-title"></div>
        <div id="confirm-modal-hint"></div>
        <div id="confirm-modal-message"></div>
        <button id="confirm-modal-cancel-btn">Cancel</button>
      </div>
    `;
    const { wireConfirmModal, confirmModalController } = await import('@scripts/features/confirmModal');
    expect(() => wireConfirmModal()).not.toThrow();
    expect(confirmModalController.isWired).toBe(true);
  });

  it('wires without cancel button', async () => {
    document.body.innerHTML = `
      <div id="confirm-modal" aria-hidden="true">
        <div id="confirm-modal-title"></div>
        <div id="confirm-modal-hint"></div>
        <div id="confirm-modal-message"></div>
        <button id="confirm-modal-confirm-btn">Confirm</button>
      </div>
    `;
    const { wireConfirmModal } = await import('@scripts/features/confirmModal');
    expect(() => wireConfirmModal()).not.toThrow();
  });

  it('handles confirmWithModal when modal is removed from DOM', async () => {
    document.body.innerHTML = '';
    const { confirmWithModal } = await import('@scripts/features/confirmModal');
    const promise = confirmWithModal({ message: 'Ghost modal' });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    expect(btn).toBeNull();
    expect(promise).toBeInstanceOf(Promise);
  });

  it('transitions danger class from true to false in setContent', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn') as HTMLButtonElement;

    confirmModalController.open({ message: 'First', danger: true });
    expect(confirmBtn.classList.contains('danger')).toBe(true);
    expect(confirmBtn.classList.contains('primary')).toBe(false);

    confirmModalController.open({ message: 'Second', danger: false });
    expect(confirmBtn.classList.contains('danger')).toBe(false);
    expect(confirmBtn.classList.contains('primary')).toBe(true);
  });

  it('handles empty message string in setContent', async () => {
    const { confirmModalController } = await import('@scripts/features/confirmModal');
    confirmModalController.open({ message: '' });
    const messageEl = document.getElementById('confirm-modal-message') as HTMLElement;
    expect(messageEl.textContent).toBe('');
  });
});
