// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Provides a minimal `matchMedia` test shim used by history imports. */
function createMatchMediaMock(query: string) {
  return { matches: false, media: query, addListener: () => {}, removeListener: () => {} }
}

/** Mounts the DOM nodes required by the history feature module. */
function mountHistoryDom() {
  document.body.innerHTML = `
    <input id="filter" />
    <input id="select-all" type="checkbox" />
    <ul id="file-list"></ul>
    <span id="changes-count"></span>
    <div id="left-foot"></div>
    <div id="diff-path"></div>
    <div id="diff"></div>
    <button id="history-actions-btn"></button>
  `
}

/** Imports the history feature after the test DOM is ready. */
async function loadHistoryModule() {
  return import('./history')
}

/** Imports the shared state module after the test DOM is ready. */
async function loadStateModule() {
  return import('../../state/state')
}

// Set matchMedia before importing modules that touch browser media APIs.
(globalThis as any).matchMedia = createMatchMediaMock

beforeEach(() => {
  vi.resetModules()
  mountHistoryDom()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('history parsing', () => {
  it('returns empty for non-array or empty', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
    // @ts-ignore
    expect(parseCommitDiffByFile(null)).toEqual([])
    expect(parseCommitDiffByFile([])).toEqual([])
  })

  it('parses a simple diff into files with status', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
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
  it('returns input when invalid date', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    expect(formatTimeAgo('not a date')).toBe('not a date')
  })

  it('formats recent times', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    const now = new Date()
    const secAgo = new Date(now.getTime() - 30 * 1000).toISOString()
    expect(formatTimeAgo(secAgo)).toBe('just now')

    const minAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString()
    expect(formatTimeAgo(minAgo)).toBe('2 minutes ago')

    const hrAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    expect(formatTimeAgo(hrAgo)).toBe('2 hours ago')
  })
})

describe('history hash layout', () => {
  it('moves the short hash to the detail header', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()

    state.commits = [
      {
        id: '1234567890abcdef',
        msg: 'Fix history hash layout',
        meta: new Date().toISOString(),
        author: 'Ada Lovelace',
      },
    ] as any
    state.ahead = 0
    state.behind = 0
    state.aheadIds = new Set<string>()
    state.selectedCommit = null

    expect(renderHistoryList('')).toBe(true)

    const rowHash = document.querySelector('#file-list .badge.hash')
    expect(rowHash).toBeNull()

    const header = document.querySelector('#diff-path') as HTMLElement
    const shortHash = header.querySelector('.badge.hash') as HTMLElement | null
    expect(shortHash?.textContent).toBe('1234567')
    expect(shortHash?.title).toBe('1234567890abcdef')
    expect(header.querySelector('.commit-hash-full')?.textContent).toBe('1234567890abcdef')

    warnSpy.mockRestore()
  })
})
