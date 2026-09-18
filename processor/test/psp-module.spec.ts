import { describe, expect, it } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { storeConfig } from './support/store-config';
import { buildPspModule } from '../src/providers/psp/psp-module';
import { PspConfigHandler } from '../src/providers/psp/config/config.handler';
import { PspPaymentHandler } from '../src/providers/psp/payment/payment.handler';
import { PspModificationHandler } from '../src/providers/psp/modifications/modification.handler';
import { PspReturnHandler } from '../src/providers/psp/return/return.handler';
import { PspIntrospectionService } from '../src/providers/psp/introspection/introspection.service';
import { PspWebhookHandler } from '../src/providers/psp/webhook/webhook.handler';

/** The custom-Type key the composition root injects from the brand defaults. */
const pspModule = buildPspModule('psp-payment');

describe('buildPspModule — ProviderModule assembly', () => {
  it('exposes the identity members', () => {
    expect(pspModule.key).toBe('psp');
    expect(pspModule.paymentCustomType.key).toBe('psp-payment');
    expect(pspModule.paymentCustomType.resourceTypeIds).toContain('payment');
  });

  it('stamps the custom-Type key it is BUILT with - a rebrand changes the type, not the code', () => {
    expect(buildPspModule('rebranded-payment').paymentCustomType.key).toBe('rebranded-payment');
  });

  it('wires every by-concern handler to its concrete implementation', () => {
    expect(pspModule.config).toBeInstanceOf(PspConfigHandler);
    expect(pspModule.payment).toBeInstanceOf(PspPaymentHandler);
    expect(pspModule.modifications).toBeInstanceOf(PspModificationHandler);
    expect(pspModule.returnLeg).toBeInstanceOf(PspReturnHandler);
    expect(pspModule.introspection).toBeInstanceOf(PspIntrospectionService);
    expect(pspModule.webhook).toBeInstanceOf(PspWebhookHandler);
  });

  it('interprets a vendor status via the single mapProviderStatus member', () => {
    expect(pspModule.mapProviderStatus({ state: PaymentState.CAPTURED })).toBe(PaymentState.CAPTURED);
  });

  it('shopperPublicKey exposes only the public key, never the private key', () => {
    const cfg = storeConfig({ credentials: { publicKey: 'pub-key', privateKey: 'priv-secret' } });
    const publicKey = pspModule.config.shopperPublicKey(cfg);
    expect(publicKey).toBe('pub-key');
    expect(publicKey).not.toContain('priv-secret');
  });
});
