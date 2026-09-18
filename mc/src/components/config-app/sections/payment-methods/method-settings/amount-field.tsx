/**
 * One money field beside the currency it is denominated in. Each amount carries its OWN selector, so a
 * EUR minimum and a USD surcharge need no shared control; only the selected currency's value is on
 * screen and the rest are saved untouched. `min`/`step` come from that currency (`1` for JPY).
 */

import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import FieldLabel from '@commercetools-uikit/field-label';
import NumberInput from '@commercetools-uikit/number-input';
import SelectInput from '@commercetools-uikit/select-input';
import { placeholderFor, stepFor } from './method-amounts';

export type AmountFieldProps = {
  id: string;
  name: string;
  label: string;
  hint?: string;
  /** Accessible name for the currency selector (the visible label belongs to the amount). */
  currencyLabel: string;
  currency: string;
  currencyOptions: { value: string; label: string }[];
  onCurrencyChange: (currency: string) => void;
  value: string;
  onValueChange: (value: string) => void;
};

const AmountField = ({
  id,
  name,
  label,
  hint,
  currencyLabel,
  currency,
  currencyOptions,
  onCurrencyChange,
  value,
  onValueChange,
}: AmountFieldProps) => (
  <Spacings.Stack scale="xs">
    <FieldLabel title={label} htmlFor={id} />
    {hint ? <Text.Detail tone="secondary">{hint}</Text.Detail> : null}
    <div className="unzer-field-row">
      <div className="unzer-field-row__value">
        <NumberInput
          id={id}
          name={name}
          value={value}
          min={0}
          step={stepFor(currency)}
          placeholder={placeholderFor(currency)}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </div>
      <div className="unzer-field-row__scope">
        <SelectInput
          name={`${name}-currency`}
          aria-label={currencyLabel}
          value={currency}
          options={currencyOptions}
          isSearchable={false}
          onChange={(event) =>
            onCurrencyChange(String(event.target.value ?? currency))
          }
        />
      </div>
    </div>
  </Spacings.Stack>
);
AmountField.displayName = 'AmountField';

export default AmountField;
