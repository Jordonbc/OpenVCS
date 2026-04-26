// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MonitoringModule {
  normalizeOptionalString: (value: string | null | undefined) => string | null;
  isFrontendMonitoringAllowed: (settings: unknown) => boolean;
  shouldEnableFrontendMonitoring: (settings: unknown) => boolean;
  syncFrontendMonitoring: (settings: unknown) => Promise<void>;
  addFrontendLogBreadcrumb: (level: 'debug' | 'info' | 'warning' | 'error', message: string) => void;
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('normalizeOptionalString', () => {
  it('returns null for blank strings', async () => {
    const monitoring = await import('./monitoring');
    expect(monitoring.normalizeOptionalString('   ')).toBeNull();
  });

  it('trims populated strings', async () => {
    const monitoring = await import('./monitoring');
    expect(monitoring.normalizeOptionalString('  value  ')).toBe('value');
  });
});

describe('isFrontendMonitoringAllowed', () => {
  it('requires crash report consent', async () => {
    const monitoring = await import('./monitoring');
    expect(monitoring.isFrontendMonitoringAllowed({ general: { crash_reports: true } })).toBe(true);
    expect(monitoring.isFrontendMonitoringAllowed({ general: { crash_reports: false } })).toBe(false);
    expect(monitoring.isFrontendMonitoringAllowed(null)).toBe(false);
  });
});

describe('shouldEnableFrontendMonitoring', () => {
  it('requires tauri and crash report consent', async () => {
    const monitoring = await import('./monitoring');
    expect(monitoring.shouldEnableFrontendMonitoring({ general: { crash_reports: true } })).toBe(false);
    expect(monitoring.shouldEnableFrontendMonitoring({ general: { crash_reports: false } })).toBe(false);
  });
});

describe('syncFrontendMonitoring', () => {
  it('relays frontend errors with capped breadcrumbs', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    for (let index = 0; index < 45; index += 1) {
      monitoring.addFrontendLogBreadcrumb('info', `crumb-${index}`);
    }

    const error = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message, filename: 'app://index.js', lineno: 7, colno: 11 }));

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('boom');
    expect(payload?.payload?.kind).toBe('error');
    expect(payload?.payload?.breadcrumbs).toHaveLength(40);
    expect(payload?.payload?.breadcrumbs[0]?.message).toBe('crumb-5');
    expect(payload?.payload?.breadcrumbs[39]?.message).toBe('crumb-44');
  });

  it('uninstalls listeners when crash reports are disabled', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: false } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after-disable'), message: 'after-disable' }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports a fallback message for undefined rejection reasons', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: undefined,
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.kind).toBe('unhandledrejection');
    expect(payload?.payload?.message).toBe('Unhandled promise rejection (no reason provided)');
  });

  it('forwards build metadata with frontend reports', async () => {
    vi.stubEnv('VITE_SENTRY_RELEASE', 'release-123');
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'qa');

    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('meta'), message: 'meta' }));

    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.release).toBe('release-123');
    expect(payload?.payload?.environment).toBe('qa');
  });

  it('is idempotent when enabling monitoring repeatedly', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('once'), message: 'once' }));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
