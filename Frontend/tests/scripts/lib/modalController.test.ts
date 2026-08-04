// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockHydrate = vi.fn();
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();

vi.mock('@scripts/ui/modals', () => ({
  hydrate: mockHydrate,
  openModal: mockOpenModal,
  closeModal: mockCloseModal,
}));

interface SampleState {
  name: string;
  count: number;
}

function mountModal(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'sample-modal';
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.resetModules();
  mockHydrate.mockReset();
  mockOpenModal.mockReset();
  mockCloseModal.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function load() {
  return import('@scripts/lib/modalController');
}

describe('ModalController initOnce', () => {
  it('wires exactly once when called repeatedly', async () => {
    const { ModalController } = await load();
    const wire = vi.fn();
    mountModal();
    const controller = new ModalController<SampleState>('sample-modal', { wire });

    controller.initOnce();
    controller.initOnce();
    controller.initOnce();

    expect(wire).toHaveBeenCalledTimes(1);
    expect(controller.isWired).toBe(true);
  });

  it('does nothing when the modal element is missing', async () => {
    const { ModalController } = await load();
    const wire = vi.fn();
    const controller = new ModalController<SampleState>('missing-modal', { wire });

    controller.initOnce();

    expect(wire).not.toHaveBeenCalled();
    expect(controller.isWired).toBe(false);
  });
});

describe('ModalController open', () => {
  it('hydrates, wires once, applies typed state, and opens', async () => {
    const { ModalController } = await load();
    const wire = vi.fn();
    const apply = vi.fn();
    mountModal();
    const controller = new ModalController<SampleState>('sample-modal', {
      wire,
      apply,
    });

    controller.open({ name: 'alpha', count: 3 });
    controller.open({ name: 'beta', count: 5 });

    expect(mockHydrate).toHaveBeenCalledWith('sample-modal');
    expect(wire).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenNthCalledWith(
      1,
      { name: 'alpha', count: 3 },
      expect.objectContaining({ id: 'sample-modal' }),
    );
    expect(apply).toHaveBeenNthCalledWith(
      2,
      { name: 'beta', count: 5 },
      expect.objectContaining({ id: 'sample-modal' }),
    );
    expect(mockOpenModal).toHaveBeenCalledTimes(2);
    expect(mockOpenModal).toHaveBeenCalledWith('sample-modal');
  });

  it('does not open when the modal element is missing', async () => {
    const { ModalController } = await load();
    const wire = vi.fn();
    const apply = vi.fn();
    const controller = new ModalController<SampleState>('missing-modal', {
      wire,
      apply,
    });

    controller.open({ name: 'x', count: 0 });

    expect(apply).not.toHaveBeenCalled();
    expect(mockOpenModal).not.toHaveBeenCalled();
  });

  it('opens after an async apply settles', async () => {
    const { ModalController } = await load();
    const apply = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    mountModal();
    const controller = new ModalController<SampleState>('sample-modal', {
      wire: vi.fn(),
      apply,
    });

    controller.open({ name: 'slow', count: 1 });
    expect(mockOpenModal).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(mockOpenModal).toHaveBeenCalledWith('sample-modal');
  });
});

describe('ModalController close', () => {
  it('closes the modal via the shared shell', async () => {
    const { ModalController } = await load();
    const controller = new ModalController<SampleState>('sample-modal', {
      wire: vi.fn(),
    });

    controller.close();

    expect(mockCloseModal).toHaveBeenCalledWith('sample-modal');
  });
});
