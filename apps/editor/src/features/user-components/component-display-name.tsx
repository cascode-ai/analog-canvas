import { useMemo, useRef } from "react";

/** The name field edits the raw JSON candidate without waiting for blur. */
export function ComponentDisplayName({
  source,
  onChange,
  disabled = false,
}: {
  source: string;
  onChange(text: string): void;
  disabled?: boolean;
}) {
  const parsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(source);
      if (!value || typeof value !== "object" || !("symbol" in value))
        return null;
      const symbol = value.symbol;
      if (
        !symbol ||
        typeof symbol !== "object" ||
        !("name" in symbol) ||
        typeof symbol.name !== "string"
      )
        return null;
      return { value, symbol, name: symbol.name };
    } catch {
      return null;
    }
  }, [source]);
  const lastName = useRef("");
  if (parsed?.name.trim()) lastName.current = parsed.name;
  if (!parsed) return null;
  const rename = (name: string) =>
    onChange(
      JSON.stringify(
        { ...parsed.value, symbol: { ...parsed.symbol, name } },
        null,
        2,
      ),
    );
  return (
    <label className="component-definition-name">
      Display name{" "}
      <input
        aria-label="Component display name"
        value={parsed.name}
        disabled={disabled}
        maxLength={100}
        onChange={(event) => rename(event.currentTarget.value)}
        onBlur={() => {
          if (!parsed.name.trim() && lastName.current) rename(lastName.current);
        }}
      />
    </label>
  );
}
