import type { Annotation } from "@icm/model";

import { ColorOverrideControl } from "./color-override-control";
import { PropertyDisclosure } from "./property-disclosure";

export function AnnotationColorProperties({
  annotation,
  inheritedColor,
  onChange,
}: {
  annotation: Annotation;
  inheritedColor: string;
  onChange: (textColor: string | undefined) => void;
}) {
  return (
    <section
      className="property-section annotation-text-properties"
      aria-label="Text properties"
    >
      <PropertyDisclosure title="Text appearance" ariaLabel="Text appearance">
        <ColorOverrideControl
          label="Text color"
          value={annotation.textColor}
          fallback={inheritedColor}
          autoTitle="Use the inherited text color"
          disabled={annotation.locked}
          onChange={onChange}
        />
        <small>Auto uses the inherited text color.</small>
      </PropertyDisclosure>
    </section>
  );
}
