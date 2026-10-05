import { planEnsureNamedNet } from "@icm/edit-engine";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import type { AgentSessionSnapshot } from "../schema.js";
import { createAgentCircuitService } from "../service.js";

let built: AgentSessionSnapshot | undefined;

/**
 * A small circuit as the editor holds it, made as an Agent makes one: typed
 * edits and a wire through the real Agent service and Edit Engine, read back
 * as the real Snapshot. One NMOS M1 (w 2u, l 1u), one resistor R1, a wire
 * from M1.D to R1.1 (vout-route, on vout-net) that a Net Label (label-1)
 * names Vout, and a global VDD rail from junction-1 to junction-2. Nothing
 * in it is written by hand: IDs, pins, routes and diagnostics are the real
 * ones.
 */
export function testSnapshot(): AgentSessionSnapshot {
  built ??= build();
  return structuredClone(built);
}

function build(): AgentSessionSnapshot {
  const created = createEmptyProject("project-1", "Test Project");
  created.documents[0]!.id = "main";
  created.documents[0]!.name = "Main";
  created.topDocumentId = "main";
  let project: CircuitProject = created;
  const document = () => project.documents[0]!;
  const service = createAgentCircuitService({
    agentId: "fixture",
    resolver: new InMemorySymbolResolver(builtInSymbols),
    permissions: {
      snapshot: true,
      render: false,
      sourceSpans: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
    store: {
      getDocument: () => document(),
      commitDocument: (next) => {
        project = { ...project, documents: [next] };
      },
      getProject: () => project,
      commitProject: (next) => {
        project = next;
      },
    },
  });
  let request = 0;
  const transact = (payload: Record<string, unknown>) => {
    request += 1;
    const response = service.handle({
      apiVersion: "3.0",
      requestId: `fixture-${request}`,
      operation: "transact",
      transactionId: `fixture-${request}`,
      documentId: "main",
      expectedRevision: document().revision,
      ...payload,
    });
    if (!response.ok)
      throw new Error(
        `The fixture's edit was refused: ${response.error.message}`,
      );
  };

  transact({
    edits: [
      {
        kind: "add_instance",
        instance: {
          id: "instance-1",
          reference: "M1",
          symbolId: "nmos",
          placement: {
            position: { x: 300, y: 240 },
            rotation: 0,
            mirror: "none",
          },
          netlist: { parameters: { w: "2u", l: "1u" } },
        },
      },
      {
        kind: "add_instance",
        instance: {
          id: "instance-2",
          reference: "R1",
          symbolId: "resistor",
          placement: {
            position: { x: 460, y: 120 },
            rotation: 0,
            mirror: "none",
          },
        },
      },
    ],
  });
  transact({
    wireIntent: {
      id: "vout",
      from: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "instance-1", pinName: "D" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "instance-2", pinName: "1" },
      },
    },
  });
  // Name the wire's Net with a Net Label, as the editor's Net Label does.
  const netId = document().routes.find(
    (route) => route.id === "vout-route",
  )!.netId;
  const named = planEnsureNamedNet(document(), {
    candidateNetId: netId,
    name: "Vout",
    evidenceId: "evidence-vout",
    owner: { kind: "net-label", annotationId: "label-1" },
    scope: "local",
  });
  if (!named.ok) throw new Error(named.message);
  transact({
    edits: [
      ...named.edits,
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          id: "label-1",
          kind: "net-label",
          binding: { kind: "net-name", netId },
          netId,
          // Over the wire's top run, from (310, 100) to (460, 100).
          anchor: { kind: "free", position: { x: 380, y: 90 } },
          alignment: "middle",
          rotation: 0,
          locked: false,
        },
      },
    ],
  });
  transact({
    edits: [
      {
        kind: "add_power_rail",
        netId: "net-vdd",
        routeId: "route-vdd",
        startJunctionId: "junction-1",
        endJunctionId: "junction-2",
        labelId: "label-vdd",
        netName: "VDD",
        scope: "global",
        powerDomain: "vdd",
        start: { x: 200, y: 40 },
        end: { x: 360, y: 40 },
      },
    ],
  });
  const response = service.handle({
    apiVersion: "3.0",
    requestId: "fixture-snapshot",
    operation: "snapshot",
    documentId: "main",
  });
  if (!response.ok || !("snapshot" in response))
    throw new Error("The fixture's Snapshot could not be read");
  return response.snapshot;
}
