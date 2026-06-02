// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, beforeEach } from 'vitest';

describe('normalizeId', () => {
  it('lowercases and trims the input', async () => {
    const { normalizeId } = await import('@scripts/plugins/sanitize');
    expect(normalizeId('  HelloWorld  ')).toBe('helloworld');
  });

  it('returns empty string for falsy values', async () => {
    const { normalizeId } = await import('@scripts/plugins/sanitize');
    expect(normalizeId('')).toBe('');
    expect(normalizeId(undefined as unknown as string)).toBe('');
    expect(normalizeId(null as unknown as string)).toBe('');
  });
});

describe('escapeCssSelector', () => {
  beforeEach(() => {
    if (typeof CSS === 'undefined') {
      (globalThis as any).CSS = {};
    }
  });

  it('uses CSS.escape when available', async () => {
    (CSS as any).escape = (s: string) => `escaped-${s}`;
    const { escapeCssSelector } = await import('@scripts/plugins/sanitize');
    expect(escapeCssSelector('hello')).toBe('escaped-hello');
  });

  it('falls back to regex replacement when CSS.escape is undefined', async () => {
    (CSS as any).escape = undefined;
    const mod = await import('@scripts/plugins/sanitize');
    expect(mod.escapeCssSelector('hello.world')).toBe('hello\\.world');
    expect(mod.escapeCssSelector('foo bar')).toBe('foo\\ bar');
  });
});

describe('escapeCssSelector edge cases', () => {
  beforeEach(() => {
    if (typeof CSS === 'undefined') {
      (globalThis as any).CSS = {};
    }
  });

  it('handles null and undefined values via CSS.escape', async () => {
    (CSS as any).escape = (s: string) => `esc-${s}`;
    const { escapeCssSelector } = await import('@scripts/plugins/sanitize');
    expect(escapeCssSelector(null as unknown as string)).toBe('esc-');
    expect(escapeCssSelector(undefined as unknown as string)).toBe('esc-');
  });

  it('handles null and undefined values via fallback', async () => {
    (CSS as any).escape = undefined;
    const { escapeCssSelector } = await import('@scripts/plugins/sanitize');
    expect(escapeCssSelector(null as unknown as string)).toBe('');
    expect(escapeCssSelector(undefined as unknown as string)).toBe('');
  });

  it('handles empty string via CSS.escape', async () => {
    (CSS as any).escape = (s: string) => `esc-${s}`;
    const { escapeCssSelector } = await import('@scripts/plugins/sanitize');
    expect(escapeCssSelector('')).toBe('esc-');
  });

  it('handles empty string via fallback', async () => {
    (CSS as any).escape = undefined;
    const { escapeCssSelector } = await import('@scripts/plugins/sanitize');
    expect(escapeCssSelector('')).toBe('');
  });
});

describe('isSafePluginUrl edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps empty href attributes (considered safe)', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<a href="">link</a>');
    expect(el).not.toBeNull();
    // Empty/whitespace-only href is treated as safe by isSafePluginUrl
    expect(el!.getAttribute('href')).toBe('');
  });

  it('keeps whitespace-only href (considered safe)', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<a href="   ">link</a>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBe('   ');
  });

  it('removes base tag', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><base href="https://evil.com"><span>safe</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('base')).toBeNull();
    expect(el!.textContent).toBe('safe');
  });

  it('removes meta tag', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><meta http-equiv="refresh" content="0;url=evil"><span>safe</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('meta')).toBeNull();
    expect(el!.textContent).toBe('safe');
  });

  it('removes link tag', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><link rel="stylesheet" href="evil.css"><span>safe</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('link')).toBeNull();
    expect(el!.textContent).toBe('safe');
  });

  it('removes svg tag', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><svg onload="alert(1)"></svg><span>safe</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('svg')).toBeNull();
    expect(el!.textContent).toBe('safe');
  });

  it('removes style attribute on nested elements', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><span style="font-size:100px">big</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('span')!.getAttribute('style')).toBeNull();
  });

  it('strips action attribute with javascript: URL', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<form action="javascript:alert(1)"><button>submit</button></form>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('action')).toBeNull();
  });

  it('strips xlink:href with javascript: URL', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    // SVG is blocked entirely, so test on a custom element with xlink:href
    const el = parseSanitizedPluginElement('<div><a xlink:href="javascript:void(0)">link</a></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('a')!.getAttribute('xlink:href')).toBeNull();
  });
});

