import type { PaymentStateDeclaration } from '../../domain';
import { paymentSDK } from '../bootstrap/payment-sdk';
import { isNotFound } from './errors';

export type StateOutcome = 'created' | 'adopted';

async function readState(key: string): Promise<{ type: string } | undefined> {
  try {
    const response = await paymentSDK.ctAPI.client.states().withKey({ key }).get().execute();
    return { type: response.body.type };
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Create the state, adopt an existing `PaymentState` under the key, refuse a key held by a state of another type. */
export async function ensurePaymentState(declaration: PaymentStateDeclaration): Promise<StateOutcome> {
  const existing = await readState(declaration.key);
  if (existing === undefined) {
    await paymentSDK.ctAPI.client
      .states()
      .post({
        body: {
          key: declaration.key,
          type: declaration.type,
          name: declaration.name,
          ...(declaration.initial ? { initial: true } : {}),
        },
      })
      .execute();
    return 'created';
  }

  if (existing.type !== declaration.type) {
    throw new Error(
      `commercetools State '${declaration.key}' exists with type '${existing.type}', but the connector needs ` +
        `'${declaration.type}' for the payment state it writes. Rename or remove that state, or the payment ` +
        `state cannot be recorded.`,
    );
  }
  return 'adopted';
}

/** Whether a State is registered under the key; any other failure propagates. */
export async function stateExists(key: string): Promise<boolean> {
  return (await readState(key)) !== undefined;
}

export const states = { ensurePaymentState, stateExists };
