import { formalSvgTextFace } from "./text-face.js";

/**
 * A formal SVG that draws the same everywhere (#2427): its text set in a
 * subset of the faces the headless PNG is drawn with, ICM Schematic
 * (Metropolis, DejaVu symbols and the round period in one face), holding
 * only the characters the SVG writes, once per weight and style it uses.
 * Without it a standalone SVG shows whatever Metropolis or fallback the
 * reader's computer has.
 *
 * The subset is cut by HarfBuzz (`harfbuzz-subset.wasm`, no imports), so the
 * same code runs in Node, the browser and the Worker; each passes its own
 * way of reading the wasm and the font files.
 */

/** The four ICM Schematic faces, by the style key the SVG asks for. */
export const ICM_SCHEMATIC_FACES = {
  regular: { file: "ICMSchematic-Regular.ttf", weight: 400, style: "normal" },
  bold: { file: "ICMSchematic-Bold.ttf", weight: 700, style: "normal" },
  italic: {
    file: "ICMSchematic-RegularItalic.ttf",
    weight: 400,
    style: "italic",
  },
  boldItalic: {
    file: "ICMSchematic-BoldItalic.ttf",
    weight: 700,
    style: "italic",
  },
} as const;
export type IcmSchematicStyle = keyof typeof ICM_SCHEMATIC_FACES;

const FAMILY = "ICM Schematic";

export interface SvgFontEmbedSources {
  /** `harfbuzz-subset.wasm`, its bytes or a compiled module. */
  readonly wasm: () => Promise<BufferSource | WebAssembly.Module>;
  /** One file of `packages/exporters/fonts/`. */
  readonly readFont: (file: string) => Promise<Uint8Array>;
}

interface SubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    user: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, which: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_SUBSET_FLAGS_NO_HINTING = 0x1;
const HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE = 0x200;
const SUBSET_FLAGS =
  HB_SUBSET_FLAGS_NO_HINTING | HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
/** Tables a browser does not read to draw the text: math layout, signatures. */
const DROPPED_TABLES = ["MATH", "DSIG", "meta", "BASE", "JSTF"];
const tableTag = (tag: string) =>
  [...tag].reduce(
    (value, character) => value * 256 + character.charCodeAt(0),
    0,
  );

const instances = new WeakMap<SvgFontEmbedSources, Promise<SubsetExports>>();

async function subsetter(sources: SvgFontEmbedSources): Promise<SubsetExports> {
  let instance = instances.get(sources);
  if (!instance) {
    instance = sources.wasm().then(async (wasm) => {
      const compiled =
        wasm instanceof WebAssembly.Module
          ? wasm
          : await WebAssembly.compile(wasm);
      const made = await WebAssembly.instantiate(compiled, {});
      return made.exports as unknown as SubsetExports;
    });
    instances.set(sources, instance);
    instance.catch(() => instances.delete(sources));
  }
  return instance;
}

/** The font holding only `codepoints`, as a TrueType file. */
function subsetFontBytes(
  hb: SubsetExports,
  font: Uint8Array,
  codepoints: Iterable<number>,
): Uint8Array {
  const pointer = hb.malloc(font.byteLength);
  let face = 0;
  let input = 0;
  let subset = 0;
  try {
    new Uint8Array(hb.memory.buffer).set(font, pointer);
    // HB_MEMORY_MODE_WRITABLE: HarfBuzz may use the copy as it is.
    const blob = hb.hb_blob_create(pointer, font.byteLength, 2, 0, 0);
    face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    input = hb.hb_subset_input_create_or_fail();
    if (!input) throw new Error("HarfBuzz could not start a subset");
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const codepoint of codepoints) hb.hb_set_add(unicodes, codepoint);
    // A browser draws outlines without hints, and the text needs only its
    // own glyphs, not every alternate a feature could reach.
    hb.hb_subset_input_set_flags(input, SUBSET_FLAGS);
    const dropped = hb.hb_subset_input_set(
      input,
      HB_SUBSET_SETS_DROP_TABLE_TAG,
    );
    for (const tag of DROPPED_TABLES) hb.hb_set_add(dropped, tableTag(tag));
    subset = hb.hb_subset_or_fail(face, input);
    if (!subset) throw new Error("HarfBuzz could not subset the font");
    const result = hb.hb_face_reference_blob(subset);
    try {
      const data = hb.hb_blob_get_data(result, 0);
      const length = hb.hb_blob_get_length(result);
      const bytes = new Uint8Array(hb.memory.buffer, data, length).slice();
      return withMetropolisLineMetrics(bytes);
    } finally {
      hb.hb_blob_destroy(result);
    }
  } finally {
    if (subset) hb.hb_face_destroy(subset);
    if (input) hb.hb_subset_input_destroy(input);
    if (face) hb.hb_face_destroy(face);
    hb.free(pointer);
  }
}

/**
 * ICM Schematic took its hhea ascent and descent from the DejaVu fallback it
 * was merged with (928/-236), while the editor's Metropolis has 795/-205, its
 * OS/2 typographic values. A browser sizes a text box from hhea, so the
 * embedded face would make labels taller than the editor measured them and
 * push edge labels out of the figure. Copy the typographic values back.
 */
