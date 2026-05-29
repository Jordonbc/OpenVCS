// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tauri', () => ({
  TAURI: {
    invoke: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./monitoring', () => ({
  addFrontendLogBreadcrumb: vi.fn(),
}));

describe('logger', () => {
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    log: console.log,
    warn: console.warn,
    error: console.error,
    trace: console.trace,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__OPENVCS_FRONTEND_LOGGER_INSTALLED__;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.trace = originalConsole.trace;
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.trace = originalConsole.trace;
    delete (globalThis as Record<string, unknown>).__OPENVCS_FRONTEND_LOGGER_INSTALLED__;
  });

  it('prefixes module logs and serializes plain objects', async () => {
    const { logger } = await import('./logger');
    const { TAURI } = await import('./tauri');
    const { addFrontendLogBreadcrumb } = await import('./monitoring');

    logger.create('repo').warn({ branch: 'main' }, 'changed');

    expect(addFrontendLogBreadcrumb).toHaveBeenCalledWith(
      'warning',
      '[repo] {\n  "branch": "main"\n} changed',
    );
    expect(TAURI.invoke).toHaveBeenCalledWith('log_frontend_message', {
      level: 'warn',
      message: '[repo] {\n  "branch": "main"\n} changed',
    });
  });

  it('formats errors with their stack and routes them as error logs', async () => {
    const { logger } = await import('./logger');
    const { TAURI } = await import('./tauri');
    const { addFrontendLogBreadcrumb } = await import('./monitoring');
    const error = new Error('boom');
    error.stack = 'trace-line';

    logger.error(error);

    expect(addFrontendLogBreadcrumb).toHaveBeenCalledWith(
      'error',
      'Error: boom\ntrace-line',
    );
    expect(TAURI.invoke).toHaveBeenCalledWith('log_frontend_message', {
      level: 'error',
      message: 'Error: boom\ntrace-line',
    });
  });

  it('falls back to String() for unserializable objects', async () => {
    const { logger } = await import('./logger');
    const { TAURI } = await import('./tauri');

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info(circular);

    expect(TAURI.invoke).toHaveBeenCalledWith('log_frontend_message', {
      level: 'info',
      message: '[object Object]',
    });
  });

  it('patches console methods and forwards log payloads only once', async () => {
    const debugSpy = vi.fn();
    console.debug = debugSpy;

    await import('./logger');
    const { TAURI } = await import('./tauri');
    const { addFrontendLogBreadcrumb } = await import('./monitoring');

    console.debug('hello', { count: 2 });

    expect(debugSpy).toHaveBeenCalledWith('hello', { count: 2 });
    expect(addFrontendLogBreadcrumb).toHaveBeenCalledWith(
      'debug',
      'hello {\n  "count": 2\n}',
    );
    expect(TAURI.invoke).toHaveBeenCalledWith('log_frontend_message', {
      level: 'debug',
      message: 'hello {\n  "count": 2\n}',
    });

    vi.resetModules();
    await import('./logger');
    console.debug('again');

    expect(debugSpy).toHaveBeenCalledTimes(2);
    expect(TAURI.invoke).toHaveBeenCalledTimes(2);
  });

  it('supports top-level trace, debug, info, warn, and error helpers', async () => {
    const { logger } = await import('./logger');
    const { TAURI } = await import('./tauri');

    logger.trace('trace');
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(TAURI.invoke).toHaveBeenNthCalledWith(1, 'log_frontend_message', {
      level: 'trace',
      message: 'trace',
    });
    expect(TAURI.invoke).toHaveBeenNthCalledWith(5, 'log_frontend_message', {
      level: 'error',
      message: 'error',
    });
  });

  it('patches console info, warn, error, and trace methods', async () => {
    const infoSpy = vi.fn();
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    const traceSpy = vi.fn();
    console.info = infoSpy;
    console.warn = warnSpy;
    console.error = errorSpy;
    console.trace = traceSpy;

    await import('./logger');
    const { TAURI } = await import('./tauri');

    console.info('hello');
    console.warn('careful');
    console.error('broken');
    console.trace('stack');

    expect(infoSpy).toHaveBeenCalledWith('hello');
    expect(warnSpy).toHaveBeenCalledWith('careful');
    expect(errorSpy).toHaveBeenCalledWith('broken');
    expect(traceSpy).toHaveBeenCalledWith('stack');
    expect(TAURI.invoke).toHaveBeenCalledWith('log_frontend_message', {
      level: 'trace',
      message: 'stack',
    });
  });
});
