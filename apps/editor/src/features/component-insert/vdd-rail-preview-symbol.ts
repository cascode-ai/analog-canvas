import type { SymbolDefinition } from "@icm/symbols";

/**
 * Editor-only artwork for the virtual Power Rail Library item. This definition
 * is deliberately absent from the product Symbol Resolver: it may be rendered
 * in the picker and placement preview, but it can never become an Instance.
 *
 * The drawing is a long rail with taps hanging off it, not the single stem
 * of a supply Port. The two entries do different things — one places a point,
 * the other draws a conductor between two clicks — so they must not read as
 * the same tool in the Library.
 */
export const vddRailPreviewSymbol = {
  schemaVersion: 1,
  id: "vdd",
  name: "Power Rail",
  viewBox: { x: -14, y: -4, width: 28, height: 26 },
  pins: [
    {
      name: "P",
      role: "power",
      at: { x: 0, y: 20 },
      direction: "south",
      presentation: { visibility: "visible", leadLength: 10 },
    },
  ],
  primitives: [
    {
      kind: "polygon",
      points: [
        { x: -12, y: -1.6 },
        { x: 12, y: -1.6 },
        { x: 12, y: 1.6 },
        { x: -12, y: 1.6 },
      ],
      fill: "foreground",
      stroke: "none",
    },
    {
      kind: "line",
      from: { x: -7, y: 1.6 },
      to: { x: -7, y: 11 },
      style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
    },
    {
      kind: "line",
      from: { x: 0, y: 1.6 },
      to: { x: 0, y: 20 },
      style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
    },
    {
      kind: "line",
      from: { x: 7, y: 1.6 },
      to: { x: 7, y: 11 },
      style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
    },
  ],
  variants: [],
  labelVisibility: "hidden",
} satisfies SymbolDefinition;
