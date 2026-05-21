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
    <button id="commit-btn"></button>
    <input id="commit-summary" />
    <div id="status"></div>
  `
}

/** Installs a Tauri mock for tests that invoke backend commands. */
function installTauriMock() {
  (window as any).__TAURI__ = {
    core: { invoke: vi.fn(async () => []) },
    event: { listen: vi.fn() },
  }
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
  delete (window as any).__TAURI__
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

  it('detects deleted file status', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
    const lines = [
      'diff --git a/removed.txt b/removed.txt',
      'deleted file mode 100644',
      'index abc..def',
      '--- a/removed.txt',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-gone',
    ]
    const files = parseCommitDiffByFile(lines)
    expect(files.length).toBe(1)
    expect(files[0].path).toBe('removed.txt')
    expect(files[0].status).toBe('D')
  })

  it('deduplicates diff ---/+++ status properly', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
    const lines = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '+change',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
    ]
    const files = parseCommitDiffByFile(lines)
    expect(files.length).toBe(2)
    expect(files[0].path).toBe('a.txt')
    expect(files[0].status).toBe('M')
    expect(files[1].path).toBe('b.txt')
    expect(files[1].status).toBe('M')
  })

  it('skips non-diff lines before the first diff --git', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
    const lines = [
      'some metadata line',
      'another line',
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
    ]
    const files = parseCommitDiffByFile(lines)
    expect(files.length).toBe(1)
    expect(files[0].path).toBe('x.txt')
  })

  it('uses pathA when pathB is empty', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
    const lines = [
      'diff --git a/x.txt b/x.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/x.txt',
    ]
    const files = parseCommitDiffByFile(lines)
    expect(files.length).toBe(1)
    expect(files[0].path).toBe('x.txt')
  })
})

describe('formatTimeAgo', () => {
  it('returns input when invalid date', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    expect(formatTimeAgo('not a date')).toBe('not a date')
    expect(formatTimeAgo('')).toBe('')
  })

  it('returns trimmed input for unparseable dates', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    expect(formatTimeAgo('  some text  ')).toBe('some text')
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

  it('formats edge values', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    const now = Date.now()

    expect(formatTimeAgo(new Date(now - 10 * 1000).toISOString())).toBe('just now')
    expect(formatTimeAgo(new Date(now - 60 * 1000).toISOString())).toBe('1 minute ago')
    expect(formatTimeAgo(new Date(now - 45 * 60 * 1000).toISOString())).toBe('45 minutes ago')
    expect(formatTimeAgo(new Date(now - 60 * 60 * 1000).toISOString())).toBe('1 hour ago')
    expect(formatTimeAgo(new Date(now - 23 * 60 * 60 * 1000).toISOString())).toBe('23 hours ago')
    expect(formatTimeAgo(new Date(now - 25 * 60 * 60 * 1000).toISOString())).toBe('yesterday')
  })
})

describe('formatTimeAgo - weeks and months', () => {
  it('formats days and weeks', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    const now = Date.now()

    expect(formatTimeAgo(new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString())).toBe('3 days ago')
    expect(formatTimeAgo(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())).toBe('1 week ago')
    expect(formatTimeAgo(new Date(now - 21 * 24 * 60 * 60 * 1000).toISOString())).toBe('3 weeks ago')
    expect(formatTimeAgo(new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString())).toBe('4 weeks ago')
  })
})

describe('formatTimeAgo - years', () => {
  it('formats months and years', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    const now = Date.now()

    expect(formatTimeAgo(new Date(now - 65 * 24 * 60 * 60 * 1000).toISOString())).toBe('2 months ago')
    expect(formatTimeAgo(new Date(now - 370 * 24 * 60 * 60 * 1000).toISOString())).toBe('1 year ago')
    expect(formatTimeAgo(new Date(now - 1100 * 24 * 60 * 60 * 1000).toISOString())).toBe('3 years ago')
  })
})

describe('renderHistoryList', () => {
  it('returns false when required DOM elements are missing', async () => {
    document.body.innerHTML = ''
    const { renderHistoryList } = await loadHistoryModule()
    expect(renderHistoryList('')).toBe(false)
  })

  it('renders empty state when no commits', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [] as any
    state.ahead = 0
    state.behind = 0

    const result = renderHistoryList('')
    expect(result).toBe(true)
    expect(document.querySelector('#file-list')?.textContent).toContain('No commits loaded')
  })

  it('filters commits by query text', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'aaa', msg: 'Fix bug', meta: new Date().toISOString() } as any,
      { id: 'bbb', msg: 'Add feature', meta: new Date().toISOString() } as any,
    ]
    state.ahead = 0
    state.behind = 0
    state.aheadIds = new Set<string>()

    renderHistoryList('bug')
    const listText = document.querySelector('#file-list')?.textContent || ''
    expect(listText).toContain('Fix bug')
    expect(listText).not.toContain('Add feature')
  })

  it('filters commits by id hash', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'abc123', msg: 'First', meta: new Date().toISOString() } as any,
      { id: 'def456', msg: 'Second', meta: new Date().toISOString() } as any,
    ]
    state.ahead = 0
    state.behind = 0
    state.aheadIds = new Set<string>()

    renderHistoryList('abc')
    const listText = document.querySelector('#file-list')?.textContent || ''
    expect(listText).toContain('First')
    expect(listText).not.toContain('Second')
  })

  it('renders behind notice when behind > 0', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'aaa', msg: 'Commit 1', meta: new Date().toISOString() } as any,
    ]
    state.ahead = 0
    state.behind = 3
    state.aheadIds = new Set<string>()

    renderHistoryList('')
    const listText = document.querySelector('#file-list')?.textContent || ''
    expect(listText).toContain('incoming')
    expect(listText).toContain('3')
  })

  it('marks ahead commits when aheadIds provided', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'commit-a', msg: 'Ahead commit', meta: new Date().toISOString() } as any,
    ]
    state.ahead = 1
    state.behind = 0
    state.aheadIds = new Set<string>(['commit-a'])

    renderHistoryList('')
    const listHtml = document.querySelector('#file-list')?.innerHTML || ''
    expect(listHtml).toContain('up')
    expect(listHtml).toContain('outgoing')
  })

  it('falls back to ahead count when aheadIds is empty', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'aaa', msg: 'First ahead', meta: new Date().toISOString() } as any,
      { id: 'bbb', msg: 'Second', meta: new Date().toISOString() } as any,
    ]
    state.ahead = 2
    state.behind = 0
    state.aheadIds = new Set<string>()

    renderHistoryList('')
    const listHtml = document.querySelector('#file-list')?.innerHTML || ''
    expect(listHtml).toContain('up')
    expect(listHtml).toContain('outgoing')
    expect(listHtml).toContain('First ahead')
  })

  it('renders incoming commits with down tag', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'inc-1', msg: 'Incoming', meta: new Date().toISOString(), incoming: true } as any,
    ]
    state.ahead = 0
    state.behind = 1
    state.aheadIds = new Set<string>()

    renderHistoryList('')
    const listHtml = document.querySelector('#file-list')?.innerHTML || ''
    expect(listHtml).toContain('down')
    expect(listHtml).toContain('incoming')
  })

  it('shows incoming commits with remoteRef label', async () => {
    const { renderHistoryList } = await loadHistoryModule()
    const { state } = await loadStateModule()
    state.commits = [
      { id: 'inc-1', msg: 'From origin', meta: new Date().toISOString(), incoming: true, remoteRef: 'origin/main' } as any,
    ]
    state.ahead = 0
    state.behind = 1
    state.aheadIds = new Set<string>()

    renderHistoryList('')
    const listHtml = document.querySelector('#file-list')?.innerHTML || ''
    expect(listHtml).toContain('incoming')
    expect(listHtml).toContain('origin/main')
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

describe('selectHistory', () => {
  it('returns early when diffEl or diffHeadPath is missing', async () => {
    document.body.innerHTML = ''
    const { selectHistory } = await loadHistoryModule()
    await expect(selectHistory({ id: 'abc' }, 0)).resolves.toBeUndefined()
  })

  it('renders commit metadata and loads diff', async () => {
    installTauriMock()
    // Need to re-import so the tauri mock is picked up
    const { selectHistory } = await loadHistoryModule()
    const commit = {
      id: 'abc123def456',
      author: 'Test User <test@example.com>',
      msg: 'Test commit message',
      meta: '',
    }

    await selectHistory(commit, 0)

    const diffPath = document.getElementById('diff-path') as HTMLElement
    expect(diffPath?.textContent).toContain('abc123d')
    expect(diffPath?.textContent).toContain('abc123def456')

    const diffText = document.getElementById('diff')?.textContent || ''
    expect(diffText).toContain('abc123def456')
    expect(diffText).toContain('Test User')
    expect(diffText).toContain('Test commit message')
  })

  it('handles commit with empty id', async () => {
    installTauriMock()
    const { selectHistory } = await loadHistoryModule()
    const commit = { id: '', author: '', msg: '' }

    await selectHistory(commit, 0)

    const diffPath = document.getElementById('diff-path') as HTMLElement
    expect(diffPath?.textContent).toContain('unknown')
  })

  it('handles vcs_diff_commit failure gracefully', async () => {
    installTauriMock()
    ;(window as any).__TAURI__.core.invoke.mockRejectedValue(new Error('diff fail'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { selectHistory } = await loadHistoryModule()
    const commit = { id: 'abc', author: 'A', msg: 'M' }

    await selectHistory(commit, 0)

    const diffText = document.getElementById('diff')?.textContent || ''
    expect(diffText).toContain('Failed to load diff')
    warnSpy.mockRestore()
  })

  it('renders per-file diff sidebar when files are present', async () => {
    installTauriMock()
    ;(window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/readme.txt b/readme.txt',
          '--- a/readme.txt',
          '+++ b/readme.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ]
      }
      return []
    })
    const { selectHistory } = await loadHistoryModule()
    const commit = { id: 'abc', author: 'A', msg: 'M' }

    await selectHistory(commit, 0)

    const diffEl = document.getElementById('diff')!
    const sidebar = diffEl.querySelector('.commit-files')
    expect(sidebar).toBeTruthy()
    expect(sidebar?.textContent).toContain('readme.txt')

    const fileRows = sidebar?.querySelectorAll('.row')
    expect(fileRows?.length).toBe(1)
  })

  it('handles file contextmenu copy path in sidebar', async () => {
    installTauriMock()
    ;(window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.txt b/a.txt',
          '--- a/a.txt',
          '+++ b/a.txt',
          '@@ -1 +1 @@',
          '-x',
          '+y',
        ]
      }
      return []
    })
    // jsdom may not have navigator.clipboard; mock it if absent
    if (typeof navigator.clipboard === 'undefined') {
      (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    }
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const { selectHistory } = await loadHistoryModule()
    const commit = { id: 'abc', author: 'A', msg: 'M' }

    await selectHistory(commit, 0)

    const diffEl = document.getElementById('diff')!
    const fileRow = diffEl.querySelector('.commit-files .row')
    expect(fileRow).toBeTruthy()

    const ctxEvent = new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10, cancelable: true })
    fileRow!.dispatchEvent(ctxEvent)

    writeTextSpy.mockRestore()
  })

  it('renders hunks when commit diff has no file separators', async () => {
    installTauriMock()
    ;(window as any).__TAURI__.core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.txt b/a.txt',
          '--- a/a.txt',
          '+++ b/a.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ]
      }
      return []
    })
    const { selectHistory } = await loadHistoryModule()
    const commit = { id: 'abc', author: 'A', msg: 'M' }

    await selectHistory(commit, 0)

    const diffText = document.getElementById('diff')?.textContent || ''
    expect(diffText).toContain('-old')
    expect(diffText).toContain('+new')
  })
})
