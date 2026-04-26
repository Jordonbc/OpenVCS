// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { TAURI } from "./tauri";
import { addFrontendLogBreadcrumb } from "./monitoring";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
const LOGGER_PATCH_FLAG = "__OPENVCS_FRONTEND_LOGGER_INSTALLED__";

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

function sendToBackend(
  level: LogLevel,
  message: string,
  options: { breadcrumb?: boolean } = {},
): void {
  if (options.breadcrumb !== false) {
    addFrontendLogBreadcrumb(toMonitoringBreadcrumbLevel(level), message);
  }
  TAURI.invoke("log_frontend_message", { level, message }).catch(() => {});
}

/** Maps logger levels to the breadcrumb levels sent through monitoring relay payloads. */
function toMonitoringBreadcrumbLevel(level: LogLevel): "debug" | "info" | "warning" | "error" {
  switch (level) {
    case "trace":
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warn":
      return "warning";
    case "error":
      return "error";
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
  if ((globalThis as Record<string, unknown>)[LOGGER_PATCH_FLAG]) {
    return;
  }

  const originalConsole = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    trace: console.trace.bind(console),
  };

  console.debug = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("debug", msg);
    originalConsole.debug(...args);
  };

  console.info = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("info", msg);
    originalConsole.info(...args);
  };

  console.log = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("info", msg);
    originalConsole.log(...args);
  };

  console.warn = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("warn", msg);
    originalConsole.warn(...args);
  };

  console.error = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("error", msg);
    originalConsole.error(...args);
  };

  console.trace = (...args: unknown[]) => {
    const msg = formatMessage(...args);
    sendToBackend("trace", msg);
    originalConsole.trace(...args);
  };

  (globalThis as Record<string, unknown>)[LOGGER_PATCH_FLAG] = true;
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
