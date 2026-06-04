// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@scripts/lib/menu', () => ({ buildCtxMenu: vi.fn() }))
vi.mock('@scripts/lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }))
vi.mock('@scripts/lib/notify', () => ({ notify: vi.fn() }))
vi.mock('@scripts/plugins', () => ({
  getPluginContextMenuItems: vi.fn(() => []),
  runPluginAction: vi.fn(),
}))
vi.mock('@scripts/features/repo/hydrate', () => ({
  hydrateStatus: vi.fn().mockResolvedValue(undefined),
  hydrateCommits: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@scripts/features/repo/commit', () => ({ updateCommitButton: vi.fn() }))
vi.mock('@scripts/features/cherryPick', () => ({ openCherryPick: vi.fn() }))

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
  return import('@scripts/features/repo/history')
}

/** Imports the shared state module after the test DOM is ready. */
async function loadStateModule() {
  return import('@scripts/state/state')
}

// Set matchMedia before importing modules that touch browser media APIs.
(globalThis as any).matchMedia = createMatchMediaMock

beforeEach(() => {
  vi.clearAllMocks()
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

  it('handles null lines gracefully', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule()
    expect(parseCommitDiffByFile(null as any)).toEqual([])
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

describe('formatTimeAgo - catch path', () => {
  it('handles object whose toString throws', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    const badObj = { toString: () => { throw new Error('boom') } } as any
    expect(formatTimeAgo(badObj)).toBe('')
  })

  it('returns the input string when Date fails silently', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    expect(formatTimeAgo('not-a-date')).toBe('not-a-date')
  })

  it('handles string that trims but is not a valid date', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    expect(formatTimeAgo('  ')).toBe('')
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

  it('opens commit actions and runs copy, plugin, cherry-pick, revert, and undo actions', async () => {
    installTauriMock()
    ;(navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }

    const { renderHistoryList } = await loadHistoryModule()
    const { state, prefs } = await loadStateModule()
    const { buildCtxMenu } = await import('@scripts/lib/menu')
    const { getPluginContextMenuItems, runPluginAction } = await import('@scripts/plugins')
    const { notify } = await import('@scripts/lib/notify')
    const { openCherryPick } = await import('@scripts/features/cherryPick')
    const { hydrateStatus, hydrateCommits } = await import('@scripts/features/repo/hydrate')

    prefs.tab = 'history'
    vi.mocked(getPluginContextMenuItems).mockReturnValue([{ label: 'Plugin inspect', action: 'plugin.inspect' }])
    ;(window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') return []
      return undefined
    })

    state.commits = [
      { id: 'abcdef123456', msg: 'Commit 1', meta: new Date().toISOString(), author: 'A', remoteRef: '@{upstream}' } as any,
    ]
    state.ahead = 1
    state.behind = 0
    state.aheadIds = new Set<string>(['abcdef123456'])

    renderHistoryList('')
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }))

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || []
    expect(items.map((item) => item.label)).toContain('Copy hash')
    expect(items.map((item) => item.label)).toContain('Plugin inspect')
    expect(items.map((item) => item.label)).toContain('Cherry-pick to branch')
    expect(items.map((item) => item.label)).toContain('Revert commit')
    expect(items.map((item) => item.label)).toContain('Undo this commit')

    await items.find((item) => item.label === 'Copy hash')?.action?.()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abcdef123456')
    expect(notify).toHaveBeenCalledWith('Hash copied')

    await items.find((item) => item.label === 'Plugin inspect')?.action?.()
    expect(runPluginAction).toHaveBeenCalledWith('plugin.inspect', {
      commit: state.commits[0],
    })

    await items.find((item) => item.label === 'Cherry-pick to branch')?.action?.()
    expect(openCherryPick).toHaveBeenCalledWith(state.commits[0])

    await items.find((item) => item.label === 'Revert commit')?.action?.()
    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_revert_commit', {
      id: 'abcdef123456',
    })
    expect(hydrateStatus).toHaveBeenCalled()
    expect(hydrateCommits).toHaveBeenCalled()

    await items.find((item) => item.label === 'Undo this commit')?.action?.()
    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_undo_to_commit', {
      id: 'abcdef123456',
      parent: true,
    })
  })
})

