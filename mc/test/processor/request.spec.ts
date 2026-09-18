import {
  STORE_KEY_FORWARD_HEADER,
  operationUri,
  storeKeyForwardHeaders,
} from '../../src/processor/request';

describe('operationUri', () => {
  it('builds the processor operations URL from the external API base', () => {
    expect(operationUri('https://proc.example', 'store-config')).toBe(
      'https://proc.example/operations/store-config'
    );
  });
});

describe('storeKeyForwardHeaders', () => {
  it('emits the prefixed forward header when a store is selected', () => {
    expect(storeKeyForwardHeaders('eu-store')).toEqual({
      [STORE_KEY_FORWARD_HEADER]: 'eu-store',
    });
    expect(STORE_KEY_FORWARD_HEADER).toBe('x-store-key');
  });

  it('emits no header when no store is in scope (connector-wide reads omit it)', () => {
    expect(storeKeyForwardHeaders(undefined)).toEqual({});
  });
});
