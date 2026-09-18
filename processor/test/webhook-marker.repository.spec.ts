import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { claimWebhookMarker, releaseWebhookMarker } from '../src/infrastructure/persistence/webhook-marker.repository';
import { getBrand } from '../src/infrastructure/config/brand';

/**
 * Mock the raw commercetools apiRoot custom-object builder chain used by the marker repository:
 *   client.customObjects().post({ body }).execute()                                 // claim (create)
 *   client.customObjects().withContainerAndKey({container,key}).delete().execute()  // release
 * capturing the POST body and delete container/key while each test drives `execute`.
 */
interface Captured {
  postBody?: { container: string; key: string; value: unknown; version?: number };
  deleteContainerKey?: { container: string; key: string };
  postExecute: jest.Mock<() => Promise<unknown>>;
  deleteExecute: jest.Mock<() => Promise<unknown>>;
}

function mockCustomObjects(): Captured {
  const captured: Captured = {
    postExecute: jest.fn<() => Promise<unknown>>(),
    deleteExecute: jest.fn<() => Promise<unknown>>(),
  };
  const builder = {
    post: (args: { body: Captured['postBody'] }) => {
      captured.postBody = args.body;
      return { execute: captured.postExecute };
    },
    withContainerAndKey: (args: { container: string; key: string }) => {
      captured.deleteContainerKey = args;
      return { delete: () => ({ execute: captured.deleteExecute }) };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'customObjects').mockReturnValue(builder as never);
  return captured;
}

// The composite operation identity the caller supplies (paymentId~kind~operationId -
// `~`-separated: every segment and the separator stay inside the CT custom-object key charset).
const KEY = 'pay-123~payment.captured~op-1';

describe('config/webhook-marker.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('claimWebhookMarker', () => {
    it('creates the marker in the connector-webhook-processed container with version 0 (create-if-absent)', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: { processed: true } } });

      const acquired = await claimWebhookMarker(KEY);

      expect(acquired).toBe(true);
      expect(captured.postBody?.container).toBe(getBrand().webhookMarkerContainer);
      expect(captured.postBody?.key).toBe(KEY);
      // version 0 makes the POST a create-only (a stale/existing version → 409).
      expect(captured.postBody?.version).toBe(0);
    });

    it('persists a static marker value (no dynamic timestamp)', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await claimWebhookMarker(KEY);

      expect(captured.postBody?.value).toEqual({ processed: true });
    });

    it('returns false when the marker already exists (409 statusCode → already claimed)', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockRejectedValue({ statusCode: 409, message: 'ConcurrentModification' });

      await expect(claimWebhookMarker(KEY)).resolves.toBe(false);
    });

    it('returns false on a ConcurrentModification error code (concurrent create)', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockRejectedValue({
        statusCode: 409,
        body: { statusCode: 409, errors: [{ code: 'ConcurrentModification' }] },
      });

      await expect(claimWebhookMarker(KEY)).resolves.toBe(false);
    });

    it('re-throws non-409 errors', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(claimWebhookMarker(KEY)).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('releaseWebhookMarker', () => {
    it('deletes the marker by container and key', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await releaseWebhookMarker(KEY);

      expect(captured.deleteContainerKey).toEqual({
        container: getBrand().webhookMarkerContainer,
        key: KEY,
      });
    });

    it('swallows a 404 (marker already gone) so rollback is best-effort', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(releaseWebhookMarker(KEY)).resolves.toBeUndefined();
    });

    it('re-throws non-404 delete errors', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(releaseWebhookMarker(KEY)).rejects.toMatchObject({ statusCode: 500 });
    });
  });
});