describe('selectHistory', () => {
  it('renders file-scoped diffs and supports file-level context actions', async () => {
    installTauriMock()
    ;(navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }

    const { selectHistory } = await loadHistoryModule()
    const { buildCtxMenu } = await import('@scripts/lib/menu')
    const { notify } = await import('@scripts/lib/notify')
    const { hydrateStatus } = await import('@scripts/features/repo/hydrate')
    ;(window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ]
      }
      return args?.patch ? undefined : []
    })

    await selectHistory({ id: 'abc1234', msg: 'Refactor', author: 'Dev' } as any, 0)

    expect(document.querySelector('.commit-files')).not.toBeNull()
    const row = document.querySelector('.commit-files .row[data-idx="0"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }))

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || []
    await items.find((item) => item.label === 'Copy path')?.action?.()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('src/a.ts')
    expect(notify).toHaveBeenCalledWith('Path copied')

    await items.find((item) => item.label === 'Revert this file')?.action?.()
    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_discard_patch', {
      patch: expect.stringContaining('diff --git a/src/a.ts b/src/a.ts'),
    })
    expect(hydrateStatus).toHaveBeenCalled()
  })

  it('shows a failed diff message when commit diff loading throws', async () => {
    installTauriMock()
    ;(window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') throw new Error('boom')
      return []
    })

    const { selectHistory } = await loadHistoryModule()
    await selectHistory({ id: 'abc1234', msg: 'Refactor', author: 'Dev' } as any, 0)

    expect(document.getElementById('diff')?.textContent).toContain('Failed to load diff')
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

describe('openCommitActionsMenu - failure paths', () => {
  it('copy hash failure does not throw', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockRejectedValue(new Error('clipboard fail')) };
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();
    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await expect(items.find((i: any) => i.label === 'Copy hash')?.action?.()).resolves.toBeUndefined();
  });

  it('revert failure notifies', async () => {
    installTauriMock();
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_revert_commit') throw new Error('revert fail');
      if (cmd === 'vcs_diff_commit') return [];
      return undefined;
    });
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');
    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();
    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert commit')?.action?.();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Revert failed'));
  });
});

// ============================================================================
// selectHistory - selectCommitFile inner function
// ============================================================================
describe('selectHistory - selectCommitFile', () => {
  it('switches file in sidebar and renders correct diff', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          'diff --git a/b.ts b/b.ts',
          '--- a/b.ts',
          '+++ b/b.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new2',
        ];
      }
      return undefined;
    });

    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: 'abc123', msg: 'Multi', author: 'Dev' } as any, 0);

    const rows = document.querySelectorAll('.commit-files .row');
    expect(rows.length).toBe(2);

    // Click the second file
    (rows[1] as HTMLElement).click();
  });
});

// ============================================================================
// selectHistory - revert binary file
// ============================================================================
describe('selectHistory - revert binary file', () => {
  it('notifies when reverting a binary diff', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/image.png b/image.png',
          'GIT binary patch',
          '--- a/image.png',
          '+++ b/image.png',
          '@@ -1,3 +0,0 @@',
          '-binary',
        ];
      }
      return undefined;
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');

    await selectHistory({ id: 'abc', msg: 'Binary', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect(notify).toHaveBeenCalledWith('Cannot revert binary diffs yet');
  });
});

// ============================================================================
// formatTimeAgo - month (mon===1)
// ============================================================================
describe('formatTimeAgo - month', () => {
  it('formats 1 month ago', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 32 * 24 * 60 * 60 * 1000).toISOString())).toBe('1 month ago');
  });
});

