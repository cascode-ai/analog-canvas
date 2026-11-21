import { useId, type ReactNode } from "react";

/**
 * A setting reached through one action: its name, the action where a row's
 * value starts, and a note under both when one applies.
 */
export function PropertyActionRow({
  label,
  note,
  children,
}: {
  label: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div
      className="instance-property-row"
      role="group"
      aria-labelledby={labelId}
    >
      <span id={labelId}>{label}</span>
      {children}
      {note ? <small>{note}</small> : null}
    </div>
  );
}
