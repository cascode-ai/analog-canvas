import { sourcePresentation } from "../features/simulation/source-presentation";
import { readFileSync } from "node:fs";

import {
  buildProjectConnectivityIndex,
  evaluateSubmissionGates,
  resolveDocumentLogicalNets,
  resolveVisualAnchor,
  runErcChecks,
} from "@icm/derived";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  readSimulationExperimentConfig,
} from "@icm/model";
import type { CircuitProject } from "@icm/model";
import {
  analyzeDesignNetlist,
  compileSourceSimulation,
  createDesignNetlistExport,
  printSpiceNetlist,
} from "@icm/netlist";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  createLibraryExampleProject,
  libraryProjectExamples,
} from "./library-examples";

/**
 * Hierarchical and reviewed-external artwork is derived from the Project, so a
 * built-ins-only resolver silently under-reports on any example that ships a
 * Cell instance.
 */
function projectResolver(project: CircuitProject) {
  return createProjectSymbolResolver(project, builtInSymbols);
}

describe("bundled Library Project examples", () => {
  it("ships canonical, schema-current, openable Projects", () => {
    // Bundled examples can grow, so the contract is per-example rather than a
    // frozen count or single-document shape.
    expect(libraryProjectExamples.map((example) => example.id)).toEqual(
      expect.arrayContaining([
        "common-source-amplifier",
        "two-stage-op-amp",
        "current-mirror-loaded-differential-pair",
        "fully-differential-two-stage-op-amp",
        "five-transistor-ota-sky130",
      ]),
    );
    expect(
      new Set(libraryProjectExamples.map((example) => example.id)).size,
    ).toBe(libraryProjectExamples.length);
    for (const example of libraryProjectExamples) {
      expect(example.name.trim()).not.toBe("");
      expect(serializeProject(example.project)).toContain(
        `"schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION}`,
      );
      expect(example.project.documents.length).toBeGreaterThanOrEqual(1);
      expect(
        example.project.documents.some(
          (document) => document.id === example.project.topDocumentId,
        ),
      ).toBe(true);
    }
  });

  it("keeps every bundled annotation attached to visible geometry", () => {
    for (const example of libraryProjectExamples) {
      const resolver = projectResolver(example.project);
      const unresolved = example.project.documents.flatMap((document) =>
        document.annotations.flatMap((annotation) => {
          const resolved = resolveVisualAnchor(
            document,
            resolver,
            annotation.anchor,
          );
          return resolved.resolved
            ? []
            : [
                {
                  documentId: document.id,
                  annotationId: annotation.id,
                  message: resolved.diagnostic?.message,
                },
              ];
        }),
      );
      expect(unresolved, example.id).toEqual([]);
    }
  });

  it("ships no Example with unresolved MOS bulk semantics", () => {
    for (const example of libraryProjectExamples) {
      const resolver = projectResolver(example.project);
      const diagnostics = runErcChecks(
        example.project,
        buildProjectConnectivityIndex(example.project, resolver),
        resolver,
      );
      expect(
        diagnostics.filter(
          (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
        ),
        example.id,
      ).toEqual([]);
    }
  });

  it("ships only visible instances and models VDD through rail geometry", () => {
    for (const example of libraryProjectExamples) {
      for (const document of example.project.documents) {
        expect(
          document.instances.filter((instance) => !instance.placement),
          `${example.id}:${document.id}:unplaced instances`,
        ).toEqual([]);
        expect(
          document.instances.filter(
            (instance) => instance.symbolId === "vdd-port",
          ),
          `${example.id}:${document.id}:legacy VDD instances`,
        ).toEqual([]);
      }
    }
  });

  it("upgrades stored VDD rails into current Logical-Net power semantics", () => {
    for (const example of libraryProjectExamples) {
      for (const document of example.project.documents) {
        const railNetIds = new Set(
          document.routes.flatMap((route) =>
            route.presentation === "power-rail" ? [route.netId] : [],
          ),
        );
        const logicalNets = resolveDocumentLogicalNets(document);
        for (const netId of railNetIds) {
          expect(
            logicalNets.byBaseNetId.get(netId),
            `${example.id}:${document.id}:${netId}`,
          ).toMatchObject({
            name: "VDD",
            powerDomain: "vdd",
          });
        }
      }
    }
  });

  it("returns a fresh Project snapshot for every selected example", () => {
    const first = createLibraryExampleProject("common-source-amplifier");
    const second = createLibraryExampleProject("common-source-amplifier");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    first.name = "Changed only in this snapshot";
    expect(second.name).toBe("New Circuit");
    expect(createLibraryExampleProject("missing-example")).toBeNull();
  });

  it("exports a complete Example without replacing its persisted bindings", () => {
    const example = createLibraryExampleProject("five-transistor-ota-sky130");
    expect(example).not.toBeNull();
    if (!example) return;

    const result = createDesignNetlistExport(example);
    expect(result.status).toBe("ready");
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("sky130_fd_pr__nfet_01v8");
    expect(result.file.text).toContain("sky130_fd_pr__pfet_01v8");
  });

  it("reports an incomplete Example instead of repairing it with an export preset", () => {
    const example = createLibraryExampleProject("common-source-amplifier");
    expect(example).not.toBeNull();
    if (!example) return;

    const result = createDesignNetlistExport(example);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "MISSING_MODEL_TARGET",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "MISSING_REQUIRED_PARAMETER",
      ),
    ).toBe(true);
  });
});

