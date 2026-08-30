import type { SchematicDocument } from "@icm/model";

import { ColorOverrideControl } from "./color-override-control";

type Instance = SchematicDocument["instances"][number];
type InstanceStyleOverride = NonNullable<Instance["styleOverride"]>;

export { hexToRgb, rgbToHex } from "./color-override-control";

export function ComponentStyleProperties({
  instance,
  defaultForeground,
  onChange,
}: {
  instance: Instance;
  defaultForeground: string;
  onChange: (styleOverride: InstanceStyleOverride | null) => void;
}) {
  const update = (
    key: keyof InstanceStyleOverride,
    value: string | undefined,
  ): void => {
    const next = { ...instance.styleOverride, [key]: value };
    if (value === undefined) delete next[key];
    onChange(Object.keys(next).length === 0 ? null : next);
  };

  return (
    <div className="property-card component-appearance-card">
      <div className="property-section-heading">Appearance</div>
      <small>
        Colors apply only to this component. Wires and document defaults stay
        unchanged.
      </small>
      <ColorOverrideControl
        label="Line / foreground"
        value={instance.styleOverride?.foreground}
        fallback={defaultForeground}
        onChange={(value) => update("foreground", value)}
      />
      <ColorOverrideControl
        label="Background / fill"
        value={instance.styleOverride?.background}
        fallback="#ffffff"
        transparentDefault
        onChange={(value) => update("background", value)}
      />
    </div>
  );
}
