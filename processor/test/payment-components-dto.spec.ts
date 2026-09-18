import { describe, expect, it } from '@jest/globals';
import { Value } from '@sinclair/typebox/value';
import { SupportedPaymentComponentsSchema } from '../src/infrastructure/http/dtos/mc/payment-components.dto';
import { toSupportedComponentsWire } from '../src/infrastructure/http/mappers/operation.mappers';
import { PspIntrospectionService } from '../src/providers/psp/introspection/introspection.service';

/**
 * The `payment-components` wire schema narrows the drop-in type to the three literals the enabler's
 * `DropinType` enum carries. The mapper only casts, so a drop-in the provider advertises outside that set
 * would fail response serialization at runtime with nothing else in the codebase pointing at it. This pins
 * that the provider's advertisement is serializable, and that both apps agree on the same three literals -
 * each side pins them against its own contract rather than importing the other's.
 */
describe('payment-components wire schema', () => {
  const service = new PspIntrospectionService({} as never);

  it('accepts what the provider advertises', () => {
    const wire = toSupportedComponentsWire({
      dropins: service.supportedDropins(),
      components: service.supportedComponents(),
      express: [],
    });

    expect(Value.Check(SupportedPaymentComponentsSchema, wire)).toBe(true);
    expect(wire.dropins).toEqual([{ type: 'embedded' }]);
    expect(wire.components).toEqual([{ type: 'unzer' }]);
  });

  it('refuses a drop-in type outside the enabler contract', () => {
    const wire = toSupportedComponentsWire({ dropins: [{ type: 'unzer' }], components: [], express: [] });

    expect(Value.Check(SupportedPaymentComponentsSchema, wire)).toBe(false);
  });

  it('narrows the drop-in type to exactly embedded, hpp and hpp-preselected', () => {
    for (const type of ['embedded', 'hpp', 'hpp-preselected']) {
      expect(Value.Check(SupportedPaymentComponentsSchema, { dropins: [{ type }], components: [], express: [] })).toBe(
        true,
      );
    }
    expect(
      Value.Check(SupportedPaymentComponentsSchema, { dropins: [{ type: 'card' }], components: [], express: [] }),
    ).toBe(false);
  });
});
