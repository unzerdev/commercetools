import type { CustomerReader } from '../../application/ports';
import { ctClient } from '../commercetools';
import { log } from '../bootstrap/libs/logger';

const PLATFORM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `CustomerReader` over `ctClient.customers`; never throws, a failure is logged with its likely cause. */
export class CustomerReaderAdapter implements CustomerReader {
  public async dateOfBirth(customerId: string): Promise<string | undefined> {
    let dateOfBirth: string | undefined;
    try {
      const customer = await ctClient.customers.find({ id: customerId });
      dateOfBirth = customer?.dateOfBirth;
    } catch (error) {
      log.warn('Customer read for the shopper date of birth failed; continuing without it', {
        customerId,
        reason: error instanceof Error ? error.message : 'unknown',
        hint: 'the commercetools client needs the view_customers scope',
      });
      return undefined;
    }

    const match = PLATFORM_DATE.exec(dateOfBirth ?? '');
    return match ? `${match[1]}${match[2]}${match[3]}` : undefined;
  }
}
