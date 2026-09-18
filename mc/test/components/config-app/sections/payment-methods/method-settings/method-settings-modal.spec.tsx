import type { ReactElement } from 'react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReferenceDataProvider } from '../../../../../../src/hooks/use-reference-data';
import type { UseReferenceDataResult } from '../../../../../../src/hooks/use-reference-data';
import type { UnzerMethodConfigDto } from '../../../../../../src/types/config';
import BusyOverlayHost from '../../../../../../src/components/shared/busy-overlay';
import MethodSettingsModal from '../../../../../../src/components/config-app/sections/payment-methods/method-settings/method-settings-modal';

// EUR → 2 fraction digits, so the modal edits major units and converts to minor at the form boundary.
// The amount fields are NUMBER inputs, so `toHaveValue` reads a number (and `null` when empty).
const REFERENCE_DATA: UseReferenceDataResult = {
  languages: ['en', 'de'],
  currencies: ['EUR'],
  countries: ['DE', 'FR', 'NL'],
  loading: false,
};

/** A two-currency store: the amounts are configured for one currency at a time. */
const MULTI_CURRENCY: UseReferenceDataResult = {
  ...REFERENCE_DATA,
  currencies: ['EUR', 'USD'],
};

const baseMethod = (
  overrides: Partial<UnzerMethodConfigDto> = {}
): UnzerMethodConfigDto => ({
  paymentMethodCode: 'card',
  enabled: true,
  name: { en: 'Cards' },
  description: { en: 'Visa, Mastercard, Maestro and more.' },
  surcharge: {},
  countries: [],
  sendBasketData: false,
  supportsAuthorize: true,
  ...overrides,
});

/**
 * A wallet method as the GET view returns one: `vendorCardNetworks` is the read-only coverage the
 * processor derives from the keypair, already spelled the way THAT wallet's own sheet spells it
 * (`MASTERCARD` for Google, `masterCard` for Apple). The modal offers exactly those networks, so a
 * fixture without them offers none and every wallet block saves an empty network list.
 */
const walletMethod = (
  paymentMethodCode: 'googlepay' | 'applepay',
  overrides: Partial<UnzerMethodConfigDto> = {}
): UnzerMethodConfigDto =>
  baseMethod({
    paymentMethodCode,
    vendorCardNetworks:
      paymentMethodCode === 'googlepay'
        ? ['MASTERCARD', 'VISA']
        : ['masterCard', 'visa'],
    ...overrides,
  });

/** Pick a currency beside one amount field (each field carries its own selector). */
const selectCurrency = (field: string, code: string) => {
  const selector = screen.getByLabelText(`Currency for ${field}`);
  fireEvent.focus(selector);
  fireEvent.keyDown(selector, { key: 'ArrowDown' });
  // The selected code also renders in the control, so pick the one the open menu offers.
  fireEvent.click(screen.getByRole('option', { name: code }));
};

const renderModal = (
  method: UnzerMethodConfigDto,
  props: {
    onSave?: jest.Mock;
    onClose?: jest.Mock;
    referenceData?: UseReferenceDataResult;
  } = {}
) => {
  const onSave = props.onSave ?? jest.fn();
  const onClose = props.onClose ?? jest.fn();
  const referenceData = props.referenceData ?? REFERENCE_DATA;
  const ui: ReactElement = (
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <ReferenceDataProvider value={referenceData}>
          {/* The screen's single in-flight indicator, which the modal claims while it saves. */}
          <BusyOverlayHost />
          <MethodSettingsModal
            method={method}
            isOpen
            onClose={onClose}
            onSave={onSave}
          />
        </ReferenceDataProvider>
      </IntlProvider>
    </MemoryRouter>
  );
  const rendered = render(ui);
  return { ...rendered, onSave, onClose };
};

const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

