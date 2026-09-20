import { useState } from "react";
import type {
  PortLabelFormatOptions,
  PortLabelSuffixCase,
  PortLabelSuffixPlacement,
} from "@icm/model";

export interface PortLabelFormatPropertiesProps {
  documentId: string;
  labelCount: number;
  onFormat(options: PortLabelFormatOptions): void;
}

/** Current-Cell batch formatting kept with the canvas Properties tools. */
export function PortLabelFormatProperties({
  labelCount,
  onFormat,
}: PortLabelFormatPropertiesProps) {
  const [suffixCase, setSuffixCase] = useState<PortLabelSuffixCase>("preserve");
  const [suffixPlacement, setSuffixPlacement] =
    useState<PortLabelSuffixPlacement>("subscript");

  return (
    <section
      className="property-section port-label-format-properties"
      aria-label="Port label formatting"
    >
      <div className="property-section-heading">Port labels</div>
      <div className="port-label-format-controls">
        <label>
          Suffix case
          <select
            aria-label="Port label suffix case"
            value={suffixCase}
            onChange={(event) =>
              setSuffixCase(event.currentTarget.value as PortLabelSuffixCase)
            }
          >
            <option value="preserve">Keep typed case</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="lowercase">lowercase</option>
          </select>
        </label>
        <label>
          Suffix position
          <select
            aria-label="Port label suffix position"
            value={suffixPlacement}
            onChange={(event) =>
              setSuffixPlacement(
                event.currentTarget.value as PortLabelSuffixPlacement,
              )
            }
          >
            <option value="subscript">Subscript</option>
            <option value="baseline">Baseline</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={labelCount === 0}
        onClick={() => onFormat({ suffixCase, suffixPlacement })}
      >
        Format all Port labels
      </button>
      <small>
        Applies to {labelCount} label{labelCount === 1 ? "" : "s"} in this Cell.
        The first character stays bold italic; Port names and electrical
        connections do not change.
      </small>
    </section>
  );
}
