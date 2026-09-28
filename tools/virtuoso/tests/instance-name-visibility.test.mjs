import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.mjs";
import {
  convertDesign,
  defaultPresentation,
} from "../../../packages/virtuoso-import/dist/adapter/index.js";

test("instance name visibility persists without deleting references or net labels", async () => {
  const runtime = {
    root: fileURLToPath(new URL("../../../", import.meta.url)),
  };
  const style = await defaultPresentation(runtime),
    source = fixture();
  const mapping = {
    version: 1,
    devices: {
      "analogLib/res": {
        symbol: "resistor",
        pins: { PLUS: "1", MINUS: "2" },
        parameters: { r: "r" },
      },
    },
  };
  const shown = await convertDesign(source, mapping, {
    runtime,
    presentation: style,
  });
  const hidden = await convertDesign(source, mapping, {
    runtime,
    presentation: { ...style, showInstanceNames: false },
  });
  const a = shown.project.documents[0],
    b = hidden.project.documents[0];
  assert.deepEqual(a.instances, b.instances);
  assert.deepEqual(a.nets, b.nets);
  assert.deepEqual(a.routes, b.routes);
  const labels = b.annotations.filter(
    (a) => a.binding?.kind === "instance-reference",
  );
  assert(labels.length > 0);
  assert(labels.every((a) => a.visible === false));
  assert(
    b.annotations
      .filter((a) => a.binding?.kind !== "instance-reference")
      .every((a) => a.visible !== false),
  );
  for (const label of labels)
    assert(!hidden.svg.includes(`data-object-id="${label.id}"`));
  assert.deepEqual(hidden.validation.blockingErc, []);
  const legacy = { ...style };
  delete legacy.showInstanceNames;
  const old = await convertDesign(source, mapping, {
    runtime,
    presentation: legacy,
  });
  assert(
    old.project.documents[0].annotations
      .filter((a) => a.binding?.kind === "instance-reference")
      .every((a) => a.visible === true),
  );
  await assert.rejects(() =>
    convertDesign(source, mapping, {
      runtime,
      presentation: { ...style, showInstanceNames: "false" },
    }),
  );
});
