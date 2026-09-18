/**
 * The per-method settings dialog: localized name/description, booking method, per-currency amounts,
 * country restriction, basket and Click-to-Pay switches. `Save changes` hands the edited method to the
 * parent, which merges it into the list AND persists it (there is no tab-level save); `Cancel` discards.
 *
 * Everything not about the dialog itself lives beside it: `method-amounts` (money boundary),
 * `amount-field` (one amount row), `flag-option` (flag-led select options).
 */

import { useId, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { ConfirmationDialog } from '@commercetools-frontend/application-components';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import FieldLabel from '@commercetools-uikit/field-label';
import TextInput from '@commercetools-uikit/text-input';
import SelectInput from '@commercetools-uikit/select-input';
import { useBusy } from '../../../../shared/busy-overlay';
import { UnzerRadioGroup, UnzerToggle } from '../../../../ui';
import { closeUnlessClickedOutside } from '../../../../shared/dialog';
import { useReferenceDataContext } from '../../../../../hooks/use-reference-data';
import type { UnzerMethodConfigDto } from '../../../../../types/config';
import AmountField from './amount-field';
import { flagOption, localeOptionLabel, MenuAbove } from './flag-option';
import {
  amountCurrenciesFor,
  seedAmountText,
  toAmounts,
  type AmountText,
} from './method-amounts';
import PaymentMethodLogo from '../catalogue/payment-method-logo';
import {
  methodDisplayName,
  methodVendorDescription,
} from '../catalogue/method-display';
import {
  defaultMethodDescription,
  defaultMethodName,
} from '../catalogue/default-method-text';
import {
  BOOKING_MODES_DOCS_URL,
  APPLE_PAY_METHOD_CODE,
  CLICK_TO_PAY_METHOD_CODE,
  GOOGLE_PAY_METHOD_CODE,
  unzerMethodBookingMode,
  unzerMethodDocsUrl,
  unzerMethodRequiresBasket,
} from '../catalogue/method-catalogue';
import messages from './messages';

/**
 * Display names for the card networks either wallet sheet accepts, keyed by the value that is SAVED. A value
 * with no entry renders as itself - a network the vendor starts reporting tomorrow is then still selectable,
 * just unprettified, which is better than hiding it.
 */
const NETWORK_LABELS: Record<string, string> = {
  MASTERCARD: 'Mastercard',
  masterCard: 'Mastercard',
  maestro: 'Maestro',
  VISA: 'Visa',
  visa: 'Visa',
  AMEX: 'American Express',
  amex: 'American Express',
  DISCOVER: 'Discover',
  discover: 'Discover',
  JCB: 'JCB',
  jcb: 'JCB',
  INTERAC: 'Interac',
};

/** A method's booking modes. Charge captures immediately; Authorize reserves for a later capture. */
type BookingMode = NonNullable<UnzerMethodConfigDto['bookingMode']>;

export type MethodSettingsModalProps = {
  /** The method being edited; the modal seeds its draft from this and never mutates it in place. */
  method: UnzerMethodConfigDto;
  isOpen: boolean;
  /** Discards the draft and closes (Cancel / the close affordance). */
  onClose: () => void;
  /**
   * Hands the edited method to the parent, which merges it into the array AND PERSISTS it. The modal
   * stays open until this settles, and stays open on rejection so the edit is not lost to a failed save.
   */
  onSave: (next: UnzerMethodConfigDto) => Promise<void> | void;
};

/**
 * Fill every store language the merchant has not written yet - leaving whatever they did write alone.
 * Applied ONCE, when the modal opens: a field the operator deliberately clears must stay cleared.
 */
const withDefaultText = (
  method: UnzerMethodConfigDto,
  languages: string[]
): UnzerMethodConfigDto => {
  const name = { ...method.name };
  const description = { ...method.description };
  for (const language of languages) {
    if (!name[language]) {
      name[language] = defaultMethodName(method.paymentMethodCode);
    }
    if (!description[language]) {
      description[language] = defaultMethodDescription(
        method.paymentMethodCode,
        language
      );
    }
  }
  return { ...method, name, description };
};

const MethodSettingsModal = ({
  method,
  isOpen,
  onClose,
  onSave,
}: MethodSettingsModalProps) => {
  const intl = useIntl();
  const { languages, countries, currencies } = useReferenceDataContext();
  const defaultLocale = languages[0] ?? 'en';

  /**
   * The currencies the amounts can be configured in: the store's own, PLUS any currency the persisted
   * config already carries. A project that drops a currency must not silently hide (and then drop on the
   * next save) an amount the merchant configured for it.
   */
  const amountCurrencies = useMemo(
    () =>
      amountCurrenciesFor(
        currencies,
        method.minAmount,
        method.maxAmount,
        method.surcharge
      ),
    [currencies, method]
  );

  const nameId = useId();
  const descriptionId = useId();
  const minAmountId = useId();
  const googleMerchantIdId = useId();
  const googleMerchantNameId = useId();
  const googleCountryId = useId();
  const googleNetworksId = useId();
  const googleButtonColorId = useId();
  const googleButtonSizeId = useId();
  const googleButtonTypeId = useId();
  const appleNetworksId = useId();
  const appleLabelId = useId();
  const maxAmountId = useId();
  const surchargeId = useId();

  /**
   * The draft starts with the localized fields FILLED IN, per store language: Unzer's name for the
   * method, and "Pay securely with <method>" as the description. These are real values, not placeholders
   * - the merchant edits them and the save carries them, so what the shopper sees at checkout is what
   * this screen showed. A language the merchant already described keeps their text untouched.
   */
  const [draft, setDraft] = useState<UnzerMethodConfigDto>(() =>
    withDefaultText(method, languages.length > 0 ? languages : ['en'])
  );
  const [nameLocale, setNameLocale] = useState(defaultLocale);
  const [descriptionLocale, setDescriptionLocale] = useState(defaultLocale);
  // One selected currency PER amount field: the three are independent controls on their own rows.
  const [minCurrency, setMinCurrency] = useState(() => amountCurrencies[0]);
  const [maxCurrency, setMaxCurrency] = useState(() => amountCurrencies[0]);
  const [surchargeCurrency, setSurchargeCurrency] = useState(
    () => amountCurrencies[0]
  );
  const [minAmountText, setMinAmountText] = useState<AmountText>(() =>
    seedAmountText(method.minAmount, amountCurrencies)
  );
  const [maxAmountText, setMaxAmountText] = useState<AmountText>(() =>
    seedAmountText(method.maxAmount, amountCurrencies)
  );
  const [surchargeText, setSurchargeText] = useState<AmountText>(() =>
    seedAmountText(method.surcharge, amountCurrencies)
  );
  /** In flight while the parent persists; the dialog stays open (and its primary button disabled). */
  const [saving, setSaving] = useState(false);
  // The save crosses the MC API Gateway to the connector, so it claims the app's ONE in-flight
  // indicator (the centred spinner over a click-swallowing scrim) exactly as every other request does.
  useBusy(saving);

  const localeOptions = useMemo(() => {
    const list = languages.length > 0 ? languages : ['en'];
    return list.map((code) => ({
      value: code,
      label: localeOptionLabel(code),
    }));
  }, [languages]);
  const currencyOptions = useMemo(
    () => amountCurrencies.map((code) => ({ value: code, label: code })),
    [amountCurrencies]
  );
  // Full country names, in the operator's language, behind the country's flag: a list of ISO codes is a
  // puzzle, and `Intl` already knows every translation. The code stays the VALUE (it is what the DTO
  // persists) and is appended to the name, so a merchant who thinks in codes can still scan for one.
  const countryNames = useMemo(
    () => new Intl.DisplayNames([intl.locale], { type: 'region' }),
    [intl.locale]
  );
  const { countryOptions, countryText } = useMemo(() => {
    const named = countries
      .map((code) => ({
        code,
        text: `${countryNames.of(code) ?? code} (${code})`,
      }))
      .sort((a, b) => a.text.localeCompare(b.text, intl.locale));
    return {
      countryOptions: named.map(({ code, text }) => ({
        value: code,
        label: flagOption(code, text),
      })),
      // The label is a node, so react-select's default text filter cannot read it; the type-ahead
      // matches this plain-text twin instead.
      countryText: new Map(named.map(({ code, text }) => [code, text])),
    };
  }, [countries, countryNames, intl.locale]);

  // The dialog is titled the way the list row was: Unzer's name for the method type, so the two
  // never disagree and neither follows the checkout copy edited in the fields below.
  const title = methodDisplayName(method.paymentMethodCode);
  // Unzer's own words about the method type, identical in every environment (see the helper).
  const headerDescription = methodVendorDescription(
    method.paymentMethodCode,
    intl
  );

  const setLocalizedField = (
    field: 'name' | 'description',
    locale: string,
    value: string
  ) =>
    setDraft((current) => ({
      ...current,
      [field]: { ...current[field], [locale]: value },
    }));

  /** Write one currency's cell of one amount field, leaving the other currencies' drafts alone. */
  const setAmount =
    (
      setText: (update: (current: AmountText) => AmountText) => void,
      currency: string
    ) =>
    (value: string) =>
      setText((current) => ({ ...current, [currency]: value }));

  const bookingOptions = [
    { value: 'charge', label: intl.formatMessage(messages.bookingCharge) },
    {
      value: 'authorize',
      label: intl.formatMessage(messages.bookingAuthorize),
    },
  ];

  /**
   * What the vendor supports for this method. The merchant chooses ONLY where Unzer supports both; where
   * it supports one, that one is what the save carries - offering a control with a single legal answer
   * is a way of asking a question whose wrong answer the vendor rejects at payment time.
   */
  const vendorBooking = unzerMethodBookingMode(method.paymentMethodCode);
  const supportsBoth =
    vendorBooking === 'both' && method.supportsAuthorize !== false;
  const forcedBookingMode: BookingMode | undefined = supportsBoth
    ? undefined
    : vendorBooking === 'authorize'
      ? 'authorize'
      : 'charge';

  /**
   * Several Unzer methods REQUIRE the basket (Klarna and the whole BNPL family): the payment fails
   * without it. For those the connector always sends it and the screen offers no toggle to break.
   */
  const basketRequired = unzerMethodRequiresBasket(method.paymentMethodCode);

  /** Click to Pay rides on the CARD method - the vendor exposes it as a second affordance, not a method. */
  const offersClickToPay =
    method.paymentMethodCode.toLowerCase() === CLICK_TO_PAY_METHOD_CODE;

  /**
   * The WALLETS carry their own settings: Apple and Google each need details the connector cannot derive - the
   * merchant's identity with them, and what their payment sheet may offer. Each block is rendered on its own
   * method only, and `buildNext` refuses to carry the other one.
   */
  const isGooglePay =
    method.paymentMethodCode.toLowerCase() === GOOGLE_PAY_METHOD_CODE;
  const isApplePay =
    method.paymentMethodCode.toLowerCase() === APPLE_PAY_METHOD_CODE;

  /** Fixed, translated option lists - the same shape `bookingOptions` uses. */
  /**
   * The two countries Unzer serves Google Pay for, named in the operator's own language and followed by the
   * code - the same treatment the country restriction below gets, and the reference integration's source model
   * spells them out too rather than showing bare codes.
   */
  const googleCountryOptions = ['DK', 'CH'].map((code) => ({
    value: code,
    label: `${countryNames.of(code) ?? code} (${code})`,
  }));
  /**
   * The card networks on offer are the VENDOR's and only the vendor's: `vendorCardNetworks` is what
   * the account's keypair reports for this method, already spelled the way its sheet spells it. No fallback list
   * lives here - an account the vendor reports nothing for has nothing to tick, which is the honest state, and a
   * pair hardcoded in this screen would invite a merchant to configure what cannot be charged.
   */
  const networkOptions = (method.vendorCardNetworks ?? []).map((value) => ({
    value,
    label: NETWORK_LABELS[value] ?? value,
  }));
  const googleButtonColorOptions = [
    {
      value: 'default',
      label: intl.formatMessage(messages.walletButtonColorDefault),
    },
    {
      value: 'black',
      label: intl.formatMessage(messages.walletButtonColorBlack),
    },
    {
      value: 'white',
      label: intl.formatMessage(messages.walletButtonColorWhite),
    },
  ];
  /** Google's own `buttonType` set, each label naming what the button then says. */
  const googleButtonTypeOptions = (
    [
      'buy',
      'pay',
      'checkout',
      'order',
      'book',
      'donate',
      'subscribe',
      'plain',
    ] as const
  ).map((value) => ({
    value,
    label: intl.formatMessage(
      messages[`walletButtonType_${value}` as keyof typeof messages]
    ),
  }));
  const googleButtonSizeOptions = [
    { value: 'fill', label: intl.formatMessage(messages.walletButtonSizeFill) },
    {
      value: 'static',
      label: intl.formatMessage(messages.walletButtonSizeStatic),
    },
  ];

  /** Write one field of a wallet block, leaving the rest of the block alone. */
  const setGoogleField = <
    K extends keyof NonNullable<UnzerMethodConfigDto['googlePay']>,
  >(
    field: K,
    value: NonNullable<UnzerMethodConfigDto['googlePay']>[K]
  ) =>
    setDraft((current) => ({
      ...current,
      googlePay: { ...current.googlePay, [field]: value },
    }));
  const setAppleField = <
    K extends keyof NonNullable<UnzerMethodConfigDto['applePay']>,
  >(
    field: K,
    value: NonNullable<UnzerMethodConfigDto['applePay']>[K]
  ) =>
    setDraft((current) => ({
      ...current,
      applePay: { ...current.applePay, [field]: value },
    }));

  /**
   * The wallet blocks as the screen is showing them: the merchant's own value where they set one, the effective
   * default where they did not. `gatewayMerchantId` is carried through untouched - it is the connector's field,
   * re-stamped on every save.
   */
  const googlePayToSave: UnzerMethodConfigDto['googlePay'] = {
    ...draft.googlePay,
    merchantId: draft.googlePay?.merchantId ?? '',
    merchantName: draft.googlePay?.merchantName ?? '',
    countryCode: draft.googlePay?.countryCode ?? 'DK',
    allowedCardNetworks:
      draft.googlePay?.allowedCardNetworks ??
      networkOptions.map((option) => option.value),
    allowCreditCards: draft.googlePay?.allowCreditCards ?? true,
    allowPrepaidCards: draft.googlePay?.allowPrepaidCards ?? true,
    buttonColor: draft.googlePay?.buttonColor ?? 'default',
    buttonType: draft.googlePay?.buttonType ?? 'buy',
    buttonSizeMode: draft.googlePay?.buttonSizeMode ?? 'fill',
  };
  const applePayToSave: UnzerMethodConfigDto['applePay'] = {
    ...draft.applePay,
    supportedNetworks:
      draft.applePay?.supportedNetworks ??
      networkOptions.map((option) => option.value),
    label: draft.applePay?.label ?? '',
  };

  const buildNext = (): UnzerMethodConfigDto => {
    const minAmount = toAmounts(minAmountText);
    const maxAmount = toAmounts(maxAmountText);
    return {
      ...draft,
      // What the screen did not ask about, it decides here rather than persisting whatever the draft
      // happened to carry: the vendor's only booking mode, and the basket the vendor requires.
      bookingMode: forcedBookingMode ?? draft.bookingMode ?? 'charge',
      // Basket data defaults ON: several Unzer methods require it, none is harmed by it, and the
      // richer request is the one more likely to be accepted.
      sendBasketData: basketRequired ? true : (draft.sendBasketData ?? true),
      // An empty map is "no bound in any currency", which the optional field says more plainly.
      minAmount: Object.keys(minAmount).length > 0 ? minAmount : undefined,
      maxAmount: Object.keys(maxAmount).length > 0 ? maxAmount : undefined,
      surcharge: toAmounts(surchargeText),
      /*
       * A wallet block belongs to ONE method: carried onto another it would describe nothing, and the processor
       * refuses it with a 400. So the screen states each block only where it means something - and it states it
       * WHOLE, with the values the controls are showing, rather than only the fields the merchant happened to
       * touch. A saved configuration should read back the way the screen read; the connector then
       * stamps Google's gateway merchant id onto it server-side.
       */
      googlePay: isGooglePay ? googlePayToSave : undefined,
      applePay: isApplePay ? applePayToSave : undefined,
    };
  };

  const handleConfirm = () => {
    const saved = onSave(buildNext());
    // A parent that persists returns a promise: hold the dialog open (primary disabled) until it
    // settles. One that merges synchronously gets no busy state and no stray async update.
    if (!saved) return;
    setSaving(true);
    saved
      // The parent reports the failure; the dialog stays open so the edit survives a rejected save.
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  return (
    <ConfirmationDialog
      size="l"
      // The logo belongs BESIDE the name: it identified the method in the list the merchant just came
      // from, and repeating the name under a centred logo said the same thing twice.
      title={
        <span className="unzer-modal-title">
          <PaymentMethodLogo code={method.paymentMethodCode} name={title} />
          {title}
        </span>
      }
      // A node title carries no accessible name of its own, so the dialog gets one explicitly.
      aria-label={title}
      isOpen={isOpen}
      // A click beside the dialog must not throw the edits away; ✕ and Escape still close.
      onClose={closeUnlessClickedOutside(onClose)}
      onCancel={onClose}
      onConfirm={handleConfirm}
      isPrimaryButtonDisabled={saving}
      labelPrimary={intl.formatMessage(
        saving ? messages.saving : messages.saveChanges
      )}
      labelSecondary={intl.formatMessage(messages.cancel)}
      dataAttributesSecondaryButton={{ 'data-unzer-cancel': 'true' }}
    >
      <Spacings.Stack scale="l">
        {/* Unzer's own description of the method, and where to read more about it. */}
        <Text.Body tone="secondary">
          {headerDescription ? `${headerDescription} ` : ''}
          <a
            className="unzer-link"
            href={unzerMethodDocsUrl(method.paymentMethodCode)}
            target="_blank"
            rel="noreferrer"
          >
            {intl.formatMessage(messages.learnMore)}
          </a>
        </Text.Body>

        <Spacings.Stack scale="m">
          <Spacings.Stack scale="xs">
            <FieldLabel
              title={intl.formatMessage(messages.nameLabel)}
              htmlFor={nameId}
            />
            <Text.Detail tone="secondary">
              {intl.formatMessage(messages.nameHint)}
            </Text.Detail>
            <div className="unzer-field-row">
              <div className="unzer-field-row__scope unzer-field-row__scope--locale">
                <SelectInput
                  name="method-name-language"
                  aria-label={intl.formatMessage(
                    messages.languageSelectorLabel,
                    { field: intl.formatMessage(messages.nameLabel) }
                  )}
                  value={nameLocale}
                  options={localeOptions}
                  isSearchable={false}
                  onChange={(event) =>
                    setNameLocale(String(event.target.value ?? defaultLocale))
                  }
                />
              </div>
              <div className="unzer-field-row__value">
                <TextInput
                  id={nameId}
                  name="method-name"
                  value={draft.name[nameLocale] ?? ''}
                  onChange={(event) =>
                    setLocalizedField('name', nameLocale, event.target.value)
                  }
                />
              </div>
            </div>
          </Spacings.Stack>

          <Spacings.Stack scale="xs">
            <FieldLabel
              title={intl.formatMessage(messages.descriptionLabel)}
              htmlFor={descriptionId}
            />
            <Text.Detail tone="secondary">
              {intl.formatMessage(messages.descriptionHint)}
            </Text.Detail>
            <div className="unzer-field-row">
              <div className="unzer-field-row__scope unzer-field-row__scope--locale">
                <SelectInput
                  name="method-description-language"
                  aria-label={intl.formatMessage(
                    messages.languageSelectorLabel,
                    { field: intl.formatMessage(messages.descriptionLabel) }
                  )}
                  value={descriptionLocale}
                  options={localeOptions}
                  isSearchable={false}
                  onChange={(event) =>
                    setDescriptionLocale(
                      String(event.target.value ?? defaultLocale)
                    )
                  }
                />
              </div>
              <div className="unzer-field-row__value">
                <TextInput
                  id={descriptionId}
                  name="method-description"
                  value={draft.description[descriptionLocale] ?? ''}
                  onChange={(event) =>
                    setLocalizedField(
                      'description',
                      descriptionLocale,
                      event.target.value
                    )
                  }
                />
              </div>
            </div>
          </Spacings.Stack>

          {supportsBoth ? (
            <Spacings.Stack scale="xs">
              <FieldLabel title={intl.formatMessage(messages.bookingLabel)} />
              <Text.Detail tone="secondary">
                {intl.formatMessage(messages.bookingHint)}{' '}
                <a
                  className="unzer-link"
                  href={BOOKING_MODES_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {intl.formatMessage(messages.learnMore)}
                </a>
              </Text.Detail>
              <UnzerRadioGroup
                name="method-booking-mode"
                align="start"
                value={draft.bookingMode ?? 'charge'}
                options={bookingOptions}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    bookingMode: value as BookingMode,
                  }))
                }
              />
            </Spacings.Stack>
          ) : null}

          {/* Each amount is one row: the value, then the currency it is denominated in. The three
              selectors are independent - the connector converts nothing between currencies, so every
              currency keeps its own values and every save carries all of them. */}
          <Spacings.Stack scale="m">
            <Text.Detail tone="secondary">
              {intl.formatMessage(messages.amountsHint)}
            </Text.Detail>

            <AmountField
              id={minAmountId}
              name="method-min-amount"
              label={intl.formatMessage(messages.minAmountLabel)}
              currencyLabel={intl.formatMessage(
                messages.currencySelectorLabel,
                {
                  field: intl.formatMessage(messages.minAmountLabel),
                }
              )}
              currency={minCurrency}
              currencyOptions={currencyOptions}
              onCurrencyChange={setMinCurrency}
              value={minAmountText[minCurrency] ?? ''}
              onValueChange={setAmount(setMinAmountText, minCurrency)}
            />
            <AmountField
              id={maxAmountId}
              name="method-max-amount"
              label={intl.formatMessage(messages.maxAmountLabel)}
              currencyLabel={intl.formatMessage(
                messages.currencySelectorLabel,
                {
                  field: intl.formatMessage(messages.maxAmountLabel),
                }
              )}
              currency={maxCurrency}
              currencyOptions={currencyOptions}
              onCurrencyChange={setMaxCurrency}
              value={maxAmountText[maxCurrency] ?? ''}
              onValueChange={setAmount(setMaxAmountText, maxCurrency)}
            />
            <AmountField
              id={surchargeId}
              name="method-surcharge"
              label={intl.formatMessage(messages.surchargeLabel)}
              hint={intl.formatMessage(messages.surchargeHint)}
              currencyLabel={intl.formatMessage(
                messages.currencySelectorLabel,
                {
                  field: intl.formatMessage(messages.surchargeLabel),
                }
              )}
              currency={surchargeCurrency}
              currencyOptions={currencyOptions}
              onCurrencyChange={setSurchargeCurrency}
              value={surchargeText[surchargeCurrency] ?? ''}
              onValueChange={setAmount(setSurchargeText, surchargeCurrency)}
            />
          </Spacings.Stack>

          <Spacings.Stack scale="xs">
            <FieldLabel title={intl.formatMessage(messages.countriesLabel)} />
            <Text.Detail tone="secondary">
              {intl.formatMessage(messages.countriesHint)}
            </Text.Detail>
            <SelectInput
              name="method-countries"
              aria-label={intl.formatMessage(messages.countriesLabel)}
              isMulti
              // Narrower than the modal: a country list is short entries, and full width made a
              // two-country restriction read as an unfinished field.
              horizontalConstraint={10}
              components={{ Menu: MenuAbove }}
              value={draft.countries}
              options={countryOptions}
              filterOption={(option, input) =>
                (countryText.get(option.value) ?? option.value)
                  .toLowerCase()
                  .includes(input.trim().toLowerCase())
              }
              placeholder={intl.formatMessage(messages.countriesPlaceholder)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  countries: (event.target.value as string[]) ?? [],
                }))
              }
            />
          </Spacings.Stack>

          {basketRequired ? null : (
            <Spacings.Stack scale="xs">
              {/* The text rides INSIDE the toggle's label, so clicking it switches too. */}
              <UnzerToggle
                label={intl.formatMessage(messages.sendBasketLabel)}
                // ON unless the merchant turned it off: the richer request is the one more Unzer
                // methods accept, so an unanswered basket question answers itself with `true`.
                checked={draft.sendBasketData ?? true}
                onChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    sendBasketData: checked,
                  }))
                }
              />
              <Text.Detail tone="secondary">
                {intl.formatMessage(messages.sendBasketDescription)}
              </Text.Detail>
            </Spacings.Stack>
          )}

          {isGooglePay ? (
            <Spacings.Stack scale="s">
              {/* The connector's own field: read off the Unzer keypair and stamped on every save,
                  so it is shown rather than asked for. */}
              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.googlePayGatewayIdLabel)}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.googlePayGatewayIdHint)}
                </Text.Detail>
                <Text.Body>
                  {draft.googlePay?.gatewayMerchantId ||
                    intl.formatMessage(messages.googlePayGatewayIdPending)}
                </Text.Body>
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.googlePayMerchantIdLabel)}
                  htmlFor={googleMerchantIdId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.googlePayMerchantIdHint)}
                </Text.Detail>
                <TextInput
                  id={googleMerchantIdId}
                  name="google-pay-merchant-id"
                  value={draft.googlePay?.merchantId ?? ''}
                  onChange={(event) =>
                    setGoogleField('merchantId', event.target.value)
                  }
                />
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(
                    messages.googlePayMerchantNameLabel
                  )}
                  htmlFor={googleMerchantNameId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.googlePayMerchantNameHint)}
                </Text.Detail>
                <TextInput
                  id={googleMerchantNameId}
                  name="google-pay-merchant-name"
                  value={draft.googlePay?.merchantName ?? ''}
                  onChange={(event) =>
                    setGoogleField('merchantName', event.target.value)
                  }
                />
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.googlePayCountryLabel)}
                  htmlFor={googleCountryId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.googlePayCountryHint)}
                </Text.Detail>
                <SelectInput
                  id={googleCountryId}
                  name="google-pay-country"
                  horizontalConstraint={5}
                  isSearchable={false}
                  value={draft.googlePay?.countryCode ?? 'DK'}
                  options={googleCountryOptions}
                  onChange={(event) =>
                    setGoogleField(
                      'countryCode',
                      String(event.target.value ?? 'DK') as 'DK' | 'CH'
                    )
                  }
                />
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.walletNetworksLabel)}
                  htmlFor={googleNetworksId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.walletNetworksHint)}
                </Text.Detail>
                <SelectInput
                  id={googleNetworksId}
                  name="google-pay-networks"
                  isMulti
                  horizontalConstraint={10}
                  components={{ Menu: MenuAbove }}
                  value={
                    draft.googlePay?.allowedCardNetworks ??
                    networkOptions.map((option) => option.value)
                  }
                  options={networkOptions}
                  onChange={(event) =>
                    setGoogleField(
                      'allowedCardNetworks',
                      (event.target.value as string[]) ?? []
                    )
                  }
                />
              </Spacings.Stack>

              <UnzerToggle
                label={intl.formatMessage(messages.googlePayCreditCardsLabel)}
                checked={draft.googlePay?.allowCreditCards ?? true}
                onChange={(checked) =>
                  setGoogleField('allowCreditCards', checked)
                }
              />
              <UnzerToggle
                label={intl.formatMessage(messages.googlePayPrepaidCardsLabel)}
                checked={draft.googlePay?.allowPrepaidCards ?? true}
                onChange={(checked) =>
                  setGoogleField('allowPrepaidCards', checked)
                }
              />

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.walletButtonColorLabel)}
                  htmlFor={googleButtonColorId}
                />
                <SelectInput
                  id={googleButtonColorId}
                  name="google-pay-button-color"
                  horizontalConstraint={7}
                  isSearchable={false}
                  value={draft.googlePay?.buttonColor ?? 'default'}
                  options={googleButtonColorOptions}
                  onChange={(event) =>
                    setGoogleField(
                      'buttonColor',
                      String(event.target.value ?? 'default') as
                        'default' | 'black' | 'white'
                    )
                  }
                />
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.walletButtonTypeLabel)}
                  htmlFor={googleButtonTypeId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.walletButtonTypeHint)}
                </Text.Detail>
                <SelectInput
                  id={googleButtonTypeId}
                  name="google-pay-button-type"
                  horizontalConstraint={7}
                  isSearchable={false}
                  value={draft.googlePay?.buttonType ?? 'buy'}
                  options={googleButtonTypeOptions}
                  onChange={(event) =>
                    setGoogleField(
                      'buttonType',
                      String(event.target.value ?? 'buy') as NonNullable<
                        UnzerMethodConfigDto['googlePay']
                      >['buttonType']
                    )
                  }
                />
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.walletButtonSizeLabel)}
                  htmlFor={googleButtonSizeId}
                />
                <SelectInput
                  id={googleButtonSizeId}
                  name="google-pay-button-size"
                  horizontalConstraint={7}
                  isSearchable={false}
                  value={draft.googlePay?.buttonSizeMode ?? 'fill'}
                  options={googleButtonSizeOptions}
                  onChange={(event) =>
                    setGoogleField(
                      'buttonSizeMode',
                      String(event.target.value ?? 'fill') as 'static' | 'fill'
                    )
                  }
                />
              </Spacings.Stack>
            </Spacings.Stack>
          ) : null}

          {isApplePay ? (
            <Spacings.Stack scale="s">
              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.walletNetworksLabel)}
                  htmlFor={appleNetworksId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.walletNetworksHint)}
                </Text.Detail>
                <SelectInput
                  id={appleNetworksId}
                  name="apple-pay-networks"
                  isMulti
                  horizontalConstraint={10}
                  components={{ Menu: MenuAbove }}
                  value={
                    draft.applePay?.supportedNetworks ??
                    networkOptions.map((option) => option.value)
                  }
                  options={networkOptions}
                  onChange={(event) =>
                    setAppleField(
                      'supportedNetworks',
                      (event.target.value as string[]) ?? []
                    )
                  }
                />
              </Spacings.Stack>

              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.applePayLabelLabel)}
                  htmlFor={appleLabelId}
                />
                <Text.Detail tone="secondary">
                  {intl.formatMessage(messages.applePayLabelHint)}
                </Text.Detail>
                <TextInput
                  id={appleLabelId}
                  name="apple-pay-label"
                  value={draft.applePay?.label ?? ''}
                  onChange={(event) =>
                    setAppleField('label', event.target.value)
                  }
                />
              </Spacings.Stack>
            </Spacings.Stack>
          ) : null}

          {offersClickToPay ? (
            <Spacings.Stack scale="xs">
              <UnzerToggle
                label={intl.formatMessage(messages.clickToPayLabel)}
                checked={draft.clickToPayEnabled ?? false}
                onChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    clickToPayEnabled: checked,
                  }))
                }
              />
              <Text.Detail tone="secondary">
                {intl.formatMessage(messages.clickToPayDescription)}
              </Text.Detail>
            </Spacings.Stack>
          ) : null}
        </Spacings.Stack>
      </Spacings.Stack>
    </ConfirmationDialog>
  );
};
MethodSettingsModal.displayName = 'MethodSettingsModal';

export default MethodSettingsModal;
