// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GlobalSettings } from '../types';

import { TAURI, isTauriRuntimeAvailable } from './tauri';

/** Represents the console breadcrumb level forwarded with frontend error reports. */
type MonitoringBreadcrumbLevel = 'debug' | 'info' | 'warning' | 'error';

/** Maximum number of frontend breadcrumbs kept with an error report. */
const MAX_FRONTEND_BREADCRUMBS = 40;
/** Sentry release metadata passed through the backend relay. */
const FRONTEND_RELEASE = normalizeOptionalString(import.meta.env.VITE_SENTRY_RELEASE);
/** Sentry environment metadata passed through the backend relay. */
const FRONTEND_ENVIRONMENT =
  normalizeOptionalString(import.meta.env.VITE_SENTRY_ENVIRONMENT) ?? 'desktop';

/** Represents a single frontend breadcrumb included with a reported error. */
interface FrontendBreadcrumb {
  timestampMs: number;
  level: MonitoringBreadcrumbLevel;
  message: string;
}

/** Represents a normalized frontend error payload sent to the backend. */
interface FrontendErrorReport {
  kind: 'error' | 'unhandledrejection';
  message: string;
  stack?: string | null;
  source?: string | null;
  line?: number | null;
  column?: number | null;
  url?: string | null;
  userAgent?: string | null;
  release?: string | null;
  environment?: string | null;
  breadcrumbs: FrontendBreadcrumb[];
}

/** Tracks whether frontend monitoring listeners are currently installed. */
let monitoringEnabled = false;
/** Stores recent console breadcrumbs for the next relayed frontend error. */
const frontendBreadcrumbs: FrontendBreadcrumb[] = [];

/** Handles global frontend `error` events. */
let errorListener: ((event: ErrorEvent) => void) | null = null;
/** Handles global frontend `unhandledrejection` events. */
let rejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;

/** Trims a string-like value and normalizes empty strings to `null`. */
export function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/** Returns whether current settings allow frontend crash reporting. */
export function isFrontendMonitoringAllowed(settings: GlobalSettings | null | undefined): boolean {
  return settings?.general?.crash_reports === true;
}

/** Returns whether the frontend has everything needed to relay monitoring events. */
export function shouldEnableFrontendMonitoring(
  settings: GlobalSettings | null | undefined,
): boolean {
  return Boolean(isTauriRuntimeAvailable() && isFrontendMonitoringAllowed(settings));
}

/** Synchronizes frontend error relay hooks with the latest settings. */
export async function syncFrontendMonitoring(
  settings: GlobalSettings | null | undefined,
): Promise<void> {
  const shouldEnable = shouldEnableFrontendMonitoring(settings);

  if (!shouldEnable) {
    uninstallFrontendMonitoring();
    return;
  }

  if (monitoringEnabled) {
    return;
  }

  installFrontendMonitoring();
}

/** Records a console breadcrumb when frontend monitoring is active. */
export function addFrontendLogBreadcrumb(
  level: MonitoringBreadcrumbLevel,
  message: string,
): void {
  if (!monitoringEnabled) {
    return;
  }

  frontendBreadcrumbs.push({
    timestampMs: Date.now(),
    level,
    message,
  });
  if (frontendBreadcrumbs.length > MAX_FRONTEND_BREADCRUMBS) {
    frontendBreadcrumbs.splice(0, frontendBreadcrumbs.length - MAX_FRONTEND_BREADCRUMBS);
  }
}

/** Installs global frontend error listeners that relay events to the backend. */
function installFrontendMonitoring(): void {
  errorListener = (event: ErrorEvent) => {
    void reportFrontendError({
      kind: 'error',
      message: event.error instanceof Error ? event.error.message : String(event.message || 'Unknown error'),
      stack: event.error instanceof Error ? event.error.stack ?? null : null,
      source: normalizeOptionalString(event.filename),
      line: typeof event.lineno === 'number' ? event.lineno : null,
      column: typeof event.colno === 'number' ? event.colno : null,
    });
  };

  rejectionListener = (event: PromiseRejectionEvent) => {
    const rejection = event.reason;
    void reportFrontendError({
      kind: 'unhandledrejection',
      message: getUnhandledRejectionMessage(rejection),
      stack: rejection instanceof Error ? rejection.stack ?? null : null,
      source: null,
      line: null,
      column: null,
    });
  };

  window.addEventListener('error', errorListener);
  window.addEventListener('unhandledrejection', rejectionListener);
  monitoringEnabled = true;
}

/** Removes global frontend monitoring listeners and clears queued breadcrumbs. */
function uninstallFrontendMonitoring(): void {
  if (errorListener) {
    window.removeEventListener('error', errorListener);
    errorListener = null;
  }
  if (rejectionListener) {
    window.removeEventListener('unhandledrejection', rejectionListener);
    rejectionListener = null;
  }
  frontendBreadcrumbs.length = 0;
  monitoringEnabled = false;
}

/** Reports a normalized frontend error payload to the backend monitoring command. */
async function reportFrontendError(
  report: Omit<FrontendErrorReport, 'url' | 'userAgent' | 'release' | 'environment' | 'breadcrumbs'>,
): Promise<void> {
  if (!monitoringEnabled || !isTauriRuntimeAvailable()) {
    return;
  }

  const payload: FrontendErrorReport = {
    ...report,
    url: normalizeOptionalString(window.location.href),
    userAgent: normalizeOptionalString(window.navigator.userAgent),
    release: FRONTEND_RELEASE,
    environment: FRONTEND_ENVIRONMENT,
    breadcrumbs: frontendBreadcrumbs.slice(),
  };

  await TAURI.invoke('report_frontend_error', { payload }).catch(() => {});
}

/** Derives a human-readable message for an unhandled promise rejection reason. */
function getUnhandledRejectionMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === 'string') {
    const normalized = normalizeOptionalString(reason);
    if (normalized) {
      return normalized;
    }
  }
  try {
    const serialized = JSON.stringify(reason);
    if (typeof serialized === 'string' && serialized.trim().length > 0) {
      return serialized;
    }
  } catch {
    // Fall through to the generic formatter below.
  }

  if (typeof reason === 'undefined') {
    return 'Unhandled promise rejection (no reason provided)';
  }

  return String(reason);
}