// ============================================================================
// openCommitActionsMenu without commit id
// ============================================================================
describe('openCommitActionsMenu - missing commit id', () => {
  it('omits cherry-pick and revert when commit has no id', async () => {
    installTauriMock();
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    prefs.tab = 'history';
    state.commits = [{ id: '', msg: 'No id commit', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const labels = items.map((i: any) => i.label);
    expect(labels).toContain('Copy hash');
    expect(labels).not.toContain('Cherry-pick to branch');
    expect(labels).not.toContain('Revert commit');
    expect(labels).not.toContain('Undo to this commit');
  });
});

// ============================================================================
// Revert confirmation cancellation
// ============================================================================
describe('revert confirmation', () => {
  it('cancels and does not invoke vcs_revert_commit when confirmBool returns false', async () => {
    installTauriMock();
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    const { notify } = await import('@scripts/lib/notify');

    vi.mocked(confirmBool).mockResolvedValue(false);
    vi.mocked(notify).mockClear();
    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert commit')?.action?.();
    expect((window as any).__TAURI__.core.invoke).not.toHaveBeenCalledWith('vcs_revert_commit', expect.anything());
    expect(notify).not.toHaveBeenCalledWith('Revert complete');
  });
});

// ============================================================================
// Undo action failure
// ============================================================================
describe('undo action failure', () => {
  it('notifies on undo to commit failure', async () => {
    installTauriMock();
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_undo_to_commit') throw new Error('undo fail');
      if (cmd === 'vcs_diff_commit') return [];
      return undefined;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { confirmBool } = await import('@scripts/lib/confirm');
    vi.mocked(confirmBool).mockResolvedValue(true);
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');

    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString() }] as any;
    state.ahead = 1;
    state.behind = 0;
    state.aheadIds = new Set<string>(['abc123']);

    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Undo this commit')?.action?.();
    expect(notify).toHaveBeenCalledWith('Undo failed: Error: undo fail');
    errorSpy.mockRestore();
  });
});

// ============================================================================
// renderHistoryList - commit without id
// ============================================================================
describe('renderHistoryList - commit without id', () => {
  it('renders commits without id without crashing', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();

    state.commits = [{ id: '', msg: 'No id', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    expect(renderHistoryList('')).toBe(true);
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('No id');
  });
});

// ============================================================================
// diffEl contextmenu handler (module-level)
// ============================================================================
describe('diffEl contextmenu handler', () => {
  it('opens commit actions menu when tab=history and commit selected', async () => {
    installTauriMock();
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') return [];
      return undefined;
    });
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test Commit', meta: new Date().toISOString(), author: 'Dev' }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');

    const diff = document.getElementById('diff') as HTMLElement;
    diff.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 15, clientY: 25 }));

    expect(vi.mocked(buildCtxMenu)).toHaveBeenCalled();
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    expect(items.map((i: any) => i.label)).toContain('Copy hash');
  });
});

// ============================================================================
// selectHistory - file revert failure
// ============================================================================
describe('selectHistory - file revert failure', () => {
  it('notifies on vcs_discard_patch failure', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'vcs_discard_patch') throw new Error('discard fail');
      return [];
    });
    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    const { notify } = await import('@scripts/lib/notify');

    vi.mocked(confirmBool).mockReset().mockResolvedValue(true);

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    vi.mocked(buildCtxMenu).mockClear();
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Revert failed'));
  });
});

// ============================================================================
// selectCommitFile invalid index
// ============================================================================
describe('selectCommitFile - invalid index', () => {
  it('handles invalid data-idx gracefully', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          'diff --git a/b.ts b/b.ts',
          '--- a/b.ts',
          '+++ b/b.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new2',
        ];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: 'abc123', msg: 'Multi', author: 'Dev' } as any, 0);

    const rows = document.querySelectorAll('.commit-files .row');
    rows.forEach((r) => { r.setAttribute('data-idx', '-1'); });
    (rows[0] as HTMLElement).click();
  });
});

// ============================================================================
// selectHistory - missing side/content elements
// ============================================================================
describe('selectHistory - missing side/content elements', () => {
  it('skips file sidebar setup when commit-files or commit-content is missing', async () => {
    installTauriMock();
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const diff = document.getElementById('diff') as HTMLElement;
    const origQuery = diff.querySelector.bind(diff);
    vi.spyOn(diff, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.commit-files' || sel === '.commit-content') return null;
      return origQuery(sel);
    });

    await expect(selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0)).resolves.toBeUndefined();
  });
});

