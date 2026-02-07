import { describe, expect, it } from 'vitest'
import { buildPatchForSelected } from './diff'

describe('buildPatchForSelected', () => {
  const lines = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
    ' keep',
    '@@ -10,2 +10,2 @@',
    '-x',
    '+y',
  ]

  it('includes whole selected hunks without requiring per-line selections', () => {
    const patch = buildPatchForSelected('a.txt', lines, [0], {})

    expect(patch).toContain('@@ -1,2 +1,2 @@')
    expect(patch).toContain('-old')
    expect(patch).toContain('+new')
    expect(patch).not.toContain('@@ -10,2 +10,2 @@')
  })

  it('builds a partial mini-hunk when only line selections are present', () => {
    const patch = buildPatchForSelected('a.txt', lines, [], { 0: [1] })

    expect(patch).toContain('@@ -1,1 +1,0 @@')
    expect(patch).toContain('-old')
    expect(patch).not.toContain('+new')
  })

  it('combines whole-hunk and partial selections across hunks', () => {
    const patch = buildPatchForSelected('a.txt', lines, [0], { 1: [1] })

    expect(patch).toContain('@@ -1,2 +1,2 @@')
    expect(patch).toContain('@@ -10,1 +10,0 @@')
    expect(patch).toContain('-x')
    expect(patch).not.toContain('+y')
  })
})
