import { describe, it, expect } from 'vitest'

// Provide matchMedia to avoid jsdom environment errors in modules that access it
// Set it on global before importing modules that may use it.
(globalThis as any).matchMedia = (query: string) => ({ matches: false, media: query, addListener: () => {}, removeListener: () => {} })

import { parseCommitDiffByFile, formatTimeAgo } from './history'

describe('history parsing', () => {
  it('returns empty for non-array or empty', () => {
    // @ts-ignore
    expect(parseCommitDiffByFile(null)).toEqual([])
    expect(parseCommitDiffByFile([])).toEqual([])
  })

  it('parses a simple diff into files with status', () => {
    const lines = [
      'diff --git a/foo.txt b/foo.txt',
      'index 000..111',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1 +1 @@',
      '+hello',
      'diff --git a/bar.txt b/bar.txt',
      'new file mode 100644',
      'index 000..222',
      '--- /dev/null',
      '+++ b/bar.txt',
    ]
    const files = parseCommitDiffByFile(lines)
    expect(files.length).toBe(2)
    expect(files[0].path).toBe('foo.txt')
    expect(files[0].status).toBe('M')
    expect(files[1].path).toBe('bar.txt')
    expect(files[1].status).toBe('A')
  })
})

describe('formatTimeAgo', () => {
  it('returns input when invalid date', () => {
    expect(formatTimeAgo('not a date')).toBe('not a date')
  })

  it('formats recent times', () => {
    const now = new Date()
    const secAgo = new Date(now.getTime() - 30 * 1000).toISOString()
    expect(formatTimeAgo(secAgo)).toBe('just now')

    const minAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString()
    expect(formatTimeAgo(minAgo)).toBe('2 minutes ago')

    const hrAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    expect(formatTimeAgo(hrAgo)).toBe('2 hours ago')
  })
})
