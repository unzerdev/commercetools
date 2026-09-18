/**
 * Radix's own event type for "the pointer went down outside this layer". UI Kit's `ConfirmationDialog`
 * wires ONE `onClose` to three dismissals - the header's ✕, the Escape key, and this one - so the event
 * is the only thing that tells them apart.
 */
const POINTER_DOWN_OUTSIDE = 'dismissableLayer.pointerDownOutside';

/**
 * Wrap a dialog's `onClose` so a click BESIDE the dialog does not dismiss it. Every dialog on this screen
 * is a form with explicit actions (Save / Cancel, Disconnect / Cancel), and a stray click on the page
 * around it threw away everything the operator had typed - the one input the dialog cannot ask about.
 * The ✕ and the Escape key still close, because both are deliberate.
 */
export const closeUnlessClickedOutside =
  (onClose: () => void) =>
  (event?: { type?: string }): void => {
    if (event?.type === POINTER_DOWN_OUTSIDE) {
      return;
    }
    onClose();
  };
