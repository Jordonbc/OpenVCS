// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { qs, qsa, setText, setValue, setChecked, escapeHtml, toKebab, on } from '@scripts/lib/dom'

describe('dom utils', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('qs and qsa find elements', () => {
    document.body.innerHTML = `<div id="a" class="x"></div><div class="x"></div>`
    const a = qs('#a')
    const all = qsa('.x')
    expect(a).not.toBeNull()
    expect(all.length).toBe(2)
  })

  it('qs returns null for non-matching selector', () => {
    const result = qs('#nonexistent')
    expect(result).toBeNull()
  })

  it('qsa with custom root', () => {
    document.body.innerHTML = `<div id="outer"><span class="s"></span><span class="s"></span></div>`
    const outer = qs('#outer')!
    const spans = qsa('.s', outer)
    expect(spans).toHaveLength(2)
  })

  it('qsa returns empty array for no matches', () => {
    const result = qsa('.no-match')
    expect(result).toEqual([])
  })

  it('setText sets textContent', () => {
    document.body.innerHTML = `<div id="t"></div>`
    const el = qs('#t')
    setText(el, 'hello')
    expect(el?.textContent).toBe('hello')
  })

  it('setText handles null/undefined element gracefully', () => {
    setText(null, 'ignored')
    setText(undefined, 'ignored')
    // no crash means success
  })

  it('setValue sets input/select values and ignores missing elements', () => {
    document.body.innerHTML = `<input id="i" />`
    const i = qs<HTMLInputElement>('#i')
    setValue(i, 42)
    expect(i?.value).toBe('42')
    setValue(null as any, 'x')
  })

  it('setChecked toggles checkbox', () => {
    document.body.innerHTML = `<input type="checkbox" id="c" />`
    const c = qs<HTMLInputElement>('#c')
    setChecked(c, true)
    expect(c?.checked).toBe(true)
  })

  it('setChecked handles null/undefined element', () => {
    setChecked(null, true)
    setChecked(undefined, true)
    // no crash means success
  })

  it('escapeHtml escapes & and <', () => {
    // implementation escapes & and < but not '>'
    expect(escapeHtml('<&>')).toBe('&lt;&amp;>')
  })

  it('escapeHtml handles non-string values', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(null)).toBe('null')
    expect(escapeHtml(undefined)).toBe('undefined')
    expect(escapeHtml(true)).toBe('true')
  })

  it('toKebab lowercases and replaces underscores', () => {
    expect(toKebab('Hello_WORLD')).toBe('hello-world')
  })

  it('toKebab handles null/undefined/empty', () => {
    expect(toKebab(null)).toBe('')
    expect(toKebab(undefined)).toBe('')
    expect(toKebab('')).toBe('')
  })

  it('on adds event listener to Document', () => {
    const handler = vi.fn()
    on(document, 'click', handler)
    document.dispatchEvent(new MouseEvent('click'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('on adds event listener to HTMLElement', () => {
    document.body.innerHTML = `<button id="btn">Click</button>`
    const btn = qs('#btn')!
    const handler = vi.fn()
    on(btn, 'click', handler)
    btn.dispatchEvent(new MouseEvent('click'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('on adds event listener to Window', () => {
    const handler = vi.fn()
    on(window, 'resize', handler)
    window.dispatchEvent(new Event('resize'))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
