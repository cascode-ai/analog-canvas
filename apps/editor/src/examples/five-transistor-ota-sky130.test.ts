import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildProjectConnectivityIndex,
  collectProjectDiagnosticEvidence,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { analyzeDesignNetlist, printSpiceNetlist } from "@icm/netlist";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { createLibraryExampleProject } from "./library-examples";

const EXAMPLE_ID = "five-transistor-ota-sky130";
const REFERENCE_PATH = "fixtures/simulation-acceptance/ota-5t.spi";

interface ParsedInstance {
  reference: string;
  master: string;
  nodes: string[];
  parameters: Record<string, string>;
}
interface ParsedCell {
  ports: string[];
  instances: ParsedInstance[];
}

/**
 * A SPICE subcircuit read as connectivity rather than as text: ports in
 * declaration order, and one record per card carrying its master, its node
 * order and its parameters.
 */
function parseSubcircuit(text: string, cellName: string): ParsedCell {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("*"));
  const start = lines.findIndex((line) =>
    new RegExp(`^\\.subckt\\s+${cellName}\\b`, "iu").test(line),
  );
  if (start < 0) throw new Error(`No .subckt ${cellName} in the netlist`);
  const end = lines.findIndex(
    (line, index) => index > start && /^\.ends\b/iu.test(line),
  );
  if (end < 0) throw new Error(`No .ends closing .subckt ${cellName}`);
  const ports = lines[start]!.split(/\s+/u).slice(2);
  const instances = lines.slice(start + 1, end).map((line) => {
    const tokens = line.split(/\s+/u);
    const reference = tokens[0]!;
    const parameters: Record<string, string> = {};
    let index = tokens.length;
    while (index > 1 && tokens[index - 1]!.includes("=")) {
      index -= 1;
      const [name, value] = tokens[index]!.split("=");
      parameters[name!.toLowerCase()] = value!;
    }
    const master = tokens[index - 1]!;
    return {
      reference,
      master,
      nodes: tokens.slice(1, index - 1),
      parameters,
    };
  });
  return { ports, instances };
}

function sameParameterValue(left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber === rightNumber
    : left.toLowerCase() === right.toLowerCase();
}

/**
 * Two subcircuits describe the same circuit when one node renaming carries
 * every card of the first onto the matching card of the second. Ports are
 * pinned by position, because a subcircuit's port order is its interface;
 * every other node name is free, and is required only to be consistent.
 */
function connectivityDifferences(
  reference: ParsedCell,
  candidate: ParsedCell,
): string[] {
  const differences: string[] = [];
  if (reference.ports.length !== candidate.ports.length) {
    differences.push(
      `port count ${reference.ports.length} vs ${candidate.ports.length}`,
    );
    return differences;
  }
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  const unify = (left: string, right: string, where: string): void => {
    const mapped = forward.get(left);
    if (mapped === undefined) {
      const claimed = backward.get(right);
      if (claimed !== undefined && claimed !== left) {
        differences.push(`${where}: ${right} already stands for ${claimed}`);
        return;
      }
      forward.set(left, right);
      backward.set(right, left);
      return;
    }
    if (mapped !== right) {
      differences.push(`${where}: ${left} maps to ${mapped}, not ${right}`);
    }
  };
  reference.ports.forEach((port, index) => {
    unify(port, candidate.ports[index]!, `port ${index}`);
  });

  const byReference = new Map(
    candidate.instances.map((instance) => [instance.reference, instance]),
  );
  for (const expected of reference.instances) {
    const actual = byReference.get(expected.reference);
    if (!actual) {
      differences.push(`missing instance ${expected.reference}`);
      continue;
    }
    byReference.delete(expected.reference);
    if (actual.master !== expected.master) {
      differences.push(
        `${expected.reference}: master ${actual.master} vs ${expected.master}`,
      );
    }
    if (actual.nodes.length !== expected.nodes.length) {
      differences.push(
        `${expected.reference}: ${actual.nodes.length} nodes vs ${expected.nodes.length}`,
      );
      continue;
    }
    expected.nodes.forEach((node, index) => {
      unify(node, actual.nodes[index]!, `${expected.reference} node ${index}`);
    });
    const names = new Set([
      ...Object.keys(expected.parameters),
      ...Object.keys(actual.parameters),
    ]);
    for (const name of names) {
      const expectedValue = expected.parameters[name];
      const actualValue = actual.parameters[name];
      if (
        expectedValue === undefined ||
        actualValue === undefined ||
        !sameParameterValue(expectedValue, actualValue)
      ) {
        differences.push(
          `${expected.reference}: ${name}=${actualValue ?? "(absent)"} vs ${expectedValue ?? "(absent)"}`,
        );
      }
    }
  }
  for (const extra of byReference.keys()) {
    differences.push(`unexpected instance ${extra}`);
  }
  return differences;
}

