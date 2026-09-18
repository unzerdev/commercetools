import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { useIntl } from 'react-intl';
import messages from './messages';

/**
 * The app's ONE in-flight indicator: a large centred spinner over a scrim that covers the screen.
 *
 * Two upstream defaults are deliberately overridden. `LoadingSpinner` renders `null` for its first
 * `maxDelayDuration` milliseconds (default **1000**) to avoid a flash on instant responses — but every
 * call here crosses the MC API Gateway to the connector, so the operator was left looking at a screen
 * that gave no sign of working; the delay is turned off. And the spinner tops out at 32px (`scale="l"`),
 * which reads as an afterthought in the middle of a page, so the CSS scales it up.
 *
 * The scrim is not decoration: it takes the clicks. While a save is in flight the form must not accept a
 * second submit, an environment switch, or a store change — the request already left with the values it
 * had, and the screen would be describing a state the connector is not in.
 *
 * ONE is meant literally. Several things are in flight at once on this screen — the store list, the
 * store config, the reference data, the methods catalogue, plus whatever the operator just submitted —
 * and each used to render its own overlay, so two of them stacked into two spinners turning inside each
 * other over a doubly-dimmed page. Callers no longer render anything: they DECLARE they are busy with
 * {@link useBusy}, a shared counter drives a single {@link BusyOverlayHost}, and the overlay is on screen
 * for exactly as long as at least one caller is waiting.
 */

/** How many callers are currently busy, and who to tell when that changes. */
let busyCount = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const setBusyCount = (next: number) => {
  busyCount = next;
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Declare that this component is waiting on something. The overlay shows while ANY caller says so and
 * disappears when the last one stops — including when a component unmounts mid-flight, because the
 * effect's cleanup is what releases the claim.
 */
export const useBusy = (isBusy: boolean): void => {
  useEffect(() => {
    if (!isBusy) {
      return;
    }
    setBusyCount(busyCount + 1);
    return () => setBusyCount(busyCount - 1);
  }, [isBusy]);
};

const BusyOverlay = () => {
  const intl = useIntl();
  return (
    <div
      className="unzer-busy"
      role="alert"
      aria-busy="true"
      aria-label={intl.formatMessage(messages.busy)}
    >
      <LoadingSpinner scale="l" maxDelayDuration={0} />
    </div>
  );
};
BusyOverlay.displayName = 'BusyOverlay';

/**
 * Renders the single overlay. Mounted ONCE, at the top of the screen's tree, but PORTALED to
 * `document.body`: a save started from a dialog has to be covered by the same scrim as one started from
 * the page, and the dialog renders in the app-shell's own portal container. From inside the app tree the
 * overlay lost that stacking contest; as a child of `body` it competes at the document root and wins.
 */
const BusyOverlayHost = () => {
  const isBusy = useSyncExternalStore(
    subscribe,
    () => busyCount > 0,
    () => false
  );
  return isBusy ? createPortal(<BusyOverlay />, document.body) : null;
};
BusyOverlayHost.displayName = 'BusyOverlayHost';

export default BusyOverlayHost;