/**
 * One SPICE subcircuit reduced to the facts a simulator sees: the formal port
 * order, and for each device its model card, its ordered node list, and its
 * numeric parameters. Comments, spacing, and node spelling are not facts.
 */
interface SubcircuitStructure {
  ports: string[];
  devices: Map<
    string,
    { model: string; nodes: string[]; parameters: Map<string, number> }
  >;
}

function readSubcircuit(text: string, name: string): SubcircuitStructure {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*"));
  const start = lines.findIndex((line) =>
    new RegExp(`^\\.subckt\\s+${name}\\b`, "iu").test(line),
  );
  if (start < 0) throw new Error(`No .subckt ${name} in the netlist`);
  const end = lines.findIndex(
    (line, index) => index > start && /^\.ends\b/iu.test(line),
  );
  const ports = lines[start]!.split(/\s+/u).slice(2);
  const devices = new Map<
    string,
    { model: string; nodes: string[]; parameters: Map<string, number> }
  >();
  for (const line of lines.slice(start + 1, end)) {
    const tokens = line.split(/\s+/u);
    const parameterStart = tokens.findIndex((token) => token.includes("="));
    const head = parameterStart < 0 ? tokens : tokens.slice(0, parameterStart);
    const parameters = new Map<string, number>();
    for (const token of parameterStart < 0
      ? []
      : tokens.slice(parameterStart)) {
      const [key, value] = token.split("=");
      parameters.set(key!.toLowerCase(), Number(value));
    }
    devices.set(head[0]!, {
      model: head.at(-1)!,
      nodes: head.slice(1, -1),
      parameters,
    });
  }
  return { ports, devices };
}

/**
 * Assert two subcircuits describe the same circuit up to node renaming: every
 * node of one maps to exactly one node of the other, consistently, across the
 * formal interface and every device pin.
 */
function expectConnectivityEquivalent(
  actual: SubcircuitStructure,
  reference: SubcircuitStructure,
): void {
  // Guard the comparison itself: an unparsed netlist would otherwise agree
  // with an unparsed reference on everything.
  expect(reference.devices.size).toBe(6);
  expect(reference.ports.length).toBe(6);
  // The saved schematic and standalone reference declare different port
  // orders. Compare topology through named ports; the interface test below
  // separately protects authored order and the matching hierarchy call.
  expect([...actual.ports].sort()).toEqual([...reference.ports].sort());
  expect([...actual.devices.keys()].sort()).toEqual(
    [...reference.devices.keys()].sort(),
  );
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  const unify = (left: string, right: string, where: string): void => {
    expect(forward.get(left) ?? right, `${where}: ${left}`).toBe(right);
    expect(backward.get(right) ?? left, `${where}: ${right}`).toBe(left);
    forward.set(left, right);
    backward.set(right, left);
  };
  actual.ports.forEach((port) => unify(port, port, "port"));
  for (const [designator, device] of actual.devices) {
    const other = reference.devices.get(designator)!;
    expect(device.model, designator).toBe(other.model);
    expect(device.nodes.length, designator).toBe(other.nodes.length);
    expect([...device.parameters].sort(), designator).toEqual(
      [...other.parameters].sort(),
    );
    device.nodes.forEach((node, index) =>
      unify(node, other.nodes[index]!, `${designator} pin ${index}`),
    );
  }
}

