/** The same small controls serve schematic output and native external models.
 * Their owners supply the operation scope and rejection policy. */
export function NetlistCodeSelect({
  label,
  ariaLabel,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const netlistFormatOptions = [
  { value: "spice", label: "SPICE" },
  { value: "spectre", label: "SCS" },
] as const;

export function NetlistCopyButton({
  label = "Copy netlist",
  title = label,
  disabled,
  onCopy,
  testId,
}: {
  label?: string;
  title?: string;
  disabled?: boolean;
  onCopy(): void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="netlist-code-copy"
      data-testid={testId}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onCopy}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M7 7h10v10H7z M13 7V3H3v10h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
