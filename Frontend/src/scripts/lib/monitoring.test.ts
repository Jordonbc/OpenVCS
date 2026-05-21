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
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    for (let index = 0; index < 45; index += 1) {
      monitoring.addFrontendLogBreadcrumb('info', `crumb-${index}`);
    }

    const errorEvent = new ErrorEvent('error', { error: new Error('boom'), message: 'boom', filename: 'app://index.js', lineno: 7, colno: 11 });
    window.dispatchEvent(errorEvent);

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
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: false } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after-disable'), message: 'after-disable' }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports a fallback message for undefined rejection reasons', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
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
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('meta'), message: 'meta' }));

    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.release).toBe('release-123');
    expect(payload?.payload?.environment).toBe('qa');
  });

  it('is idempotent when enabling monitoring repeatedly', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('once'), message: 'once' }));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports Error instance rejection reason message', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: new Error('custom error message'),
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.kind).toBe('unhandledrejection');
    expect(payload?.payload?.message).toBe('custom error message');
    expect(payload?.payload?.stack).toBeTruthy();
  });

  it('reports string rejection reason', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: 'plain string reason',
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('plain string reason');
  });

  it('reports non-empty JSON for rejection reason when string is empty after trim', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: '',
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('""');
  });

  it('reports serialized JSON for plain object rejection', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: { code: 42, detail: 'fail' },
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('{"code":42,"detail":"fail"}');
  });

  it('falls back to String() for Symbol rejection reason', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: Symbol('x'),
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('Symbol(x)');
  });

  it('reports String() fallback for BigInt rejection (JSON.stringify throws)', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    const event = new Event('unhandledrejection') as PromiseRejectionEvent & { reason: unknown };
    Object.defineProperty(event, 'reason', {
      value: BigInt(1),
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('1');
  });

  it('does not add breadcrumb when monitoring is not enabled', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    monitoring.addFrontendLogBreadcrumb('info', 'should not appear');

    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('no-breadcrumbs'), message: 'no-breadcrumbs' }));

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.breadcrumbs).toHaveLength(0);
  });

  it('handles invoke rejection gracefully (catch handler)', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('invoke failed'));
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('fail'), message: 'fail' }));

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('handles error event with non-Error reason', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    window.dispatchEvent(new ErrorEvent('error', { error: 'string-error', message: 'string message' }));

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.message).toBe('string message');
    expect(payload?.payload?.stack).toBeNull();
    expect(payload?.payload?.source).toBeNull();
  });

  it('uninstalls without listeners installed (null errorListener/rejectionListener)', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: false } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('preserves all breadcrumbs when count is exactly at limit (no splice)', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
    const monitoring = (await import('./monitoring')) as MonitoringModule;
    await monitoring.syncFrontendMonitoring({ general: { crash_reports: true } });

    for (let index = 0; index < 40; index += 1) {
      monitoring.addFrontendLogBreadcrumb('debug', `crumb-${index}`);
    }

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('exact-limit'), message: 'exact-limit' }));

    expect(invoke).toHaveBeenCalledTimes(1);
    const [, payload] = invoke.mock.calls[0] ?? [];
    expect(payload?.payload?.breadcrumbs).toHaveLength(40);
    expect(payload?.payload?.breadcrumbs[0]?.message).toBe('crumb-0');
  });

});