describe("the bundled five-transistor Sky130 OTA", () => {
  const project = createLibraryExampleProject("five-transistor-ota-sky130")!;
  const testbench = project.documents.find(
    (document) => document.id === project.topDocumentId,
  )!;
  const dut = project.documents.find(
    (document) => document.netlist?.name === "ota_5t",
  )!;

  it("ships PULSE and SIN Testbench Cells that instantiate the same OTA Cell", () => {
    expect(project.documents).toHaveLength(3);
    expect(dut.netlist?.terminals.map((terminal) => terminal.name)).toEqual([
      "vss",
      "ibias",
      "vdd",
      "vinn",
      "vinp",
      "vout",
    ]);
    const exportedDut = analyzeDesignNetlist(project).ir?.cells.find(
      (cell) => cell.id === dut.id,
    );
    expect(exportedDut?.ports.map((port) => port.name)).toEqual([
      "vss",
      "ibias",
      "vdd",
      "vinn",
      "vinp",
      "vout",
    ]);
    const call = testbench.instances.find(
      (instance) => instance.netlist?.binding?.kind === "subcircuit",
    );
    expect(call).toMatchObject({
      reference: "XDUT",
      netlist: { binding: { kind: "subcircuit", childDocumentId: dut.id } },
    });
    const exportedCall = analyzeDesignNetlist(project)
      .ir?.cells.find((cell) => cell.id === testbench.id)
      ?.instances.find((instance) => instance.id === call!.id);
    expect(exportedCall?.nodes.map((node) => node.pinName)).toEqual(
      exportedDut?.ports.map((port) => port.name),
    );
    // The stimulus a reader needs before an operating point means anything.
    expect(
      Object.fromEntries(
        testbench.instances.flatMap((instance) =>
          instance.netlist?.binding?.kind === "primitive"
            ? [
                [
                  instance.reference!,
                  instance.netlist.parameters.dc ??
                    instance.netlist.parameters.value,
                ],
              ]
            : [],
        ),
      ),
    ).toEqual({
      VDD: "1.8",
      VINP: "0.9",
      VINN: "0.9",
      IBIAS: "15u",
      CL: "1p",
    });
    expect(
      testbench.instances.filter((instance) => instance.symbolId === "ground")
        .length,
    ).toBeGreaterThan(0);
    const sinTestbench = project.documents.find(
      (document) => document.id === "document-ota-5t-testbench-sin",
    );
    expect(
      sinTestbench?.instances.find((instance) => instance.id === "VINP"),
    ).toMatchObject({
      netlist: {
        parameters: {
          waveform: "sin",
          offset: "0.9",
          amplitude: "10m",
          frequency: "1Meg",
        },
      },
    });
  });

  it("ships twelve native folders with original analysis coverage and Canvas bindings", async () => {
    const expected = [
      ["simulation-setup-ota-op-ac", "OP + DC + AC + TRAN", "tt"],
      ["simulation-setup-ota-full-tt", "OP + DC + AC + TRAN + NOISE", "tt"],
      ["simulation-setup-ota-bias-tt", "OP", "tt"],
      ["simulation-setup-ota-dc-transfer-tt", "DC", "tt"],
      ...["tt", "ff", "ss", "fs", "sf"].map((corner) => [
        "simulation-setup-ota-ac-" + corner,
        "AC",
        corner,
      ]),
      ["simulation-setup-ota-tran-tt", "TRAN", "tt"],
      ["simulation-setup-ota-noise-tt", "NOISE", "tt"],
      ["simulation-setup-ota-tran-sin-tt", "TRAN", "tt"],
    ];
    expect(
      project.simulationFolders.map((folder) => {
        const parsed = readSimulationExperimentConfig(folder);
        if (!parsed.ok) throw Error(parsed.message);
        expect(parsed.authority).toBe("code");
        return [
          folder.id,
          sourcePresentation(folder).analysisLabel,
          folder.input.files
            .find((f) => f.path === folder.input.entry)
            ?.text.match(
              /include "models\/library\.inc" section=(tt|ff|ss|fs|sf)/u,
            )?.[1],
        ];
      }),
    ).toEqual(expected);
    for (const folder of project.simulationFolders) {
      expect(
        folder.input.circuitBindings.find((b) => b.emission === "top-level")
          ?.documentId,
      ).toBe(
        folder.id.endsWith("sin-tt")
          ? "document-ota-5t-testbench-sin"
          : testbench.id,
      );
      const compiled = await compileSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (!compiled.ok) continue;
      expect(compiled.language).toBe("vacask");
      expect(compiled.config.outputs).toEqual([]);
      expect(compiled.config.measurements).toEqual([]);
      expect(
        compiled.files.find((f) => f.path === "circuit.spice")?.text,
      ).toContain("mag=1");
      const code = compiled.files.find(
        (f) => f.path === folder.input.entry,
      )!.text;
      if (folder.id === "simulation-setup-ota-op-ac") {
        expect(code).toContain("from=0.88 to=0.92 step=0.005");
        expect(code).toContain('from=1 to=1000000000 mode="dec" points=10');
        expect(code).toContain("stop=0.000004 step=2e-8 maxstep=2e-8");
      }
      if (folder.id.endsWith("sin-tt"))
        expect(
          compiled.files.find((f) => f.path === "circuit.spice")?.text,
        ).toContain('type="sine"');
    }
  });

  it("passes the Check-and-Save gates with no electrical rule issue", () => {
    const resolver = projectResolver(project);
    expect(evaluateSubmissionGates(project, resolver)).toEqual({
      ok: true,
      failures: [],
    });
    expect(
      runErcChecks(
        project,
        buildProjectConnectivityIndex(project, resolver),
        resolver,
      ),
    ).toEqual([]);
  });

  it("exports an ota_5t subcircuit connectivity-equivalent to the reference", () => {
    // Simulation rationale's acceptance fixture is the circuit this example draws. A
    // structural comparison — not a string compare — is what proves the
    // drawing did not quietly move a terminal or drop a finger count.
    const referenceText = readFileSync(
      new URL(
        "../../../../fixtures/simulation-acceptance/ota-5t.spi",
        import.meta.url,
      ),
      "utf8",
    );
    const analysis = analyzeDesignNetlist(project, { rootDocumentId: dut.id });
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ir).not.toBeNull();
    expectConnectivityEquivalent(
      readSubcircuit(printSpiceNetlist(analysis.ir!), "ota_5t"),
      readSubcircuit(referenceText, "ota_5t"),
    );
  });
});
