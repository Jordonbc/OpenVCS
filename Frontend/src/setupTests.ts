// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Test setup: provide browser shims used by frontend modules
(globalThis as any).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})

