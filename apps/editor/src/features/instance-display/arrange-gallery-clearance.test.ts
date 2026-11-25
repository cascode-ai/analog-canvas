import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
} from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { arrangeInstanceLabelsReport } from "./arrange-instance-labels";
import { textbookLabelEdits } from "./label-preset";

/** A Gallery drawing from fixtures/label-clearance, as published. */
function gallery(id: string) {
  const project = parseProject(
    readFileSync(
      resolve(process.cwd(), `fixtures/label-clearance/${id}.icproj.json`),
      "utf8",
    ),
  );
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  return { document, resolver };
}

type Gallery = ReturnType<typeof gallery>;

function apply(
  { document, resolver }: Gallery,
  edits: readonly SchematicEdit[],
): SchematicDocument {
  const result = executeTransaction(
    document,
    {
      transactionId: "arrange",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: [...edits],
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

/** Each part name or value the label findings report, by its Reference. */
function reported({ resolver }: Gallery, document: SchematicDocument) {
  const parts = new Map(
    document.instances.map((item) => [item.id, item.reference ?? item.id]),
  );
  const labels = new Map(
    document.annotations.flatMap((annotation) =>
      (annotation.kind === "instance-label" ||
        annotation.kind === "instance-value") &&
      annotation.anchor.kind === "object" &&
      parts.has(annotation.anchor.objectId)
        ? [[annotation.id, parts.get(annotation.anchor.objectId)!] as const]
        : [],
    ),
  );
  return [
    ...new Set(
      diagnoseLabelClearance(document, resolver)
        .filter(
          (d) =>
            (d.code === "VISUAL_LABEL_CLEARANCE" ||
              d.code === "VISUAL_LABEL_CROWDED") &&
            labels.has(d.objectIds[0]!),
        )
        .map((d) => `${labels.get(d.objectIds[0]!)}:${d.code.slice(13)}`),
    ),
  ].sort();
}

/** Where each label is drawn, by id. */
function drawn({ resolver }: Gallery, document: SchematicDocument) {
  const context = createLabelClearanceContext(document, resolver);
  return new Map(
    context.visible.map((label) => [label.id, context.measure(label).position]),
  );
}

/**
 * Every label the edits moved stands where the label findings report
 * nothing: not on a wire, a part, a junction dot or another label, nor
 * within the minimum clearance of one.
 */
function movedClear(
  gallery: Gallery,
  before: SchematicDocument,
  after: SchematicDocument,
) {
  const was = drawn(gallery, before);
  const context = createLabelClearanceContext(after, gallery.resolver);
  return context.visible
    .filter((label) => {
      const from = was.get(label.id);
      const to = context.measure(label).position;
      return from && (from.x !== to.x || from.y !== to.y);
    })
    .map((label) => [label.id, context.clearAt(label)] as const);
}

const placed = (document: SchematicDocument) =>
  document.instances.filter((item) => item.placement).map((item) => item.id);

describe("repairing a Gallery drawing's crowded labels (#2619)", () => {
  it("moves the telescopic op amp's names off their transistors and leaves clear ones", () => {
    // 296p9s5vn2: M4, M6 and M8 were drawn on their own transistors. An
    // includeManual pass had cleared two, then moved M7 across its VDD stub
    // and M3 onto its drain's junction dot.
    const fixture = gallery("296p9s5vn2");
    const before = fixture.document;
    // P6, an output Port, has its name on its own wire: a Pin's name takes
    // its first clear side and has none here, so it stays and is reported.
    expect(reported(fixture, before)).toEqual([
      "M4:CLEARANCE",
      "M6:CLEARANCE",
      "M8:CLEARANCE",
      "P6:CLEARANCE",
    ]);
    const { edits, leftInPlace } = arrangeInstanceLabelsReport(
      before,
      fixture.resolver,
      placed(before),
      { includeManual: true },
    );
    const after = apply(fixture, edits);
    expect(reported(fixture, after)).toEqual(["P6:CLEARANCE"]);
    const moved = movedClear(fixture, before, after);
    expect(moved.map(([id]) => id).sort()).toEqual([
      "instance-label-M4",
      "instance-label-M6",
      "instance-label-M8",
    ]);
    expect(moved.every(([, clear]) => clear)).toBe(true);
    // Hand-placed names nothing reports stay where their author put them.
    for (const name of ["M3", "M5", "M7"])
      expect(leftInPlace).toContainEqual(
        expect.objectContaining({
          labelId: `instance-label-${name}`,
          reason: "clear",
        }),
      );
  });

  it("clears the self-bias circuit's M5 from its drain wire", () => {
    // zp3r9haqg7: M5's name stood on its drain wire, 0.26 units from its
    // line; M1 and M2 leaned on their source arrows.
    const fixture = gallery("zp3r9haqg7");
    const before = fixture.document;
    expect(reported(fixture, before)).toContain("M5:CLEARANCE");
    const { edits } = arrangeInstanceLabelsReport(
      before,
      fixture.resolver,
      placed(before),
      { includeManual: true },
    );
    const after = apply(fixture, edits);
    expect(reported(fixture, after)).toEqual([]);
    expect(movedClear(fixture, before, after).every(([, clear]) => clear)).toBe(
      true,
    );
  });

  it("repairs them with the textbook preset too, which had changed nothing", () => {
    const fixture = gallery("296p9s5vn2");
    const after = apply(
      fixture,
      textbookLabelEdits(
        fixture.document,
        fixture.resolver,
        placed(fixture.document),
      ),
    );
    expect(reported(fixture, after)).toEqual(["P6:CLEARANCE"]);
    expect(
      movedClear(fixture, fixture.document, after).every(([, clear]) => clear),
    ).toBe(true);
  });

  it("moves no label of a published drawing until asked", () => {
    // Stored positions stay on load: only placements and arrangements move
    // labels, so a drawing reads as it was published.
    const fixture = gallery("296p9s5vn2");
    const raw = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "fixtures/label-clearance/296p9s5vn2.icproj.json",
        ),
        "utf8",
      ),
    ) as { documents: SchematicDocument[] };
    const stored = raw.documents[0]!.annotations.map((a) => [a.id, a.anchor]);
    expect(
      stored.map(([id]) => [
        id,
        fixture.document.annotations.find((a) => a.id === id)?.anchor,
      ]),
    ).toEqual(stored);
  });
});
