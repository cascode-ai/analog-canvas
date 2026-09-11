import { useState } from "react";

/** A cancellable local name draft; the caller owns validation and persistence. */
export function InlineSourceName(props: {
  label: string;
  initial: string;
  onSubmit(name: string): void;
  onCancel(): void;
  onChange?(name: string): void;
}) {
  const [name, setName] = useState(props.initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) props.onSubmit(name.trim());
      }}
    >
      <input
        autoFocus
        aria-label={props.label}
        value={name}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setName(next);
          props.onChange?.(next);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") props.onCancel();
        }}
      />
    </form>
  );
}
