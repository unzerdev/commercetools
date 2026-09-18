import type { StoreEnvironmentBlock } from './store-environment-block';

/** The wire view of an environment block: everything but the server-owned subscription ids. */
export type StoreConfigEnvironmentView = Omit<StoreEnvironmentBlock, 'webhookIds'>;
