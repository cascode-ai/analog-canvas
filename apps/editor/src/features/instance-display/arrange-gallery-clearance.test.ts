import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
} from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { Rect, SchematicDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { arrangeInstanceLabelsReport } from "./arrange-instance-labels";
import { textbookLabelEdits } from "./label-preset";

/** A published Community Gallery smoke fixture from fixtures/label-clearance. */
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

function movedClear(
  fixture: Gallery,
  before: SchematicDocument,
  after: SchematicDocument,
) {
  const was = drawn(fixture, before);
  const context = createLabelClearanceContext(after, fixture.resolver);
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

function gap(a: Rect, b: Rect): number {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );
}

function repaired(fixture: Gallery) {
  const before = fixture.document;
  const { edits, leftInPlace } = arrangeInstanceLabelsReport(
    before,
    fixture.resolver,
    placed(before),
    { includeManual: true },
  );
  const after = edits.length ? apply(fixture, edits) : before;
  const was = createLabelClearanceContext(before, fixture.resolver);
  const now = createLabelClearanceContext(after, fixture.resolver);
  const grid = before.presentation.grid;
  const ownerOf = (id: string) => {
    const label = now.visible.find((item) => item.id === id)!;
    return label.anchor.kind === "object" ? label.anchor.objectId : null;
  };
  const inkBefore = new Map(
    was.visible.map((label) => [label.id, was.measure(label).inkBounds]),
  );
  const moved = movedClear(fixture, before, after);
  const reportedBefore = new Set(
    was.visible.filter((label) => !was.clearAt(label)).map((l) => l.id),
  );
  for (const [id, clear] of moved) {
    expect(clear, id).toBe(true);
    const owner = ownerOf(id);
    const label = now.visible.find((item) => item.id === id)!;
    const ink = now.measure(label).inkBounds;
    expect(now.overlapsAt(ink, id), id).toEqual([]);
    const body = now.symbols.find((symbol) => symbol.id === owner)?.bounds;
    if (!body) continue;
    const own = gap(ink, body);
    expect(own, id).toBeLessThanOrEqual(grid * 2);
    for (const symbol of now.symbols)
      if (symbol.id !== owner)
        expect(
          gap(ink, symbol.bounds),
          `${id} by ${symbol.id}`,
        ).toBeGreaterThan(own);
  }
  for (const instance of after.instances) {
    const name = `instance-label-${instance.id}`;
    const value = `instance-value-${instance.id}`;
    const n = now.labelBounds(name);
    const v = now.labelBounds(value);
    const n0 = inkBefore.get(name);
    const v0 = inkBefore.get(value);
    if (!n || !v || !n0 || !v0) continue;
    expect(gap(n, v), instance.reference).toBeLessThanOrEqual(
      Math.max(grid, gap(n0, v0)),
    );
  }
  const reportedAfter = now.visible
    .filter((label) => !now.clearAt(label))
    .map((label) => label.id);
  for (const id of reportedAfter) {
    expect(reportedBefore.has(id), id).toBe(true);
    expect(
      leftInPlace.map((label) => label.labelId),
      id,
    ).toContain(id);
  }
  return {
    before,
    after,
    edits,
    leftInPlace,
    moved: moved.map(([id]) => id),
  };
}

describe("repairing published Gallery smoke drawings (#2619)", () => {
  it("moves the telescopic op amp's names off their transistors and leaves clear ones", () => {
    const fixture = gallery("296p9s5vn2");
    const before = fixture.document;
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
    for (const name of ["M3", "M5", "M7"])
      expect(leftInPlace).toContainEqual(
        expect.objectContaining({
          labelId: `instance-label-${name}`,
          reason: "clear",
        }),
      );
  });

  it("clears the self-bias circuit's M5 from its drain wire", () => {
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

  it("repairs them with the textbook preset too", () => {
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

  it("keeps 296p9s5vn2's and zp3r9haqg7's repairs within every invariant", () => {
    for (const id of ["296p9s5vn2", "zp3r9haqg7"]) {
      const { moved } = repaired(gallery(id));
      expect(moved.length, id).toBeGreaterThan(0);
    }
  });

  it("moves no label of a drawing with only unreported parts", () => {
    const { edits, leftInPlace } = repaired(gallery("vk3x9wxz7j"));
    expect(edits).toEqual([]);
    for (const label of ["net-label-1", "net-label-2"])
      expect(leftInPlace).toContainEqual(
        expect.objectContaining({ labelId: label, reason: "unarranged" }),
      );
  });
});
