import { beforeEach, describe, expect, it, vi } from 'vitest'

const overlayMock = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('overlayscrollbars', () => ({
  OverlayScrollbars: overlayMock,
}))

import { initOverlayScrollbars, observeOverlayScrollbars } from './scrollbars'

describe('scrollbars observer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    overlayMock.mockClear()
  })

  it('initializes only known scroll containers', () => {
    document.body.innerHTML = `
      <div class="noop"></div>
      <div class="list-scroll"></div>
      <section><div class="pop-list-scroll"></div></section>
    `

    initOverlayScrollbars()
    expect(overlayMock).toHaveBeenCalledTimes(2)
  })

  it('ignores unrelated added nodes and batches matching subtree init', async () => {
    const stop = observeOverlayScrollbars()
    try {
      const noop = document.createElement('div')
      noop.className = 'no-scroll-target'
      document.body.appendChild(noop)
      await Promise.resolve()
      expect(overlayMock).toHaveBeenCalledTimes(0)

      const wrapper = document.createElement('section')
      wrapper.innerHTML = `
        <div class="nope"></div>
        <div class="list-scroll"></div>
      `
      document.body.appendChild(wrapper)
      await Promise.resolve()
      await Promise.resolve()
      expect(overlayMock).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })
})
