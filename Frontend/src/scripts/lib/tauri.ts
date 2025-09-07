// src/scripts/lib/tauri.ts
import type { Json } from "../types";

type Unlisten = () => void;
type Listener<T = unknown> = (evt: { payload: T }) => void;

interface TauriCore {
    invoke<T = unknown>(cmd: string, args?: Json): Promise<T>;
}
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

export const TAURI = {
    has: !!core,
    invoke<T = unknown>(cmd: string, args?: Json): Promise<T> {
        return core ? core.invoke<T>(cmd, args) : Promise.resolve(undefined as unknown as T);
    },
    listen<T = unknown>(event: string, cb: Listener<T>): Promise<{ unlisten: Unlisten }> {
        return tEvent ? tEvent.listen<T>(event, cb) : Promise.resolve({ unlisten() {} });
    },
};
