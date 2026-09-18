/** A currency-keyed amount bag: `{ <ISO-4217>: <minor units> }`. An absent currency means no limit / no surcharge. */
export type CurrencyAmounts = Record<string, number>;
