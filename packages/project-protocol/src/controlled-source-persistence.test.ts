import { createEmptyProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { describe, expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "./index.js";
import { publishProjectToGallery } from "../../../apps/editor/src/features/editor-shell/gallery-publish";

function fixture() {
  const project = createEmptyProject("control-persistence", "Controls");
  const document = project.documents[0]!;
  for (const [id, symbolId, parameters, control] of [
    ["R1", "resistor", { value: "1k" }, undefined],
    ["V1", "voltage-source", { dc: "1" }, undefined],
    [
      "E1",
      "vcvs",
      { gain: "2" },
      { kind: "voltage", positiveNetId: "p", negativeNetId: "n" },
    ],
    [
      "G1",
      "vccs",
      { gm: "3m" },
      { kind: "voltage", positiveNetId: "n", negativeNetId: "p" },
    ],
    [
      "F1",
      "cccs",
      { gain: "4" },
      {
        kind: "terminal-current",
        instanceId: "R1",
        pinName: "1",
        direction: "into",
      },
    ],
    [
      "H1",
      "ccvs",
      { rm: "5k" },
      {
        kind: "terminal-current",
        instanceId: "R1",
        pinName: "2",
        direction: "out",
      },
    ],
    ["F2", "cccs", { gain: "6" }, { kind: "current", sensorInstanceId: "V1" }],
  ] as const) {
    document.instances.push({
      id,
      reference: id,
      symbolId,
      placement: null,
      netlist: {
        parameters: { ...parameters },
        ...(control ? { control: { ...control } } : {}),
      },
    });
  }
  document.nets = ["p", "n"].map((id, index) => ({
    id,
    terminals: document.instances.map((i) => ({
      instanceId: i.id,
      pinName:
        i.symbolId === "resistor" ? (index ? "2" : "1") : index ? "-" : "+",
    })),
  }));
  return project;
}

const controls = (project: ReturnType<typeof fixture>) =>
  project.documents[0]!.instances.map((i) => i.netlist?.control);

describe("controlled-source portable persistence", () => {
  it.each(["spice", "spectre"] as const)(
    "retains all control identities/directions and exact %s netlist through repeated saves",
    (format) => {
      const before = fixture();
      const output = createDesignNetlistExport(before, { format });
      expect(output.status).toBe("ready");
      const text = serializeProject(before);
      expect(JSON.parse(text).schemaVersion).toBe(CURRENT_PROJECT_FILE_VERSION);
      const reopened = parseProject(serializeProject(parseProject(text)));
      expect(controls(reopened)).toEqual(controls(before));
      const after = createDesignNetlistExport(reopened, { format });
      expect(after.status).toBe("ready");
      if (output.status === "ready" && after.status === "ready")
        expect(after.file.text).toBe(output.file.text);
    },
  );

  it("keeps selections through the Gallery payload and server parse/serialize boundary", async () => {
    const before = fixture();
    let stored = "";
    const outcome = await publishProjectToGallery(
      before,
      { name: "Controls", description: "", tags: [], aiGenerated: false },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        stored = serializeProject(parseProject(body.projectText));
        return Response.json({ id: "gallery-controls" }, { status: 201 });
      }) as typeof fetch,
    );
    expect(outcome.status).toBe("published");
    expect(controls(parseProject(stored))).toEqual(controls(before));
  });

  it("preserves unfinished selections without inventing controls for old files", () => {
    const before = fixture();
    before.documents[0]!.instances[2]!.netlist!.control = {
      kind: "voltage",
      positiveNetId: "p",
    };
    before.documents[0]!.instances[3]!.netlist!.control = {
      kind: "terminal-current",
      direction: "out",
    };
    expect(controls(parseProject(serializeProject(before)))).toEqual(
      controls(before),
    );
    const raw = JSON.parse(serializeProject(before));
    raw.schemaVersion = 64;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(
      /requires Project schema 65/,
    );
    for (const instance of raw.documents[0].instances) delete instance.control;
    expect(
      controls(parseProject(JSON.stringify(raw))).every(
        (control) => control === undefined,
      ),
    ).toBe(true);
  });

  it("rejects invalid control data rather than dropping it", () => {
    const raw = JSON.parse(serializeProject(fixture()));
    raw.documents[0].instances.find(
      (i: { id: string }) => i.id === "H1",
    ).control.direction = "sideways";
    expect(() => parseProject(JSON.stringify(raw))).toThrow();
  });
});
