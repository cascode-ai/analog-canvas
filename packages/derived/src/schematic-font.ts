export const schematicRoundPeriodFontBase64 =
  "AAEAAAAKAIAAAwAgT1MvMkiLRg0AAAEoAAAAYGNtYXAADACBAAABkAAAADRnbHlm4Z5vWQAAAcwAAAAgaGVhZC3up0AAAACsAAAANmhoZWEFCgHYAAAA5AAAACRobXR4A8AAaQAAAYgAAAAIbG9jYQAQAAAAAAHEAAAABm1heHAABAAKAAABCAAAACBuYW1l3HZZJQAAAewAAAHacG9zdAAVAAAAAAPIAAAAJgABAAAAAQAAKn0opV8PPPUAAwPoAAAAAOa4MtEAAAAA5rgy0QBpABQA/wCqAAAAAwACAAAAAAAAAAEAAAOg/xQAAAJYAGkAaQD/AAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAgAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwHgAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAAC4ALgOg/xQAAAOgAOwAAAAAAAAAAAIHAtkAAAAgAAACWAAAAWgAaQAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAAALv//AAAALv///9MAAQAAAAAAAAAAABAAAAABAGkAFAD/AKoABwAANzI1NCMiFRS0S0tLFEtLS0sAAAAADACWAAEAAAAAAAEAEAAAAAEAAAAAAAIABwAQAAEAAAAAAAMAHAAXAAEAAAAAAAQAGAAzAAEAAAAAAAUACwBLAAEAAAAAAAYAFgBWAAMAAQQJAAEAIABsAAMAAQQJAAIADgCMAAMAAQQJAAMAOACaAAMAAQQJAAQAMADSAAMAAQQJAAUAFgECAAMAAQQJAAYALAEYSUNNIFJvdW5kIFBlcmlvZFJlZ3VsYXJJQ00gUm91bmQgUGVyaW9kIFJlZ3VsYXIgMS4wSUNNIFJvdW5kIFBlcmlvZCBSZWd1bGFyVmVyc2lvbiAxLjBJQ01Sb3VuZFBlcmlvZC1SZWd1bGFyAEkAQwBNACAAUgBvAHUAbgBkACAAUABlAHIAaQBvAGQAUgBlAGcAdQBsAGEAcgBJAEMATQAgAFIAbwB1AG4AZAAgAFAAZQByAGkAbwBkACAAUgBlAGcAdQBsAGEAcgAgADEALgAwAEkAQwBNACAAUgBvAHUAbgBkACAAUABlAHIAaQBvAGQAIABSAGUAZwB1AGwAYQByAFYAZQByAHMAaQBvAG4AIAAxAC4AMABJAEMATQBSAG8AdQBuAGQAUABlAHIAaQBvAGQALQBSAGUAZwB1AGwAYQByAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAEQAA";

/**
 * One self-authored U+002E glyph: a circular full stop with a 0.36 em
 * advance, matching the deterministic narrow-glyph metric. Every other code
 * point falls through to the calibrated schematic font stack. Keeping this a
 * font boundary preserves the canonical "." character, browser caret and
 * selection behavior, and SVG text semantics.
 */
const schematicRoundPeriodFontFamily = "ICM Round Period";

const roundPeriodSource = `url(data:font/ttf;base64,${schematicRoundPeriodFontBase64}) format("truetype")`;

const roundPeriodFaces = [
  [400, "normal"],
  [400, "italic"],
  [700, "normal"],
  [700, "italic"],
] as const;

const roundPeriodFace = ([weight, style]: (typeof roundPeriodFaces)[number]) =>
  `@font-face{font-family:"${schematicRoundPeriodFontFamily}";src:${roundPeriodSource};font-weight:${weight};font-style:${style};font-display:block;unicode-range:U+002E}`;

/** Every house text style, for a live canvas whose text changes. */
export const schematicRoundPeriodFontFaceCss = roundPeriodFaces
  .map(roundPeriodFace)
  .join("");

/**
 * The faces a finished drawing's markup uses, each embedding the glyph once
 * (#2214): none when no text holds a full stop, and the bold or italic faces
 * only when some text is bold or italic. A face per style keeps the browser
 * from synthesizing a slanted or emboldened period.
 */
export function schematicRoundPeriodFontFaceCssFor(markup: string): string {
  const text = markup.replace(/<[^>]*>/gu, "");
  if (!text.includes(".")) return "";
  const italic = /italic/u.test(markup);
  const bold = /font-weight(?:=["']?|:\s*)(?:bold|[6-9]00)/u.test(markup);
  return roundPeriodFaces
    .filter(
      ([weight, style]) =>
        (weight === 400 || bold) && (style === "normal" || italic),
    )
    .map(roundPeriodFace)
    .join("");
}

export function withSchematicRoundPeriodFont(fallbackStack: string): string {
  return `'${schematicRoundPeriodFontFamily}',${fallbackStack}`;
}