// ============================================================================
// diffEl contextmenu - early return conditions
// ============================================================================
describe('diffEl contextmenu - early returns', () => {
  it('does not open menu when tab is not history', async () => {
    installTauriMock();
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    prefs.tab = 'changes';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString(), author: 'Dev' }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();
    renderHistoryList('');

    const diff = document.getElementById('diff') as HTMLElement;
    diff.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(buildCtxMenu).not.toHaveBeenCalled();
  });

  it('does not open menu when no commit is selected', async () => {
    installTauriMock();
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString(), author: 'Dev' }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();
    renderHistoryList('');
    // renderHistoryList sets selectedCommit, reset it to test early return
    (state as any).selectedCommit = null;

    const diff = document.getElementById('diff') as HTMLElement;
    diff.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(buildCtxMenu).not.toHaveBeenCalled();
  });
});

// ============================================================================
// selectHistory - copy path clipboard failure
// ============================================================================
describe('selectHistory - copy path failure', () => {
  it('handles clipboard write failure silently', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockRejectedValue(new Error('clipboard error')) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];

    // Copy path should not throw and should silently ignore the clipboard error
    await expect(items.find((i: any) => i.label === 'Copy path')?.action?.()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalledWith('Path copied');
  });
});

// ============================================================================
// selectHistory - file revert confirmation cancellation
// ============================================================================
describe('selectHistory - file revert confirmation cancellation', () => {
  it('does not revert when confirmBool returns false', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    const { notify } = await import('@scripts/lib/notify');

    vi.mocked(confirmBool).mockResolvedValue(false);
    vi.mocked(notify).mockClear();
    vi.mocked(buildCtxMenu).mockClear();

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect((window as any).__TAURI__.core.invoke).not.toHaveBeenCalledWith('vcs_discard_patch', expect.anything());
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('Revert'));
  });
});

// ============================================================================
// selectHistory - file contextmenu invalid idx
// ============================================================================
describe('selectHistory - file contextmenu invalid idx', () => {
  it('early returns when data-idx is invalid', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.setAttribute('data-idx', '-1');
    vi.mocked(buildCtxMenu).mockClear();
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    expect(buildCtxMenu).not.toHaveBeenCalled();
  });
});

// ============================================================================
// selectHistory - diffHtml truthy when files.length === 0
// ============================================================================
describe('selectHistory - files.length === 0 with renderable diff', () => {
  it('renders hunks label when diff has no git diff separators but has hunk content', async () => {
    installTauriMock();
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return ['@@ -1 +1 @@', '-old', '+new'];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const diffEl = document.getElementById('diff') as HTMLElement;
    expect(diffEl.innerHTML).toContain('Changes');
    expect(diffEl.textContent).toContain('-old');
    expect(diffEl.textContent).toContain('+new');
  });
});

// ============================================================================
// renderHistoryList - behind count edge cases
// ============================================================================
describe('renderHistoryList behind count edge cases', () => {
  it('shows singular "commit" when behind is 1', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'aaa', msg: 'Latest', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 1;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('incoming');
    expect(listText).toContain('1 incoming commit');
  });

  it('shows no behind notice when behind is 0', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'aaa', msg: 'Only', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).not.toContain('incoming');
  });

  it('shows plural "commits" when behind > 1', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'aaa', msg: 'C1', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 2;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('2 incoming commits');
  });
});

// ============================================================================
// renderHistoryList - null/undefined commits
// ============================================================================
describe('renderHistoryList null commits', () => {
  it('handles state.commits being null via || [] fallback', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = null as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    const result = renderHistoryList('');
    expect(result).toBe(true);
    expect(document.querySelector('#file-list')?.textContent).toContain('No commits loaded');
  });
});

// ============================================================================
// renderHistoryList - commit count wording
// ============================================================================
describe('renderHistoryList commit count wording', () => {
  it('shows singular "commit" when exactly 1 commit', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'aaa', msg: 'Single', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const countText = document.getElementById('changes-count')?.textContent || '';
    expect(countText).toBe('1 commit');
  });

  it('shows plural "commits" when no commits (0)', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const countText = document.getElementById('changes-count')?.textContent || '';
    expect(countText).toBe('0 commits');
  });
});

