import { paymentSDK } from '../bootstrap/payment-sdk';
import { isNotFound } from './errors';

export type CustomObjectRecord<T = unknown> = { key: string; value: T; version: number };

export type FindCustomObjectArgs = { container: string; key: string };
export type SaveCustomObjectArgs<T> = { container: string; key: string; value: T; version?: number };
export type RemoveCustomObjectArgs = { container: string; key: string; version?: number };
export type QueryCustomObjectsArgs = {
  container: string;
  /** A commercetools predicate; values travel in `vars` as `var.<name>`, never string-built. */
  where?: string;
  vars?: Record<string, string | string[]>;
  limit?: number;
  offset?: number;
};

/** One object, or `null` on a 404. */
async function find<T>({ container, key }: FindCustomObjectArgs): Promise<CustomObjectRecord<T> | null> {
  try {
    const { body } = await paymentSDK.ctAPI.client
      .customObjects()
      .withContainerAndKey({ container, key })
      .get()
      .execute();
    return { key: body.key, value: body.value as T, version: body.version };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function query<T>({
  container,
  where,
  vars,
  limit,
  offset,
}: QueryCustomObjectsArgs): Promise<CustomObjectRecord<T>[]> {
  const { body } = await paymentSDK.ctAPI.client
    .customObjects()
    .withContainer({ container })
    .get({
      queryArgs: {
        ...(where !== undefined ? { where } : {}),
        ...(vars ?? {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
        withTotal: false,
      },
    })
    .execute();

  return body.results.map((result) => ({ key: result.key, value: result.value as T, version: result.version }));
}

/** Create or update; a stale `version` (or `0` against an existing object) raises the 409 the caller decides on. */
async function save<T>({ container, key, value, version }: SaveCustomObjectArgs<T>): Promise<CustomObjectRecord<T>> {
  const { body } = await paymentSDK.ctAPI.client
    .customObjects()
    .post({ body: { container, key, value, ...(version !== undefined ? { version } : {}) } })
    .execute();

  return { key: body.key, value: body.value as T, version: body.version };
}

/** Idempotent delete: a missing object is tolerated. */
async function remove({ container, key, version }: RemoveCustomObjectArgs): Promise<void> {
  try {
    await paymentSDK.ctAPI.client
      .customObjects()
      .withContainerAndKey({ container, key })
      .delete(version !== undefined ? { queryArgs: { version } } : {})
      .execute();
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
}

export const customObjects = { find, query, save, remove };
