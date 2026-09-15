import { useEffect, useState } from "react";
import {
  createNetlistExportProfile,
  isNetlistExportProfile,
  NETLIST_PROFILE_IDS,
  type NetlistExportProfile,
  type NetlistProfileId,
} from "@icm/netlist";

export const NETLIST_EXPORT_PREFERENCES_KEY = "icm.netlist-export.v1";
export interface NetlistExportPreferences {
  selected: NetlistProfileId;
  profiles: Record<NetlistProfileId, NetlistExportProfile>;
}
export function parseNetlistExportPreferences(
  raw: string,
): NetlistExportPreferences {
  const parsed = JSON.parse(raw) as NetlistExportPreferences | null;
  if (!parsed || !NETLIST_PROFILE_IDS.includes(parsed.selected))
    throw new Error('selected must be "abstract", "sky130", or "custom".');
  if (
    !NETLIST_PROFILE_IDS.every(
      (id) =>
        isNetlistExportProfile(parsed.profiles?.[id]) &&
        parsed.profiles[id].id === id,
    )
  )
    throw new Error(
      "Keep all three profiles with valid device parameters and library settings.",
    );
  return parsed;
}
export function readNetlistExportPreferences(
  raw: string | null,
): NetlistExportPreferences {
  try {
    return parseNetlistExportPreferences(raw ?? "null");
  } catch {
    return {
      selected: "abstract",
      profiles: Object.fromEntries(
        NETLIST_PROFILE_IDS.map((id) => [id, createNetlistExportProfile(id)]),
      ) as NetlistExportPreferences["profiles"],
    };
  }
}

/** Raw JSON is the complete configuration surface; valid edits apply immediately. */
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
      /* Editing and downloading work without browser storage. */
    }
  }, [text, error]);
  const changeText = (source: string) => {
    setText(source);
    try {
      setPreferences(parseNetlistExportPreferences(source));
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };
  return {
    profile: preferences.profiles[preferences.selected],
    text,
    error,
    changeText,
  };
}
