import type { SchematicDocument } from "@icm/model";

import { ColorOverrideControl } from "./color-override-control";
import { PropertyDisclosure } from "./property-disclosure";

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
    <PropertyDisclosure
      title="Appearance"
      ariaLabel="Component appearance"
      className="component-appearance-card"
    >
      <small>Colors apply to this component only.</small>
      <ColorOverrideControl
        label="Line"
        value={instance.styleOverride?.foreground}
        fallback={defaultForeground}
        onChange={(value) => update("foreground", value)}
      />
      <ColorOverrideControl
        label="Background"
        value={instance.styleOverride?.background}
        fallback="#ffffff"
        transparentDefault
        onChange={(value) => update("background", value)}
      />
    </PropertyDisclosure>
  );
}
