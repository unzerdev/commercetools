/**
 * The Unzer payment-methods tab, reproducing the prototype `payment-methods.tsx`: a heading + descriptive
 * paragraph and one raised Card per method. Each card is a `.unzer-pm-row` - the bundled method logo, the
 * name, and on the right either a `Settings` link (opens the per-method settings modal) when the method is
 * ENABLED or a `Learn more` link (to the Unzer docs) when it is not, plus the enable toggle (magenta when
 * on). The row NEVER wraps: a long name truncates with the full text on hover, so every card in a grid row
 * keeps the same height.
 *
 * There is no tab-level save. A method's settings PERSIST FROM THE MODAL, and switching a method OFF
 * persists immediately - the one action that has no modal to save from, and the one a merchant would
 * otherwise lose on reload. Switching a method ON only stages the change and opens the modal, so the
 * enable and the settings the merchant is about to write reach the processor as ONE save (and Cancel
 * leaves the method off).
 */

import { useState } from 'react';
import { useIntl } from 'react-intl';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import Card from '@commercetools-uikit/card';
import { useBusy } from '../../../../shared/busy-overlay';
import { UnzerToggle } from '../../../../ui';
import type { UnzerMethodConfigDto } from '../../../../../types/config';
import PaymentMethodLogo from '../catalogue/payment-method-logo';
import { methodDisplayName } from '../catalogue/method-display';
import { unzerMethodDocsUrl } from '../catalogue/method-catalogue';
import messages from './messages';

/**
 * The name's size class. Rather than one size that fits the shortest name and cuts the rest, the text
 * steps down as it lengthens: most names sit at the full 16px, and only the longest give a point or two
 * back so they are still read whole beside their actions. The thresholds are character counts, not
 * measurements - the cards are a fixed two-column grid and the artwork is one width, so length is the
 * only thing that varies.
 */
const nameClassName = (name: string): string => {
  if (name.length > 32) return 'unzer-pm-name unzer-pm-name--longest';
  if (name.length > 22) return 'unzer-pm-name unzer-pm-name--long';
  return 'unzer-pm-name';
};

export type PaymentMethodsSectionProps = {
  methods: UnzerMethodConfigDto[];
  onMethodsChange: (next: UnzerMethodConfigDto[]) => void;
  /**
   * Persists the whole method list. It takes the list EXPLICITLY rather than reading the parent's state,
   * so a save never races the `onMethodsChange` that produced it.
   */
  onPersist: (next: UnzerMethodConfigDto[]) => Promise<void>;
  /** Opens the per-method settings modal. When absent, the `Settings` action is disabled. */
  onOpenSettings?: (method: UnzerMethodConfigDto, staged: boolean) => void;
};

const PaymentMethodsSection = ({
  methods,
  onMethodsChange,
  onPersist,
  onOpenSettings,
}: PaymentMethodsSectionProps) => {
  const intl = useIntl();
  const [saving, setSaving] = useState(false);
  useBusy(saving);

  const onToggle = (
    index: number,
    method: UnzerMethodConfigDto,
    enabled: boolean
  ) => {
    const next = methods.map((current, position) =>
      position === index ? { ...current, enabled } : current
    );
    if (enabled) {
      // STAGED: the enable lives in local state until the settings modal saves it, so the merchant
      // configures the method and switches it on in one write (and Cancel puts the toggle back).
      onMethodsChange(next);
      onOpenSettings?.({ ...method, enabled }, true);
      return;
    }
    // Disabling has no modal to save from, so it persists here or not at all.
    setSaving(true);
    onMethodsChange(next);
    onPersist(next)
      // The parent reports the failure; the toggle goes back rather than claiming a state the
      // processor never accepted.
      .catch(() => onMethodsChange(methods))
      .finally(() => setSaving(false));
  };

  return (
    <Spacings.Stack scale="xl">
      <Spacings.Stack scale="xs">
        <Text.Headline as="h1">
          {intl.formatMessage(messages.heading)}
        </Text.Headline>
        <Text.Body tone="secondary">
          {intl.formatMessage(messages.description)}
        </Text.Body>
      </Spacings.Stack>

      {methods.length === 0 ? (
        <Text.Body tone="secondary">
          {intl.formatMessage(messages.noMethods)}
        </Text.Body>
      ) : (
        // Two methods per row where the screen allows it: the list is 20+ entries long and a single
        // column turned choosing one into a scroll.
        <div className="unzer-pm-grid">
          {methods.map((method, index) => {
            // The vendor's own name, never the merchant's checkout copy: this is the
            // administration screen (see `methodDisplayName`).
            const name = methodDisplayName(method.paymentMethodCode);
            return (
              <Card key={method.paymentMethodCode} type="raised" insetScale="m">
                <div className="unzer-pm-row">
                  <div className="unzer-pm-info">
                    <PaymentMethodLogo
                      code={method.paymentMethodCode}
                      name={name}
                      url={method.logo}
                    />
                    {/* Name only: the description belongs to the settings modal, where there is room to
                        read it. Repeated across 20+ rows it made the list a wall of text to scroll.
                        A long name wraps and steps down a size rather than widening the card; past two
                        lines it ellipsizes and `title` gives the rest back on hover. */}
                    <div className={nameClassName(name)} title={name}>
                      {name}
                    </div>
                  </div>
                  <div className="unzer-pm-ops">
                    {method.enabled ? (
                      <button
                        type="button"
                        className="unzer-pm-link"
                        disabled={!onOpenSettings}
                        onClick={() => onOpenSettings?.(method, false)}
                      >
                        {intl.formatMessage(messages.settings)}
                      </button>
                    ) : (
                      <a
                        className="unzer-pm-link"
                        // THIS method's page, not the documentation root: the operator is deciding
                        // whether to switch this one on, and Unzer's slugs match neither the code nor
                        // the name (`paylater-invoice` → `/invoice/`).
                        href={unzerMethodDocsUrl(method.paymentMethodCode)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {intl.formatMessage(messages.learnMore)}
                      </a>
                    )}
                    <UnzerToggle
                      ariaLabel={intl.formatMessage(messages.enableMethod, {
                        method: name,
                      })}
                      checked={method.enabled}
                      onChange={(enabled) => onToggle(index, method, enabled)}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Spacings.Stack>
  );
};
PaymentMethodsSection.displayName = 'PaymentMethodsSection';

export default PaymentMethodsSection;
