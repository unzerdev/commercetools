import type { MarkerStore } from '../../application/ports';
import { ctClient, isConcurrentModification } from '../commercetools';
import { getBrand } from '../config/brand';

/** The claim is the object's existence, so the value is static and the write reproducible. */
const MARKER_VALUE = { processed: true } as const;

/** Create-if-absent via `version: 0`; a 409 means the marker already exists or a concurrent create won. */
export async function claimWebhookMarker(key: string): Promise<boolean> {
  try {
    await ctClient.customObjects.save({
      container: getBrand().webhookMarkerContainer,
      key,
      value: MARKER_VALUE,
      version: 0,
    });

    return true;
  } catch (error) {
    if (isConcurrentModification(error)) {
      return false;
    }
    throw error;
  }
}

/** Best-effort delete so a redelivery re-processes; an already-gone marker is fine. */
export async function releaseWebhookMarker(key: string): Promise<void> {
  await ctClient.customObjects.remove({ container: getBrand().webhookMarkerContainer, key });
}

/** The `MarkerStore` port over this repository. */
export const markerStore: MarkerStore = {
  claim: claimWebhookMarker,
  release: releaseWebhookMarker,
};
