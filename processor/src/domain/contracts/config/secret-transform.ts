/** A secret-leaf transform: the new value, or `undefined` to drop the leaf. `previous` is the same leaf in a prior config. */
export type SecretTransform = (value: string, previous: string | undefined) => string | undefined;
