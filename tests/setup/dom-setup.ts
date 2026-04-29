/**
 * DOM test setup — installs `@testing-library/jest-dom` matchers
 * (e.g. toBeInTheDocument, toHaveAttribute, ...) onto vitest's expect.
 *
 * Loaded by `vitest.dom.config.ts` only — node-environment tests under the
 * default `vitest.config.ts` are unaffected.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom 不支援 scrollIntoView, IntersectionObserver, ResizeObserver — 提供 noop stub
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // noop in tests
  }
}

if (typeof globalThis !== 'undefined' && typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub
}

if (typeof globalThis !== 'undefined' && typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}

afterEach(() => {
  cleanup()
})
