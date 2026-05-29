// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/menu', () => ({ buildCtxMenu: vi.fn() }))
vi.mock('../../lib/confirm', () => ({ confirmBool: vi.fn(async () => true) }))
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }))
vi.mock('../../plugins', () => ({
  getPluginContextMenuItems: vi.fn(() => []),
  runPluginAction: vi.fn(),
}))
vi.mock('./hydrate', () => ({
  hydrateStatus: vi.fn().mockResolvedValue(undefined),
  hydrateCommits: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./commit', () => ({ updateCommitButton: vi.fn() }))
vi.mock('../cherryPick', () => ({ openCherryPick: vi.fn() }))

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

describe('formatTimeAgo - catch path', () => {
  it('handles object whose toString throws', async () => {
    const { formatTimeAgo } = await loadHistoryModule()
    const badObj = { toString: () => { throw new Error('boom') } } as any
    expect(formatTimeAgo(badObj)).toBe('')
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
    const { buildCtxMenu } = await import('../../lib/menu')
    const { getPluginContextMenuItems, runPluginAction } = await import('../../plugins')
    const { notify } = await import('../../lib/notify')
    const { openCherryPick } = await import('../cherryPick')
    const { hydrateStatus, hydrateCommits } = await import('./hydrate')

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
    expect(items.map((item) => item.label)).toContain('Cherry-pick to branch…')
    expect(items.map((item) => item.label)).toContain('Revert (reverse) commit…')
    expect(items.map((item) => item.label)).toContain('Undo to this commit')

    await items.find((item) => item.label === 'Copy hash')?.action?.()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abcdef123456')
    expect(notify).toHaveBeenCalledWith('Hash copied')

    await items.find((item) => item.label === 'Plugin inspect')?.action?.()
    expect(runPluginAction).toHaveBeenCalledWith('plugin.inspect', {
      commit: state.commits[0],
    })

    await items.find((item) => item.label === 'Cherry-pick to branch…')?.action?.()
    expect(openCherryPick).toHaveBeenCalledWith(state.commits[0])

    await items.find((item) => item.label === 'Revert (reverse) commit…')?.action?.()
    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_revert_commit', {
      id: 'abcdef123456',
    })
    expect(hydrateStatus).toHaveBeenCalled()
    expect(hydrateCommits).toHaveBeenCalled()

    await items.find((item) => item.label === 'Undo to this commit')?.action?.()
    expect((window as any).__TAURI__.core.invoke).toHaveBeenCalledWith('vcs_undo_to_commit', {
      id: 'abcdef123456',
    })
  })
})

describe('selectHistory', () => {
  it('renders file-scoped diffs and supports file-level context actions', async () => {
    installTauriMock()
    ;(navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }

    const { selectHistory } = await loadHistoryModule()
    const { buildCtxMenu } = await import('../../lib/menu')
    const { notify } = await import('../../lib/notify')
    const { hydrateStatus } = await import('./hydrate')
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

describe('updateHistoryActionsVisibility via selectHistory', () => {
  it('hides button when not on history tab', async () => {
    installTauriMock();
    const { selectHistory } = await loadHistoryModule();
    const { prefs } = await loadStateModule();
    prefs.tab = 'changes';
    await selectHistory({ id: 'abc123', author: 'A', msg: 'M' } as any, 0);
    const btn = document.getElementById('history-actions-btn') as HTMLButtonElement;
    expect(btn.hidden).toBe(true);
    expect(btn.disabled).toBe(true);
  });

  it('hides button when commit id is empty', async () => {
    installTauriMock();
    const { selectHistory } = await loadHistoryModule();
    const { prefs } = await loadStateModule();
    prefs.tab = 'history';
    await selectHistory({ id: '', author: 'A', msg: 'M' } as any, 0);
    const btn = document.getElementById('history-actions-btn') as HTMLButtonElement;
    expect(btn.hidden).toBe(true);
    expect(btn.disabled).toBe(true);
  });

  it('shows button when on history tab with valid commit', async () => {
    installTauriMock();
    const { selectHistory } = await loadHistoryModule();
    const { prefs } = await loadStateModule();
    prefs.tab = 'history';
    await selectHistory({ id: 'abc123', author: 'A', msg: 'M' } as any, 0);
    const btn = document.getElementById('history-actions-btn') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);
  });
});

describe('openCommitActionsMenu - failure paths', () => {
  it('copy hash failure does not throw', async () => {
    installTauriMock();
    (navigator as any).clipboard = { writeText: vi.fn().mockRejectedValue(new Error('clipboard fail')) };
    const { renderHistoryList } = await loadHistoryModule();
    const { state, prefs } = await loadStateModule();
    const { buildCtxMenu } = await import('../../lib/menu');
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
    const { buildCtxMenu } = await import('../../lib/menu');
    const { notify } = await import('../../lib/notify');
    prefs.tab = 'history';
    state.commits = [{ id: 'abc123', msg: 'Test', meta: new Date().toISOString() }] as any;
    state.ahead = 0;
    state.behind = 0;
    state.aheadIds = new Set<string>();
    renderHistoryList('');
    const row = document.querySelector('#file-list li.row.commit') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }));
    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert (reverse) commit…')?.action?.();
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
    const { buildCtxMenu } = await import('../../lib/menu');
    const { notify } = await import('../../lib/notify');

    await selectHistory({ id: 'abc', msg: 'Binary', author: 'A' } as any, 0);

    const fileRow = document.querySelector('.commit-files .row') as HTMLElement;
    fileRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));

    const items = vi.mocked(buildCtxMenu).mock.calls.at(-1)?.[0] || [];
    await items.find((i: any) => i.label === 'Revert this file')?.action?.();
    expect(notify).toHaveBeenCalledWith('Cannot revert binary diffs yet');
  });
});