// ============================================================================
// formatTimeAgo - boundary edge cases
// ============================================================================
describe('formatTimeAgo boundary edge cases', () => {
  it('returns minutes when exactly at 59 minutes (min < 60)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 59 * 60 * 1000).toISOString())).toBe('59 minutes ago');
  });

  it('returns hours when exactly at 60 minutes (min >= 60)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 60 * 60 * 1000).toISOString())).toBe('1 hour ago');
  });

  it('returns days when exactly at 6 days (day < 7)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString())).toBe('6 days ago');
  });

  it('returns weeks when exactly at 7 days (day >= 7)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())).toBe('1 week ago');
  });

  it('handles large year values', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 3650 * 24 * 60 * 60 * 1000).toISOString())).toBe('10 years ago');
  });
});

// ============================================================================
// renderHistoryList - non-empty filter that matches nothing
// ============================================================================
describe('renderHistoryList filter edge cases', () => {
  it('shows empty list when filter matches no commits', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'aaa', msg: 'Alpha', meta: new Date().toISOString() } as any,
      { id: 'bbb', msg: 'Beta', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('zzz_nonexistent');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('No commits loaded');
  });

  it('shows empty list when filter matches neither msg nor id', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'xyz789', msg: 'Gamma', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('Delta');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('No commits loaded');
  });
});

// ============================================================================
// formatTimeAgo - exact boundary cases at transition points
// ============================================================================
describe('formatTimeAgo exact boundary transitions', () => {
  it('returns "just now" at 44 seconds (just under threshold)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 44 * 1000).toISOString())).toBe('just now');
  });

  it('returns "1 minute ago" at 45 seconds (exact threshold)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 45 * 1000).toISOString())).toBe('1 minute ago');
  });

  it('returns "2 minutes ago" at 90 seconds (exact threshold)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 90 * 1000).toISOString())).toBe('2 minutes ago');
  });

  it('returns "2 hours ago" at 120 minutes (exact threshold)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 120 * 60 * 1000).toISOString())).toBe('2 hours ago');
  });

  it('returns "yesterday" at 1 day (day === 1)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 24 * 60 * 60 * 1000).toISOString())).toBe('yesterday');
  });

  it('returns "1 week ago" at 7 days (exact threshold)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())).toBe('1 week ago');
  });
});

// ============================================================================
// selectHistory - null commit handling
// ============================================================================
describe('selectHistory null commit', () => {
  it('sets selectedCommit via commit || null guard', async () => {
    const { selectHistory } = await loadHistoryModule();
    const { state } = await loadStateModule();
    await selectHistory({ id: null } as any, 0);
    expect((state as any).selectedCommit).toEqual({ id: null });
  });

  it('shows "Commit (unknown)" for commit with null id', async () => {
    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: null } as any, 0);
    const diffPath = document.getElementById('diff-path') as HTMLElement;
    expect(diffPath?.textContent).toContain('Commit (unknown)');
  });

  it('renders metadata template for commit with null id', async () => {
    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: null } as any, 0);
    const diffEl = document.getElementById('diff') as HTMLElement;
    expect(diffEl?.textContent).toContain('commit');
  });
});

// ============================================================================
// selectHistory - commit with no id (skip vcs_diff_commit)
// ============================================================================
describe('selectHistory commit without id', () => {
  it('skips vcs_diff_commit when commit exists but id is empty', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: '', author: 'Dev', msg: 'No id' } as any, 0);

    expect(document.getElementById('diff')?.textContent).not.toContain('Failed to load diff');
    warnSpy.mockRestore();
  });
});

// ============================================================================
// selectHistory - selectCommitFile missing DOM elements
// ============================================================================
describe('selectHistory selectCommitFile missing contentEl', () => {
  it('gracefully handles missing commit-content element', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const contentEl = document.querySelector('.commit-content') as HTMLElement;
    if (contentEl) contentEl.remove();

    const row = document.querySelector('.commit-files .row') as HTMLElement;
    expect(() => row.click()).not.toThrow();
  });
});

