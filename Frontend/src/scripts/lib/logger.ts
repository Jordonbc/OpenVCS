// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from "./tauri";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

interface Logger {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function formatMessage(...args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) {
        return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ""}`;
      }
      if (typeof a === "object") {
        try {
          return JSON.stringify(a, null, 2);
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

function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  
  return {
    trace: (...args: unknown[]) => {
      const msg = `${prefix} ${formatMessage(...args)}`;
      sendToBackend("trace", msg);
    },
    debug: (...args: unknown[]) => {
      const msg = `${prefix} ${formatMessage(...args)}`;
      sendToBackend("debug", msg);
    },
    info: (...args: unknown[]) => {
      const msg = `${prefix} ${formatMessage(...args)}`;
      sendToBackend("info", msg);
    },
    warn: (...args: unknown[]) => {
      const msg = `${prefix} ${formatMessage(...args)}`;
      sendToBackend("warn", msg);
    },
    error: (...args: unknown[]) => {
      const msg = `${prefix} ${formatMessage(...args)}`;
      sendToBackend("error", msg);
    },
  };
}

function installFrontendLogger(): void {
  const originalConsole = {
    debug: console.debug,
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.debug = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("debug", msg);
  };

  console.log = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("info", msg);
  };

  console.warn = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("warn", msg);
  };

  console.error = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("error", msg);
  };

  console.trace = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("trace", msg);
  };
}

installFrontendLogger();

export const logger = {
  create: createLogger,
  trace: (...args: unknown[]) => sendToBackend("trace", formatMessage(...args)),
  debug: (...args: unknown[]) => sendToBackend("debug", formatMessage(...args)),
  info: (...args: unknown[]) => sendToBackend("info", formatMessage(...args)),
  warn: (...args: unknown[]) => sendToBackend("warn", formatMessage(...args)),
  error: (...args: unknown[]) => sendToBackend("error", formatMessage(...args)),
};
