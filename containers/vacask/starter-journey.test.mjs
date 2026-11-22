import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseProject } from "../../packages/project-protocol/src/index.js";
import { compileSourceSimulation } from "../../packages/netlist/src/simulation-source-compile.js";
import {
  vacaskMeasurementPythonSource,
  vacaskPlotPythonSource,
} from "../../packages/netlist/src/vacask-postprocess.js";
import {
  nativeSimulationDevices,
  nativeDeviceOpAcquisitions,
} from "../../packages/netlist/src/simulation-native-devices.js";

const legacyLibraryOta = JSON.parse(
  await readFile(
    new URL(
      "../../netlists/native-ota-library/legacy-source.icproj.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const projects = await Promise.all(
  ["rc", "rlc", "common-source", "ota", "ota-library"].map(async (kind) => ({
    kind,
    project: parseProject(
      await readFile(
        new URL(
          kind === "ota-library"
            ? "../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json"
            : `../../apps/editor/src/examples/simulation-${kind}.icproj.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  })),
);
const resistanceFor = (id) =>
  ({ "rlc-1": 200, "rlc-2": 632.455532, "rlc-3": 1000 })[id];
const reference = (kind, name) =>
  readFile(
    new URL(
      `../../netlists/native-${kind === "rc" ? "rc-filters" : "rlc-filter"}/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

const sectioned = JSON.parse(
  await readFile(
    new URL(
      "../../netlists/vacask-sky130/model-symbols-sections.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const cornerLibraries = Object.fromEntries(
  sectioned.modelSymbols.map((library) => [library.section, library]),
);
const library = cornerLibraries.tt;

it("preserves all twelve Library OTA experiments, their circuits and native report source", async () => {
  const { project } = projects.find((p) => p.kind === "ota-library");
  const before = parseProject(JSON.stringify(legacyLibraryOta));
  // Main #827 repaired copied route-marker anchors without changing the circuit.
  // Keep the historical electrical baseline, with those explicit drawing fixes.
  const repairedAnchors = {
    "route-ui-3": [530, 150, "route-leg-950eb45aec291af5"],
    "tb-ibias-route": [536, 240, "route-leg-9c7f13cc644db106"],
    "tb-vinp-route": [450, 290, "route-leg-db9df07a18d56c80"],
    "tb-vinn-route": [450, 340, "route-leg-42de77b6b7306ba2"],
  };
  for (const document of before.documents)
    for (const annotation of document.annotations) {
      const anchor = annotation.anchor;
      const repair = anchor.kind === "route" && repairedAnchors[anchor.routeId];
      if (repair) {
        anchor.fallbackPosition = { x: repair[0], y: repair[1] };
        anchor.legId = repair[2];
      }
    }
  expect({ ...project, simulationFolders: [] }).toEqual({
    ...before,
    simulationFolders: [],
  });
  expect(project.simulationFolders.map((f) => f.id)).toEqual(
    before.simulationFolders.map((f) => f.id),
  );
  for (const folder of project.simulationFolders) {
    const original = before.simulationFolders.find((f) => f.id === folder.id);
    expect(folder.input.circuitBindings).toEqual(
      original.input.circuitBindings,
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    for (const [file, path] of [
      ["report.py", "netlists/native-ota-library/report.py"],
      ["native_report.py", "scripts/lib/native-starter-report.py"],
    ])
      expect(folder.input.files.find((f) => f.path === file).text).toBe(
        (
          await readFile(new URL(`../../${path}`, import.meta.url), "utf8")
        ).replaceAll("\r\n", "\n"),
      );
    const corner = legacyLibraryOta.simulationSetups.find(
      (s) => s.id === folder.id,
    ).input.environment.corner;
    const lib = cornerLibraries[corner];
    expect(folder.input.dependencies).toEqual([
      {
        id: lib.dependencyId,
        sha256: lib.sha256,
        mountPath: "models/library.inc",
      },
    ]);
    if (folder.id.includes("bias") || folder.id.includes("full")) {
      const ops = nativeSimulationDevices(project, folder.input, [lib])
        .filter((d) => ["M1", "M3"].includes(d.instanceId))
        .flatMap((d) => nativeDeviceOpAcquisitions(d));
      for (const op of ops)
        expect(
          compiled.files.find((f) => f.path === folder.input.entry).text,
        ).toContain(op.save);
    }
  }
});

it("ships all eight OTA native folders without substituting corners or the code-owned feedback testbench", async () => {
  const { project } = projects.find((p) => p.kind === "ota");
  expect(project.simulationFolders).toHaveLength(8);
  for (const folder of project.simulationFolders) {
    const corner = folder.id.startsWith("ota-ac-") ? folder.id.slice(-2) : "tt";
    const mode = folder.id.startsWith("ota-ac-") ? "ac" : folder.id.slice(4);
    const template = (
      await readFile(
        new URL(`../../netlists/native-ota/${mode}.sim`, import.meta.url),
        "utf8",
      )
    ).replaceAll("\r\n", "\n");
    const code = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    ).text;
    expect(code).toBe(
      folder.name +
        "\n" +
        template
          .slice(template.indexOf("\n") + 1)
          .replace(
            'include "models/library.inc"',
            'include "models/library.inc" section=' + corner,
          ),
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    expect(compiled.config.environment.profileId).toBe(
      "vacask-sky130-candidate",
    );
    const lib = cornerLibraries[corner];
    expect(folder.input.dependencies).toEqual([
      {
        id: lib.dependencyId,
        sha256: lib.sha256,
        mountPath: "models/library.inc",
      },
    ]);
    if (mode === "op") {
      const ops = nativeSimulationDevices(project, folder.input, [lib])
        .filter((d) => d.polarity)
        .flatMap((d) => nativeDeviceOpAcquisitions(d));
      for (const op of ops) expect(code).toContain(op.save);
    }
    if (mode === "closed") {
      expect(folder.input.circuitBindings[0]).toMatchObject({
        documentId: "document-ota-5t",
        emission: "subcircuit",
      });
      expect(
        folder.input.files.find((f) => f.path === "testbench.spice").text,
      ).toBe(
        (
          await readFile(
            new URL("../../netlists/native-ota/testbench.sim", import.meta.url),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
    }
    if (!["dc", "noise"].includes(mode)) {
      expect(folder.input.files.find((f) => f.path === "report.py").text).toBe(
        (
          await readFile(
            new URL(
              "../../scripts/lib/native-starter-report.py",
              import.meta.url,
            ),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
    }
  }
});

it("ships four native common-source experiments with converter-checked wrapper selectors and explicit candidate identity", async () => {
  const { project } = projects.find((p) => p.kind === "common-source");
  const before = structuredClone(project);
  const report = (
    await readFile(
      new URL("../../scripts/lib/native-starter-report.py", import.meta.url),
      "utf8",
    )
  ).replaceAll("\r\n", "\n");
  expect(project.simulationFolders.map((f) => f.id)).toEqual([
    "cs-op",
    "cs-dc",
    "cs-ac",
    "cs-tran",
  ]);
  for (const folder of project.simulationFolders) {
    const template = (
      await readFile(
        new URL(
          `../../netlists/native-common-source/${folder.id.slice(3)}.sim`,
          import.meta.url,
        ),
        "utf8",
      )
    ).replaceAll("\r\n", "\n");
    const code = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    ).text;
    expect(code).toBe(
      folder.name +
        "\n" +
        template
          .slice(template.indexOf("\n") + 1)
          .replace(
            'include "models/library.inc"',
            'include "models/library.inc" section=tt',
          ),
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    expect(compiled.config.environment.profileId).toBe(
      "vacask-sky130-candidate",
    );
    expect(folder.input.dependencies).toEqual([
      {
        id: library.dependencyId,
        sha256: library.sha256,
        mountPath: "models/library.inc",
      },
    ]);
    expect(code).not.toMatch(/options\s+scale=/u);
    if (folder.id === "cs-op") {
      const device = nativeSimulationDevices(project, folder.input, [
        library,
      ]).find((d) => d.instanceId === "XM1");
      const acquisitions = nativeDeviceOpAcquisitions(device);
      for (const op of acquisitions) expect(code).toContain(op.save);
    }
    if (["cs-ac", "cs-tran"].includes(folder.id)) {
      expect(folder.input.files.find((f) => f.path === "report.py").text).toBe(
        report,
      );
      expect(
        folder.input.files.find((f) => f.path === "icm_reports.py").text,
      ).toBe(vacaskMeasurementPythonSource() + "\n" + vacaskPlotPythonSource());
    }
  }
  expect(project).toEqual(before);
});

it.each(projects.filter((p) => ["rc", "rlc"].includes(p.kind)))(
  "ships $kind experiments as native source with editable shared report helpers",
  async ({ kind, project }) => {
    const before = structuredClone(project);
    expect(project.simulationFolders).toHaveLength(kind === "rc" ? 4 : 3);
    for (const folder of project.simulationFolders) {
      const source = (path) =>
        folder.input.files.find((file) => file.path === path).text;
      const template = (
        await reference(
          kind,
          kind === "rlc"
            ? "rlc.sim"
            : folder.id.endsWith("-ac")
              ? "ac.sim"
              : "step.sim",
        )
      )
        .replaceAll("\r\n", "\n")
        .replace(
          'alter instance("R1") r=200',
          `alter instance("R1") r=${resistanceFor(folder.id)}`,
        );
      expect(source(folder.input.entry)).toBe(
        folder.name + "\n" + template.slice(template.indexOf("\n") + 1),
      );
      expect(source("report.py")).toBe(
        (
          await readFile(
            new URL(
              "../../scripts/lib/native-starter-report.py",
              import.meta.url,
            ),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
      expect(source("icm_reports.py")).toBe(
        vacaskMeasurementPythonSource() + "\n" + vacaskPlotPythonSource(),
      );
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      expect(compiled.config.environment.profileId).toBe(
        "vacask-sky130-candidate",
      );
      expect(
        compiled.files.find((f) => f.path === "circuit.spice").text,
      ).toContain('load "capacitor.osdi"');
    }
    expect(project).toEqual(before);
  },
);
