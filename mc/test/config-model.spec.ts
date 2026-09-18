import {
  configToForm,
  environmentConnected,
  formToConfig,
} from '../src/components/config-app/config-model';
import { REDACTED_SECRET } from '../src/types/config';
import type { StoreConfigDto } from '../src/types/config';

const fullConfig = (): StoreConfigDto => ({
  mode: 'live',
  environments: {
    sandbox: {
      credentials: { publicKey: 's-pub-abc', privateKey: REDACTED_SECRET },
    },
    live: {
      credentials: { publicKey: 'p-pub-xyz', privateKey: REDACTED_SECRET },
    },
  },
});

describe('configToForm', () => {
  it('yields a full default form for an unconfigured store ({})', () => {
    const form = configToForm({});
    expect(form.mode).toBe('sandbox');
    expect(form.environments.sandbox).toEqual({
      publicKey: '',
      privateKey: '',
    });
    expect(form.environments.live).toEqual({ publicKey: '', privateKey: '' });
  });

  it('reads the active mode and both environments’ keys', () => {
    const form = configToForm(fullConfig());
    expect(form.mode).toBe('live');
    expect(form.environments.sandbox.publicKey).toBe('s-pub-abc');
    expect(form.environments.live.publicKey).toBe('p-pub-xyz');
  });

  it('carries the secret sentinel through unchanged', () => {
    const form = configToForm(fullConfig());
    expect(form.environments.sandbox.privateKey).toBe(REDACTED_SECRET);
    expect(form.environments.live.privateKey).toBe(REDACTED_SECRET);
  });

  it('hydrates a missing key leaf to an empty string so the form always round-trips', () => {
    const form = configToForm({
      environments: { sandbox: { credentials: { publicKey: 's-pub-1' } } },
    });
    expect(form.environments.sandbox).toEqual({
      publicKey: 's-pub-1',
      privateKey: '',
    });
    expect(form.environments.live).toEqual({ publicKey: '', privateKey: '' });
  });
});

describe('formToConfig', () => {
  it('preserves an unchanged secret (still the sentinel) so the processor keeps the stored value', () => {
    const out = formToConfig(configToForm(fullConfig()));
    expect(out.environments?.sandbox?.credentials?.privateKey).toBe(
      REDACTED_SECRET
    );
    expect(out.environments?.live?.credentials?.privateKey).toBe(
      REDACTED_SECRET
    );
  });

  it('overwrites a changed secret with the new value', () => {
    const form = configToForm(fullConfig());
    form.environments.sandbox.privateKey = 's-priv-new';
    const out = formToConfig(form);
    expect(out.environments?.sandbox?.credentials?.privateKey).toBe(
      's-priv-new'
    );
  });

  it('omits an environment’s credentials bag when both keys are empty', () => {
    const out = formToConfig(configToForm({}));
    expect(out.environments?.sandbox?.credentials).toBeUndefined();
    expect(out.environments?.live?.credentials).toBeUndefined();
  });

  it('round-trips the active mode and keys', () => {
    const out = formToConfig(configToForm(fullConfig()));
    expect(out.mode).toBe('live');
    expect(out.environments?.sandbox?.credentials?.publicKey).toBe('s-pub-abc');
    expect(out.environments?.live?.credentials?.publicKey).toBe('p-pub-xyz');
  });
});

describe('environmentConnected', () => {
  it('is true when both keys are present (a masked sentinel counts)', () => {
    expect(
      environmentConnected({
        credentials: { publicKey: 's-pub-1', privateKey: REDACTED_SECRET },
      })
    ).toBe(true);
  });

  it('is false when a key is missing', () => {
    expect(
      environmentConnected({ credentials: { publicKey: 's-pub-1' } })
    ).toBe(false);
    expect(environmentConnected(undefined)).toBe(false);
    expect(environmentConnected({})).toBe(false);
  });
});
