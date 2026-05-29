// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, beforeEach } from 'vitest';

describe('normalizeId', () => {
  it('lowercases and trims the input', async () => {
    const { normalizeId } = await import('./sanitize');
    expect(normalizeId('  HelloWorld  ')).toBe('helloworld');
  });

  it('returns empty string for falsy values', async () => {
    const { normalizeId } = await import('./sanitize');
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
    const { escapeCssSelector } = await import('./sanitize');
    expect(escapeCssSelector('hello')).toBe('escaped-hello');
  });

  it('falls back to regex replacement when CSS.escape is undefined', async () => {
    (CSS as any).escape = undefined;
    const mod = await import('./sanitize');
    expect(mod.escapeCssSelector('hello.world')).toBe('hello\\.world');
    expect(mod.escapeCssSelector('foo bar')).toBe('foo\\ bar');
  });
});

describe('parseSanitizedPluginElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('parses a simple div from html string', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div class="foo">hello</div>');
    expect(el).not.toBeNull();
    expect(el!.className).toBe('foo');
    expect(el!.textContent).toBe('hello');
  });

  it('strips script tags', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div><script>alert(1)</script><span>safe</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('script')).toBeNull();
    expect(el!.textContent).toBe('safe');
  });

  it('strips iframe tags', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div><iframe src="https://evil"></iframe><span>ok</span></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('iframe')).toBeNull();
  });

  it('removes on* attributes (inline event handlers)', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<button onclick="alert(1)" onmouseenter="evil()">click</button>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('onclick')).toBeNull();
    expect(el!.getAttribute('onmouseenter')).toBeNull();
  });

  it('removes style attributes', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div style="color:red">text</div>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('style')).toBeNull();
  });

  it('removes href with javascript: protocol', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<a href="javascript:alert(1)">link</a>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBeNull();
  });

  it('keeps safe href values like fragment identifiers', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<a href="#section">link</a>');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBe('#section');
  });

  it('strips blocked tags', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
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
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div><!-- comment --><span>text</span></div>');
    expect(el).not.toBeNull();
    expect(el!.innerHTML).not.toContain('comment');
  });

  it('returns null for empty or non-element content', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    expect(parseSanitizedPluginElement('')).toBeNull();
    expect(parseSanitizedPluginElement('   text   ')).toBeNull();
    expect(parseSanitizedPluginElement(null as unknown as string)).toBeNull();
  });

  it('strips blocked tags nested inside safe containers', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div><p><script>bad</script><span>good</span></p></div>');
    expect(el).not.toBeNull();
    expect(el!.querySelector('script')).toBeNull();
    expect(el!.textContent).toBe('good');
  });

  it('removes data: and vbscript: protocol URLs', async () => {
    const { parseSanitizedPluginElement } = await import('./sanitize');
    const el = parseSanitizedPluginElement('<div><a href="data:text/plain,hello">one</a><a href="vbscript:msgbox">two</a><a href="https://safe.com">three</a></div>');
    expect(el).not.toBeNull();
    const anchors = el!.querySelectorAll('a');
    expect(anchors[0].getAttribute('href')).toBeNull();
    expect(anchors[1].getAttribute('href')).toBeNull();
    expect(anchors[2].getAttribute('href')).toBe('https://safe.com');
  });
});