function requireProject(): CircuitProject {
  const project = createLibraryExampleProject(EXAMPLE_ID);
  expect(project).not.toBeNull();
  return project!;
}

function documentByCellName(
  project: CircuitProject,
  cellName: string,
): SchematicDocument {
  const document = project.documents.find(
    (candidate) => candidate.netlist?.name === cellName,
  );
  expect(document, cellName).toBeDefined();
  return document!;
}

function netIdOfTerminal(
  document: SchematicDocument,
  instanceId: string,
  pinName: string,
): string | undefined {
  return document.nets.find((net) =>
    net.terminals.some(
      (terminal) =>
        terminal.instanceId === instanceId && terminal.pinName === pinName,
    ),
  )?.id;
}

describe("the bundled five-transistor Sky130 OTA", () => {
  it("ships the OTA as a Cell and a testbench that instantiates it", () => {
    const project = requireProject();
    expect(project.documents).toHaveLength(2);
    const dut = documentByCellName(project, "ota_5t");
    const testbench = documentByCellName(project, "ota_5t_tb");
    expect(project.topDocumentId).toBe(testbench.id);

    // The formal interface is the reference `.subckt` interface, in order.
    expect(dut.netlist?.terminals.map((terminal) => terminal.name)).toEqual([
      "vss",
      "ibias",
      "vdd",
      "vinn",
      "vinp",
      "vout",
    ]);
    // Every port is a placed Cell Pin, the way the hierarchy feature states one.
    for (const terminal of dut.netlist!.terminals) {
      const port = dut.instances.find(
        (instance) => instance.id === terminal.interfaceInstanceIds[0],
      );
      expect(port?.symbolId, terminal.name).toBe("port");
      expect(port?.placement, terminal.name).not.toBeNull();
    }

    const call = testbench.instances.find(
      (instance) => instance.netlist?.binding?.kind === "subcircuit",
    );
    expect(call?.reference).toBe("XDUT");
    expect(call?.netlist?.binding).toEqual({
      kind: "subcircuit",
      childDocumentId: dut.id,
    });
    expect(
      testbench.instances
        .filter((instance) => instance.netlist)
        .map((instance) => instance.reference)
        .sort(),
    ).toEqual(["CL", "IBIAS", "VDD", "VINN", "VINP", "XDUT"]);
  });

  it("binds all six devices to the reviewed Sky130 masters with the stated geometry", () => {
    const project = requireProject();
    const dut = documentByCellName(project, "ota_5t");
    const masterOf = (instanceId: string): string | undefined => {
      const binding = dut.instances.find(
        (instance) => instance.id === instanceId,
      )?.netlist?.binding;
      if (binding?.kind !== "external-subcircuit") return undefined;
      return project.externalSubcircuitDefinitions.find(
        (definition) => definition.id === binding.definitionId,
      )?.name;
    };
    const expected = {
      M1: ["sky130_fd_pr__nfet_01v8", "1u", "96u", "12"],
      M2: ["sky130_fd_pr__nfet_01v8", "1u", "96u", "12"],
      M3: ["sky130_fd_pr__pfet_01v8", "1u", "64u", "8"],
      M4: ["sky130_fd_pr__pfet_01v8", "1u", "64u", "8"],
      M5: ["sky130_fd_pr__nfet_01v8", "3u", "100u", "20"],
      M6: ["sky130_fd_pr__nfet_01v8", "3u", "60u", "6"],
    };
    for (const [instanceId, [master, l, w, nf]] of Object.entries(expected)) {
      const instance = dut.instances.find(
        (candidate) => candidate.id === instanceId,
      );
      expect(masterOf(instanceId), instanceId).toBe(master);
      expect(instance?.netlist?.parameters, instanceId).toEqual({ l, w, nf });
    }

    // Bodies are electrical facts: NMOS on the vss port's Net, PMOS on vdd's.
    const vssNetId = dut.netlist!.terminals.find(
      (terminal) => terminal.name === "vss",
    )!.netId;
    const vddNetId = dut.netlist!.terminals.find(
      (terminal) => terminal.name === "vdd",
    )!.netId;
    for (const instanceId of ["M1", "M2", "M5", "M6"]) {
      expect(netIdOfTerminal(dut, instanceId, "B"), instanceId).toBe(vssNetId);
    }
    for (const instanceId of ["M3", "M4"]) {
      expect(netIdOfTerminal(dut, instanceId, "B"), instanceId).toBe(vddNetId);
    }
  });

  it("is drawn: every Instance placed, every Net wired, references and values visible", () => {
    const project = requireProject();
    for (const document of project.documents) {
      expect(
        document.instances.filter((instance) => !instance.placement),
        `${document.id}: unplaced`,
      ).toEqual([]);
      // No Net may be left as a flightline: each carries drawn geometry.
      for (const net of document.nets) {
        expect(
          document.routes.some((route) => route.netId === net.id),
          `${document.id}:${net.id}`,
        ).toBe(true);
      }
    }
    const dut = documentByCellName(project, "ota_5t");
    for (const instanceId of ["M1", "M2", "M3", "M4", "M5", "M6"]) {
      expect(
        dut.annotations.some(
          (annotation) =>
            annotation.binding?.kind === "instance-reference" &&
            annotation.binding.instanceId === instanceId,
        ),
        `${instanceId}: reference label`,
      ).toBe(true);
      expect(
        dut.annotations.some(
          (annotation) =>
            annotation.binding?.kind === "instance-value" &&
            annotation.binding.instanceId === instanceId,
        ),
        `${instanceId}: value label`,
      ).toBe(true);
    }
    // The testbench nodes a probe asks for are named, not generated.
    const testbench = documentByCellName(project, "ota_5t_tb");
    const labelled = new Set(
      testbench.connectivityEvidence.flatMap((evidence) =>
        evidence.kind === "name-claim" ? [evidence.name] : [],
      ),
    );
    for (const name of ["vdd", "vinp", "vinn", "ibias", "vout"]) {
      expect(labelled.has(name), name).toBe(true);
    }
  });

  it("passes the Check-and-Save report with no issue", () => {
    const project = requireProject();
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const evidence = collectProjectDiagnosticEvidence(
      project,
      resolver,
      buildProjectConnectivityIndex(project, resolver),
    );
    expect(
      evidence.diagnostics.map(
        (diagnostic) =>
          `${diagnostic.severity} ${diagnostic.code} ${diagnostic.message}`,
      ),
    ).toEqual([]);
  });

  it("exports an ota_5t subcircuit connectivity-equivalent to the reference SPICE", () => {
    const project = requireProject();
    const analysis = analyzeDesignNetlist(project);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ir).not.toBeNull();
    const exported = parseSubcircuit(printSpiceNetlist(analysis.ir!), "ota_5t");
    const reference = parseSubcircuit(
      readFileSync(resolve(process.cwd(), REFERENCE_PATH), "utf8"),
      "ota_5t",
    );
    expect(reference.instances).toHaveLength(6);
    expect(connectivityDifferences(reference, exported)).toEqual([]);
  });

  it("would notice a swapped node, a changed geometry or a missing device", () => {
    // The comparison above is only evidence if it can fail. Each mutation is
    // one defect the export could plausibly carry.
    const reference = parseSubcircuit(
      readFileSync(resolve(process.cwd(), REFERENCE_PATH), "utf8"),
      "ota_5t",
    );
    const mutate = (change: (cell: ParsedCell) => void): string[] => {
      const copy: ParsedCell = structuredClone(reference);
      change(copy);
      return connectivityDifferences(reference, copy);
    };
    // XM1's drain and source exchanged.
    expect(
      mutate((cell) => {
        const nodes = cell.instances[0]!.nodes;
        [nodes[0], nodes[2]] = [nodes[2]!, nodes[0]!];
      }),
    ).not.toEqual([]);
    // The tail device given the wrong width.
    expect(
      mutate((cell) => {
        cell.instances[4]!.parameters.w = "50";
      }),
    ).not.toEqual([]);
    // A finger count dropped.
    expect(
      mutate((cell) => {
        delete cell.instances[2]!.parameters.nf;
      }),
    ).not.toEqual([]);
    // The bias replica removed.
    expect(mutate((cell) => void cell.instances.pop())).not.toEqual([]);
    // Two subcircuit ports exchanged.
    expect(
      mutate((cell) => {
        [cell.ports[1], cell.ports[2]] = [cell.ports[2]!, cell.ports[1]!];
      }),
    ).not.toEqual([]);
    // A pure renaming of the internal nodes is not a difference.
    expect(
      mutate((cell) => {
        for (const instance of cell.instances) {
          instance.nodes = instance.nodes.map((node) =>
            node === "nleft" ? "n_a" : node === "tail" ? "n_b" : node,
          );
        }
      }),
    ).toEqual([]);
  });
});
