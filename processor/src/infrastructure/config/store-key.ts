import { getConfig } from './config';

/** The deployment store key: the commercetools project key. The merchant and webhook fallback, never the shopper's. */
export const resolveStoreKey = (): string => getConfig().projectKey;