describe('parseSanitizedPluginElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('parses a simple div from html string', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div class="foo">hello</div>');
    expect(el).not.toBeNull();
    expect(el!.className).toBe('foo');
    expect(el!.textContent).toBe('hello');
  });

  it('strips script tags', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><script>alert(1)</script><span>safe</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('script')).toBeNull();
    expect(el!.textContent).toBe('safe');
  });

  it('strips iframe tags', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><iframe src="https://evil"></iframe><span>ok</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('iframe')).toBeNull();
  });

  it('removes on* attributes (inline event handlers)', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<button onclick="alert(1)" onmouseenter="evil()">click</button>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('onclick')).toBeNull();
    expect(el!.getAttribute('onmouseenter')).toBeNull();
  });

  it('removes style attributes', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div style="color:red">text</div>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('style')).toBeNull();
  });

  it('removes href with javascript: protocol', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<a href="javascript:alert(1)">link</a>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBeNull();
  });

  it('keeps safe href values like fragment identifiers', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<a href="#section">link</a>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBe('#section');
  });

  it('strips blocked tags', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const html = '<div><embed></embed><object><param></object><script>bad</script><style></style><template></template><span>keep</span></div>';
    const el = parseSanitizedPluginElement(html);
    expect(el).not.toBeNull();
    expect(el!.querySelector('embed')).toBeNull();
    expect(el!.querySelector('object')).toBeNull();
    expect(el!.querySelector('script')).toBeNull();
    expect(el!.querySelector('style')).toBeNull();
    expect(el!.querySelector('template')).toBeNull();
    expect(el!.textContent).toBe('keep');
  });

  it('removes comment nodes', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><!-- comment --><span>text</span></div>');
    expect(el).not.toBeNull();
    expect(el!.innerHTML).not.toContain('comment');
  });

  it('returns null for empty or non-element content', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    expect(parseSanitizedPluginElement('')).toBeNull();
    expect(parseSanitizedPluginElement('   text   ')).toBeNull();
    expect(parseSanitizedPluginElement(null as unknown as string)).toBeNull();
  });

  it('strips href when URL constructor throws', async () => {
    const origURL = globalThis.URL;
    (globalThis as any).URL = vi.fn((url: string, base?: string | URL) => {
      if (url === 'x-bad:url') throw new TypeError('bad url');
      return new origURL(url, base);
    }) as any;
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<a href="x-bad:url">link</a>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBeNull();
    (globalThis as any).URL = origURL;
  });

  it('strips blocked tags nested inside safe containers', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><p><script>bad</script><span>good</span></p></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('script')).toBeNull();
    expect(el!.textContent).toBe('good');
  });

  it('removes data: and vbscript: protocol URLs', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<div><a href="data:text/plain,hello">one</a><a href="vbscript:msgbox">two</a><a href="https://safe.com">three</a></div>');
    expect(el).not.toBeNull();
    const anchors = el!.querySelectorAll('a');
    expect(anchors[0].getAttribute('href')).toBeNull();
    expect(anchors[1].getAttribute('href')).toBeNull();
    expect(anchors[2].getAttribute('href')).toBe('https://safe.com');
  });

  it('handles formaction attribute with javascript: URL', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<button formaction="javascript:alert(1)">click</button>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('formaction')).toBeNull();
  });

  it('handles src attribute with javascript: URL', async () => {
    const { parseSanitizedPluginElement } = await import('@scripts/plugins/sanitize');
    const el = parseSanitizedPluginElement('<img src="javascript:alert(1)">');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('src')).toBeNull();
  });
});
