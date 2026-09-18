/**
 * `config/state.repository` — provisioning the commercetools `State`s `paymentStatus.state` references
 *. The SDK offers no service for the resource at all, so this is a raw-client path.
 *
 * The behaviour under test is ADOPT-OR-REFUSE, which is what BARE state keys require: `State` keys are
 * project-global, so `new` or `completed` may already belong to the merchant.
 *
 * Mocks the raw apiRoot `states()` builder chain:
 *   client.states().withKey({ key }).get().execute()   // read the registered state
 *   client.states().post({ body }).execute()           // create it
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { PaymentStateDeclaration } from '../src/domain';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { ensurePaymentState } from '../src/infrastructure/commercetools/states';

interface Captured {
  getExecute: jest.Mock<() => Promise<unknown>>;
  postBody?: Record<string, unknown>;
  postExecute: jest.Mock<() => Promise<unknown>>;
  key?: string;
}

function mockStates(): Captured {
  const captured: Captured = {
    getExecute: jest.fn<() => Promise<unknown>>(),
    postExecute: jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: {} }),
  };
  const builder = {
    withKey: (args: { key: string }) => {
      captured.key = args.key;
      return { get: () => ({ execute: captured.getExecute }) };
    },
    post: (post: { body: Record<string, unknown> }) => {
      captured.postBody = post.body;
      return { execute: captured.postExecute };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'states').mockReturnValue(builder as never);
  return captured;
}

const NOT_FOUND = { statusCode: 404, body: { statusCode: 404 } };

const declaration: PaymentStateDeclaration = {
  key: 'new',
  type: 'PaymentState',
  name: { en: 'New' },
  initial: true,
};

describe('config/state.repository — adopt or refuse a bare state key', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates the state when the key is free, with its name and initial flag', async () => {
    const captured = mockStates();
    captured.getExecute.mockRejectedValue(NOT_FOUND);

    const outcome = await ensurePaymentState(declaration);

    expect(outcome).toBe('created');
    expect(captured.postBody).toEqual({ key: 'new', type: 'PaymentState', name: { en: 'New' }, initial: true });
    // No transition graph is ever written: an unset `transitions` lets commercetools permit every
    // transition, and the connector's lifecycle is not linear.
    expect(captured.postBody).not.toHaveProperty('transitions');
  });

  it('omits the initial flag for the five states that are not the entry point', async () => {
    const captured = mockStates();
    captured.getExecute.mockRejectedValue(NOT_FOUND);

    await ensurePaymentState({ key: 'completed', type: 'PaymentState', name: { en: 'Completed' } });

    expect(captured.postBody).toEqual({ key: 'completed', type: 'PaymentState', name: { en: 'Completed' } });
  });

  /**
   * The merchant's state, adopted as it stands — including their NAME for it. The connector needs the key to
   * exist and nothing more, and renaming it would rewrite a label somebody chose.
   */
  it('adopts an existing PaymentState untouched, writing nothing', async () => {
    const captured = mockStates();
    captured.getExecute.mockResolvedValue({ body: { key: 'new', type: 'PaymentState', name: { en: 'Brand new' } } });

    const outcome = await ensurePaymentState(declaration);

    expect(outcome).toBe('adopted');
    expect(captured.postExecute).not.toHaveBeenCalled();
  });

  /**
   * The failure bare keys make possible, and the reason it must land at DEPLOY time. A Payment accepts a
   * state of type `PaymentState` only, so adopting an `OrderState` under this key would leave every later
   * `transitionState` on a payment refused — one payment at a time, in production.
   */
  it('THROWS when the key is held by a state of another type, naming the key and the type found', async () => {
    const captured = mockStates();
    captured.getExecute.mockResolvedValue({ body: { key: 'new', type: 'OrderState' } });

    await expect(ensurePaymentState(declaration)).rejects.toThrow(/'new'.*'OrderState'.*'PaymentState'/s);
    expect(captured.postExecute).not.toHaveBeenCalled();
  });

  // A 404 is an answer; anything else is a fault and must not be read as "the key is free".
  it('propagates a non-404 read failure rather than creating over it', async () => {
    const captured = mockStates();
    captured.getExecute.mockRejectedValue({ statusCode: 503, body: { statusCode: 503 } });

    await expect(ensurePaymentState(declaration)).rejects.toEqual(expect.objectContaining({ statusCode: 503 }));
    expect(captured.postExecute).not.toHaveBeenCalled();
  });
});
