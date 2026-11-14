import type { BodyFill, Instance } from "@icm/model";

export interface BodyFillPropertiesProps {
  instances: readonly Instance[];
  supportsBodyFill: (instance: Instance) => boolean;
  background: string;
  onChange: (objectIds: string[], fill: BodyFill | null) => void;
}

export function BodyFillProperties({
  instances,
  supportsBodyFill,
  background,
  onChange,
}: BodyFillPropertiesProps) {
  if (instances.length === 0) return null;
  const eligible = instances.filter(supportsBodyFill);
  const legacy = instances.filter(
    (instance) => instance.styleOverride?.background,
  );
  const modeOf = (instance: Instance) =>
    instance.bodyFill?.kind ??
    (instance.styleOverride?.background ? "legacy" : "transparent");
  const modes = new Set(eligible.map(modeOf));
  const colors = new Set(
    eligible.flatMap((instance) =>
      instance.bodyFill?.kind === "color" ? [instance.bodyFill.color] : [],
    ),
  );
  const mode =
    modes.size > 1 || colors.size > 1
      ? "mixed"
      : (modes.values().next().value ?? "legacy");
  const color =
    colors.size === 1
      ? (colors.values().next().value ?? background)
      : background;
  const customColor = /^#[0-9a-f]{6}$/iu.test(color) ? color : "#ffffff";
  const ids = eligible.map((instance) => instance.id);
  return (
    <section className="property-section" aria-label="Symbol body">
      <div className="property-section-heading">Symbol body</div>
      {eligible.length === 0 ? (
        <p className="inspect-empty">This symbol has no fillable body.</p>
      ) : (
        <>
          <label>
            Body fill
            <select
              aria-label="Body fill"
              value={mode}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (next === "transparent") onChange(ids, null);
                else if (next === "background")
                  onChange(ids, { kind: "background" });
                else if (next === "color")
                  onChange(ids, { kind: "color", color: customColor });
              }}
            >
              {mode === "mixed" ? (
                <option value="mixed" disabled>
                  Mixed
                </option>
              ) : null}
              {mode === "legacy" ? (
                <option value="legacy" disabled>
                  Legacy background
                </option>
              ) : null}
              <option value="transparent">Transparent</option>
              <option value="background">Document background</option>
              <option value="color">Custom color</option>
            </select>
          </label>
          {mode === "color" ? (
            <label>
              Fill color
              <input
                type="color"
                value={customColor}
                aria-label="Body fill color"
                onChange={(event) =>
                  onChange(ids, {
                    kind: "color",
                    color: event.currentTarget.value,
                  })
                }
              />
            </label>
          ) : null}
          {eligible.length !== instances.length ? (
            <p className="inspect-empty">
              {eligible.length} of {instances.length} selected symbols have a
              fillable body.
            </p>
          ) : null}
        </>
      )}
      {legacy.length > 0 ? (
        <button
          type="button"
          onClick={() =>
            onChange(
              legacy.map(({ id }) => id),
              null,
            )
          }
        >
          Clear legacy background
        </button>
      ) : null}
    </section>
  );
}
