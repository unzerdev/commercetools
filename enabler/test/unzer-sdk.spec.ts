import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { loadUnzerSdk, UNZER_SDK_URL } from '../src/components/unzer/sdk';

/**
 * `loadUnzerSdk` injects the Unzer UI Components v2 ES module once and resolves when its elements are
 * registered. It waits on the script tag's `load`/`error` events, so — like the vendor-script loaders
 * before it — the wait must be bounded: a stale tag that already fired `load` never fires it again.
 *
 * The jsdom custom-element registry cannot be reset within a file, so the "already registered"
 * short-circuit is asserted LAST — defining `unzer-payment` earlier would poison the inject cases.
 */
describe('loadUnzerSdk', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('injects a single <script type="module"> for the Unzer CDN and resolves on load', async () => {
    const promise = loadUnzerSdk();
    const script = document.head.querySelector<HTMLScriptElement>(`script[src="${UNZER_SDK_URL}"]`);
    expect(script).not.toBeNull();
    expect(script!.type).toBe('module');

    script!.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
  });

  it('dedupes a concurrent load onto one injected script tag', async () => {
    const first = loadUnzerSdk();
    const second = loadUnzerSdk();
    expect(document.head.querySelectorAll(`script[src="${UNZER_SDK_URL}"]`)).toHaveLength(1);

    document.head.querySelector('script')!.dispatchEvent(new Event('load'));
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  describe('the wait is bounded', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('rejects when a pre-existing script never becomes ready, instead of hanging', async () => {
      const stale = document.createElement('script');
      stale.src = UNZER_SDK_URL;
      document.head.appendChild(stale);

      const assertion = expect(loadUnzerSdk()).rejects.toThrow(/did not become ready/i);
      jest.advanceTimersByTime(60_000);
      await assertion;
    });
  });

  // Runs last: this registers <unzer-payment> permanently in the jsdom registry.
  describe('after the SDK elements are registered', () => {
    it('resolves immediately without injecting a script', async () => {
      customElements.define('unzer-payment', class extends HTMLElement {});
      await expect(loadUnzerSdk()).resolves.toBeUndefined();
      expect(document.head.querySelector('script')).toBeNull();
    });
  });
});
