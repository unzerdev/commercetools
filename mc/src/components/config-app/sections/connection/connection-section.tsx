/**
 * The Connection tab of the Unzer configuration screen. It reproduces the Unzer connect screen (see the
 * prototype `connection.tsx`): a two-column body — the credentials form on the left, a pink marketing
 * illustration card on the right — with the UnzerOne headline, merchant-portal / contact copy, an
 * Environment card (Sandbox/Live radios), a Credentials card (public/private keys), and a button row
 * (Connect / Save changes + Disconnect, and a Need-help link). Columns stack on narrow widths.
 *
 * Branded controls (radios, buttons, links) are our own Unzer primitives (`components/ui` + `styles/unzer.css`); the
 * neutral primitives (text, cards, inputs) are commercetools UI Kit.
 *
 * It reads and writes the Formik connection form provided by the parent and receives every side effect as
 * a prop, so the whole save flow is drivable from a unit test without a processor client. `connected` is
 * PERSISTED state owned by the parent — whether the LOADED/last-saved active environment has both API
 * keys; it drives the Disconnect action. The save is server-authoritative: `onSave` PUTs the keys and the
 * processor validates them against Unzer inside that PUT; a rejected Save keeps the form open and surfaces
 * the processor's message. The primary action stays DISABLED until the selected environment carries both
 * keys with the prefix that environment issues (sandbox `s-pub-`/`s-priv-`, live `p-pub-`/`p-priv-`) and
 * the form differs from what is stored — so an empty or plainly wrong form never costs a round trip, and
 * the field message says which key is wrong while the button explains itself by staying shut.
 */

import { Fragment, useId, useState, type ReactNode } from 'react';
import { useFormikContext } from 'formik';
import { useIntl, type MessageDescriptor } from 'react-intl';
import {
  ConfirmationDialog,
  useModalState,
} from '@commercetools-frontend/application-components';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import Card from '@commercetools-uikit/card';
import FieldLabel from '@commercetools-uikit/field-label';
import TextInput from '@commercetools-uikit/text-input';
import PasswordInput from '@commercetools-uikit/password-input';
import { useBusy } from '../../../shared/busy-overlay';
import { EyeIcon, EyeCrossedIcon } from '@commercetools-uikit/icons';
import { ErrorMessage } from '@commercetools-uikit/messages';
import { UnzerButton, UnzerLink, UnzerRadioGroup } from '../../../ui';
import { closeUnlessClickedOutside } from '../../../shared/dialog';
import ConnectionIllustration from '../../../branding/connection-illustration';
import { REDACTED_SECRET } from '../../../../types/config';
import type { ConfigFormValues, StoreMode } from '../../config-model';
import messages from './messages';

/** The Unzer merchant portal, per environment. */
const MERCHANT_PORTAL: Record<StoreMode, string> = {
  sandbox: 'https://sbx-insights.unzer.com',
  live: 'https://insights.unzer.com',
};

/**
 * Unzer's sales-contact page, per language - the German path is not a translation of the English one,
 * so this is a map and not a locale segment.
 */
const CONTACT_URL: Record<string, string> = {
  en: 'https://www.unzer.com/en/sales-team-contact/',
  de: 'https://www.unzer.com/de/kontakt-vertrieb',
};

/** The Unzer support centre, per language. */
const SUPPORT_URL: Record<string, string> = {
  en: 'https://help.unzer.com/en/support/home',
  de: 'https://help.unzer.com/de/support/home',
};

/**
 * An Unzer page in the language the operator is reading (`intl.locale` follows the Merchant Center data
 * locale, see `data-locale-messages`). Matched on the PRIMARY SUBTAG, falling back to English - Unzer
 * serves these pages in `en` and `de` only, and a locale like `sr` must not produce a 404 link.
 */
const localizedUrl = (
  byLanguage: Record<string, string>,
  locale: string
): string => byLanguage[locale.split('-')[0].toLowerCase()] ?? byLanguage.en;

/** The expected API-key prefix per environment (the client-side format guard). */
const KEY_PREFIX: Record<StoreMode, { publicKey: string; privateKey: string }> =
  {
    sandbox: { publicKey: 's-pub-', privateKey: 's-priv-' },
    live: { publicKey: 'p-pub-', privateKey: 'p-priv-' },
  };

