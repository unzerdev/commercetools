import type { SecretScope, SecretTransform, StoredStoreConfig, StoreEnvironmentBlock } from '../contracts';

/** The named secret fields of an environment block; every `credentials` value is secret too. */
const SECRET_FIELDS = ['webhookSecret'] as const;

function mapEnvironmentSecrets(
  env: StoreEnvironmentBlock,
  transform: SecretTransform,
  prev: StoreEnvironmentBlock | undefined,
  scope: SecretScope,
): StoreEnvironmentBlock {
  const out: StoreEnvironmentBlock = { ...env };

  if (env.credentials && scope.credentials !== false) {
    out.credentials = Object.fromEntries(
      Object.entries(env.credentials).flatMap(([key, value]) => {
        if (typeof value !== 'string') {
          return [[key, value]];
        }
        const next = transform(value, prev?.credentials?.[key]);
        return next === undefined ? [] : [[key, next]];
      }),
    );
  }

  for (const field of SECRET_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') {
      const next = transform(value, prev?.[field]);
      if (next === undefined) {
        delete out[field];
      } else {
        out[field] = next;
      }
    }
  }

  return out;
}

/**
 * The one walk over every secret leaf of a stored config, shared by encryption at rest, redaction and
 * masked write-back so their secret topology cannot drift. Never mutates the input.
 */
export function mapStoredSecrets(
  value: StoredStoreConfig,
  transform: SecretTransform,
  previous?: StoredStoreConfig | null,
  scope: SecretScope = {},
): StoredStoreConfig {
  if (!value.environments) {
    return value;
  }

  const prevEnvs = previous?.environments;
  const { sandbox, live } = value.environments;
  return {
    ...value,
    environments: {
      ...(sandbox ? { sandbox: mapEnvironmentSecrets(sandbox, transform, prevEnvs?.sandbox, scope) } : {}),
      ...(live ? { live: mapEnvironmentSecrets(live, transform, prevEnvs?.live, scope) } : {}),
    },
  };
}
