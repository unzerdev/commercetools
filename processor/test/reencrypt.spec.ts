import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { getBrand } from '../src/infrastructure/config/brand';
import { currentKeyId, decrypt, encrypt, keyIdOf } from '../src/infrastructure/crypto/crypto';
import { reencryptStoreConfigs } from '../src/infrastructure/connectors/reencrypt';
import type { StoredStoreConfig } from '../src/domain';

// Two distinct 64-hex keys, used verbatim as 32 raw key bytes (see config/crypto): CURRENT encrypts,
// PREVIOUS is the rotation fallback. A third ORPHAN key models ciphertext no configured key can open.
const CURRENT = 'a'.repeat(64);
const PREVIOUS = 'b'.repeat(64);
const ORPHAN = 'c'.repeat(64);

/**
 * Encrypt `plaintext` under an ARBITRARY key by installing it as the current key for the call only —
 * how an old-key (or orphan-key) ciphertext fixture is built without a second crypto module.
 */
function encWith(key: string, plaintext: string): string {
  const savedCur = process.env.ENCRYPTION_KEY;
  const savedPrev = process.env.ENCRYPTION_KEY_PREVIOUS;
  process.env.ENCRYPTION_KEY = key;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  try {
    return encrypt(plaintext);
  } finally {
    process.env.ENCRYPTION_KEY = savedCur;
    if (savedPrev === undefined) {
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    } else {
      process.env.ENCRYPTION_KEY_PREVIOUS = savedPrev;
    }
  }
}

/**
 * Mock the raw commercetools apiRoot custom-object builder chain the re-encryption drives:
 *   client.customObjects().withContainer({ container }).get({ queryArgs }).execute()   (list-by-container)
 *   client.customObjects().post({ body }).execute()                                    (CAS write-back)
 * capturing the listed container(s), each page's queryArgs and every POST body while letting each test
 * drive `execute`.
 */
interface Captured {
  listedContainers: string[];
  listQueryArgs: Array<{ limit?: number; offset?: number } | undefined>;
  posts: Array<{ container: string; key: string; value: StoredStoreConfig; version?: number }>;
  listExecute: jest.Mock<() => Promise<unknown>>;
  postExecute: jest.Mock<() => Promise<unknown>>;
}

