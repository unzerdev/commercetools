import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithIntl } from '../../../../../support/render-with-intl';
import type { UnzerMethodConfigDto } from '../../../../../../src/types/config';
import PaymentMethodsSection from '../../../../../../src/components/config-app/sections/payment-methods/method-list/payment-methods-section';

/**
 * The row is labelled from the CODE (Unzer's own name for the type), so `name` here is the merchant's
 * checkout copy: it rides along on the method and must never be what the screen reads.
 */
const method = (
  code: string,
  name: string,
  enabled: boolean,
  description = ''
): UnzerMethodConfigDto => ({
  paymentMethodCode: code,
  enabled,
  name: { en: name },
  description: description ? { en: description } : {},
  surcharge: {},
  countries: [],
  sendBasketData: false,
});

const renderSection = (
  methods: UnzerMethodConfigDto[],
  props: {
    onMethodsChange?: jest.Mock;
    onPersist?: jest.Mock<Promise<void>, [UnzerMethodConfigDto[]]>;
    onOpenSettings?: jest.Mock;
  } = {}
) => {
  const onMethodsChange = props.onMethodsChange ?? jest.fn();
  const onPersist = props.onPersist ?? jest.fn().mockResolvedValue(undefined);
  renderWithIntl(
    <PaymentMethodsSection
      methods={methods}
      onMethodsChange={onMethodsChange}
      onPersist={onPersist}
      onOpenSettings={props.onOpenSettings}
    />
  );
  return { onMethodsChange, onPersist };
};

describe('PaymentMethodsSection', () => {
  it('renders one row per method, named - and nothing else to read', () => {
    renderSection([
      method(
        'card',
        'Renamed for checkout',
        true,
        'Visa, Mastercard and more.'
      ),
      method('paypal', 'PayPal', false, 'Pay with a PayPal account.'),
    ]);

    // Unzer's names, not the merchant's: this is the administration screen.
    expect(screen.getByText('Cards and Click to Pay')).toBeInTheDocument();
    expect(screen.getByText('PayPal')).toBeInTheDocument();
    expect(screen.queryByText('Renamed for checkout')).not.toBeInTheDocument();
    // The description belongs to the settings modal: repeated down a 20-method list it was a wall of
    // text between the operator and the toggle they came for.
    expect(
      screen.queryByText('Visa, Mastercard and more.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Pay with a PayPal account.')
    ).not.toBeInTheDocument();
  });

  it('shows Settings for an enabled method and Learn more for a disabled one', () => {
    renderSection(
      [method('card', 'Cards', true), method('paypal', 'PayPal', false)],
      { onOpenSettings: jest.fn() }
    );

    expect(
      screen.getByRole('button', { name: 'Settings' })
    ).toBeInTheDocument();

    const learnMore = screen.getByRole('link', { name: 'Learn more' });
    expect(learnMore).toBeInTheDocument();
    // THIS method's documentation page, not the root: `method-catalogue.ts` owns the slug, which
    // matches neither the code nor the name.
    expect(learnMore).toHaveAttribute(
      'href',
      'https://docs.unzer.com/payment-methods/paypal/'
    );
    expect(learnMore).toHaveAttribute('target', '_blank');
  });

  // Enabling is STAGED: it opens the settings modal, and the modal's save is what persists - so the
  // enable and the settings the merchant is about to write reach the processor as one save.
  it('stages an enable and opens its settings, without persisting', () => {
    const onMethodsChange = jest.fn();
    const onPersist = jest.fn().mockResolvedValue(undefined);
    const onOpenSettings = jest.fn();
    renderSection([method('ideal', 'iDEAL', false)], {
      onMethodsChange,
      onPersist,
      onOpenSettings,
    });

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable iDEAL | Wero' })
    );

    expect(onMethodsChange).toHaveBeenCalledWith([
      expect.objectContaining({ paymentMethodCode: 'ideal', enabled: true }),
    ]);
    expect(onOpenSettings).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodCode: 'ideal', enabled: true }),
      true
    );
    expect(onPersist).not.toHaveBeenCalled();
  });

  // Disabling has no modal behind it: it persists on the click or it is lost on the next reload.
  it('persists a disable immediately', async () => {
    const onPersist = jest.fn().mockResolvedValue(undefined);
    const onOpenSettings = jest.fn();
    renderSection([method('ideal', 'iDEAL', true)], {
      onPersist,
      onOpenSettings,
    });

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable iDEAL | Wero' })
    );

    await waitFor(() =>
      expect(onPersist).toHaveBeenCalledWith([
        expect.objectContaining({ paymentMethodCode: 'ideal', enabled: false }),
      ])
    );
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it('puts the toggle back when persisting a disable fails', async () => {
    const onMethodsChange = jest.fn();
    const onPersist = jest.fn().mockRejectedValue(new Error('nope'));
    renderSection([method('ideal', 'iDEAL', true)], {
      onMethodsChange,
      onPersist,
    });

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable iDEAL | Wero' })
    );

    await waitFor(() =>
      expect(onMethodsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paymentMethodCode: 'ideal', enabled: true }),
      ])
    );
  });

  it('shows the empty state when there are no methods', () => {
    renderSection([]);

    expect(
      screen.getByText(/No payment methods are available yet/)
    ).toBeInTheDocument();
  });

  // There is no tab-level save any more: the modal persists, and so does a disable.
  it('offers no tab-level Save changes button', () => {
    renderSection([method('card', 'Cards', true)]);

    expect(
      screen.queryByRole('button', { name: 'Save changes' })
    ).not.toBeInTheDocument();
  });

  it('truncates a long method name and keeps the full text on hover', () => {
    // A code Unzer added after this catalogue: it has no name to shorten it, so the row renders the code
    // itself - the longest label this screen can be handed.
    const long = 'unzer-installment-secured-for-business-customers-de';
    renderSection([method(long, 'Whatever the merchant typed', false)]);

    // The row must not grow or wrap, so the name is the part that gives way - it truncates inside
    // `.unzer-pm-name`, with `title` handing the full text back on hover.
    const named = screen.getByTitle(long);
    expect(named).toHaveClass('unzer-pm-name');
    expect(named).toHaveTextContent(long);
  });

  it('disables the Settings action until a settings handler is provided', () => {
    renderSection([method('card', 'Cards', true)]);

    expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled();
  });

  it('invokes onOpenSettings with the method when Settings is clicked', () => {
    const onOpenSettings = jest.fn();
    renderSection([method('card', 'Cards', true)], { onOpenSettings });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    // `false`: opened from Settings, so there is no staged enable for a Cancel to undo.
    expect(onOpenSettings).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodCode: 'card' }),
      false
    );
  });
});

/**
 * The merchant's own logo wins over the bundled artwork, the same precedence the shopper's checkout
 * applies - the two screens must not show one method wearing two different marks.
 */
describe('PaymentMethodsSection logo precedence', () => {
  const UPLOADED = 'https://connector.test/assets/logo/a1b2c3';

  it("renders the merchant's uploaded logo when the view carries one", () => {
    renderSection([{ ...method('card', 'Cards', true), logo: UPLOADED }]);

    expect(screen.getByAltText('Cards and Click to Pay')).toHaveAttribute(
      'src',
      UPLOADED
    );
  });

  it('falls back to the bundled artwork when the method has none', () => {
    renderSection([method('card', 'Cards', true)]);

    expect(screen.getByAltText('Cards and Click to Pay')).not.toHaveAttribute(
      'src',
      UPLOADED
    );
  });
});
