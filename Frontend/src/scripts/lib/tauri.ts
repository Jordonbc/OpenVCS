// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/lib/tauri.ts
import type { Json } from "../types";

type Unlisten = () => void;
type Listener<T = unknown> = (evt: { payload: T }) => void;

/** Interface for Tauri core functionality. */
interface TauriCore {
    invoke<T = unknown>(cmd: string, args?: Json): Promise<T>;
}
/** Interface for Tauri event system. */
interface TauriEvent {
    listen<T = unknown>(event: string, cb: Listener<T>): Promise<{ unlisten: Unlisten }>;
}

declare global {
    interface Window {
        __TAURI__?: { core: TauriCore; event: TauriEvent };
    }
}

const core: TauriCore | null   = typeof window !== "undefined" && window.__TAURI__?.core  ? window.__TAURI__.core  : null;
const tEvent: TauriEvent | null = typeof window !== "undefined" && window.__TAURI__?.event ? window.__TAURI__.event : null;
const TAURI_RUNTIME_ERROR = 'Failed to initialize Tauri runtime.';

/** Returns whether the Tauri runtime core is available. */
export function isTauriRuntimeAvailable(): boolean {
    return !!core;
}

/** Tauri API wrapper providing invoke and event listening capabilities. */
export const TAURI = {
    /** Invoke a Tauri command. Returns a rejected promise if runtime unavailable. */
    invoke<T = unknown>(cmd: string, args?: Json): Promise<T> {
        if (!core) {
            return Promise.reject(new Error(TAURI_RUNTIME_ERROR));
        }
        return core.invoke<T>(cmd, args);
    },
    /** Listen for Tauri events. Returns a rejected promise if runtime unavailable. */
    listen<T = unknown>(event: string, cb: Listener<T>): Promise<{ unlisten: Unlisten }> {
        if (!tEvent) {
            return Promise.reject(new Error(TAURI_RUNTIME_ERROR));
        }
        return tEvent.listen<T>(event, cb);
    },
};

/** Ensures the desktop runtime is available before boot continues. */
export function assertDesktopRuntime() {
    if (!core || !tEvent) {
        throw new Error(TAURI_RUNTIME_ERROR);
    }
}