function mockCustomObjects(): Captured {
  const captured: Captured = {
    listedContainers: [],
    listQueryArgs: [],
    posts: [],
    listExecute: jest.fn<() => Promise<unknown>>(),
    postExecute: jest.fn<() => Promise<unknown>>(),
  };
  const builder = {
    withContainer: (args: { container: string }) => {
      captured.listedContainers.push(args.container);
      return {
        get: (methodArgs?: { queryArgs?: { limit?: number; offset?: number } }) => {
          captured.listQueryArgs.push(methodArgs?.queryArgs);
          return { execute: captured.listExecute };
        },
      };
    },
    post: (args: { body: Captured['posts'][number] }) => {
      captured.posts.push(args.body);
      return { execute: captured.postExecute };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'customObjects').mockReturnValue(builder as never);
  return captured;
}

/** A single-page list response for the given custom objects. */
const listPage = (objects: Array<{ key: string; value: StoredStoreConfig; version: number }>) => ({
  body: { limit: 500, offset: 0, count: objects.length, total: objects.length, results: objects },
});

/** Echo the just-posted (encrypted-at-rest) value back with a bumped version, like commercetools. */
const echoPost = (captured: Captured, version: number): void => {
  captured.postExecute.mockImplementation(async () => ({
    body: { version, value: captured.posts[captured.posts.length - 1].value },
  }));
};

/** An object whose every secret leaf is sealed under the PREVIOUS key — a rotation left it behind. */
const objectUnderPreviousKey = (): StoredStoreConfig => ({
  mode: 'sandbox',
  environments: {
    sandbox: {
      credentials: {
        publicKey: encWith(PREVIOUS, 's-pub-abc'),
        privateKey: encWith(PREVIOUS, 's-priv-xyz'),
      },
    },
  },
});

describe('config/reencrypt — automatic post-deploy re-encryption', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalPrev = process.env.ENCRYPTION_KEY_PREVIOUS;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CURRENT;
    process.env.ENCRYPTION_KEY_PREVIOUS = PREVIOUS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalPrev === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = originalPrev;
  });

  it('(a) re-encrypts an object whose leaves are under the previous key, landing them under the current key', async () => {
    const captured = mockCustomObjects();
    captured.listExecute.mockResolvedValue(listPage([{ key: 'store-a', value: objectUnderPreviousKey(), version: 7 }]));
    echoPost(captured, 8);

    await reencryptStoreConfigs();

    // Listed the connection container only.
    expect(captured.listedContainers).toEqual([getBrand().customObjectContainer]);
    expect(captured.posts).toHaveLength(1);

    const post = captured.posts[0];
    expect(post.key).toBe('store-a');
    expect(post.container).toBe(getBrand().customObjectContainer);
    expect(post.version).toBe(7); // CAS at the version the list returned

    const env = post.value.environments!.sandbox!;
    // Every leaf now sealed under the CURRENT key-id...
    expect(keyIdOf(env.credentials!.publicKey)).toBe(currentKeyId());
    expect(keyIdOf(env.credentials!.privateKey)).toBe(currentKeyId());
    // ...and still decrypts to the original plaintext (no data lost in the re-wrap).
    expect(decrypt(env.credentials!.publicKey)).toBe('s-pub-abc');
    expect(decrypt(env.credentials!.privateKey)).toBe('s-priv-xyz');
  });

  it('(b) writes nothing when every leaf is already under the current key (idempotent second run)', async () => {
    const captured = mockCustomObjects();
    const alreadyCurrent: StoredStoreConfig = {
      mode: 'live',
      environments: {
        live: {
          credentials: {
            publicKey: encWith(CURRENT, 'p-pub-1'),
            privateKey: encWith(CURRENT, 'p-priv-2'),
          },
        },
      },
    };
    captured.listExecute.mockResolvedValue(listPage([{ key: 'store-b', value: alreadyCurrent, version: 3 }]));

    await reencryptStoreConfigs();

    expect(captured.posts).toHaveLength(0);
  });

  it('(c) does nothing — no list, no write — when no previous key is configured', async () => {
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    const captured = mockCustomObjects();

    await reencryptStoreConfigs();

    expect(captured.listedContainers).toHaveLength(0);
    expect(captured.posts).toHaveLength(0);
  });

  it('(d) handles multiple store objects independently — rewrites only the ones under an old key', async () => {
    const captured = mockCustomObjects();
    const stale = objectUnderPreviousKey();
    const fresh: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: { publicKey: encWith(CURRENT, 's-pub-fresh') } } },
    };
    captured.listExecute.mockResolvedValue(
      listPage([
        { key: 'store-stale', value: stale, version: 1 },
        { key: 'store-fresh', value: fresh, version: 2 },
      ]),
    );
    echoPost(captured, 99);

    await reencryptStoreConfigs();

    // Only the stale object is rewritten; the already-current one is skipped.
    expect(captured.posts.map((p) => p.key)).toEqual(['store-stale']);
    expect(captured.posts[0].version).toBe(1);
  });

  it('(e) throws (failing the deploy) when a leaf cannot be decrypted by any configured key', async () => {
    const captured = mockCustomObjects();
    const orphaned: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: { publicKey: encWith(ORPHAN, 'secret') } } },
    };
    captured.listExecute.mockResolvedValue(listPage([{ key: 'store-x', value: orphaned, version: 1 }]));

    await expect(reencryptStoreConfigs()).rejects.toThrow(/decrypt/i);
    // Nothing persisted — an unreadable secret is never written back.
    expect(captured.posts).toHaveLength(0);
  });
});
