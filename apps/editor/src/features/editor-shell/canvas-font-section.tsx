import { DOCUMENT_FONT_LABELS, type DocumentFontCode } from "./document-font";

export interface CanvasFontSectionProps {
  font: DocumentFontCode;
  onChange(font: DocumentFontCode): void;
}

/**
 * The canvas-wide font beside a selected text or part (#1725): one choice
 * for every text of this canvas, the same one Canvas settings shows.
 */
export function CanvasFontSection({ font, onChange }: CanvasFontSectionProps) {
  return (
    <section className="context-actions" aria-label="Canvas font">
      <label>
        Canvas font (whole canvas)
        <select
          value={font}
          onChange={(event) =>
            onChange(event.currentTarget.value as DocumentFontCode)
          }
        >
          {Object.entries(DOCUMENT_FONT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
