// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect, beforeEach } from 'vitest'
import { qs, qsa, setText, setValue, setChecked, escapeHtml, toKebab } from './dom'

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

  it('setText sets textContent', () => {
    document.body.innerHTML = `<div id="t"></div>`
    const el = qs('#t')
    setText(el, 'hello')
    expect(el?.textContent).toBe('hello')
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

  it('escapeHtml escapes & and <', () => {
    // implementation escapes & and < but not '>'
    expect(escapeHtml('<&>')).toBe('&lt;&amp;>')
  })

  it('toKebab lowercases and replaces underscores', () => {
    expect(toKebab('Hello_WORLD')).toBe('hello-world')
  })
})
