// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/headPoll.ts
// Focus-driven refresh and lightweight head polling so external changes surface
// in the UI while the window is focused.
// Extracted from main.ts (single-responsibility module).

import { TAURI, isTauriRuntimeAvailable } from '../lib/tauri';
import { state } from '../state/state';
import { hydrateSnapshot } from './repo';
import { updateFetchUI, fetchCurrentRemoteOnly } from './fetchActions';
import { setRepoHeader } from '../ui/layout';

const FETCH_SETTINGS_PLUGIN_ID = 'openvcs.git'; // allowlist

let focusInFlight: Promise<void> | null = null;
let headPollInFlight: Promise<void> | null = null;
let lastHeadKey = '';
const headPollMs = 15000;

/** Runs a focus-triggered refresh (respecting the plugin's fetch-on-focus setting). */
async function onFocus() {
    if (focusInFlight) return focusInFlight;
    if (await TAURI.invoke<boolean>('vcs_operation_active').catch(() => false)) return;
    focusInFlight = (async () => {
        let doFetch = true;
        try {
            const fields = await TAURI.invoke<Array<{ id: string; value: unknown }>>('get_plugin_settings', {
                pluginId: FETCH_SETTINGS_PLUGIN_ID,
            });
            const fetchSetting = (Array.isArray(fields) ? fields : []).find((field) => String(field?.id || '').trim() === 'fetch_on_focus');
            if (fetchSetting && typeof fetchSetting.value === 'boolean') {
                doFetch = fetchSetting.value;
            }
        } catch {}
        if (await TAURI.invoke<boolean>('vcs_operation_active').catch(() => false)) return;
        if (doFetch) {
            await fetchCurrentRemoteOnly({ hydrate: false });
        }
        await hydrateSnapshot();
        updateFetchUI();
    })();
    try {
        await focusInFlight;
    } finally {
        focusInFlight = null;
    }
}

/** Schedules the next head-poll pass; reschedules itself while the window is live. */
const scheduleHeadPoll = () => {
    window.setTimeout(async () => {
        if (!isTauriRuntimeAvailable() || !state.hasRepo || document.visibilityState !== 'visible' || !document.hasFocus()) {
            return scheduleHeadPoll();
        }
        if (headPollInFlight) {
            return scheduleHeadPoll();
        }
        headPollInFlight = (async () => {
            try {
                const head = await TAURI.invoke<{ detached: boolean; branch?: string; commit?: string }>('vcs_head_status');
                const key = `${head?.detached ? 1 : 0}:${String(head?.branch || '')}:${String(head?.commit || '')}`;
                if (key === lastHeadKey) return;

                const ok = await hydrateSnapshot();
                if (!ok) return;
                setRepoHeader();
                updateFetchUI();
                lastHeadKey = key;
            } catch {
                // ignore transient failures (e.g. repo switching / git busy)
            }
        })().finally(() => {
            headPollInFlight = null;
            scheduleHeadPoll();
        });
    }, headPollMs);
};

/** Registers focus/visibility listeners and starts the head-poll loop. */
function bindHeadPoll() {
    window.addEventListener('focus', () => { onFocus().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onFocus().catch(() => {});
    });
    scheduleHeadPoll();
}

export { bindHeadPoll, scheduleHeadPoll };
