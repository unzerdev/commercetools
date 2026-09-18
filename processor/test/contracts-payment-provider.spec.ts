/**
 * The PSP-agnostic single-payment read contract: `ProviderPaymentDetails` + the MANDATORY
 * `IntrospectionService.paymentDetails`. Any provider must be able to answer "give me this payment's
 * details", so the method is required (not optional) and the shape it returns is neutral — a vendor
 * payload never crosses into the core.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderPaymentDetails } from '../src/domain';
import { pspManifest } from '../src/providers/psp';
import { makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

/** The files that DECLARE the contract — the boundary the vendor name must never cross. */
const CONTRACT_SOURCES = [
  'src/domain/contracts/provider/provider-payment-details.ts',
  'src/domain/contracts/provider/provider-operation.ts',
  'src/domain/contracts/provider/payment-details-amounts.ts',
  'src/application/handlers/read/introspection-service.ts',
  'src/application/handlers/payment/modification-handler.ts',
];

async function readDetails(): Promise<ProviderPaymentDetails> {
  const provider = makeFakeProviderModule();
  const cfg = await makeFakePorts().configResolver.resolve('store-1');
  return provider.introspection.paymentDetails(cfg, 'vendor-pay-1');
}

describe('ProviderPaymentDetails — the neutral single-payment read', () => {
  it('is answered by every provider module (mandatory, not optional)', async () => {
    const provider = makeFakeProviderModule();

    expect(typeof provider.introspection.paymentDetails).toBe('function');
    expect(typeof (await readDetails()).displayStatus).toBe('string');
  });

  it('carries the display-only order reference and amount book under neutral names', async () => {
    const details = await readDetails();

    expect(details.orderId).toEqual(expect.any(String));
    expect(details.amounts).toEqual({
      total: { centAmount: expect.any(Number), currencyCode: expect.any(String) },
      charged: { centAmount: expect.any(Number), currencyCode: expect.any(String) },
    });
  });

  // The reconciliation half of the write-ahead reservation: the provider reports the operations it holds,
  // each under the vendor's OWN id — the one key a standing leg is matched by, since a payment read carries
  // no merchant reference. A payment with no operations reports an empty list, never nothing.
  it('carries the provider’s operation list, keyed by the vendor’s own operation id', async () => {
    const details = await readDetails();

    expect(Array.isArray(details.operations)).toBe(true);
    expect(details.operations[0]).toEqual({
      id: expect.any(String),
      type: expect.any(String),
      date: expect.any(String),
      outcome: expect.any(String),
      amount: { centAmount: expect.any(Number), currencyCode: expect.any(String) },
      rawStatus: expect.any(Object),
    });
  });

  it('names no vendor in the sources that declare it', () => {
    // The forbidden word is read from the active manifest, so the guard holds for any brand this
    // base is distributed as — and the assertion itself carries no brand literal.
    const vendor = pspManifest.brandDefaults.displayName.toLowerCase();

    CONTRACT_SOURCES.forEach((source) => {
      const declaration = readFileSync(path.join(process.cwd(), source), 'utf8');

      expect(declaration.toLowerCase()).not.toContain(vendor);
    });
  });
});
