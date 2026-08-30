import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export const COLOR_PRESETS = [
  { label: "Black", value: "#000000" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#d97706" },
  { label: "Yellow", value: "#facc15" },
  { label: "Green", value: "#059669" },
  { label: "Blue", value: "#2563eb" },
  { label: "Gray", value: "#6b7280" },
  { label: "White", value: "#ffffff" },
] as const;

/** Collapse a continuous picker/RGB interaction into one undoable edit. */
const COLOR_SETTLE_MS = 250;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function normalizeHexColor(value: string): string {
  const shorthand = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(value);
  return shorthand
    ? `#${shorthand[1]}${shorthand[1]}${shorthand[2]}${shorthand[2]}${shorthand[3]}${shorthand[3]}`
    : value;
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexToRgb(value: string): RgbColor {
  const normalized = value.replace(/^#/u, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function ColorOverrideControl({
  label,
  value,
  fallback,
  transparentDefault,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  transparentDefault?: boolean;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const effective = normalizeHexColor(value ?? fallback);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ value, onChange });
  latestRef.current = { value, onChange };
  const shown = draft ?? effective;
  const rgb = hexToRgb(shown);

  const cancelSettle = (): void => {
    if (settleRef.current === null) return;
    clearTimeout(settleRef.current);
    settleRef.current = null;
  };
  const commitNow = (next: string | undefined): void => {
    cancelSettle();
    draftRef.current = null;
    setDraft(null);
    const latest = latestRef.current;
    if (next !== latest.value) latest.onChange(next);
  };
  const commitPending = (): void => {
    const pending = draftRef.current;
    if (pending === null) return;
    commitNow(pending);
  };
  const setPending = (next: string): void => {
    draftRef.current = next;
    setDraft(next);
    cancelSettle();
    settleRef.current = setTimeout(commitPending, COLOR_SETTLE_MS);
  };

  useEffect(() => cancelSettle, []);

  const updateChannel = (channel: keyof RgbColor, raw: string): void => {
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    setPending(rgbToHex({ ...rgb, [channel]: clampChannel(parsed) }));
  };
  const colorLabel = /color$/iu.test(label) ? label : `${label} color`;

  return (
    <fieldset className="component-color-control" disabled={disabled}>
      <legend>{label}</legend>
      <div className="component-color-primary-row">
        <input
          aria-label={`${colorLabel} picker`}
          type="color"
          value={shown}
          onChange={(event) => setPending(event.currentTarget.value)}
          onBlur={commitPending}
        />
        <output aria-label={`${colorLabel} hex value`}>
          {draft ?? value ?? (transparentDefault ? "Transparent" : "Automatic")}
        </output>
        <button
          type="button"
          disabled={disabled || !value}
          aria-label={`Reset ${label.toLowerCase()}`}
          title={
            transparentDefault
              ? "Remove the component background"
              : "Use the document ink color"
          }
          onClick={() => commitNow(undefined)}
        >
          Auto
        </button>
      </div>
      <div className="component-color-presets" aria-label={`${label} presets`}>
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="component-color-swatch"
            style={
              {
                "--component-swatch-color": preset.value,
              } as CSSProperties
            }
            aria-label={`Use ${preset.label} for ${label.toLowerCase()}`}
            aria-pressed={shown.toLowerCase() === preset.value}
            title={`${preset.label} · ${preset.value}`}
            onClick={() => commitNow(preset.value)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="component-rgb-inputs" aria-label={`${label} custom RGB`}>
        {(["r", "g", "b"] as const).map((channel) => (
          <label key={channel}>
            {channel.toUpperCase()}
            <input
              aria-label={`${label} ${
                channel === "r" ? "red" : channel === "g" ? "green" : "blue"
              }`}
              type="number"
              min="0"
              max="255"
              step="1"
              value={rgb[channel]}
              onChange={(event) =>
                updateChannel(channel, event.currentTarget.value)
              }
              onBlur={commitPending}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPending();
              }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
