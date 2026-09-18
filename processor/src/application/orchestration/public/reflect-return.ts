import { ErrorRequiredField } from '@commercetools/connect-payments-sdk';
import { resolveStateEffect } from '../../../domain';
import {
  failureRedirect,
  type OrchestrationDeps,
  recordPaymentOutcome,
  redirectWithStatus,
  resolvePaymentConfig,
  statusForReturn,
} from '../shared';
import type { ReflectReturnCtx } from './reflect-return-ctx';

/**
 * `GET /return`: the provider verifies the return fail-closed and reads the definitive status, which is
 * reflected onto the CT Payment. Every failure lands on the one safe failure redirect.
 */
export async function reflectReturn(ctx: ReflectReturnCtx, deps: OrchestrationDeps): Promise<{ redirectUrl: string }> {
  const { env } = ctx;
  const { ports, provider } = deps;

  const ctPaymentId = ctx.query.ctPaymentId;
  if (!ctPaymentId) {
    throw new ErrorRequiredField('ctPaymentId');
  }

  try {
    const payment = await ports.paymentStore.get(ctPaymentId);
    const cfg = await resolvePaymentConfig(payment, ports.configResolver);
    const returnCtx = provider.returnLeg.readContext((payment.custom?.fields ?? {}) as Record<string, unknown>);

    const result = await provider.returnLeg.resolve(cfg, {
      query: ctx.query,
      context: returnCtx.providerContext,
    });

    const state = provider.mapProviderStatus(result.rawStatus);
    const effect = resolveStateEffect(state);

    await recordPaymentOutcome(
      payment,
      {
        effect,
        state,
        statusCode: result.statusCode,
        amount: payment.amountPlanned,
        interactionId: result.providerOperationId ?? result.providerPaymentId,
        pspReference: result.providerPaymentId,
      },
      env,
      ports,
    );

    return { redirectUrl: redirectWithStatus(returnCtx.shopperReturnUrl, statusForReturn(effect), env) };
  } catch (e) {
    env.logger.warn('Return leg could not be resolved; not reflecting onto commercetools', {
      ctPaymentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { redirectUrl: failureRedirect(env) };
  }
}
