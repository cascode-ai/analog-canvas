import { useEffect, useState } from "react";
import {
  createNetlistExportProfile,
  isNetlistExportProfile,
  NETLIST_PROFILE_IDS,
  setNetlistDefaultTarget,
  type NetlistExportProfile,
  type NetlistProfileId,
  type NetlistQuickTargetFamily,
} from "./netlist-process-presets";
import type { NetlistFormat, NetlistPortCase } from "@icm/netlist";

export const NETLIST_EXPORT_PREFERENCES_KEY = "icm.netlist-export.v1";
export interface NetlistExportPreferences {
  selected: NetlistProfileId;
  format: NetlistFormat;
  portCase: NetlistPortCase;
  profiles: Record<NetlistProfileId, NetlistExportProfile>;
}

export function createDefaultNetlistExportPreferences(): NetlistExportPreferences {
  return {
    selected: "abstract",
    format: "spice",
    portCase: "upper",
    profiles: Object.fromEntries(
      NETLIST_PROFILE_IDS.map((id) => [id, createNetlistExportProfile(id)]),
    ) as NetlistExportPreferences["profiles"],
  };
}

function migrateStoredNetlistExportPreferences(raw: string): string {
  const parsed = JSON.parse(raw) as Partial<NetlistExportPreferences> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return raw;
  if (!parsed.profiles)
    return JSON.stringify({
      ...createDefaultNetlistExportPreferences(),
      ...parsed,
    });
  const profiles = parsed.profiles as Partial<
    Record<NetlistProfileId, NetlistExportProfile>
  >;
  // v1 shipped Abstract, SKY130, and Custom. Add new foundry templates
  // without discarding any edited legacy profile or its selected preset.
  for (const id of ["tsmc28", "tsmc180"] as const) {
    profiles[id] ??= createNetlistExportProfile(id);
  }
  return JSON.stringify({
    format: "spice",
    portCase: "upper",
    ...parsed,
    profiles,
  });
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
  if (parsed.portCase !== "upper" && parsed.portCase !== "lower")
    throw new Error("portCase must be upper or lower.");
  if (
    !NETLIST_PROFILE_IDS.every(
      (id) =>
        isNetlistExportProfile(parsed.profiles?.[id]) &&
        parsed.profiles[id].id === id,
    )
  )
    throw new Error(
      "Keep every preset with valid device targets and parameters.",
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
    return createDefaultNetlistExportPreferences();
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

export function selectNetlistPortCase(
  preferences: NetlistExportPreferences,
  portCase: NetlistPortCase,
): NetlistExportPreferences {
  return { ...preferences, portCase };
}

export function setNetlistExportDeviceTarget(
  preferences: NetlistExportPreferences,
  family: NetlistQuickTargetFamily,
  target: string,
): NetlistExportPreferences {
  const profile = setNetlistDefaultTarget(
    preferences.profiles[preferences.selected],
    family,
    target,
  );
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
      /* Editing and copying work without browser storage. */
    }
  }, [text, error]);
  const changeText = (
    source: string,
    apply?: (next: NetlistExportPreferences) => void,
  ) => {
    setText(source);
    try {
      const next = parseNetlistExportPreferences(source);
      apply?.(next);
      setPreferences(next);
      setError(null);
      return next;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid JSON");
      return null;
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
  const selectPortCase = (portCase: NetlistPortCase) => {
    const next = selectNetlistPortCase(preferences, portCase);
    const source = JSON.stringify(next, null, 2);
    setPreferences(next);
    setText(source);
    setError(null);
  };
  const setDeviceTarget = (
    family: NetlistQuickTargetFamily,
    target: string,
    selected: NetlistProfileId = preferences.selected,
  ) => {
    if (target && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(target)) return;
    const next = setNetlistExportDeviceTarget(
      { ...preferences, selected },
      family,
      target,
    );
    const source = JSON.stringify(next, null, 2);
    setPreferences(next);
    setText(source);
    setError(null);
  };
  const reset = () => {
    const next = createDefaultNetlistExportPreferences();
    setPreferences(next);
    setText(JSON.stringify(next, null, 2));
    setError(null);
  };
  return {
    preferences,
    selected: preferences.selected,
    format: preferences.format,
    portCase: preferences.portCase,
    profile: preferences.profiles[preferences.selected],
    text,
    error,
    changeText,
    selectProfile,
    selectFormat,
    selectPortCase,
    setDeviceTarget,
    reset,
  };
}
