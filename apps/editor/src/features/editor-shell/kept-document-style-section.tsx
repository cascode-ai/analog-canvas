import type { KeptDocumentStyle } from "./kept-document-style";

export interface KeptDocumentStyleSectionProps {
  kept: KeptDocumentStyle | null;
  onRelease(): void;
}

/** Say that a copy keeps its source's look, and let it follow this drawing. */
export function KeptDocumentStyleSection({
  kept,
  onRelease,
}: KeptDocumentStyleSectionProps) {
  if (!kept) return null;
  return (
    <section
      className="context-actions"
      aria-label="Copied style"
      data-testid="kept-document-style"
    >
      <h2>Copied style</h2>
      <p>
        Keeps the style of the drawing it was copied from: {kept.description}.
      </p>
      <button type="button" onClick={onRelease}>
        Use this drawing's style
      </button>
    </section>
  );
}
