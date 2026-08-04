// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/lib/modalController.ts
import { closeModal, hydrate, openModal } from "../ui/modals";

/**
 * Per-modal wiring plus per-open state application.
 */
export interface ModalHooks<T> {
  /** Wires persistent event listeners. Runs exactly once per modal element. */
  wire: (modal: HTMLElement) => void;
  /** Applies typed per-open state right before the modal is shown. */
  apply?: (state: T, modal: HTMLElement) => void | Promise<void>;
}

/**
 * Owns the open/init lifecycle of a single modal: hydration, wire-once,
 * typed per-open state, and open/close. Replaces the ad-hoc `wired` guard on
 * DOM nodes and the setter-on-DOM-node idioms.
 */
export class ModalController<T> {
  private readonly id: string;
  private readonly hooks: ModalHooks<T>;
  private wired = false;

  constructor(id: string, hooks: ModalHooks<T>) {
    this.id = id;
    this.hooks = hooks;
  }

  /** Whether the modal's event listeners have been installed. */
  get isWired(): boolean {
    return this.wired;
  }

  /** Wires the modal once its element exists. Safe to call repeatedly. */
  initOnce(): void {
    if (this.wired) return;
    const modal = document.getElementById(this.id);
    if (!modal) return;
    this.wired = true;
    this.hooks.wire(modal);
  }

  /**
   * Hydrates the fragment (if needed), wires once, applies typed state, and
   * shows the modal. When `apply` returns a promise, the modal opens after
   * it settles.
   */
  open(state: T): void {
    hydrate(this.id);
    this.initOnce();
    const modal = document.getElementById(this.id);
    if (!modal) return;
    const applied = this.hooks.apply?.(state, modal);
    if (applied && typeof applied.then === "function") {
      void applied.then(() => openModal(this.id));
    } else {
      openModal(this.id);
    }
  }

  /**
   * Applies per-open state without opening the modal. Useful when callers need
   * to await an async render before showing the modal themselves.
   */
  applyState(state: T, modal?: HTMLElement): void | Promise<void> {
    const el = modal ?? document.getElementById(this.id);
    if (!el) return;
    return this.hooks.apply?.(state, el);
  }

  /** Hides the modal. */
  close(): void {
    closeModal(this.id);
  }
}
