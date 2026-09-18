import type { StoreConfigEnvironmentView } from './store-config-environment-view';
import type { StoredStoreConfig } from './stored-store-config';

/** The store-config document the merchant surface reads and writes; a response carries `webhookSecret` masked. */
export type StoreConfigView = Omit<StoredStoreConfig, 'environments'> & {
  environments?: { sandbox?: StoreConfigEnvironmentView; live?: StoreConfigEnvironmentView };
};
