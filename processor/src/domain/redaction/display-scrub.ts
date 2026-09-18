/** The shortest PAN a card scheme issues; a string with at least this many digits is treated as one. */
const PAN_MIN_DIGITS = 12;

const VISIBLE_DIGITS = 4;

/** A UUID is never a PAN: the connector's own payment ids would otherwise be masked. Matched on shape, not length. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mask every digit but the last four of a string carrying a PAN-sized digit count; anything shorter passes through. */
export function scrubDisplayString(value: string): string {
  if (UUID_SHAPE.test(value)) {
    return value;
  }
  const digitCount = value.replace(/\P{Nd}/gu, '').length;
  if (digitCount < PAN_MIN_DIGITS) {
    return value;
  }
  const keepFrom = digitCount - VISIBLE_DIGITS;
  let seen = 0;
  return value.replace(/\p{Nd}/gu, (digit) => {
    const masked = seen >= keepFrom ? digit : '*';
    seen += 1;
    return masked;
  });
}
