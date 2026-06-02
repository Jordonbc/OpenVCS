// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockNotify = vi.fn();
const mockOpenModal = vi.fn();

vi.mock('@scripts/lib/tauri', () => ({
  TAURI: { invoke: mockInvoke },
}));

vi.mock('@scripts/lib/notify', () => ({
  notify: mockNotify,
}));

vi.mock('@scripts/ui/modals', () => ({
  openModal: mockOpenModal,
}));

function mountModal(info?: Record<string, string>) {
  document.body.innerHTML = `
    <div id="about-modal">
      <img id="about-logo" />
      <span id="about-version"></span>
      <span id="about-build"></span>
      <span id="about-author"></span>
      <a id="about-home"></a>
      <a id="about-repo"></a>
      <a id="about-licenses"></a>
    </div>
  `;
  if (info) {
    (document.getElementById('about-modal') as any).__info = info;
  }
}

beforeEach(() => {
  vi.resetModules();
  mockInvoke.mockReset();
  mockNotify.mockReset();
  mockOpenModal.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('openAbout', () => {
  it('opens modal and populates fields with full info', async () => {
    mockInvoke.mockResolvedValue({
      version: '1.2.3',
      build: 'build-42',
      authors: 'Alice:Bob:Charlie',
      homepage: 'https://example.com',
      repository: 'https://github.com/example/repo.git',
    });
    mountModal();

    const { openAbout } = await import('@scripts/features/about');
    await openAbout();

    expect(mockOpenModal).toHaveBeenCalledWith('about-modal');
    expect(document.getElementById('about-version')!.textContent).toBe('v1.2.3');
    expect(document.getElementById('about-build')!.textContent).toBe('build-42');
    expect(document.getElementById('about-build')!.style.display).toBe('');
    expect(document.getElementById('about-author')!.textContent).toBe('By Alice, Bob, Charlie');
    const homeLink = document.getElementById('about-home') as HTMLAnchorElement;
    expect(homeLink.href).toBe('https://example.com/');
    expect(homeLink.style.display).toBe('');
    const repoLink = document.getElementById('about-repo') as HTMLAnchorElement;
    expect(repoLink.href).toBe('https://github.com/example/repo.git');
    const licensesLink = document.getElementById('about-licenses') as HTMLAnchorElement;
    expect(licensesLink.href).toBe('https://github.com/example/repo/blob/HEAD/LICENSE');
  });

  it('handles null modal element gracefully', async () => {
    const { openAbout } = await import('@scripts/features/about');
    await openAbout();
    expect(mockOpenModal).toHaveBeenCalledWith('about-modal');
  });

  it('handles TAURI invoke returning null', async () => {
    mockInvoke.mockResolvedValue(null);
    mountModal();

    const { openAbout } = await import('@scripts/features/about');
    await openAbout();

    expect(document.getElementById('about-version')!.textContent).toBe('');
    expect(document.getElementById('about-build')!.textContent).toBe('');
    expect(document.getElementById('about-build')!.style.display).toBe('none');
    expect(document.getElementById('about-author')!.textContent).toBe('');
    const homeLink = document.getElementById('about-home') as HTMLAnchorElement;
    expect(homeLink.style.display).toBe('none');
    expect(homeLink.hasAttribute('disabled')).toBe(true);
    const licensesLink = document.getElementById('about-licenses') as HTMLAnchorElement;
    expect(licensesLink.hasAttribute('disabled')).toBe(true);
  });

  it('handles empty authors gracefully', async () => {
    mockInvoke.mockResolvedValue({
      version: '2.0',
      build: '',
      authors: '',
      homepage: '',
      repository: '',
    });
    mountModal();

    const { openAbout } = await import('@scripts/features/about');
    await openAbout();

    expect(document.getElementById('about-version')!.textContent).toBe('v2.0');
    expect(document.getElementById('about-author')!.textContent).toBe('');
    const buildEl = document.getElementById('about-build') as HTMLElement;
    expect(buildEl.style.display).toBe('none');
  });

  it('handles partial authors with empty segments', async () => {
    mockInvoke.mockResolvedValue({
      version: '',
      authors: 'Alice::Bob',
    });
    mountModal();

    const { openAbout } = await import('@scripts/features/about');
    await openAbout();

    expect(document.getElementById('about-author')!.textContent).toBe('By Alice, Bob');
  });

  it('handles aboutLogo onerror', async () => {
    mockInvoke.mockResolvedValue({});
    mountModal();

    const { openAbout } = await import('@scripts/features/about');
    await openAbout();

    const logo = document.getElementById('about-logo') as HTMLImageElement;
    expect(logo.onerror).toBeDefined();
    logo.onerror!(new Event('error'));
    expect(logo.style.display).toBe('none');
  });

  it('handles missing about-licenses element', async () => {
    document.body.innerHTML = `
      <div id="about-modal">
        <span id="about-version"></span>
      </div>
    `;
    mockInvoke.mockResolvedValue({ repository: 'https://github.com/o/r.git' });

    const { openAbout } = await import('@scripts/features/about');
    await expect(openAbout()).resolves.toBeUndefined();
  });

  it('shows error notification when TAURI.invoke throws synchronously', async () => {
    mockInvoke.mockImplementation(() => { throw new Error('network error'); });
    mountModal();

    const { openAbout } = await import('@scripts/features/about');
    await openAbout();

    expect(mockNotify).toHaveBeenCalledWith('Unable to load About');
  });
});
