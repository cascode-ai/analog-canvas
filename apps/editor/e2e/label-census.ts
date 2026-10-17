import { createRequire } from "node:module";

import {
  isSchematicAnnotationVisible,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveDocumentLogicalNets,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { flattenRichText, type CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

// The labels of a drawing and how an RNL round trip changes them, for the
// Node round-trip tests and the editor's browser tests alike
// (docs/specs/rnl-interchange.md, Acceptance criteria).

/**
 * Every label of a drawing as the editor shows it: the annotation's kind,
 * binding and text, its anchor point, alignment, turn and size, the ink it
 * covers and what it hangs on. Owners are named by their place, since an
 * import renames a part (M1 as XM1) but not where it stands.
 */
export interface LabelRecord {
  cell: string;
  kind: string;
  binding: string;
  owner: string;
  parameter: string;
  text: string;
  at: [number, number];
  alignment: string;
  rotation: number;
  scale: number;
  ink: number[];
  anchor: string;
  hidden: boolean;
  /** The part the label stands for, by symbol. */
  symbol: string;
}

export function labelCensus(
  project: CircuitProject,
  format: "spice" | "spectre",
): LabelRecord[] {
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  return project.documents.flatMap((document) => {
    const profile = resolveDocumentStyleProfile(document.presentation);
    const logical = resolveDocumentLogicalNets(document);
    const placeOf = (id: string) => {
      const instance = document.instances.find((item) => item.id === id);
      const symbol = (instance?.symbolId ?? "")
        .replace("opamp-inputs-swapped", "opamp")
        .replace(/^hierarchical-symbol-.*/u, "block");
      return {
        symbol,
        owner: `${symbol}@${instance?.placement?.position.x},${instance?.placement?.position.y}`,
      };
    };
    return document.annotations.map((annotation): LabelRecord => {
      const text = resolveAnnotationText(document, annotation, logical);
      const shown = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        profile,
        undefined,
        logical,
        text,
      );
      const binding = annotation.binding;
      // Analog Canvas's SCS import keeps a net's Spectre escape (Vin\+) in
      // its name, and a net label reads the name: the escape is not the
      // drawing's.
      const flat =
        format === "spectre" && annotation.kind === "net-label"
          ? flattenRichText(text).replaceAll("\\", "")
          : flattenRichText(text);
      const part =
        binding && "instanceId" in binding
          ? placeOf(binding.instanceId)
          : annotation.kind === "instance-label" &&
              annotation.anchor.kind === "object"
            ? placeOf(annotation.anchor.objectId)
            : undefined;
      const rounded = (value: number) => Math.round(value * 10) / 10;
      return {
        cell: (document.netlist?.name ?? document.name).toLowerCase(),
        kind: annotation.kind,
        binding: binding?.kind ?? "-",
        owner:
          part?.owner ??
          (annotation.kind === "route-marker"
            ? (annotation.markerKind ?? "marker")
            : `${annotation.kind}:${flat}`),
        parameter:
          binding && "parameter" in binding ? (binding.parameter ?? "") : "",
        text: flat,
        at: [rounded(shown.position.x), rounded(shown.position.y)],
        alignment: shown.alignment,
        rotation: shown.rotation,
        scale: annotation.sizeScale ?? 1,
        ink: [
          shown.inkBounds.x,
          shown.inkBounds.y,
          shown.inkBounds.width,
          shown.inkBounds.height,
        ].map(rounded),
        anchor: annotation.anchor.kind,
        hidden: !isSchematicAnnotationVisible(
          document,
          annotation,
          logical,
          text,
        ),
        symbol: part?.symbol ?? "",
      };
    });
  });
}

/**
 * The runtime's writer drops a start alignment on a key's text, so a Cell
 * Pin's name, which the standard port symbol aligns to the end, comes back
 * on the other side of its port. The rnl runtime keeps it from preview.10.
 */
const runtimeVersion: string = createRequire(import.meta.url)(
  "@rich-netlist/runtime/package.json",
).version;
const previewNumber = /-preview\.(\d+)$/u.exec(runtimeVersion)?.[1];
const writerKeepsStartAlignment =
  previewNumber === undefined || Number(previewNumber) >= 10;

/**
 * How each label differs after the round trip, as lines to read; none when
 * every label is where, as big as, and what it was drawn, and none is shown
 * twice.
 *
 * Two kinds of value label are exempt from their text and the ink it
 * covers, as Analog Canvas's own SPICE and SCS imports change them whatever
 * the RNL says: Spectre's numbers come back as plain decimals (15u as
 * 0.000015), and a source the SPICE import reads keeps the rest of its card
 * in its value (0.9 as 0.9 AC 1 0 PULSE(...)). A Cell Pin's alignment is
 * exempt while the writer drops it (above), and so is the ink of a net label
 * that reads a Spectre-escaped name.
 */
export function labelDifferences(
  before: readonly LabelRecord[],
  after: readonly LabelRecord[],
  format: "spice" | "spectre",
): string[] {
  const printed = new Set(after.map((label) => label.cell));
  const exempt = (label: LabelRecord) => ({
    textual:
      label.binding === "instance-value" &&
      (format === "spectre" ||
        ["voltage-source", "current-source"].includes(label.symbol)),
    sided: label.binding === "cell-terminal-name" && !writerKeepsStartAlignment,
    // A net label reads the net's name, escape and all (Vin\+), so its ink
    // is wider than the drawn Vin+.
    escaped: format === "spectre" && label.kind === "net-label",
  });
  const shown = (labels: readonly LabelRecord[]) =>
    labels.filter((label) => !label.hidden && printed.has(label.cell));
  const group = (labels: readonly LabelRecord[]) => {
    const groups = new Map<string, LabelRecord[]>();
    for (const label of labels) {
      // Whether a label stays bound to its text is not the drawing's to say
      // (a name drawn M1 on the card XM1 is its own text), so a label is
      // known by its kind and what it labels.
      const key = [label.cell, label.kind, label.owner, label.parameter].join(
        " | ",
      );
      groups.set(key, [...(groups.get(key) ?? []), label]);
    }
    return groups;
  };
  const was = group(shown(before));
  const now = group(shown(after));
  const lines: string[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const expected = (was.get(key) ?? []).sort((a, b) => a.at[0] - b.at[0]);
    const actual = (now.get(key) ?? []).sort((a, b) => a.at[0] - b.at[0]);
    if (expected.length !== actual.length) {
      lines.push(
        `${key}: ${expected.length} drawn, ${actual.length} after: ${actual.map((label) => `"${label.text}" at ${label.at}`).join("; ")}`,
      );
      continue;
    }
    expected.forEach((label, index) => {
      const other = actual[index]!;
      const skip = exempt(label);
      const problems = [
        !skip.textual && label.text !== other.text && "text",
        (Math.abs(label.at[0] - other.at[0]) > 0.15 ||
          Math.abs(label.at[1] - other.at[1]) > 0.15) &&
          "anchor point",
        !skip.sided && label.alignment !== other.alignment && "alignment",
        label.rotation !== other.rotation && "turn",
        label.scale !== other.scale && "size",
        !skip.textual &&
          !skip.sided &&
          !skip.escaped &&
          label.ink.some(
            (value, at) => Math.abs(value - other.ink[at]!) > 1.1,
          ) &&
          "ink",
        label.anchor !== other.anchor && "anchor kind",
      ].filter(Boolean);
      if (problems.length)
        lines.push(
          `${key}: ${problems.join(", ")}: "${label.text}" at ${label.at} ${label.alignment} ink ${label.ink} ${label.anchor} -> "${other.text}" at ${other.at} ${other.alignment} ink ${other.ink} ${other.anchor}`,
        );
    });
  }
  // A label the drawing hid stays hidden.
  const hiddenOwners = (labels: readonly LabelRecord[]) =>
    labels
      .filter((label) => label.hidden && printed.has(label.cell))
      .map((label) => `${label.cell} ${label.kind} ${label.owner}`);
  const stillHidden = new Set(hiddenOwners(after));
  for (const owner of hiddenOwners(before))
    if (!stillHidden.has(owner)) lines.push(`${owner}: hidden before, shown`);
  return lines;
}
