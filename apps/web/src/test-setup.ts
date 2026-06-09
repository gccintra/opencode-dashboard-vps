/* Lazily load @testing-library/jest-dom only when vitest is running.
   Static import would load it at module parse time even outside test context. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).expect !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

export {};

/* Mock document.fonts API (jsdom 29 doesn't implement FontFaceSet). */
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    value: {
      load: () => Promise.resolve([]),
      ready: Promise.resolve(),
      check: () => true,
    },
    writable: true,
  });
}