export type ConnectionSectionProps = {
  /** PERSISTED connection state of the active environment, owned by the parent. */
  connected: boolean;
  /**
   * Persists the form via the server-validating PUT store-config: the processor validates the submitted
   * keys against Unzer and persists nothing if they are invalid.
   *
   * Resolves TRUE when the save landed and FALSE when it did not — it does NOT reject. The OUTCOME
   * MESSAGE is the parent's job: a failure is surfaced as a side notification next to the success one,
   * so this section stays free of the app-shell notification store and remains renderable in a unit
   * test with nothing but Formik around it.
   */
  onSave: () => Promise<boolean>;
  /**
   * Disconnects the active environment: deletes the saved connection + webhooks through the processor.
   * Resolves TRUE on success, FALSE on failure; like {@link onSave} it never rejects and the parent
   * owns the message.
   */
  onDisconnect: () => Promise<boolean>;
};

const ConnectionSection = ({
  connected,
  onSave,
  onDisconnect,
}: ConnectionSectionProps) => {
  const intl = useIntl();
  const { values, initialValues, dirty, setFieldValue } =
    useFormikContext<ConfigFormValues>();
  const mode = values.mode;
  const environment = values.environments[mode];
  const portalUrl = MERCHANT_PORTAL[mode];
  const helpUrl = localizedUrl(SUPPORT_URL, intl.locale);
  const contactHref = localizedUrl(CONTACT_URL, intl.locale);

  const publicKeyId = useId();
  const privateKeyId = useId();

  const [saving, setSaving] = useState(false);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);

  const disconnectModal = useModalState();
  const [disconnecting, setDisconnecting] = useState(false);
  const rotationModal = useModalState();

  /** Any in-flight action: every action button is disabled while one runs, so two cannot overlap. */
  const busy = saving || disconnecting;

  useBusy(busy);

  const keyPath = (key: 'publicKey' | 'privateKey') =>
    `environments.${mode}.${key}`;

  const setMode = (next: StoreMode) => {
    void setFieldValue('mode', next);
    setPrivateKeyVisible(false);
  };

  /**
   * Validate a key's prefix against the selected environment. An EMPTY key skips this one — a field the
   * operator has not filled in yet is not "wrong", it is unfinished, and the disabled action already says
   * so. The masked sentinel also skips it: credentials now arrive in the clear (processor), so
   * `***` can only come from an OLDER processor still masking — treating it as a malformed key there
   * would block the save over a prefix the operator never typed.
   */
  const prefixError = (
    key: 'publicKey' | 'privateKey',
    label: MessageDescriptor
  ): string | undefined => {
    const value = environment[key];
    if (value === '' || value === REDACTED_SECRET) return undefined;
    const expected = KEY_PREFIX[mode][key];
    if (value.startsWith(expected)) return undefined;
    return intl.formatMessage(messages.keyPrefixError, {
      field: intl.formatMessage(label),
      env: intl.formatMessage(
        mode === 'sandbox'
          ? messages.environmentSandbox
          : messages.environmentLive
      ),
      prefix: expected,
    });
  };

  /**
   * The validation message for one key field, rendered UNDER THAT FIELD — never in a shared slot below
   * the buttons, where the operator has to work out which of the two keys it means. It appears AS THE
   * OPERATOR TYPES rather than on a submit attempt, because the action is disabled until the form is
   * valid: a button that cannot be pressed has to say why, and by then the message is the only place
   * that can.
   */
  const fieldError = (
    key: 'publicKey' | 'privateKey',
    label: MessageDescriptor
  ): string | undefined => prefixError(key, label);

  /**
   * Whether the SELECTED environment is ready to send: both keys present and carrying the prefix that
   * environment issues. Empty is not ready — there is nothing to connect with — and a wrong prefix is a
   * key from the other environment, which the vendor would reject anyway. The action stays disabled
   * until both hold, so a rejection the client can see for itself never costs a round trip.
   */
  const keysReady =
    environment.publicKey.trim() !== '' &&
    environment.privateKey.trim() !== '' &&
    !prefixError('publicKey', messages.publicKeyLabel) &&
    !prefixError('privateKey', messages.privateKeyLabel);

  /**
   * Whether this save REPLACES the account the selected environment is already connected to — the
   * operator changed a key of an environment that already held a working pair. The comparison is against
   * the form's seed, which IS the persisted config (the parent re-seeds it from the server after every
   * save), so it is exactly "different from what Unzer is connected as right now".
   */
  const persistedEnvironment = initialValues.environments[mode];
  const isRotation =
    connected &&
    (environment.publicKey !== persistedEnvironment.publicKey ||
      environment.privateKey !== persistedEnvironment.privateKey);

  const save = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  /**
   * A rotation is confirmed BEFORE it is attempted. Connecting this environment to a different Unzer
   * account discards what belonged to the old one — the processor drops the previous account's webhook
   * subscription and clears this environment's payment-method configuration once the new credentials
   * validate — and none of that is recoverable from this screen. A first connect, or a save that leaves
   * the keys alone, asks nothing.
   */
  const handleSave = async () => {
    if (isRotation) {
      rotationModal.openModal();
      return;
    }
    await save();
  };

  const confirmRotation = async () => {
    rotationModal.closeModal();
    await save();
  };

  const confirmDisconnect = async () => {
    disconnectModal.closeModal();
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  const publicKeyError = fieldError('publicKey', messages.publicKeyLabel);
  const privateKeyError = fieldError('privateKey', messages.privateKeyLabel);

  const portalLink = (chunks: ReactNode) => (
    <UnzerLink href={portalUrl}>{chunks}</UnzerLink>
  );
  const contactLink = (chunks: ReactNode) => (
    <UnzerLink href={contactHref}>{chunks}</UnzerLink>
  );

  const keyed = (nodes: ReactNode): ReactNode =>
    Array.isArray(nodes)
      ? nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)
      : nodes;

  return (
    <div className="unzer-connect-columns">
      {/* Left: form */}
      <div className="unzer-connect-col">
        <Spacings.Stack scale="l">
          <Spacings.Stack scale="xs">
            <Text.Headline as="h1">
              {intl.formatMessage(messages.marketingHeading)}
            </Text.Headline>
            <Text.Body tone="secondary">
              {keyed(
                intl.formatMessage(messages.marketingBody, {
                  portal: portalLink,
                  contact: contactLink,
                })
              )}
            </Text.Body>
          </Spacings.Stack>

          <Card type="raised" insetScale="l">
            <Spacings.Stack scale="m">
              <Text.Subheadline as="h4">
                {intl.formatMessage(messages.environmentLabel)}
              </Text.Subheadline>
              <UnzerRadioGroup
                name="environment"
                value={mode}
                options={[
                  {
                    value: 'sandbox',
                    label: intl.formatMessage(messages.environmentSandbox),
                  },
                  {
                    value: 'live',
                    label: intl.formatMessage(messages.environmentLive),
                  },
                ]}
                onChange={(value) => setMode(value as StoreMode)}
              />
            </Spacings.Stack>
          </Card>

          <Card type="raised" insetScale="l">
            <Spacings.Stack scale="m">
              <Spacings.Stack scale="xs">
                <Text.Subheadline as="h4">
                  {intl.formatMessage(messages.cardTitle)}
                </Text.Subheadline>
                <Text.Detail tone="secondary">
                  {keyed(
                    intl.formatMessage(messages.cardDescription, {
                      portal: portalLink,
                    })
                  )}
                </Text.Detail>
              </Spacings.Stack>
              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.publicKeyLabel)}
                  htmlFor={publicKeyId}
                  hasRequiredIndicator
                />
                <TextInput
                  id={publicKeyId}
                  name="publicKey"
                  value={environment.publicKey}
                  placeholder={intl.formatMessage(
                    messages.publicKeyPlaceholder,
                    { prefix: KEY_PREFIX[mode].publicKey }
                  )}
                  hasError={Boolean(publicKeyError)}
                  onChange={(event) =>
                    setFieldValue(keyPath('publicKey'), event.target.value)
                  }
                />
                {publicKeyError ? (
                  <ErrorMessage>{publicKeyError}</ErrorMessage>
                ) : null}
              </Spacings.Stack>
              <Spacings.Stack scale="xs">
                <FieldLabel
                  title={intl.formatMessage(messages.privateKeyLabel)}
                  htmlFor={privateKeyId}
                  hasRequiredIndicator
                />
                <div className="unzer-secret-field">
                  <PasswordInput
                    id={privateKeyId}
                    name="privateKey"
                    value={environment.privateKey}
                    isPasswordVisible={privateKeyVisible}
                    placeholder={intl.formatMessage(
                      messages.privateKeyPlaceholder,
                      { prefix: KEY_PREFIX[mode].privateKey }
                    )}
                    hasError={Boolean(privateKeyError)}
                    onChange={(event) =>
                      setFieldValue(keyPath('privateKey'), event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="unzer-secret-field__toggle"
                    aria-label={intl.formatMessage(
                      privateKeyVisible
                        ? messages.hidePrivateKey
                        : messages.showPrivateKey
                    )}
                    aria-pressed={privateKeyVisible}
                    onClick={() => setPrivateKeyVisible(!privateKeyVisible)}
                  >
                    {privateKeyVisible ? (
                      <EyeCrossedIcon size="30" />
                    ) : (
                      <EyeIcon size="30" />
                    )}
                  </button>
                </div>
                {privateKeyError ? (
                  <ErrorMessage>{privateKeyError}</ErrorMessage>
                ) : null}
              </Spacings.Stack>
            </Spacings.Stack>
          </Card>

          <div className="unzer-action-row">
            <div className="unzer-action-row__group">
              <UnzerButton
                variant="primary"
                label={
                  saving
                    ? intl.formatMessage(
                        connected ? messages.saving : messages.connecting
                      )
                    : intl.formatMessage(
                        connected ? messages.saveChanges : messages.connect
                      )
                }
                onClick={() => {
                  void handleSave();
                }}
                disabled={busy || !dirty || !keysReady}
              />
              {connected ? (
                <UnzerButton
                  variant="dark"
                  label={
                    disconnecting
                      ? intl.formatMessage(messages.disconnecting)
                      : intl.formatMessage(messages.disconnect)
                  }
                  onClick={disconnectModal.openModal}
                  disabled={busy}
                />
              ) : null}
            </div>
            <UnzerLink href={helpUrl}>
              {intl.formatMessage(messages.needHelp)}
            </UnzerLink>
          </div>
        </Spacings.Stack>
      </div>

      <div className="unzer-connect-col unzer-connect-col--promo">
        <Spacings.Stack scale="m" alignItems="center">
          <ConnectionIllustration />
          <Text.Subheadline as="h4">
            {intl.formatMessage(messages.rightHeading)}
          </Text.Subheadline>
          <Text.Body tone="secondary">
            {intl.formatMessage(messages.rightBody)}
          </Text.Body>
        </Spacings.Stack>
      </div>

      <ConfirmationDialog
        title={intl.formatMessage(messages.rotationConfirmTitle)}
        isOpen={rotationModal.isModalOpen}
        onClose={closeUnlessClickedOutside(rotationModal.closeModal)}
        onCancel={rotationModal.closeModal}
        onConfirm={() => {
          void confirmRotation();
        }}
        labelPrimary={intl.formatMessage(messages.rotationConfirmButton)}
        labelSecondary={intl.formatMessage(messages.cancel)}
        dataAttributesSecondaryButton={{ 'data-unzer-cancel': 'true' }}
      >
        <Spacings.Stack scale="s">
          <Text.Body>
            {intl.formatMessage(messages.rotationConfirmBody)}
          </Text.Body>

          <Text.Body isBold>
            {intl.formatMessage(messages.rotationConfirmWarning)}
          </Text.Body>
        </Spacings.Stack>
      </ConfirmationDialog>

      <ConfirmationDialog
        title={intl.formatMessage(messages.disconnectConfirmTitle)}
        isOpen={disconnectModal.isModalOpen}
        onClose={closeUnlessClickedOutside(disconnectModal.closeModal)}
        onCancel={disconnectModal.closeModal}
        onConfirm={() => {
          void confirmDisconnect();
        }}
        labelPrimary={intl.formatMessage(messages.disconnectConfirmButton)}
        labelSecondary={intl.formatMessage(messages.cancel)}
        dataAttributesSecondaryButton={{ 'data-unzer-cancel': 'true' }}
      >
        <Text.Body>
          {intl.formatMessage(messages.disconnectConfirmBody)}
        </Text.Body>
      </ConfirmationDialog>
    </div>
  );
};
ConnectionSection.displayName = 'ConnectionSection';

export default ConnectionSection;