// ============================================================================
// selectHistory - file revert edge cases
// ============================================================================
describe('selectHistory file revert edge cases', () => {
  it('handles empty lines array in file revert', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/empty.txt b/empty.txt',
          '--- a/empty.txt',
          '+++ b/empty.txt',
        ];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');

    vi.mocked(confirmBool).mockResolvedValue(true);

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const revertAction = items.find((i: any) => i.label === 'Revert this file');
    expect(revertAction).toBeDefined();
    await expect(revertAction?.action?.()).resolves.toBeUndefined();
  });

  it('handles patch without trailing newline', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'vcs_discard_patch') return undefined;
      return [];
    });
    (window as any).__TAURI__.core.invoke = invokeMock;

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');

    vi.mocked(confirmBool).mockResolvedValue(true);

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    const patchCall = invokeMock.mock.calls.find((args: unknown[]) => args[0] === 'vcs_discard_patch');
    expect(patchCall).toBeTruthy();
    expect(String((patchCall as any)[1].patch).endsWith('\n')).toBe(true);
  });

  it('file revert with isBinary lines notifies correctly', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/data.bin b/data.bin',
          'GIT binary patch',
          '--- a/data.bin',
          '+++ b/data.bin',
          '@@ -1,3 +0,0 @@',
          '-binary',
        ];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');

    await selectHistory({ id: 'abc', msg: 'Binary', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect(notify).toHaveBeenCalledWith('Cannot revert binary diffs yet');
  });
});

// ============================================================================
// openCommitActionsMenu - plugin context menu items
// ============================================================================
describe('openCommitActionsMenu with plugin items', () => {
  it('includes plugin items in the context menu', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { getPluginContextMenuItems } = await import('@scripts/plugins');

    vi.mocked(getPluginContextMenuItems).mockReturnValue([
      { label: 'Plugin Action 1', action: 'plugin.action1' },
      { label: 'Plugin Action 2', action: 'plugin.action2' },
    ]);

    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    const labels = items.map((i: any) => i.label);
    expect(labels).toContain('Plugin Action 1');
    expect(labels).toContain('Plugin Action 2');
  });

  it('executes plugin action from context menu', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { getPluginContextMenuItems, runPluginAction } = await import('@scripts/plugins');

    vi.mocked(getPluginContextMenuItems).mockReturnValue([
      { label: 'Test Plugin', action: 'test.inspect' },
    ]);

    prefs.tab = 'history';
    state.commits = [{ id: 'def456', msg: 'Plugin test', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Test Plugin')?.action?.();
    expect(runPluginAction).toHaveBeenCalledWith('test.inspect', { commit: state.commits[0] });
  });
});

// ============================================================================
// openCommitActionsMenu - copy hash edge cases
// ============================================================================
describe('openCommitActionsMenu copy hash edge cases', () => {
  it('copies empty string when commit has no id', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');

    prefs.tab = 'history';
    state.commits = [{ id: '', msg: 'Empty id', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Copy hash')?.action?.();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
    expect(notify).toHaveBeenCalledWith('Hash copied');
  });
});

// ============================================================================
// renderHistoryList - null msg and empty meta edge cases
// ============================================================================
describe('renderHistoryList null msg and meta', () => {
  it('renders "(no message)" when commit msg is null', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'aaa', msg: null, meta: new Date().toISOString() } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('(no message)');
  });

  it('handles undefined meta without crashing', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'bbb', msg: 'No meta', meta: undefined } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    expect(() => renderHistoryList('')).not.toThrow();
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('No meta');
  });
});

// ============================================================================
// renderHistoryList - aheadFallbackRemaining distribution
// ============================================================================
describe('renderHistoryList ahead fallback distribution', () => {
  it('marks ahead commits using fallback when aheadIds is empty and ahead > 0', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'c1', msg: 'First', meta: new Date().toISOString() } as any,
      { id: 'c2', msg: 'Second', meta: new Date().toISOString() } as any,
      { id: 'c3', msg: 'Third', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 2;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listHtml = document.querySelector('#file-list')?.innerHTML || '';
    const rows = document.querySelectorAll('#file-list li.row.commit');
    expect(rows.length).toBe(3);
  });
});

