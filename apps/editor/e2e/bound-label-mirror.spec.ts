import { parseSavedProject } from "./editor-fixtures";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyProject, type Annotation } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import type { SchematicDocument } from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  resolveAnnotationPresentation,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { awaitEditorReady, downloadBytes } from "./editor-fixtures";

function fixture() {
  const project = createEmptyProject("mirror-labels", "Mirror labels");
  const document = project.documents[0]!;
  document.instances = [
    {
      id: "M1",
      symbolId: "nmos",
      reference: "M1",
      netlist: { parameters: { w: "10u", l: "1u" } },
      placement: { position: { x: 260, y: 240 }, rotation: 0, mirror: "none" },
    },
    {
      id: "T1",
      symbolId: "xfmr",
      reference: "T1",
      netlist: { parameters: { k: "0.8", lp: "2n", ls: "4n" } },
      placement: { position: { x: 500, y: 380 }, rotation: 90, mirror: "none" },
    },
  ];
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const profile = resolveDocumentStyleProfile(document.presentation);
  for (const instance of document.instances) {
    for (const slot of ["reference", "value"] as const) {
      const parameter =
        instance.id === "T1" && slot === "value" ? "k" : undefined;
      const resolved = resolver.resolve(instance.symbolId)!;
      const placement = parameter
        ? defaultInstanceParameterLabelPlacement(
            instance,
            resolved,
            profile,
            10,
            parameter,
          )!
        : defaultInstanceLabelPlacement(instance, resolved, profile, 10, slot)!;
      document.annotations.push({
        id: `${slot}-${instance.id}`,
        kind: slot === "reference" ? "instance-label" : "instance-value",
        binding:
          slot === "reference"
            ? { kind: "instance-reference", instanceId: instance.id }
            : {
                kind: "instance-value",
                instanceId: instance.id,
                ...(parameter ? { parameter } : {}),
              },
        anchor: {
          kind: "object",
          objectId: instance.id,
          localOffset: {
            x: placement.position.x - instance.placement!.position.x,
            y: placement.position.y - instance.placement!.position.y,
          },
          fallbackPosition: placement.position,
        },
        alignment: placement.alignment,
        rotation: 0,
        locked: false,
      });
    }
  }
  return project;
}

async function openFixture(page: Page) {
  const project = fixture();
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "mirror-labels.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened mirror-labels.icproj.json",
  );
  return project.documents[0]!;
}
async function savedDocument(page: Page) {
  const project = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  return project.documents[0];
}
/** How far below its anchor, on the baseline, a label's ink is centred. */
function boxCenterBelowAnchor(
  document: SchematicDocument,
  annotation: Annotation,
): number {
  const { inkBounds: bounds, position } = resolveAnnotationPresentation(
    document,
    new InMemorySymbolResolver(builtInSymbols),
    annotation,
    resolveDocumentStyleProfile(document.presentation),
    {
      documentId: document.id,
      documentRevision: document.revision,
      routes: new Map(),
      endpointJoins: [],
    },
  );
  return bounds.y + bounds.height / 2 - position.y;
}

/**
 * Left to right, each label's anchor mirrors and its alignment swaps.
 * Top to bottom, its ink mirrors: the anchor sits on the baseline, so
 * mirroring the anchor alone would move a label above the part most of a
 * line closer to it once below.
 */
function checkReflected(
  document: SchematicDocument,
  before: Annotation[],
  after: Annotation[],
  axis: "x" | "y",
  coordinate: number,
) {
  for (const original of before) {
    if (original.anchor.kind !== "object") throw new Error("anchor");
    const result = after.find((a) => a.id === original.id)!;
    if (result.anchor.kind !== "object") throw new Error("anchor");
    const from = original.anchor.fallbackPosition;
    const to = result.anchor.fallbackPosition;
    if (axis === "x") {
      expect(to).toEqual({ x: 2 * coordinate - from.x, y: from.y });
    } else {
      const center = boxCenterBelowAnchor(document, original);
      expect(to.x).toBe(from.x);
      expect(
        Math.abs(to.y + center - (2 * coordinate - (from.y + center))),
      ).toBeLessThanOrEqual(0.5);
    }
    expect(result.binding).toEqual(original.binding);
    expect(result.rotation).toBe(0);
    expect(result.alignment).toBe(
      axis === "x" && original.alignment !== "middle"
        ? original.alignment === "start"
          ? "end"
          : "start"
        : original.alignment,
    );
  }
}

test("Properties mirror buttons carry the live MOS name and fraction value, with undo and reopen", async ({
  page,
}) => {
  const initial = await openFixture(page);
  const labels = initial.annotations.filter(
    (a) => a.anchor.kind === "object" && a.anchor.objectId === "M1",
  );
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toBeVisible();
  const editor = page.getByTestId("component-property-code-editor");
  await editor.getByRole("button", { name: "Mirror top to bottom" }).click();
  checkReflected(
    initial,
    labels,
    (await savedDocument(page)).annotations,
    "y",
    240,
  );
  await editor.getByRole("button", { name: "Mirror top to bottom" }).click();
  expect((await savedDocument(page)).annotations).toEqual(initial.annotations);
  await editor.getByRole("button", { name: "Mirror left to right" }).click();
  const mirrored = await savedDocument(page);
  checkReflected(initial, labels, mirrored.annotations, "x", 260);
  const bytes = await downloadBytes(page, "File", "Export Project File…");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await savedDocument(page)).annotations).toEqual(initial.annotations);
  await page.getByTestId("project-file").setInputFiles({
    name: "mirrored.icproj.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened mirrored.icproj.json",
  );
  expect((await savedDocument(page)).annotations).toEqual(mirrored.annotations);
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-object-id="value-M1"');
  expect(svg).toContain('data-object-id="reference-M1"');
});

test("multi-selection mirrors attached labels once around the group pivot", async ({
  page,
}) => {
  const initial = await openFixture(page);
  await page.getByTestId("hit-M1").click();
  await page.getByTestId("hit-T1").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Shift+R");
  await expect(page.getByTestId("status")).toContainText("as one group");
  checkReflected(
    initial,
    initial.annotations,
    (await savedDocument(page)).annotations,
    "x",
    380,
  );
  await page.keyboard.press("Shift+R");
  expect((await savedDocument(page)).annotations).toEqual(initial.annotations);
});
