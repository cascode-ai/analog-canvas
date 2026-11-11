import { DOCUMENT_TEXT_FACES, type DocumentTextFace } from "@icm/model";

/** The one font of every text on the canvas and in its exports (#1725). */
export type DocumentFontCode = "metropolis" | DocumentTextFace;

/** Each font's name in menus, in the order they offer them. */
export const DOCUMENT_FONT_LABELS: Readonly<Record<DocumentFontCode, string>> =
  {
    metropolis: "Metropolis",
    serif: "Times New Roman",
    sans: "Arial",
    "latin-modern": "Latin Modern (LaTeX)",
  };

export function isDocumentFont(value: unknown): value is DocumentFontCode {
  return (
    value === "metropolis" ||
    (DOCUMENT_TEXT_FACES as readonly unknown[]).includes(value)
  );
}

/** The stored face for a font: none for Metropolis. */
export function documentTextFaceForFont(
  font: DocumentFontCode,
): DocumentTextFace | null {
  return font === "metropolis" ? null : font;
}
