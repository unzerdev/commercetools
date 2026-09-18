import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { ProvisioningAdapter } from '../src/infrastructure/adapters/provisioning.adapter';
import { ownsPaymentField, unifiedPaymentType } from '../src/application/orchestration';
import { log } from '../src/infrastructure/bootstrap/libs/logger';
import { reviewFieldDefinition } from '../src/domain';
import type { ProviderModule } from '../src/application/handlers';

describe('provisioning — custom-type provisioning', () => {
  const providerType = {
    key: 'psp-payment',
    name: { en: 'PSP Payment' },
    resourceTypeIds: ['payment'],
    fieldDefinitions: [
      { name: 'pspPaymentId', label: { en: 'Payment id' }, required: false, type: { name: 'String' } },
      {
        name: 'aHintedField',
        label: { en: 'Hinted' },
        required: true,
        type: { name: 'String' },
        inputHint: 'SingleLine',
      },
    ],
  };

  const provider = { key: 'psp', paymentCustomType: providerType } as unknown as ProviderModule;

  /** The one provisioning call under test: the unified declaration and the connector's ownership rule. */
  const ensurePaymentType = (): Promise<void> =>
    new ProvisioningAdapter().ensurePaymentType(unifiedPaymentType(provider), (fieldName) =>
      ownsPaymentField(provider.key, fieldName),
    );

  /** The raw `types()` chain the prune step reads the registered type through. */
  interface CapturedTypes {
    postBody?: { version: number; actions: { action: string; fieldName?: string }[] };
    postExecute: jest.Mock<() => Promise<unknown>>;
  }

  /** The registered type as commercetools holds it — `names` is what it carries TODAY. */
  function mockRegisteredType(names: string[]): CapturedTypes {
    const captured: CapturedTypes = { postExecute: jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: {} }) };
    const builder = {
      withKey: () => ({
        get: () => ({
          execute: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValue({ body: { version: 3, fieldDefinitions: names.map((name) => ({ name })) } }),
        }),
        post: (post: { body: CapturedTypes['postBody'] }) => {
          captured.postBody = post.body;
          return { execute: captured.postExecute };
        },
      }),
    };
    jest.spyOn(paymentSDK.ctAPI.client, 'types').mockReturnValue(builder as never);
    return captured;
  }

  beforeEach(() => {
    jest.spyOn(paymentSDK.ctCustomTypeService, 'createOrUpdate').mockResolvedValue({ id: 'type-id' } as never);
    // Every provisioning path prunes; the default registered type is already in agreement, so it writes nothing.
    mockRegisteredType(['pspPaymentId', 'aHintedField', reviewFieldDefinition.name]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('ensurePaymentType ensures ONE unified payment type: provider fields UNIONED with the review field', async () => {
    const createOrUpdate = paymentSDK.ctCustomTypeService.createOrUpdate as jest.Mock;

    await ensurePaymentType();

    // A CT Payment's `custom` references exactly one type, so the review flag shares the provider's
    // single registered type instead of a separate `psp-payment-review` type.
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    const draft = createOrUpdate.mock.calls[0]?.[0] as { key: string; fieldDefinitions: Array<{ name: string }> };
    expect(draft.key).toBe(providerType.key);
    const names = draft.fieldDefinitions.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['pspPaymentId', reviewFieldDefinition.name]));
  });

  test('the unified TypeDraft carries field definitions and forwards an inputHint only when present', async () => {
    const createOrUpdate = paymentSDK.ctCustomTypeService.createOrUpdate as jest.Mock;

    await ensurePaymentType();

    const providerDraft = createOrUpdate.mock.calls[0]?.[0] as {
      resourceTypeIds: string[];
      fieldDefinitions: Array<Record<string, unknown>>;
    };
    expect(providerDraft.resourceTypeIds).toEqual(['payment']);
    const plain = providerDraft.fieldDefinitions.find((f) => f.name === 'pspPaymentId');
    const hinted = providerDraft.fieldDefinitions.find((f) => f.name === 'aHintedField');
    expect(plain).not.toHaveProperty('inputHint');
    expect(hinted?.inputHint).toBe('SingleLine');
  });

  /**
   * The declaration is the source of truth in BOTH directions. `createOrUpdate` only ever ADDS, so a
   * field dropped from the declaration keeps standing in the registered type — and keeps rendering as an
   * empty column on the Merchant Center's Payment page — unless the deploy removes it.
   */
  test('ensurePaymentType removes a registered field the declaration no longer carries', async () => {
    const types = mockRegisteredType([
      'pspPaymentId',
      'aHintedField',
      'pspHostedCheckoutId',
      'pspReturnMac',
      reviewFieldDefinition.name,
    ]);

    await ensurePaymentType();

    expect(types.postBody).toEqual({
      version: 3,
      actions: [
        { action: 'removeFieldDefinition', fieldName: 'pspHostedCheckoutId' },
        { action: 'removeFieldDefinition', fieldName: 'pspReturnMac' },
      ],
    });
  });

  /**
   * The prune's declared set must be the UNION the type is registered from: the provider's own
   * fields AND the PSP-agnostic review field share one registered type, so pruning against the provider's
   * half alone would delete `inReview` on every single deploy — silently dropping the flag that marks a
   * payment held for review.
   */
  test('the prune never removes the PSP-agnostic review field it registered alongside', async () => {
    const types = mockRegisteredType(['pspPaymentId', 'aHintedField', reviewFieldDefinition.name]);

    await ensurePaymentType();

    expect(types.postExecute).not.toHaveBeenCalled();
  });

  /**
   * `psp-payment` is a commercetools PROJECT resource: any operator with `manage_types` may add a field to
   * it from the Merchant Center's Settings → Custom types page, and merchants do so to carry their own
   * annotation on a Payment. "Undeclared" therefore does not mean "retired by this connector", and deleting
   * a field the connector never declared destroys its values on every Payment irreversibly.
   */
  test('leaves a merchant-added field in place and warns, while still removing a retired connector field', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    const types = mockRegisteredType([
      'pspPaymentId',
      'aHintedField',
      'pspReturnMac',
      'merchantAnnotation',
      reviewFieldDefinition.name,
    ]);

    await ensurePaymentType();

    expect(types.postBody).toEqual({
      version: 3,
      actions: [{ action: 'removeFieldDefinition', fieldName: 'pspReturnMac' }],
    });
    // Not silently kept: an operator must be able to see the divergence without losing the data.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toMatch(/merchantAnnotation/);
  });
});
