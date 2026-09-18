import type { StoreSummary } from '../../domain';
import type { ProjectReference, ProjectStoreReader, StoreReference } from '../../application/ports';
import { ctClient } from '../commercetools';

/** `ProjectStoreReader` over `ctClient.stores`, lifting the resources to plain ISO-code arrays. */
export class ProjectStoreReaderAdapter implements ProjectStoreReader {
  public async readStore(storeKey: string): Promise<StoreReference> {
    const store = await ctClient.stores.get({ key: storeKey });
    return {
      languages: store.languages,
      countries: store.countries.map((country) => country.code),
    };
  }

  public async storeExists(storeKey: string): Promise<boolean> {
    return (await ctClient.stores.find({ key: storeKey })) !== null;
  }

  public async readProjectSettings(): Promise<ProjectReference> {
    const project = await ctClient.stores.projectSettings();
    return {
      languages: project.languages,
      currencies: project.currencies,
      countries: project.countries,
    };
  }

  public async listStores(): Promise<StoreSummary[]> {
    const stores = await ctClient.stores.list();
    return stores.map((store) => {
      const localizedName = store.name ? Object.values(store.name).find((value) => value.length > 0) : undefined;
      return { key: store.key, name: localizedName ?? store.key };
    });
  }
}
