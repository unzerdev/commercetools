import type { PaymentState, ProviderStatusCode } from '../../../domain';
import { paymentStatusState } from '../../../domain';
import type { CorePorts, Payment } from '../../ports';
import type { OrchestrationEnv } from './env';

/**
 * Write what the Merchant Center reads besides the transactions: the vendor's code and text, and the
 * payment state. Always the last write of a path and never throws into it; a failure is logged.
 */
export async function writePaymentStatus(
  payment: Payment,
  state: PaymentState,
  statusCode: ProviderStatusCode | undefined,
  env: OrchestrationEnv,
  ports: CorePorts,
): Promise<void> {
  const stateKey = paymentStatusState(state, payment.transactions);
  const status = {
    ...(statusCode ? { interfaceCode: statusCode.code } : {}),
    ...(statusCode?.text ? { interfaceText: statusCode.text } : {}),
    ...(stateKey ? { stateKey } : {}),
  };
  if (Object.keys(status).length === 0) {
    return;
  }

  try {
    await ports.paymentStore.setStatus(payment.id, status);
  } catch (error) {
    env.logger.warn('The payment status could not be written; the transactions are unaffected', {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
