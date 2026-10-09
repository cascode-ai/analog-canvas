// The formula tree the parser builds and the layout sets, and the error
// naming the LaTeX that label type does not set.

export type AtomClass =
  "ord" | "op" | "bin" | "rel" | "open" | "close" | "punct";
export type Font = "italic" | "upright";
export type Alphabet = "double" | "script" | "fraktur" | "mono";
export type Align = "l" | "c" | "r";
/** Display, text, script and scriptscript style, as TeX numbers them. */
export type Style = 0 | 1 | 2 | 3;
export type AtomNode = {
  kind: "atom";
  text: string;
  cls: AtomClass;
  font: Font;
  bold?: boolean;
  /** A large operator, set bigger than the text around it. */
  large?: "sum" | "integral";
  /** Its scripts stand above and below it in display style. */
  limits?: boolean;
  /** A delimiter drawn this many em tall (\big and its kin). */
  stretch?: number;
  /** A \middle delimiter, stretched with the fences around it. */
  middle?: boolean;
};
export type ScriptsNode = {
  kind: "scripts";
  base: Node | null;
  sub?: Node[];
  sup?: Node[];
};
export type Node =
  | AtomNode
  | { kind: "group"; children: Node[]; cls?: AtomClass; limits?: boolean }
  | {
      kind: "frac";
      num: Node[];
      den: Node[];
      force?: "display" | "text";
      /** False for a binomial: the parts stack without a bar. */
      bar?: boolean;
    }
  | ScriptsNode
  | { kind: "radical"; body: Node[]; index?: Node[] }
  | { kind: "overline"; body: Node[] }
  | { kind: "underline"; body: Node[] }
  | {
      kind: "accent";
      mark: string;
      body: Node[];
      /** Stretched across its body: \widehat, \overrightarrow. */
      wide?: boolean;
      /** An arrow, set small above its body: \vec. */
      arrow?: boolean;
    }
  | { kind: "stack"; base: Node[]; over?: Node[]; under?: Node[] }
  | { kind: "xarrow"; arrow: string; over: Node[]; under?: Node[] }
  | {
      kind: "delimited";
      left: string | null;
      right: string | null;
      body: Node[];
    }
  | {
      kind: "array";
      rows: Node[][][];
      /** Each column's alignment; "rl" alternates as aligned does. */
      align: Align[] | "rl";
      cellStyle: Style;
      gaps: "matrix" | "cases" | "aligned";
    }
  | { kind: "phantom"; body: Node[]; width: boolean; height: boolean }
  | { kind: "style"; style: Style }
  | { kind: "space"; em: number };

export class Unsupported extends Error {}
