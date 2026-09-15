import { useEffect, useState } from "react";
import {
  createNetlistExportProfile,
  isNetlistExportProfile,
  NETLIST_PROFILE_IDS,
  type NetlistExportProfile,
  type NetlistFormat,
  type NetlistProfileId,
} from "@icm/netlist";

export const NETLIST_EXPORT_PREFERENCES_KEY = "icm.netlist-export.v1";
export interface NetlistExportPreferences {
  selected: NetlistProfileId;
  format: NetlistFormat;
  profiles: Record<NetlistProfileId, NetlistExportProfile>;
}

function defaultNetlistExportPreferences(): NetlistExportPreferences {
  return {
    selected: "abstract",
    format: "spice",
    profiles: Object.fromEntries(
      NETLIST_PROFILE_IDS.map((id) => [id, createNetlistExportProfile(id)]),
    ) as NetlistExportPreferences["profiles"],
  };
}

function migrateStoredNetlistExportPreferences(raw: string): string {
  const parsed = JSON.parse(raw) as Partial<NetlistExportPreferences> | null;
  if (!parsed?.profiles || typeof parsed.profiles !== "object") return raw;
  const profiles = parsed.profiles as Partial<
    Record<NetlistProfileId, NetlistExportProfile>
  >;
  // v1 shipped Abstract, SKY130, and Custom. Add new foundry templates
  // without discarding any edited legacy profile or its selected preset.
  for (const id of ["tsmc28", "tsmc180"] as const) {
    profiles[id] ??= createNetlistExportProfile(id);
  }
  return JSON.stringify({ format: "spice", ...parsed, profiles });
}

export function parseNetlistExportPreferences(
  raw: string,
): NetlistExportPreferences {
  const parsed = JSON.parse(raw) as NetlistExportPreferences | null;
  if (!parsed || !NETLIST_PROFILE_IDS.includes(parsed.selected))
    throw new Error(
      `selected must be one of: ${NETLIST_PROFILE_IDS.join(", ")}.`,
    );
  if (parsed.format !== "spice" && parsed.format !== "spectre")
    throw new Error("format must be spice or spectre.");
  if (
    !NETLIST_PROFILE_IDS.every(
      (id) =>
        isNetlistExportProfile(parsed.profiles?.[id]) &&
        parsed.profiles[id].id === id,
    )
  )
    throw new Error(
      "Keep every preset with valid device parameters and library settings.",
    );
  return parsed;
}
export function readNetlistExportPreferences(
  raw: string | null,
): NetlistExportPreferences {
  try {
    return parseNetlistExportPreferences(
      migrateStoredNetlistExportPreferences(raw ?? "null"),
    );
  } catch {
    return defaultNetlistExportPreferences();
  }
}

export function selectNetlistExportProfile(
  preferences: NetlistExportPreferences,
  selected: NetlistProfileId,
): NetlistExportPreferences {
  return { ...preferences, selected };
}

export function selectNetlistExportFormat(
  preferences: NetlistExportPreferences,
  format: NetlistFormat,
): NetlistExportPreferences {
  return { ...preferences, format };
}

export function setNetlistExportMosTarget(
  preferences: NetlistExportPreferences,
  family: "nmos" | "pmos",
  target: string,
): NetlistExportPreferences {
  const profile = structuredClone(preferences.profiles[preferences.selected]);
  profile.devices[family].target = target;
  return {
    ...preferences,
    profiles: { ...preferences.profiles, [preferences.selected]: profile },
  };
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
  const selectProfile = (selected: NetlistProfileId) => {
    const next = selectNetlistExportProfile(preferences, selected);
    const source = JSON.stringify(next, null, 2);
    setPreferences(next);
    setText(source);
    setError(null);
  };
  const selectFormat = (format: NetlistFormat) => {
    const next = selectNetlistExportFormat(preferences, format);
    const source = JSON.stringify(next, null, 2);
    setPreferences(next);
    setText(source);
    setError(null);
  };
  const setMosTarget = (family: "nmos" | "pmos", target: string) => {
    if (target && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(target)) return;
    const next = setNetlistExportMosTarget(preferences, family, target);
    const source = JSON.stringify(next, null, 2);
    setPreferences(next);
    setText(source);
    setError(null);
  };
  return {
    selected: preferences.selected,
    format: preferences.format,
    profile: preferences.profiles[preferences.selected],
    text,
    error,
    changeText,
    selectProfile,
    selectFormat,
    setMosTarget,
  };
}
