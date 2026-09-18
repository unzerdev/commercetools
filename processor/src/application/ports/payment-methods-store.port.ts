import type { PaymentMethodsObject, Versioned } from '../../domain';

/** Per-store payment-methods persistence: a plaintext Custom Object with CAS on write. */
export interface PaymentMethodsStore {
  readWithVersion(storeKey: string): Promise<Versioned<PaymentMethodsObject>>;

  /** The object the store runs on: its own, else the default scope's when it inherits its credentials too. */
  readEffective(storeKey: string, inheritDefaultScope: boolean): Promise<PaymentMethodsObject | null>;

  write(storeKey: string, value: PaymentMethodsObject, version?: number): Promise<PaymentMethodsObject>;

  delete(storeKey: string, version?: number): Promise<void>;
}
