/** The branded radio group - a native input recoloured with `accent-color`, so it stays centred. */

export interface RadioOption {
  value: string;
  label: string;
}

export const UnzerRadioGroup = ({
  name,
  value,
  options,
  onChange,
  align = 'center',
}: {
  name: string;
  value: string;
  options: RadioOption[];
  onChange: (value: string) => void;
  align?: 'center' | 'start';
}) => (
  <div
    className={
      align === 'start'
        ? 'unzer-radio-group unzer-radio-group--start'
        : 'unzer-radio-group'
    }
  >
    {options.map((opt) => (
      <label key={opt.value} className="unzer-radio">
        <input
          type="radio"
          name={name}
          value={opt.value}
          checked={value === opt.value}
          onChange={() => onChange(opt.value)}
        />
        <span>{opt.label}</span>
      </label>
    ))}
  </div>
);

/**
 * The branded switch. `label` renders its text INSIDE the `<label>`, which is what makes clicking the
 * text flip the switch — the browser does it, with no handler to keep in sync — and makes that text the
 * control's accessible name. A toggle whose meaning is carried by a neighbouring row (the methods list)
 * has no text of its own and names itself with `ariaLabel` instead.
 */
