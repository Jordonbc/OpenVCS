// Test setup: provide browser shims used by frontend modules
(globalThis as any).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})

