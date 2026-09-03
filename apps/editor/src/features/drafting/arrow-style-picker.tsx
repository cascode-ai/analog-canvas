import { useEffect, useRef } from "react";
import { razaviTextbookProfile } from "@icm/derived";
import { ARROW_PRESETS, type ArrowPreset } from "./arrow-presets";
import { ArrowArtworkView } from "./arrow-artwork-view";

export function ArrowStyleIcon({ preset }: { preset: ArrowPreset }) {
  return (
    <svg viewBox="0 0 64 32" width="64" height="32" aria-hidden="true">
      <ArrowArtworkView
        object={{
          styleOverride: { arrowHead: preset.head, arrowHeadAt: preset.at },
          ...(preset.family === "outline" ? { outline: { width: 24 } } : {}),
        }}
        points={[
          { x: 7, y: 16 },
          { x: 57, y: 16 },
        ]}
        profile={razaviTextbookProfile}
        color="currentColor"
      />
    </svg>
  );
}

/** The same gallery for the next object and the selected object. */
export function ArrowStylePicker({
  value,
  onChange,
  disabled = false,
  canChoose,
  label = "Arrow style",
}: {
  value: ArrowPreset;
  onChange: (preset: ArrowPreset) => void;
  disabled?: boolean;
  canChoose?: (preset: ArrowPreset) => boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node))
        ref.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.removeAttribute("open");
        ref.current.querySelector("summary")?.focus();
        event.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);
  return (
    <details ref={ref} className="arrow-style-picker">
      <summary
        aria-label={label}
        aria-disabled={disabled}
        title={`${label}: ${value.label}`}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <ArrowStyleIcon preset={value} />
        <span aria-hidden="true">▾</span>
      </summary>
      <div
        className="arrow-style-gallery"
        role="group"
        aria-label={`${label} choices`}
      >
        {(["line", "outline"] as const).map((family) => (
          <div key={family}>
            <strong>
              {family === "line" ? "Line arrows" : "Outline arrows"}
            </strong>
            <div className="arrow-style-options">
              {ARROW_PRESETS.filter((p) => p.family === family).map(
                (preset) => {
                  const unavailable =
                    disabled || (canChoose && !canChoose(preset));
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      aria-label={preset.label}
                      aria-pressed={value.id === preset.id}
                      title={
                        unavailable
                          ? "Outline arrows require a straight path; existing bends are preserved"
                          : preset.label
                      }
                      disabled={unavailable}
                      onClick={() => {
                        onChange(preset);
                        ref.current?.removeAttribute("open");
                        ref.current?.querySelector("summary")?.focus();
                      }}
                    >
                      <ArrowStyleIcon preset={preset} />
                    </button>
                  );
                },
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
