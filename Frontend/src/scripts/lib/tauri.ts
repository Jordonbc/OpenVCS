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

/** Tauri API wrapper providing invoke and event listening capabilities. */
export const TAURI = {
    /** Whether Tauri runtime is available. */
    has: !!core,
    /** Invoke a Tauri command. */
    invoke<T = unknown>(cmd: string, args?: Json): Promise<T> {
        return core ? core.invoke<T>(cmd, args) : Promise.resolve(undefined as unknown as T);
    },
    /** Listen for Tauri events. */
    listen<T = unknown>(event: string, cb: Listener<T>): Promise<{ unlisten: Unlisten }> {
        return tEvent ? tEvent.listen<T>(event, cb) : Promise.resolve({ unlisten() {} });
    },
};
