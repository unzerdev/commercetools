/**
 * The branded switch. `label` renders its text INSIDE the `<label>`, which is what makes clicking the
 * text flip the switch - the browser does it - and makes that text the control's accessible name. A
 * toggle whose meaning is carried by a neighbouring row (the methods list) uses `ariaLabel` instead.
 */

export const UnzerToggle = ({
  checked,
  onChange,
  ariaLabel,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  label?: string;
}) => (
  <label className={label ? 'unzer-toggle-field' : 'unzer-toggle'}>
    <span className={label ? 'unzer-toggle' : undefined}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label ? undefined : ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="unzer-toggle__track" />
    </span>
    {label ? <span className="unzer-toggle-field__label">{label}</span> : null}
  </label>
);
