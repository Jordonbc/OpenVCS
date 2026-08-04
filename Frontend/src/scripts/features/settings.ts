// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// ---------------------------------------------------------------------------
// Settings module facade.
//
// The collect/apply/wire responsibilities live in dedicated modules:
//   - settingsCollect.ts — collectSettingsFromForm
//   - settingsApply.ts  — loadSettingsIntoForm + refreshDefaultBackendOptions
//   - settingsWire.ts   — openSettings, settingsModalController, wireSettings
// This file re-exports the public API consumed by main.ts and the test suite.
// ---------------------------------------------------------------------------

export { applyAnimationPreference } from './settingsTheme';
export { collectSettingsFromForm } from './settingsCollect';
export { loadSettingsIntoForm } from './settingsApply';
export { openSettings, settingsModalController, wireSettings } from './settingsWire';
