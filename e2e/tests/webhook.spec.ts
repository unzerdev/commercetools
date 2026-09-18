import { expect, test } from '@playwright/test';
import { webhookUrlToken } from '../support/webhook-token';

/**
 * WEBHOOK (`POST /webhooks/:storeKey/:token`) — the public Unzer receiver behind a CAPABILITY-URL
 * token: Unzer does not sign webhook deliveries (a notification carries only `event`, `publicKey`,
 * `retrieveUrl`, `paymentId`), so authenticity is the secret path segment — a derived MAC over the
 * store key the processor verifies constant-time, fail-closed, BEFORE any CT or vendor call
 * (`support/webhook-token.ts` replicates the derivation). Wrong/absent token → 401
 * `{ outcome: 'unauthorized' }`; the tokenless two-segment path is not a route at all → 404.
 *
 * The fail-closed NEGATIVES are deterministic and run against the local stack with no vendor
 * account. The VALID-TOKEN positive derives the real token from the processor's ENCRYPTION_KEY (the
 * e2e `.env` must carry the same value) and posts an account-level notification — an event WITHOUT
 * a `paymentId`. That shape is chosen deliberately: a payment notification makes the processor read
 * the authoritative payment from Unzer (`getPayment`), so a fabricated `paymentId` would 5xx, while
 * the account-level event resolves to a benign 200 `{ outcome: 'ignored' }` with no vendor read —
 * proving the gate admits the valid token without a full payment fixture. The deeper PROCESSED
 * lifecycle reconciles by the `paymentReference` a real charge stamped, so it has no automated leg at
 * all - it is declared `fixme` and exercised manually via the console's webhook self-post case.
 */

const PROCESSOR_URL = process.env.PROCESSOR_URL || 'http://localhost:8080';
// The store key in the POST path: the CT project key for a default single-store stack.
const STORE_KEY = process.env.E2E_STORE_KEY || process.env.CTP_PROJECT_KEY || '';
// The processor's ENCRYPTION_KEY — the token-derivation input; the valid-token legs skip without it.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

/**
 * A minimal Unzer webhook envelope (the shape `providers/psp/webhook/webhook.handler.ts` parses).
 * `retrieveUrl` names the LEG that settled, as a real delivery does — the processor reads the operation
 * identity off that leg on the payment it fetches, so only a charge id the payment actually carries
 * reconciles under its own identity. The negatives below never reach the parse (401/404 first), so the
 * charge id is optional there.
 */
const unzerEnvelope = (paymentId: string, chargeId?: string): string =>
  JSON.stringify({
    event: 'charge.succeeded',
    publicKey: process.env.UNZER_SANDBOX_PUBLIC_KEY ?? 's-pub-e2e-placeholder',
    paymentId,
    retrieveUrl: `https://sbx-api.unzer.com/v1/payments/${paymentId}${chargeId ? `/charges/${chargeId}` : ''}`,
  });

test.describe('webhook receiver — fail-closed negatives (stack-only)', () => {
  test.skip(!STORE_KEY, 'set E2E_STORE_KEY (or CTP_PROJECT_KEY) in e2e/.env — the webhook POST path needs the store key');

  test('wrong token → uniform 401 unauthorized; tokenless path → 404', async ({ request }) => {
    const payload = unzerEnvelope('s-pay-not-a-real-payment');

    // A wrong token of the REAL length (43 base64url chars) → only the constant-time content
    // compare rejects it → 401, never a body-detail leak, before any CT or vendor call.
    const wrongToken = 'x'.repeat(43);
    const badToken = await request.post(`${PROCESSOR_URL}/webhooks/${STORE_KEY}/${wrongToken}`, {
      headers: { 'content-type': 'application/json' },
      data: payload,
    });
    expect(badToken.status()).toBe(401);
    expect(await badToken.json()).toEqual({ outcome: 'unauthorized' });

    // The tokenless two-segment path is NOT a route (the token is a path segment, not a header) → 404.
    const tokenless = await request.post(`${PROCESSOR_URL}/webhooks/${STORE_KEY}`, {
      headers: { 'content-type': 'application/json' },
      data: payload,
    });
    expect(tokenless.status()).toBe(404);
  });
});

test.describe('webhook receiver — valid token admits (stack-only)', () => {
  test.skip(!STORE_KEY, 'set E2E_STORE_KEY (or CTP_PROJECT_KEY) in e2e/.env — the webhook POST path needs the store key');
  test.skip(
    !ENCRYPTION_KEY,
    'set ENCRYPTION_KEY in e2e/.env — the SAME value the processor stack was started with; the token derives from it',
  );

  test('derived token + account-level event → 200 ignored (gate passed, no vendor read)', async ({ request }) => {
    const token = webhookUrlToken(ENCRYPTION_KEY, STORE_KEY);

    // An account-level notification: no `paymentId`, an event name outside the settlement table. The
    // processor parses it to a bare envelope WITHOUT a vendor read and answers a benign 200 no-op —
    // the 200 (vs the negatives' 401) is what proves the derived token passed the gate.
    const probe = await request.post(`${PROCESSOR_URL}/webhooks/${STORE_KEY}/${token}`, {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ event: 'e2e.token-probe', publicKey: 's-pub-e2e-placeholder' }),
    });
    expect(
      probe.status(),
      "a 401 here means the e2e ENCRYPTION_KEY differs from the processor's: the token derives from that key " +
        'and the store key ALONE, so whether the store is connected to a vendor account cannot cause it',
    ).toBe(200);
    expect(await probe.json()).toEqual({ outcome: 'ignored' });
  });
});

test.describe('webhook self-post lifecycle (Unzer sandbox)', () => {
  // NOT IMPLEMENTED as an automated leg, and declared `fixme` so it can never report a pass: the
  // assertions need a payment charged through a real Unzer sandbox account (the processor re-reads the
  // authoritative state from Unzer, so a fabricated paymentId cannot stand in), plus the same
  // ENCRYPTION_KEY the stack was started with to mint the store's capability URL. It is exercised
  // manually via the console's webhook self-post case: charge through the
  // enabler.card leg, read the Unzer paymentId AND the settling charge id (`transactions[].url` on
  // `GET /v1/payments/{id}`), self-post `unzerEnvelope(paymentId, chargeId)` to
  // `/webhooks/${STORE_KEY}/${webhookUrlToken(ENCRYPTION_KEY, STORE_KEY)}`, and assert
  // 200 { outcome: 'processed' }, then 200 { outcome: 'duplicate' } on the identical repost, and the
  // reflected Charge on the CT Payment. That manual run is what pins the open sandbox risks — that
  // `GET /v1/webhooks` shows exactly the subscribed names, and above all the cancellation naming for
  // refund (`charge.canceled`) vs void (`authorize.canceled`).
  test.fixme('Unzer webhook for a real charge → processed, identical repost → duplicate', async () => {
    throw new Error('no automated Unzer-charged payment to self-post');
  });
});