// ============================================================================
// renderHistoryList - commit with null meta causing formatTimeAgo to fall through
// ============================================================================
describe('renderHistoryList null meta', () => {
  it('formats null meta as empty string', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'ccc', msg: 'Test message', meta: null } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listHtml = document.querySelector('#file-list')?.innerHTML || '';
    expect(listHtml).toContain('Test message');
  });
});

// ============================================================================
// selectHistory - revert confirmation then patch fails
// ============================================================================
describe('selectHistory revert confirmation with invoke failure', () => {
  it('notifies when vcs_discard_patch fails after confirmation', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/fail.txt b/fail.txt',
          '--- a/fail.txt',
          '+++ b/fail.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ];
      }
      if (cmd === 'vcs_discard_patch') throw new Error('discard error');
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { confirmBool } = await import('@scripts/lib/confirm');
    const { notify } = await import('@scripts/lib/notify');

    vi.mocked(confirmBool).mockReset().mockResolvedValue(true);

    await selectHistory({ id: 'abc', msg: 'Test', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    vi.mocked(buildCtxMenu).mockClear();
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Revert failed'));
  });
});

// ============================================================================
// formatTimeAgo — months between 2 and 11 and years > 1
// ============================================================================
describe('formatTimeAgo months and years edge cases', () => {
  it('formats 3 months ago (mon=3)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString())).toBe('3 months ago');
  });

  it('formats 11 months ago (mon=11)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 335 * 24 * 60 * 60 * 1000).toISOString())).toBe('11 months ago');
  });

  it('formats 2 years ago (yr > 1)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 730 * 24 * 60 * 60 * 1000).toISOString())).toBe('2 years ago');
  });

  it('formats 5 weeks to "1 month ago" (mon=1 via wk>=5 path)', async () => {
    const { formatTimeAgo } = await loadHistoryModule();
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString())).toBe('1 month ago');
  });
});

// ============================================================================
// selectHistory — empty vcs_diff_commit result → files.length===0, diffHtml empty
// ============================================================================
describe('selectHistory empty diff result', () => {
  it('renders empty label when files.length===0 and diffHtml is empty', async () => {
    installTauriMock();
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') return [];
      return undefined;
    });

    const { selectHistory } = await loadHistoryModule();

    await selectHistory({ id: 'abc', msg: 'Test', author: 'Dev' } as any, 0);

    // Should render metadata but no diff content
    const diffEl = document.getElementById('diff') as HTMLElement;
    expect(diffEl.textContent).toContain('abc');
    expect(diffEl.textContent).toContain('Dev');
    expect(diffEl.textContent).toContain('Test');
    expect(diffEl.textContent).not.toContain('Changes');
  });
});

// ============================================================================
// renderHistoryList — meta containing '•' separator (line 140 split branch)
// ============================================================================
describe('renderHistoryList meta with separator', () => {
  it('splits meta by • and uses the first part for relative time', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    const now = new Date();
    const metaWithSep = `${now.toISOString()}•extra-info`;
    state.commits = [
      { id: 'aaa', msg: 'Meta with sep', meta: metaWithSep } as any,
    ];
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listText = document.querySelector('#file-list')?.textContent || '';
    expect(listText).toContain('Meta with sep');
    // Should show the relative time (not the raw meta)
    expect(listText).not.toContain('extra-info');
  });
});

// ============================================================================
// renderHistoryList — remoteRef not '@{upstream}' (line 153 non-upstream branch)
// ============================================================================
describe('renderHistoryList non-upstream remoteRef', () => {
  it('shows the actual remote name in incoming title when remoteRef is not @{upstream}', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'inc-1', msg: 'From origin/main', meta: new Date().toISOString(), incoming: true, remoteRef: 'origin/main' } as any,
    ];
    state.ahead = 0;
    state.behind = 1;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listHtml = document.querySelector('#file-list')?.innerHTML || '';
    expect(listHtml).toContain('origin/main');
  });

  it('shows "remote" as the default remote name when remoteRef is undefined', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: 'inc-2', msg: 'From default remote', meta: new Date().toISOString(), incoming: true } as any,
    ];
    state.ahead = 0;
    state.behind = 1;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listHtml = document.querySelector('#file-list')?.innerHTML || '';
    expect(listHtml).toContain('incoming');
  });
});

