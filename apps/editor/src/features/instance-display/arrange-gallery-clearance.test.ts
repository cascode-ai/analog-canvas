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

/** A Gallery drawing from fixtures/label-clearance, as published. */
function gallery(id: string, documentId?: string) {
  const project = parseProject(
    readFileSync(
      resolve(process.cwd(), `fixtures/label-clearance/${id}.icproj.json`),
      "utf8",
    ),
  );
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const document = project.documents.find(
    (item) => item.id === (documentId ?? project.topDocumentId),
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

  it("keeps 296p9s5vn2's and zp3r9haqg7's repairs within every rule", () => {
    for (const id of ["296p9s5vn2", "zp3r9haqg7"]) {
      const { moved } = repaired(gallery(id));
      expect(moved.length, id).toBeGreaterThan(0);
    }
  });
});

/**
 * A Gallery dry run of includeManual over all 8,574 public drawings kept
 * every netlist and broke six rules of a repair (#2619). Each drawing here
 * is one that broke a rule, as published; `repaired` checks every rule on
 * each.
 */
describe("a Gallery repair keeps to the rules a dry run found broken (#2619)", () => {
  it("moves no label of a drawing nothing reports", () => {
    // vk3x9wxz7j: only Net labels and a note far from their parts. A dry
    // run moved 3,555 labels of parts nothing reported, in 1,287 drawings.
    const { edits, leftInPlace } = repaired(gallery("vk3x9wxz7j"));
    expect(edits).toEqual([]);
    // The Net labels it does not move are named, not passed over.
    for (const label of ["net-label-1", "net-label-2"])
      expect(leftInPlace).toContainEqual(
        expect.objectContaining({ labelId: label, reason: "unarranged" }),
      );
  });

  it("leaves a block's name centred in its own box, and does not report it", () => {
    // ag-1146: "Varactor & Switched caps" is centred in its block. It was
    // reported as drawn over the block and repaired 160 units out of it.
    const fixture = gallery("ag-1146");
    const name = "instance-master-xblk";
    const findings = diagnoseLabelClearance(fixture.document, fixture.resolver);
    expect(findings.filter((d) => d.objectIds[0] === name)).toEqual([]);
    const { moved, leftInPlace } = repaired(fixture);
    expect(moved).not.toContain(name);
    // M6's name, over its own transistor's outline, has its nearest clear
    // place three grid steps off, past a repair's reach: it stays, named.
    expect(leftInPlace).toContainEqual(
      expect.objectContaining({
        labelId: "instance-label-instance-7690a770-9308-405b-a10d-44fadb7c16fc",
        reason: "crowded",
      }),
    );
  });

  it("puts no label onto another, moved or not", () => {
    // ar-3923: a repair had moved a value onto a label left where it was.
    const fixture = gallery("ar-3923");
    const { after } = repaired(fixture);
    expect(reported(fixture, after)).toEqual([]);
  });

  it("moves a part's name and value together", () => {
    // i2n-1306: R14's 220Ω, crowded by the ground under it, had been moved
    // away from its R14 and stood by the ground. Both move one row up, or,
    // that being past a grid step for a label only crowded, both stay.
    const fixture = gallery("i2n-1306");
    const { before, after } = repaired(fixture);
    const r14 = "instance-212285a2-d870-489d-bfec-0278a72d8a2f";
    const was = drawn(fixture, before);
    const now = drawn(fixture, after);
    const shift = (id: string) => ({
      x: now.get(id)!.x - was.get(id)!.x,
      y: now.get(id)!.y - was.get(id)!.y,
    });
    expect(shift(`instance-label-${r14}`)).toEqual(
      shift(`instance-value-${r14}`),
    );
  });

  it("turns a Port's name about its own end, never onto a part", () => {
    // ag-1026: v_in⁻ had been moved off its Port onto Q5's emitter.
    const fixture = gallery("ag-1026");
    const port = "instance-label-instance-b906d2ba-d144-4ee2-8785-a718ca40401a";
    const { moved } = repaired(fixture);
    expect(moved).toContain(port);
  });

  it("keeps a label beside its own part, nearer it than any other", () => {
    // i2n-828: M4A's and M4B's names had been moved toward their
    // neighbours; they now shift a few units, clear of the wires.
    const fixture = gallery("i2n-828");
    const { moved } = repaired(fixture);
    expect(moved.sort()).toEqual([
      "instance-label-instance-71a395fd-6d5d-4c59-a0cb-34b28d7f94c7",
      "instance-label-instance-ad472d46-2781-4b6f-b0bd-1eac776fc205",
    ]);
  });
});

