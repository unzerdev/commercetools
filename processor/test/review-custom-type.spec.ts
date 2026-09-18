/**
 * The PSP-agnostic payment-review field. It is a FIELD DEFINITION, not a type of its own: a CT Payment
 * carries exactly one custom type, so the review flag is unioned into the provider's payment type at
 * post-deploy rather than registered beside it.
 */
import { describe, expect, it } from '@jest/globals';
import type { CustomFieldDefinition } from '../src/domain';
import { PAYMENT_REVIEW_FIELD_NAME, reviewFieldDefinition } from '../src/domain';
import { pspManifest } from '../src/providers/psp';

describe('PSP-agnostic payment-review field definition', () => {
  it('is the boolean field the IN_REVIEW mapping writes', () => {
    const definition: CustomFieldDefinition = reviewFieldDefinition;

    expect(definition.name).toBe(PAYMENT_REVIEW_FIELD_NAME);
    expect(definition.type.name).toBe('Boolean');
    expect(definition.required).toBe(false);
    expect(Object.keys(definition.label).length).toBeGreaterThan(0);
  });

  it('is brand-agnostic (no vendor name in the field name)', () => {
    expect(reviewFieldDefinition.name.toLowerCase()).not.toContain(pspManifest.brandDefaults.displayName.toLowerCase());
  });
});
