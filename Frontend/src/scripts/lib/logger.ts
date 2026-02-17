// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from "./tauri";

type LogLevel = "debug" | "info" | "warn" | "error";

function formatMessage(...args: unknown[]): string {
    return args
        .map((a) => {
            if (a instanceof Error) return a.message;
            if (typeof a === "object") {
                try {
                    return JSON.stringify(a);
                } catch {
                    return String(a);
                }
            }
            return String(a);
        })
        .join(" ");
}

function sendToBackend(level: LogLevel, message: string): void {
    if (TAURI.has) {
        TAURI.invoke("log_frontend_message", { level, message }).catch(() => {});
    }
}

function installFrontendLogger(): void {
    console.debug = (...args: unknown[]) => {
        const msg = formatMessage(...args);
        sendToBackend("debug", msg);
    };

    console.log = (...args: unknown[]) => {
        const msg = formatMessage(...args);
        sendToBackend("debug", msg);
    };

    console.warn = (...args: unknown[]) => {
        const msg = formatMessage(...args);
        sendToBackend("warn", msg);
    };

    console.error = (...args: unknown[]) => {
        const msg = formatMessage(...args);
        sendToBackend("error", msg);
    };
}

installFrontendLogger();
