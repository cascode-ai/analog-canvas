import {
  DOCUMENT_TEXT_FACE_FONT_FAMILIES,
  type SchematicTextFace,
} from "@icm/derived";

/** The face a formal SVG's text is set in, as its root element says. */
export function formalSvgTextFace(svg: string): SchematicTextFace {
  const face = /^\s*<svg\b[^>]*\sdata-text-face="([a-z-]+)"/u.exec(svg)?.[1];
  return face !== undefined &&
    Object.hasOwn(DOCUMENT_TEXT_FACE_FONT_FAMILIES, face)
    ? (face as SchematicTextFace)
    : "metropolis";
}