export function withMetropolisLineMetrics(font: Uint8Array): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = new Map<
    string,
    { record: number; offset: number; length: number }
  >();
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...font.subarray(record, record + 4));
    tables.set(tag, {
      record,
      offset: view.getUint32(record + 8),
      length: view.getUint32(record + 12),
    });
  }
  const os2 = tables.get("OS/2");
  const hhea = tables.get("hhea");
  if (!os2 || !hhea) return font;
  for (const [from, to] of [
    [68, 4],
    [70, 6],
    [72, 8],
  ] as const)
    view.setInt16(hhea.offset + to, view.getInt16(os2.offset + from));
  let sum = 0;
  for (let at = 0; at < hhea.length; at += 4) {
    let word = 0;
    for (let byte = 0; byte < 4; byte += 1)
      word =
        word * 256 +
        (at + byte < hhea.length ? (font[hhea.offset + at + byte] ?? 0) : 0);
    sum = (sum + word) % 0x1_0000_0000;
  }
  view.setUint32(hhea.record + 4, sum);
  return font;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/giu,
    (whole, name: string) => {
      if (name[0] !== "#") return ENTITIES[name] ?? whole;
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    },
  );
}

function styleOf(
  attributes: string,
  inherited: IcmSchematicStyle,
): IcmSchematicStyle {
  let bold = inherited === "bold" || inherited === "boldItalic";
  let italic = inherited === "italic" || inherited === "boldItalic";
  const declared = (name: string) =>
    new RegExp(`${name}\\s*[:=]\\s*["']?([a-z0-9]+)`, "u").exec(
      attributes,
    )?.[1];
  const weight = declared("font-weight");
  if (weight)
    bold = weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  const style = declared("font-style");
  if (style) italic = style === "italic" || style === "oblique";
  return bold
    ? italic
      ? "boldItalic"
      : "bold"
    : italic
      ? "italic"
      : "regular";
}

/**
 * Every character the SVG's `<text>` elements write, by the face each is
 * drawn in: weight and style are followed through nested spans.
 */
export function svgTextCharacters(
  svg: string,
): Map<IcmSchematicStyle, Set<number>> {
  const byStyle = new Map<IcmSchematicStyle, Set<number>>();
  for (const [element] of svg.matchAll(/<text\b[\s\S]*?<\/text>/gu)) {
    const stack: IcmSchematicStyle[] = [];
    for (const [
      ,
      close,
      tag,
      attributes,
      selfClosing,
      text,
    ] of element.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/gu)) {
      if (text !== undefined) {
        const style = stack.at(-1) ?? "regular";
        let set = byStyle.get(style);
        for (const character of decode(text)) {
          const codepoint = character.codePointAt(0) ?? 0;
          // Line breaks only move the pen; spaces have a width of their own.
          if (codepoint < 0x20) continue;
          if (!set) byStyle.set(style, (set = new Set()));
          set.add(codepoint);
        }
      } else if (close) stack.pop();
      else if (!selfClosing && tag !== undefined)
        stack.push(styleOf(attributes ?? "", stack.at(-1) ?? "regular"));
    }
  }
  return byStyle;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/** The authored round period's rules; ICM Schematic already draws it. */
const ROUND_PERIOD_FACE =
  /@font-face\{font-family:"ICM Round Period";[^}]*\}/gu;
const EMBEDDED = /<style data-embedded-font="icm-schematic">/u;

/**
 * The SVG with its text in embedded ICM Schematic subsets. An SVG that writes
 * no text, sets another Document face, or was embedded already is returned
 * as it is.
 */
export async function embedSvgFontSubsets(
  svg: string,
  sources: SvgFontEmbedSources,
): Promise<string> {
  if (EMBEDDED.test(svg) || formalSvgTextFace(svg) !== "metropolis") return svg;
  const characters = svgTextCharacters(svg);
  if (!characters.size) return svg;
  const open = /<svg\b[^>]*>/u.exec(svg);
  if (!open || open[0].endsWith("/>")) return svg;
  const hb = await subsetter(sources);
  const rules = await Promise.all(
    [...characters].map(async ([key, codepoints]) => {
      const face = ICM_SCHEMATIC_FACES[key];
      const bytes = subsetFontBytes(
        hb,
        await sources.readFont(face.file),
        codepoints,
      );
      return `@font-face{font-family:"${FAMILY}";src:url(data:font/ttf;base64,${base64(bytes)}) format("truetype");font-weight:${face.weight};font-style:${face.style};font-display:block}`;
    }),
  );
  const body = svg
    .replace(ROUND_PERIOD_FACE, "")
    .replace(/font-family:\s*/gu, `font-family:'${FAMILY}',`)
    .replace(/font-family="/gu, `font-family="'${FAMILY}',`);
  const at = body.indexOf(open[0]) + open[0].length;
  return `${body.slice(0, at)}<style data-embedded-font="icm-schematic">${rules.join("")}</style>${body.slice(at)}`;
}
