/** The branded primary/dark button (own CSS - see `styles/unzer.css`). */

export const UnzerButton = ({
  variant = 'primary',
  label,
  onClick,
  disabled,
  type = 'button',
}: {
  variant?: 'primary' | 'dark';
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) => (
  <button
    type={type}
    className={`unzer-btn unzer-btn--${variant}`}
    onClick={onClick}
    disabled={disabled}
  >
    {label}
  </button>
);
