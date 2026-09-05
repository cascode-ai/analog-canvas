import { readFileSync } from "node:fs";

import {
  buildProjectConnectivityIndex,
  evaluateSubmissionGates,
  resolveDocumentLogicalNets,
  runErcChecks,
} from "@icm/derived";
import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import type { CircuitProject } from "@icm/model";
import {
  analyzeDesignNetlist,
  compileStructuredSimulation,
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
  expect(actual.ports).toEqual(reference.ports);
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
  actual.ports.forEach((port, index) =>
    unify(port, reference.ports[index]!, "port"),
  );
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

  it("ships a Testbench Cell that instantiates the OTA Cell", () => {
    expect(project.documents).toHaveLength(2);
    expect(dut.netlist?.terminals.map((terminal) => terminal.name)).toEqual([
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
  });

  it("persists and compiles its OP and AC acceptance setup", async () => {
    expect(project.simulation).toBeDefined();
    const compiled = await compileStructuredSimulation(
      project,
      project.simulation!,
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.request.analyses).toEqual(["op", "ac"]);
    expect(compiled.request.testbench).toContain("VINP");
    expect(compiled.request.testbench).toContain("AC 1 0");
    expect(compiled.request.testbench).toContain("op");
    expect(compiled.request.testbench).toContain("ac dec 10 1 1000000000");
    expect(compiled.request.testbench).toContain("set appendwrite");
    expect(compiled.vectors).toEqual([
      { probeId: "probe-vout", vector: "v(vout)", quantity: "voltage" },
      { probeId: "probe-ibias", vector: "v(ibias)", quantity: "voltage" },
      {
        probeId: "probe-tail",
        vector: "v(xdut.tail)",
        quantity: "voltage",
      },
      {
        probeId: "probe-nleft",
        vector: "v(xdut.nleft)",
        quantity: "voltage",
      },
    ]);
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
    // ADR 0055's acceptance fixture is the circuit this example draws. A
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
