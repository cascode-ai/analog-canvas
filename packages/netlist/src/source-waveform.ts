import type { DesignNetlistParameter } from "./ir.js";

export type IndependentSourceWaveform = "dc" | "pulse" | "sin";

export const PULSE_PARAMETER_NAMES = [
  "low",
  "high",
  "delay",
  "rise",
  "fall",
  "width",
  "period",
] as const;
export const SIN_REQUIRED_PARAMETER_NAMES = [
  "offset",
  "amplitude",
  "frequency",
] as const;
export const SIN_OPTIONAL_PARAMETER_NAMES = [
  "delay",
  "damping",
  "phase",
] as const;
export const AC_PARAMETER_NAMES = ["acMagnitude", "acPhase"] as const;
const SOURCE_PARAMETER_NAMES = [
  "waveform",
  "dc",
  ...AC_PARAMETER_NAMES,
  ...PULSE_PARAMETER_NAMES,
  ...SIN_REQUIRED_PARAMETER_NAMES,
  ...SIN_OPTIONAL_PARAMETER_NAMES,
  // Digital Clock convenience inputs remain loadable but never leak as
  // arbitrary simulator assignments. The Editor already keeps the canonical
  // PULSE fields beside them.
  "dutyCycle",
  "initial",
] as const;

export interface SourceParameterIssue {
  readonly code:
    "INVALID_SOURCE_WAVEFORM" | "MISSING_SOURCE_WAVEFORM_PARAMETER";
  readonly parameter: string;
  readonly message: string;
}

export type NormalizedTransientWaveform =
  | { readonly kind: "dc" }
  | {
      readonly kind: "pulse";
      readonly low: string | undefined;
      readonly high: string | undefined;
      readonly delay: string | undefined;
      readonly rise: string | undefined;
      readonly fall: string | undefined;
      readonly width: string | undefined;
      readonly period: string | undefined;
    }
  | {
      readonly kind: "sin";
      readonly offset: string | undefined;
      readonly amplitude: string | undefined;
      readonly frequency: string | undefined;
      readonly delay: string;
      readonly damping: string;
      readonly phase: string;
    };

export interface NormalizedIndependentSource {
  /** Parameters with an explicit canonical waveform projection. */
  readonly parameters: readonly DesignNetlistParameter[];
  readonly dc?: string;
  readonly ac?: { readonly magnitude: string; readonly phase: string };
  readonly transient: NormalizedTransientWaveform;
  readonly extraParameters: readonly DesignNetlistParameter[];
  readonly issues: readonly SourceParameterIssue[];
}

function parameterMap(parameters: readonly DesignNetlistParameter[]) {
  return new Map(
    parameters.map((item) => [item.name.toLowerCase(), item.rawValue]),
  );
}

/**
 * Normalize every independent source through one explicit waveform contract.
 * The caller supplies a descriptor-owned default only for pre-contract
 * projects. Presence of `period` or another timing field never selects a
 * waveform.
 */
export function normalizeIndependentSource(
  parameters: readonly DesignNetlistParameter[],
  defaultWaveform: IndependentSourceWaveform = "dc",
): NormalizedIndependentSource {
  const values = parameterMap(parameters);
  const authoredWaveform = values.get("waveform")?.trim().toLowerCase();
  const issues: SourceParameterIssue[] = [];
  let waveform: IndependentSourceWaveform = defaultWaveform;
  if (authoredWaveform !== undefined) {
    if (
      authoredWaveform === "dc" ||
      authoredWaveform === "pulse" ||
      authoredWaveform === "sin"
    ) {
      waveform = authoredWaveform;
    } else {
      issues.push({
        code: "INVALID_SOURCE_WAVEFORM",
        parameter: "waveform",
        message: `Source waveform must be dc, pulse, or sin; received ${authoredWaveform || "an empty value"}`,
      });
    }
  }

  const required =
    waveform === "pulse"
      ? PULSE_PARAMETER_NAMES
      : waveform === "sin"
        ? SIN_REQUIRED_PARAMETER_NAMES
        : [];
  for (const name of required) {
    if (!values.get(name)?.trim()) {
      issues.push({
        code: "MISSING_SOURCE_WAVEFORM_PARAMETER",
        parameter: name,
        message: `${waveform.toUpperCase()} waveform requires parameter ${name}`,
      });
    }
  }

  const magnitude = values.get("acmagnitude")?.trim();
  const dc = values.get("dc");
  const canonicalParameters =
    authoredWaveform === undefined
      ? [...parameters, { name: "waveform", rawValue: waveform }]
      : [...parameters];
  canonicalParameters.sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
  );
  const consumed = new Set(
    SOURCE_PARAMETER_NAMES.map((name) => name.toLowerCase()),
  );

  return {
    parameters: canonicalParameters,
    ...(dc === undefined ? {} : { dc }),
    ...(magnitude
      ? {
          ac: {
            magnitude,
            phase: values.get("acphase")?.trim() || "0",
          },
        }
      : {}),
    transient:
      waveform === "pulse"
        ? {
            kind: "pulse",
            low: values.get("low"),
            high: values.get("high"),
            delay: values.get("delay"),
            rise: values.get("rise"),
            fall: values.get("fall"),
            width: values.get("width"),
            period: values.get("period"),
          }
        : waveform === "sin"
          ? {
              kind: "sin",
              offset: values.get("offset"),
              amplitude: values.get("amplitude"),
              frequency: values.get("frequency"),
              delay: values.get("delay") ?? "0",
              damping: values.get("damping") ?? "0",
              phase: values.get("phase") ?? "0",
            }
          : { kind: "dc" },
    extraParameters: parameters.filter(
      (item) => !consumed.has(item.name.toLowerCase()),
    ),
    issues,
  };
}
