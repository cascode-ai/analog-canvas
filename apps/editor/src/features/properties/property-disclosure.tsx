import { useState, type ReactNode } from "react";

export function PropertyDisclosure({
  title,
  summary,
  defaultOpen = false,
  ariaLabel,
  role = "group",
  className,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  ariaLabel?: string;
  role?: "group" | "region";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={["property-details", "property-disclosure", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel ?? title}
      role={role}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        {summary === undefined ? null : <small>{summary}</small>}
      </summary>
      <div className="property-disclosure-body">{children}</div>
    </details>
  );
}
