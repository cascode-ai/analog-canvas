import { useEffect, useState } from "react";
import type { NetlistFormat, NetlistPortCase } from "@icm/netlist";

export const NETLIST_EXPORT_PREFERENCES_KEY = "icm.netlist-export.v1";
export interface NetlistExportPreferences {
  format: NetlistFormat;
  portCase: NetlistPortCase;
}

export function createDefaultNetlistExportPreferences(): NetlistExportPreferences {
  return { format: "spice", portCase: "upper" };
}

export function parseNetlistExportPreferences(
  raw: string,
): NetlistExportPreferences {
  const parsed = JSON.parse(raw) as Partial<NetlistExportPreferences> | null;
  if (!parsed || (parsed.format !== "spice" && parsed.format !== "spectre"))
    throw new Error("format must be spice or spectre.");
  if (parsed.portCase !== "upper" && parsed.portCase !== "lower")
    throw new Error("portCase must be upper or lower.");
  return { format: parsed.format, portCase: parsed.portCase };
}

export function readNetlistExportPreferences(
  raw: string | null,
): NetlistExportPreferences {
  try {
    return parseNetlistExportPreferences(raw ?? "null");
  } catch {
    return createDefaultNetlistExportPreferences();
  }
}

export function selectNetlistExportFormat(
  preferences: NetlistExportPreferences,
  format: NetlistFormat,
): NetlistExportPreferences {
  return { ...preferences, format };
}

export function selectNetlistPortCase(
  preferences: NetlistExportPreferences,
  portCase: NetlistPortCase,
): NetlistExportPreferences {
  return { ...preferences, portCase };
}

/** Output spelling preferences only; electrical bindings remain Project-owned. */
export function useNetlistExportPreferences() {
  const [initial] = useState(() => {
    try {
      return readNetlistExportPreferences(
        window.localStorage.getItem(NETLIST_EXPORT_PREFERENCES_KEY),
      );
    } catch {
      return readNetlistExportPreferences(null);
    }
  });
  const [preferences, setPreferences] = useState(initial);
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (error) return;
    try {
      window.localStorage.setItem(NETLIST_EXPORT_PREFERENCES_KEY, text);
    } catch {
      /* Editing and copying work without browser storage. */
    }
  }, [text, error]);
  const apply = (next: NetlistExportPreferences) => {
    setPreferences(next);
    setText(JSON.stringify(next, null, 2));
    setError(null);
  };
  const changeText = (source: string) => {
    setText(source);
    try {
      setPreferences(parseNetlistExportPreferences(source));
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };
  const selectFormat = (format: NetlistFormat) =>
    apply(selectNetlistExportFormat(preferences, format));
  const selectPortCase = (portCase: NetlistPortCase) =>
    apply(selectNetlistPortCase(preferences, portCase));
  const reset = () => apply(createDefaultNetlistExportPreferences());
  return {
    format: preferences.format,
    portCase: preferences.portCase,
    text,
    error,
    changeText,
    selectFormat,
    selectPortCase,
    reset,
  };
}