/**
 * A visual review of 56 repaired Gallery drawings found a quarter worse
 * (#2619): labels with nothing wrong but crowding moved out of their row or
 * mirror, labels moved far to a free spot by a ground or the next part,
 * names split from their values, and VDD names turned unlike the rest.
 */
describe("a Gallery repair keeps rows, mirrors and its part's labels together (#2619)", () => {
  it("leaves a row of resistors whose values are only crowded in its row", () => {
    // ar-4792: five of six resistors' values, crowded by the grounds under
    // them, had been lifted a row; R4's stayed, so the row went ragged.
    const fixture = gallery("ar-4792");
    const { before, after, moved } = repaired(fixture);
    const row = ["R2", "R4", "R6", "R8", "R10", "R12"];
    const lines = (document: SchematicDocument) =>
      new Set(
        row.map((ref) =>
          Math.round(centreOf(fixture, document, ref, "instance-value").y),
        ),
      );
    expect(lines(before).size).toBe(1);
    expect(lines(after).size).toBe(1);
    expect(moved).toEqual([]);
  });

  it("keeps a mirrored pair's names mirrored", () => {
    // ag-309: M13's name, only crowded, had been moved under its
    // transistor while M12's, its mirror image, stayed above.
    const fixture = gallery("ag-309");
    const { before, after } = repaired(fixture);
    for (const document of [before, after]) {
      const m12 = offsetOf(fixture, document, "M12", "instance-label");
      const m13 = offsetOf(fixture, document, "M13", "instance-label");
      expect(Math.abs(m12.x + m13.x)).toBeLessThanOrEqual(2.5);
      expect(Math.abs(m12.y - m13.y)).toBeLessThanOrEqual(2.5);
    }
  });

  it("keeps a column of stacked transistors' names alike", () => {
    // 6b7s8kaqky: M6's name had been lifted between M6 and M8, M8's
    // carried off its gate; each now stays as its neighbour stands.
    const fixture = gallery("6b7s8kaqky");
    const { before, after } = repaired(fixture);
    const apart = (document: SchematicDocument) => {
      const m6 = offsetOf(fixture, document, "M6", "instance-label");
      const m8 = offsetOf(fixture, document, "M8", "instance-label");
      return Math.hypot(m6.x - m8.x, m6.y - m8.y);
    };
    expect(apart(after)).toBeLessThanOrEqual(Math.max(2.5, apart(before)));
  });

  it("moves no name down beside a ground", () => {
    // ss2hsg8c7j: M1, M3 and M5, over their transistors' outlines, had been
    // moved down beside their grounds.
    const fixture = gallery("ss2hsg8c7j");
    const { moved } = repaired(fixture);
    for (const ref of ["M1", "M3", "M5"])
      expect(moved).not.toContain(labelId(fixture, ref, "instance-label"));
  });

  it("moves no name across its part or far off", () => {
    // xztx7khz65: MP's name had gone round to its transistor's far side,
    // between its drain and MN's gate, and MN's under VDD's name.
    const fixture = gallery("xztx7khz65");
    const { moved } = repaired(fixture);
    for (const ref of ["MP", "MN"])
      expect(moved).not.toContain(labelId(fixture, ref, "instance-label"));
  });

  it("leaves a capacitor's name by its value rather than across the capacitor", () => {
    // qy2d4c57sp: C_L, on its capacitor and its 0.1pF (free text), had been
    // moved to the capacitor's far side, against M18's source wire, away
    // from the 0.1pF. No clear place keeps it on its side: it stays, named.
    const fixture = gallery("qy2d4c57sp");
    const { moved, leftInPlace } = repaired(fixture);
    const name = labelId(fixture, "CL", "instance-label");
    expect(moved).not.toContain(name);
    expect(leftInPlace).toContainEqual(
      expect.objectContaining({ labelId: name, reason: "crowded" }),
    );
  });

  it("keeps a name above its value", () => {
    // ve832ef9mm: CSp's 1pF, on the VCM Port's name, had been moved above
    // its CSp.
    const id = "ve832ef9mm";
    const project = parseProject(
      readFileSync(
        resolve(process.cwd(), `fixtures/label-clearance/${id}.icproj.json`),
        "utf8",
      ),
    );
    for (const document of project.documents) {
      const fixture = gallery(id, document.id);
      const csp = fixture.document.instances.find(
        (item) => item.reference === "CSp",
      );
      if (!csp) continue;
      const { after } = repaired(fixture);
      const name = centreOf(fixture, after, "CSp", "instance-label");
      const value = centreOf(fixture, after, "CSp", "instance-value");
      expect(name.y).toBeLessThan(value.y);
    }
  });

  it("turns no VDD name unlike the drawing's others", () => {
    // bfzpwrhc4s and ag-1306: VDD names beside their bars had been moved
    // over them, unlike the drawing's other VDD names.
    for (const id of ["bfzpwrhc4s", "ag-1306"]) {
      const fixture = gallery(id);
      const { before, after } = repaired(fixture);
      expect(supplyWays(fixture, after), id).toEqual(
        supplyWays(fixture, before),
      );
    }
  });
});

