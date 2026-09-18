/** The reserved store key of the merchant-authored default configuration layer; never a commercetools store. */
export const DEFAULT_SCOPE_STORE_KEY = '__default__';

/** Whether a store key names the default configuration layer rather than a store. */
export const isDefaultScope = (storeKey: string | undefined): boolean => storeKey === DEFAULT_SCOPE_STORE_KEY;
