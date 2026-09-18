import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ConfigValidationResult } from '../../../domain';

/** This connector has no settings document: the empty strict object, so any field is rejected. */
const PspConfigSchema = Type.Object({}, { additionalProperties: false });

/** An absent settings value is valid; otherwise the value must be the empty object. */
export const validatePspConfig = (input: unknown): ConfigValidationResult => {
  if (input === undefined || input === null) {
    return { valid: true };
  }
  if (!Value.Check(PspConfigSchema, input)) {
    const errors = [...Value.Errors(PspConfigSchema, input)].map((error) => `${error.path}: ${error.message}`);
    return { valid: false, errors };
  }

  return { valid: true };
};