/** A part of the fixture's Cell, by its Reference. */
function instanceOf({ document }: Gallery, reference: string) {
  return document.instances.find((item) => item.reference === reference)!;
}

function labelId(
  fixture: Gallery,
  reference: string,
  kind: "instance-label" | "instance-value",
) {
  const id = instanceOf(fixture, reference).id;
  const binding =
    kind === "instance-label" ? "instance-reference" : "instance-value";
  return fixture.document.annotations.find(
    (annotation) =>
      annotation.binding?.kind === binding &&
      annotation.binding.instanceId === id,
  )!.id;
}

/** Where a part's label is drawn: the centre of its ink. */
function centreOf(
  fixture: Gallery,
  document: SchematicDocument,
  reference: string,
  kind: "instance-label" | "instance-value",
) {
  const context = createLabelClearanceContext(document, fixture.resolver);
  const ink = context.labelBounds(labelId(fixture, reference, kind))!;
  return { x: ink.x + ink.width / 2, y: ink.y + ink.height / 2 };
}

/** A part's label from the centre of its part. */
function offsetOf(
  fixture: Gallery,
  document: SchematicDocument,
  reference: string,
  kind: "instance-label" | "instance-value",
) {
  const context = createLabelClearanceContext(document, fixture.resolver);
  const id = instanceOf(fixture, reference).id;
  const body = context.symbols.find((symbol) => symbol.id === id)!.bounds;
  const label = centreOf(fixture, document, reference, kind);
  return {
    x: label.x - (body.x + body.width / 2),
    y: label.y - (body.y + body.height / 2),
  };
}

/** How many VDD names stand over their bar, and how many beside it. */
function supplyWays(fixture: Gallery, document: SchematicDocument) {
  const context = createLabelClearanceContext(document, fixture.resolver);
  const ways = { over: 0, beside: 0 };
  for (const instance of document.instances) {
    if (instance.symbolId !== "vdd-port") continue;
    const bar = context.symbols.find((s) => s.id === instance.id)?.bounds;
    const name = context.visible.find(
      (a) =>
        a.kind === "power-label" &&
        a.anchor.kind === "object" &&
        a.anchor.objectId === instance.id,
    );
    if (!bar || !name) continue;
    const ink = context.measure(name).inkBounds;
    if (ink.y + ink.height <= bar.y + 1) ways.over += 1;
    else ways.beside += 1;
  }
  return ways;
}

/** Gap between two boxes, 0 when they meet. */
function gap(a: Rect, b: Rect): number {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );
}

/**
 * Repair every part of a drawing as a Gallery cleanup does, and check each
 * rule of a repair: only parts with a reported label move; every moved
 * label stands where the label findings report nothing, on no other label,
 * within two grid steps of its own part and nearer it than any other; a
 * part's name and value stay as close as they were, or a row; no label
 * newly reported; every label still reported is named left in place.
 */
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
  const reportedOwners = new Set(
    [...reportedBefore].map((id) => {
      const label = was.visible.find((item) => item.id === id)!;
      return label.anchor.kind === "object" ? label.anchor.objectId : id;
    }),
  );
  for (const [id, clear] of moved) {
    expect(clear, id).toBe(true);
    const owner = ownerOf(id);
    expect(reportedOwners.has(owner ?? id), id).toBe(true);
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
  // Names and values stay together.
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
  // Nothing newly reported, and what is left is named.
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
