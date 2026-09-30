import { resolveAnnotationName, resolveAnnotationText } from "@icm/derived";
import {
  flattenRichText,
  richTextPresentsIdentifier,
  roleLabelFormat,
  type Annotation,
  type CircuitProject,
  type RichTextDocument,
  type RichTextRun,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { renderDocumentSvg } from "@icm/render-svg";
import { importSpiceSources } from "@icm/spice";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import {
  createTextEditingSession,
  editedBoundAnnotationName,
  editedBoundAnnotationPresentation,
  updateTextEditingSession,
} from "./text-editing";

/**
 * The names that once came out wrong between their spelling and their look,
 * as the editor draws them on Cell Pins and device References, and what a
 * restyle does to the netlist: nothing.
 */
const SOURCE = [
  "* label names",
  ".subckt matrix VIN V_IN CLK RF Q_bar VSS",
  "M1 VIN CLK RF VSS nch W=1u L=1u",
  "R12_a V_IN Q_bar 1k",
  "C1 RF VSS 1p",
  ".ends matrix",
  ".model nch nmos",
  ".end",
  "",
].join("\n");

async function imported() {
  const { project } = await importSpiceSources(
    [{ path: "matrix.cir", bytes: new TextEncoder().encode(SOURCE) }],
    "matrix.cir",
  );
  const drawn = withImportedInstanceDisplays(project!);
  const index = drawn.documents.findIndex(
    (document) => document.sourceBinding?.cellName === "matrix",
  );
  // Net labels on three of its Nets, in the look the editor places them in.
  const document = drawn.documents[index]!;
  for (const name of ["VIN", "V_IN", "Q_bar"]) {
    const { netId } = document.netlist!.terminals.find(
      (terminal) => terminal.name === name,
    )!;
    const format = roleLabelFormat("voltage-node", name);
    document.annotations.push({
      id: `net-label-${name}`,
      kind: "net-label",
      netId,
      binding: { kind: "net-name", netId },
      anchor: {
        kind: "object",
        objectId: document.instances[0]!.id,
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
      ...(format ? { formatOverride: format } : {}),
    });
    // A Net label names its Net through its own claim.
    document.connectivityEvidence.push({
      id: `claim-${name}`,
      kind: "name-claim",
      netId,
      name,
      owner: { kind: "net-label", annotationId: `net-label-${name}` },
      scope: "local",
    });
  }
  // Export this Cell as the root of its own netlist.
  return {
    project: { ...drawn, topDocumentId: drawn.documents[index]!.id },
    index,
  };
}

function styled(document: RichTextDocument) {
  const found = { subscript: "", overbar: "" };
  const visit = (runs: readonly RichTextRun[], styles: Set<string>): void => {
    for (const run of runs) {
      if (run.kind === "span")
        visit(run.children, new Set([...styles, run.style]));
      else if (run.kind === "text") {
        if (styles.has("subscript")) found.subscript += run.value;
        if (styles.has("overbar")) found.overbar += run.value;
      }
    }
  };
  visit(document.runs, new Set());
  return found;
}

function boundLabels(
  document: SchematicDocument,
  kinds = ["cell-terminal-name", "instance-reference", "net-name"],
): Annotation[] {
  return document.annotations.filter((annotation) =>
    kinds.includes(annotation.binding?.kind ?? ""),
  );
}

/** Same characters, other styling: each restyle a Properties or canvas
 * format command can make without touching the name. */
const RESTYLES: [string, (document: RichTextDocument) => RichTextDocument][] = [
  ["upright", (document) => ({ runs: strip(document.runs, "italic") })],
  ["regular weight", (document) => ({ runs: strip(document.runs, "bold") })],
  ["no subscript", (document) => ({ runs: strip(document.runs, "subscript") })],
];

function strip(runs: readonly RichTextRun[], style: string): RichTextRun[] {
  return runs.flatMap((run) =>
    run.kind === "span"
      ? run.style === style
        ? strip(run.children, style)
        : [{ ...run, children: strip(run.children, style) }]
      : [run],
  );
}

describe("label names drawn and restyled in the editor", () => {
  it("draws each Cell Pin and Reference as its name asks, never respelled", async () => {
    const { project, index } = await imported();
    const document = project.documents[index]!;
    const looks = Object.fromEntries(
      boundLabels(document, ["cell-terminal-name", "instance-reference"]).map(
        (annotation) => {
          const name = resolveAnnotationName(document, annotation);
          const text = resolveAnnotationText(document, annotation);
          expect(richTextPresentsIdentifier(text, name), name).toBe(true);
          return [name, { visible: flattenRichText(text), ...styled(text) }];
        },
      ),
    );
    expect(looks).toEqual({
      // Cell Pins: V over IN for both spellings, CLK and RF whole, a bar
      // (not a `_bar` subscript) for the complement.
      VIN: { visible: "VIN", subscript: "IN", overbar: "" },
      V_IN: { visible: "VIN", subscript: "IN", overbar: "" },
      CLK: { visible: "CLK", subscript: "", overbar: "" },
      RF: { visible: "RF", subscript: "", overbar: "" },
      Q_bar: { visible: "Q", subscript: "", overbar: "Q" },
      VSS: { visible: "VSS", subscript: "SS", overbar: "" },
      // References: the index under the device letter, the authored split.
      M1: { visible: "M1", subscript: "1", overbar: "" },
      R12_a: { visible: "R12a", subscript: "a", overbar: "" },
      C1: { visible: "C1", subscript: "1", overbar: "" },
    });
  });

  it("restyling never renames, and SPICE and Spectre stay byte for byte", async () => {
    const { project, index } = await imported();
    const netlists = (current: CircuitProject) =>
      (["spice", "spectre"] as const).map((format) => {
        const result = createDesignNetlistExport(current, { format });
        expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
        return result.status === "ready" ? result.file.text : "";
      });
    const before = netlists(project);
    expect(before[0]).toContain("Q_bar");
    expect(before[0]).toContain("R12_a");
    const document = structuredClone(project.documents[index]!);
    const identities = () => ({
      references: document.instances.map((instance) => instance.reference),
      terminals: document.netlist!.terminals.map((terminal) => terminal.name),
      claims: document.connectivityEvidence,
    });
    const originally = structuredClone(identities());
    expect(boundLabels(document, ["net-name"])).toHaveLength(3);
    for (const [restyle, apply] of RESTYLES) {
      for (const annotation of boundLabels(document)) {
        const name = resolveAnnotationName(document, annotation);
        const session = updateTextEditingSession(
          createTextEditingSession(
            { owner: "annotation", object: annotation },
            document,
          ),
          { content: apply(resolveAnnotationText(document, annotation)) },
        );
        // 8: a format-only edit keeps the electrical name.
        expect(
          editedBoundAnnotationName(document, annotation, session, name),
          `${restyle} ${name}`,
        ).toBe(name);
        annotation.formatOverride = editedBoundAnnotationPresentation(
          document,
          annotation,
          session,
          name,
        );
        expect(resolveAnnotationName(document, annotation)).toBe(name);
      }
      const restyled = {
        ...project,
        documents: project.documents.map((item, at) =>
          at === index ? document : item,
        ),
      };
      expect(netlists(restyled), restyle).toEqual(before);
      // No Reference, Cell terminal name or Net name claim moved.
      expect(identities(), restyle).toEqual(originally);
    }
  });

  it("renders the formatted names without underscores or a spelled-out bar", async () => {
    const { project, index } = await imported();
    const document = project.documents[index]!;
    const svg = renderDocumentSvg(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
    );
    const texts = [...svg.matchAll(/>([^<>]+)</gu)].map(([, text]) => text!);
    // The first text inside each subscript, however deeply it nests.
    const subscripts = [
      ...svg.matchAll(
        /<tspan data-text-run="subscript"[^>]*>(?:<tspan[^>]*>)*([^<]*)/gu,
      ),
    ].map(([, text]) => text);
    // Q_bar's bar is a drawn line, and no text carries `_` or `bar`.
    expect(svg).toContain('data-text-decoration="overbar"');
    expect(texts.filter((text) => /_|bar/u.test(text))).toEqual([]);
    // V_IN and VIN subscript IN; CLK and RF are never split.
    expect(subscripts).toContain("IN");
    expect(subscripts).toContain("a");
    expect(subscripts).not.toContain("LK");
    expect(subscripts).not.toContain("F");
  });
});