describe('MethodSettingsModal', () => {
  it('seeds the name/description inputs from the method for the default language', async () => {
    renderModal(baseMethod());

    expect(await screen.findByLabelText('Payment method name')).toHaveValue(
      'Cards'
    );
    expect(screen.getByLabelText('Payment method description')).toHaveValue(
      'Visa, Mastercard, Maestro and more.'
    );
  });

  // The dialog is titled from the CODE, like the row the operator clicked: the name field below is the
  // checkout copy, so renaming a method for shoppers must not rename it on the administration screen (nor
  // make sandbox and live read differently).
  it('titles the dialog with Unzer’s own name, not the merchant’s checkout name', () => {
    renderModal(baseMethod({ name: { en: 'Renamed for checkout' } }));

    // The dialog's own accessible name IS the title, so this asserts the visible header too.
    expect(
      screen.getByRole('dialog', { name: 'Cards and Click to Pay' })
    ).toBeInTheDocument();
    // The merchant's name stays where they edit it.
    expect(screen.getByLabelText('Payment method name')).toHaveValue(
      'Renamed for checkout'
    );
  });

  // The header answers "what IS this method", which is a property of the method type - so it reads the
  // same in sandbox and in live, and does not echo the merchant's own checkout copy back at them.
  it('heads the dialog with Unzer’s own description, whatever the merchant authored', () => {
    renderModal(baseMethod({ description: { en: 'Our own checkout blurb' } }));

    expect(
      screen.getByText(/Cards can be differentiated in credit and debit cards/)
    ).toBeInTheDocument();
    // The merchant's text stays where they edit it.
    expect(screen.getByLabelText('Payment method description')).toHaveValue(
      'Our own checkout blurb'
    );
  });

  it('heads an undescribed method with the SAME text as a described one', () => {
    const { unmount } = renderModal(baseMethod({ description: {} }));
    const undescribed = screen.getByText(
      /Cards can be differentiated in credit and debit cards/
    ).textContent;
    unmount();

    renderModal(baseMethod({ description: { en: 'Anything at all' } }));
    expect(
      screen.getByText(/Cards can be differentiated in credit and debit cards/)
        .textContent
    ).toBe(undescribed);
  });

  it('edits the localized name into the method and saves', () => {
    const { onSave } = renderModal(baseMethod());

    fireEvent.change(screen.getByLabelText('Payment method name'), {
      target: { value: 'Karten' },
    });
    save();

    // The other store language keeps the default the modal seeded for it - the operator edited English.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethodCode: 'card',
        name: { en: 'Karten', de: 'Cards and Click to Pay' },
      })
    );
  });

  it('renders the booking control when the method supports authorize and edits it', () => {
    const { onSave } = renderModal(baseMethod({ supportsAuthorize: true }));

    fireEvent.click(screen.getByRole('radio', { name: 'Authorize' }));
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bookingMode: 'authorize' })
    );
  });

  it('hides the booking control for a charge-only method', () => {
    renderModal(baseMethod({ supportsAuthorize: false }));

    expect(
      screen.queryByRole('radio', { name: 'Authorize' })
    ).not.toBeInTheDocument();
  });

  it('converts the major-unit amounts and surcharge to integer minor units on save', () => {
    const { onSave } = renderModal(baseMethod());

    fireEvent.change(screen.getByLabelText('Min order amount'), {
      target: { value: '5.00' },
    });
    fireEvent.change(screen.getByLabelText('Surcharge'), {
      target: { value: '1.50' },
    });
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        minAmount: { EUR: 500 },
        surcharge: { EUR: 150 },
      })
    );
  });

  it('seeds the amount fields from minor units in major units', () => {
    renderModal(
      baseMethod({ minAmount: { EUR: 1000 }, surcharge: { EUR: 250 } })
    );

    expect(screen.getByLabelText('Min order amount')).toHaveValue(10);
    expect(screen.getByLabelText('Surcharge')).toHaveValue(2.5);
  });

  it('leaves an amount the merchant did not fill in out of the saved map', () => {
    const { onSave } = renderModal(baseMethod());

    save();

    // No bound in any currency reads better as an absent field than as an empty map.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        minAmount: undefined,
        maxAmount: undefined,
        surcharge: {},
      })
    );
  });

  // Amounts are PER CURRENCY: switching the selector shows that currency's values, and the save
  // carries every currency the merchant filled in - not just the one on screen.
  it('keeps each currency’s amounts apart and saves them together', () => {
    const { onSave } = renderModal(baseMethod({ minAmount: { EUR: 1000 } }), {
      referenceData: MULTI_CURRENCY,
    });

    expect(screen.getByLabelText('Min order amount')).toHaveValue(10);

    selectCurrency('Min order amount', 'USD');
    expect(screen.getByLabelText('Min order amount')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('Min order amount'), {
      target: { value: '12.50' },
    });
    // The surcharge carries its OWN currency selector, independent of the minimum's.
    selectCurrency('Surcharge', 'USD');
    fireEvent.change(screen.getByLabelText('Surcharge'), {
      target: { value: '0.99' },
    });

    // Back to EUR: its value was never touched by the USD edit.
    selectCurrency('Min order amount', 'EUR');
    expect(screen.getByLabelText('Min order amount')).toHaveValue(10);
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        minAmount: { EUR: 1000, USD: 1250 },
        surcharge: { USD: 99 },
      })
    );
  });

  it('scales amounts by the SELECTED currency’s exponent - a 0-decimal currency (JPY) is 1:1', () => {
    const jpy: UseReferenceDataResult = {
      languages: ['en'],
      currencies: ['JPY'],
      countries: ['JP'],
      loading: false,
    };
    const { onSave } = renderModal(baseMethod({ minAmount: { JPY: 500 } }), {
      referenceData: jpy,
    });

    // JPY has 0 fraction digits: minor 500 reads back as major "500", and a typed "500" persists as 500.
    expect(screen.getByLabelText('Min order amount')).toHaveValue(500);
    fireEvent.change(screen.getByLabelText('Max order amount'), {
      target: { value: '1000' },
    });
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        minAmount: { JPY: 500 },
        maxAmount: { JPY: 1000 },
      })
    );
  });

  it('still offers a currency the project dropped but the method still carries', () => {
    const { onSave } = renderModal(baseMethod({ surcharge: { CHF: 199 } }));

    // Reference data lists EUR only; CHF stays selectable (and selected first, being alphabetically
    // ahead of EUR) so its configured surcharge is neither hidden nor dropped by the next save.
    expect(screen.getByLabelText('Surcharge')).toHaveValue(1.99);
    selectCurrency('Surcharge', 'EUR');
    expect(screen.getByLabelText('Surcharge')).toHaveValue(null);
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ surcharge: { CHF: 199 } })
    );
  });

  it('restricts the method to a selected country', () => {
    const { onSave } = renderModal(baseMethod());

    // The country control is the last react-select combobox in the modal.
    const combos = screen.getAllByRole('combobox');
    const country = combos[combos.length - 1];
    fireEvent.focus(country);
    fireEvent.keyDown(country, { key: 'ArrowDown' });
    fireEvent.keyDown(country, { key: 'Enter' });
    save();

    // The options read as full country names and are ordered by them, so the first one is France, not
    // whichever code the reference data happened to list first.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ countries: ['FR'] })
    );
  });

  // The localized fields open FILLED IN, per store language - real values the save carries, not
  // placeholders that vanish into an empty field.
  it('seeds an undescribed method with a name and a "Pay securely with" line per store language', () => {
    const { onSave } = renderModal(
      baseMethod({ paymentMethodCode: 'paypal', name: {}, description: {} })
    );

    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: { en: 'PayPal', de: 'PayPal' },
        description: {
          en: 'Pay securely with PayPal',
          de: 'Sicher bezahlen mit PayPal',
        },
      })
    );
  });

  it('leaves text the merchant already wrote alone', () => {
    const { onSave } = renderModal(
      baseMethod({
        paymentMethodCode: 'paypal',
        name: { en: 'Our wallet' },
        description: {},
      })
    );

    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: { en: 'Our wallet', de: 'PayPal' } })
    );
  });

  // What the vendor decides, the screen does not ask. Getting these wrong is not cosmetic: an
  // unsupported booking mode is rejected at the vendor, and a BNPL method without a basket fails.
  describe('what the vendor decides', () => {
    it('offers the booking choice for a method Unzer supports both ways', () => {
      renderModal(baseMethod({ paymentMethodCode: 'card' }));

      expect(screen.getByRole('radio', { name: 'Charge' })).toBeInTheDocument();
      expect(
        screen.getByRole('radio', { name: 'Authorize' })
      ).toBeInTheDocument();
    });

    it('hides the booking choice for an authorize-only method and saves authorize', () => {
      const { onSave } = renderModal(
        baseMethod({ paymentMethodCode: 'paylater-invoice' })
      );

      expect(
        screen.queryByRole('radio', { name: 'Charge' })
      ).not.toBeInTheDocument();
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ bookingMode: 'authorize' })
      );
    });

    it('hides the booking choice for a charge-only method and saves charge', () => {
      const { onSave } = renderModal(
        baseMethod({ paymentMethodCode: 'twint', bookingMode: 'authorize' })
      );

      expect(
        screen.queryByRole('radio', { name: 'Authorize' })
      ).not.toBeInTheDocument();
      // Even a draft that carried the other mode is corrected: TWINT is charge-only at the vendor.
      save();
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ bookingMode: 'charge' })
      );
    });

    it('hides the basket toggle for a method that requires the basket, and always sends it', () => {
      const { onSave } = renderModal(
        baseMethod({ paymentMethodCode: 'klarna', sendBasketData: false })
      );

      expect(
        screen.queryByRole('checkbox', { name: 'Enable sending basket' })
      ).not.toBeInTheDocument();
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ sendBasketData: true })
      );
    });

    it('offers Click to Pay on Cards only', () => {
      const { unmount } = renderModal(
        baseMethod({ paymentMethodCode: 'card' })
      );
      expect(
        screen.getByRole('checkbox', { name: 'Enable Click to Pay' })
      ).toBeInTheDocument();
      unmount();

      renderModal(baseMethod({ paymentMethodCode: 'paypal' }));
      expect(
        screen.queryByRole('checkbox', { name: 'Enable Click to Pay' })
      ).not.toBeInTheDocument();
    });

    /**
     * The WALLET blocks: each is the merchant's own identity with Apple or Google, and each belongs to ONE
     * method - rendered anywhere else it would collect settings that describe nothing, and the processor refuses
     * such a body with a 400.
     */
    it('offers the Google Pay settings on Google Pay only', () => {
      const { unmount } = renderModal(
        baseMethod({ paymentMethodCode: 'googlepay' })
      );
      expect(screen.getByLabelText('Google merchant ID')).toBeInTheDocument();
      expect(screen.getByLabelText('Google merchant name')).toBeInTheDocument();
      expect(screen.queryByLabelText('Payee name')).not.toBeInTheDocument();
      unmount();

      renderModal(baseMethod({ paymentMethodCode: 'card' }));
      expect(
        screen.queryByLabelText('Google merchant ID')
      ).not.toBeInTheDocument();
    });

    it('offers the Apple Pay settings on Apple Pay only', () => {
      const { unmount } = renderModal(
        baseMethod({ paymentMethodCode: 'applepay' })
      );
      expect(screen.getByLabelText('Payee name')).toBeInTheDocument();
      expect(
        screen.queryByLabelText('Google merchant ID')
      ).not.toBeInTheDocument();
      unmount();

      renderModal(baseMethod({ paymentMethodCode: 'paypal' }));
      expect(screen.queryByLabelText('Payee name')).not.toBeInTheDocument();
    });

    /**
     * A saved wallet block reads back the way the SCREEN read: every control's effective value, not only the
     * fields the merchant touched. The processor then stamps `gatewayMerchantId` onto it.
     */
    it('saves the whole Google Pay block, defaults included', () => {
      const { onSave } = renderModal(walletMethod('googlepay'));

      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          googlePay: {
            merchantId: '',
            merchantName: '',
            countryCode: 'DK',
            allowedCardNetworks: ['MASTERCARD', 'VISA'],
            allowCreditCards: true,
            allowPrepaidCards: true,
            buttonColor: 'default',
            buttonType: 'buy',
            buttonSizeMode: 'fill',
          },
        })
      );
    });

    it('saves the whole Apple Pay block, defaults included', () => {
      const { onSave } = renderModal(walletMethod('applepay'));

      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          applePay: { supportedNetworks: ['masterCard', 'visa'], label: '' },
        })
      );
    });

    // The gateway merchant id is the connector's field: shown, never asked for, and carried through a save.
    it('shows the stamped gateway merchant id and keeps it on save', () => {
      const { onSave } = renderModal(
        baseMethod({
          paymentMethodCode: 'googlepay',
          googlePay: { gatewayMerchantId: '9138634f404b' },
        })
      );

      expect(screen.getByText('9138634f404b')).toBeInTheDocument();
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          googlePay: expect.objectContaining({
            gatewayMerchantId: '9138634f404b',
          }),
        })
      );
    });

    it('saves what the merchant typed into the Google Pay block', () => {
      const { onSave } = renderModal(
        baseMethod({ paymentMethodCode: 'googlepay' })
      );

      fireEvent.change(screen.getByLabelText('Google merchant ID'), {
        target: { value: '12345678901234567890' },
      });
      fireEvent.change(screen.getByLabelText('Google merchant name'), {
        target: { value: 'Unzer Demo Shop' },
      });
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          googlePay: expect.objectContaining({
            merchantId: '12345678901234567890',
            merchantName: 'Unzer Demo Shop',
          }),
        })
      );
    });

    it('saves the Apple Pay payee name', () => {
      const { onSave } = renderModal(
        baseMethod({ paymentMethodCode: 'applepay' })
      );

      fireEvent.change(screen.getByLabelText('Payee name'), {
        target: { value: 'Unzer Demo Shop' },
      });
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          applePay: expect.objectContaining({ label: 'Unzer Demo Shop' }),
        })
      );
    });

    // A block the method does not own never travels, whatever the draft was seeded with: the processor answers
    // 400 for one, and a merchant would otherwise see Apple Pay settings persisted on Google Pay.
    it('sends no wallet block the method does not own', () => {
      const { onSave } = renderModal(
        walletMethod('googlepay', {
          googlePay: { merchantId: 'm-1' },
          applePay: { label: 'Leftover' },
        })
      );
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          googlePay: expect.objectContaining({ merchantId: 'm-1' }),
          applePay: undefined,
        })
      );
    });

    it('saves the Click to Pay switch', () => {
      const { onSave } = renderModal(baseMethod({ paymentMethodCode: 'card' }));

      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Enable Click to Pay' })
      );
      save();

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ clickToPayEnabled: true })
      );
    });
  });

  it('toggles send-basket data into the method', () => {
    const { onSave } = renderModal(baseMethod());

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable sending basket' })
    );
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sendBasketData: true })
    );
  });

  // The switch and its text are one control: the text is inside the `<label>`, so a click on either
  // flips it - which is what an operator expects of a labelled switch.
  it.each([
    ['Enable sending basket', 'sendBasketData'],
    ['Enable Click to Pay', 'clickToPayEnabled'],
  ])('toggles %s by clicking its label text', (label, field) => {
    const { onSave } = renderModal(
      baseMethod({ sendBasketData: false, clickToPayEnabled: false })
    );

    fireEvent.click(screen.getByText(label));
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ [field]: true })
    );
  });

  // A save leaves the browser, so it has to LOOK like it: the app's single spinner claims the screen and
  // the button says what it is doing, until the parent's promise settles.
  it('shows the spinner and a Saving… button while the save is in flight', async () => {
    let settle: () => void = () => undefined;
    const onSave = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    renderModal(baseMethod(), { onSave });

    save();

    const overlay = await screen.findByRole('alert', { name: 'Loading…' });
    expect(overlay).toBeInTheDocument();
    // OVER the dialog, not behind it: the overlay is portaled to `body`, so it is not trapped in the
    // app tree's stacking context while the dialog renders in the shell's portal container.
    // eslint-disable-next-line testing-library/no-node-access -- the assertion IS about where it mounts
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    await act(async () => {
      settle();
    });

    expect(
      screen.queryByRole('alert', { name: 'Loading…' })
    ).not.toBeInTheDocument();
  });

  // A stray click on the page around the dialog used to dismiss it, taking every edit with it. Only
  // deliberate exits close: Cancel, the header ✕, Escape.
  it('does NOT close when the pointer goes down outside the dialog', async () => {
    const { onClose } = renderModal(baseMethod());

    // Radix attaches its outside-pointer listener in a `setTimeout(0)`, so the click has to come after
    // the dialog has settled or it would find nothing listening and pass for the wrong reason.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('discards edits and closes on Cancel', () => {
    const { onSave, onClose } = renderModal(baseMethod());

    fireEvent.change(screen.getByLabelText('Payment method name'), {
      target: { value: 'Discarded' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