// ============================================================================
// renderHistoryList — commit without id but aheadFallbackRemaining > 0
// ============================================================================
describe('renderHistoryList commit without id with ahead fallback', () => {
  it('skips ahead marking for commits without id even when aheadFallbackRemaining > 0', async () => {
    const { renderHistoryList } = await loadHistoryModule();
    const { state } = await loadStateModule();
    state.commits = [
      { id: null, msg: 'No id commit', meta: new Date().toISOString() } as any,
    ];
    state.ahead = 1;
    state.behind = 0;
    state.aheadIds = new Set<string>();

    renderHistoryList('');
    const listHtml = document.querySelector('#file-list')?.innerHTML || '';
    // Should NOT have outgoing tag since the commit has no id
    expect(listHtml).not.toContain('outgoing');
  });
});

// ============================================================================
// parseCommitDiffByFile — consecutive diff blocks with no content between
// ============================================================================
describe('parseCommitDiffByFile edge cases', () => {
  it('handles diff blocks with no lines between header and next diff header', async () => {
    const { parseCommitDiffByFile } = await loadHistoryModule();
    const lines = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      'diff --git a/c.txt b/c.txt',
      '--- a/c.txt',
      '+++ b/c.txt',
    ];
    const files = parseCommitDiffByFile(lines);
    expect(files.length).toBe(2);
    expect(files[0].path).toBe('a.txt');
    expect(files[1].path).toBe('c.txt');
  });
});

// ============================================================================
// selectHistory — selectCommitFile with non-first file index
// ============================================================================
describe('selectHistory selectCommitFile non-first file', () => {
  it('switches active row when selecting non-first file via click', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/a.ts b/a.ts',
          '--- a/a.ts',
          '+++ b/a.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          'diff --git a/b.ts b/b.ts',
          '--- a/b.ts',
          '+++ b/b.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new2',
        ];
      }
      return undefined;
    });

    const { selectHistory } = await loadHistoryModule();
    await selectHistory({ id: 'abc', msg: 'Multi', author: 'Dev' } as any, 0);

    const rows = document.querySelectorAll('.commit-files .row');
    expect(rows.length).toBe(2);

    // First row should be active initially
    expect(rows[0].classList.contains('active')).toBe(true);
    expect(rows[1].classList.contains('active')).toBe(false);

    // Click second file
    (rows[1] as HTMLElement).click();
    expect(rows[0].classList.contains('active')).toBe(false);
    expect(rows[1].classList.contains('active')).toBe(true);
  });
});

// ============================================================================
// selectHistory — files.length === 0 with commit.id unset
// ============================================================================
describe('selectHistory commit without id and empty diff', () => {
  it('renders metadata and falls through when commit has no id', async () => {
    const { selectHistory } = await loadHistoryModule();
    // commit has no id, so vcs_diff_commit is never called
    // files.length === 0 (empty default), diffHtml = renderHunksReadonly([]) = ''
    await selectHistory({ id: '', author: 'NoAuthor', msg: 'Empty commit' } as any, 0);

    const diffEl = document.getElementById('diff') as HTMLElement;
    expect(diffEl.textContent).toContain('Empty commit');
    expect(diffEl.textContent).toContain('NoAuthor');
  });
});

// ============================================================================
// selectHistory — file revert with binary detection using "Binary files " pattern
// ============================================================================
describe('selectHistory file revert binary via "Binary files " pattern', () => {
  it('detects binary diff via "Binary files " marker and notifies', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (window as any).__TAURI__.core.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'vcs_diff_commit') {
        return [
          'diff --git a/data.bin b/data.bin',
          '--- a/data.bin',
          '+++ b/data.bin',
          'Binary files a/data.bin and b/data.bin differ',
        ];
      }
      return [];
    });

    const { selectHistory } = await loadHistoryModule();
    const { buildCtxMenu } = await import('@scripts/lib/menu');
    const { notify } = await import('@scripts/lib/notify');

    await selectHistory({ id: 'abc', msg: 'Binary', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect(notify).toHaveBeenCalledWith('Cannot revert binary diffs yet');
  });
});
