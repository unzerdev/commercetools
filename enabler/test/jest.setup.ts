import { jest } from '@jest/globals';

/**
 * Global test bootstrap (runs before each test file, before the framework is installed).
 *
 * jsdom does not implement `fetch`, so we install a default mock that fails loudly: any suite that
 * hits the network without arranging its own `global.fetch` gets a clear error instead of a hang.
 * Each spec replaces this with a controllable mock via the helpers in `test/helpers.ts`.
 */
global.fetch = jest.fn(() =>
  Promise.reject(new Error('fetch was called without a test-arranged mock')),
) as unknown as typeof fetch;

/**
 * jsdom implements no scrolling, so `Element.scrollIntoView` is absent where every browser has it. The
 * surface calls it to bring a wallet back into view (`showValidation`), and a suite that wants to assert the
 * call replaces this with its own mock.
 */
Element.prototype.scrollIntoView = jest.fn() as unknown as Element['scrollIntoView'];
