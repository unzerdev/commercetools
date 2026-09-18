/**
 * Runtime loader for the Unzer UI Components v2 SDK.
 *
 * The SDK is an ES module served from Unzer's CDN — it is NEVER bundled or self-hosted, so the browser
 * build stays free of the vendor bundle and always runs the CDN's current version. Loading it injects
 * the module script once and resolves when the custom elements it defines (`<unzer-payment>`, the
 * per-method elements, `<unzer-checkout>`) are available.
 */

/** The Unzer UI Components v2 ES module. */
export const UNZER_SDK_URL = 'https://static-v2.unzer.com/v2/ui-components/index.js';

/** The wrapper element the SDK always defines; its presence is the readiness signal. */
const READINESS_ELEMENT = 'unzer-payment';

/**
 * How long to wait for the SDK to register its elements before giving up. A pre-existing script tag
 * whose `load` already fired never fires it again, so the wait needs a backstop — without one the
 * mount would spin forever instead of surfacing the error/retry path.
 */
const SDK_LOAD_TIMEOUT_MS = 15000;

/**
 * Resolve once the vendor has registered `tag`, under the same budget {@link loadUnzerSdk} allows.
 *
 * A mounted element self-renders (secure iframes included) only after its definition is registered, so
 * a surface must wait for it — but a mapped tag the CDN bundle never registers, a method the current
 * SDK version dropped or renamed, would leave that wait pending for as long as the page lives. The
 * deadline turns that into the caller's error path, where the shopper is told the form did not load
 * instead of watching an empty surface. The budget lives here, with the loader that owns SDK readiness,
 * so no caller can pick a different one.
 */
export const whenUnzerElementDefined = (tag: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`The Unzer element <${tag}> was not registered in time.`)),
      SDK_LOAD_TIMEOUT_MS,
    );
    void customElements.whenDefined(tag).then(() => {
      clearTimeout(deadline);
      resolve();
    });
  });

/**
 * Load the Unzer UI Components v2 SDK once and resolve when its elements are defined. Idempotent: if
 * the SDK is already registered it resolves immediately; a concurrent load attaches to the script tag
 * already in the DOM rather than injecting a second. The wait is bounded — a stale tag that will never
 * fire `load` again rejects at the deadline into the caller's error path.
 */
export const loadUnzerSdk = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (customElements.get(READINESS_ELEMENT)) {
      resolve();
      return;
    }

    let settled = false;
    const finish = (act: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      act();
    };
    const onLoad = () => finish(() => resolve());
    const onError = () => finish(() => reject(new Error('Failed to load the Unzer UI Components SDK.')));
    const deadline = setTimeout(
      () => finish(() => reject(new Error('The Unzer UI Components SDK did not become ready in time.'))),
      SDK_LOAD_TIMEOUT_MS,
    );

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${UNZER_SDK_URL}"]`);
    if (existing) {
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.type = 'module';
    script.src = UNZER_SDK_URL;
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.appendChild(script);
  });
