import { createRoutePath } from "@icm/model";
import type { AgentSessionSnapshot } from "@icm/agent-adapter";

function connection(x: number, y: number) {
  return {
    contactPoint: { x, y },
    gridLanding: { x, y },
    escapePath: [],
    outward: null,
  };
}

/**
 * Deterministic minimal Snapshot for Helper tests: one NMOS, one resistor,
 * a routed local Net (Vout), a global VDD Net anchored by one junction, and
 * one net-label annotation. Revision 5.
 */
export function testSnapshot(): AgentSessionSnapshot {
  return {
    snapshotVersion: "2.0",
    electricalTopologyHash: "a".repeat(64),
    byteLength: 2048,
    project: {
      id: "project-1",
      name: "Test Project",
      structureRevision: 0,
      topDocumentId: "main",
      simulation: null,
      documents: [
        {
          id: "main",
          name: "Main",
          instanceCount: 2,
          netCount: 2,
          references: [],
        },
      ],
    },
    document: {
      id: "main",
      name: "Main",
      revision: 5,
      sourceStatus: "in-sync",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      presentation: {
        styleProfileId: "razavi-textbook-v1",
        grid: 20,
        compactness: "normal",
      },
      cellInterface: null,
      instances: [
        {
          id: "instance-1",
          reference: "M1",
          masterName: null,
          symbolId: "nmos",
          symbolVariantId: null,
          target: null,
          model: null,
          parameters: {},
          placement: {
            position: { x: 300, y: 240 },
            rotation: 0,
            mirror: "none",
          },
          bounds: { x: 280, y: 200, width: 40, height: 80 },
          pins: [
            {
              name: "G",
              role: "input",
              direction: "west",
              visibility: "visible",
              localPosition: { x: -20, y: 0 },
              connection: connection(280, 240),
              netId: "net-g",
            },
            {
              name: "D",
              role: "output",
              direction: "north",
              visibility: "visible",
              localPosition: { x: 0, y: -40 },
              connection: connection(300, 200),
              netId: "net-vout",
            },
            {
              name: "S",
              role: "input",
              direction: "south",
              visibility: "visible",
              localPosition: { x: 0, y: 40 },
              connection: connection(300, 280),
              netId: "net-gnd",
            },
          ],
          mosBulk: { status: "supply-default", netId: null },
          netlist: {
            binding: { kind: "primitive", deviceClass: "mos" },
            parameters: { w: "2u", l: "1u" },
          },
        },
        {
          id: "instance-2",
          reference: "R1",
          masterName: null,
          symbolId: "resistor",
          symbolVariantId: null,
          target: null,
          model: null,

          parameters: {},
          placement: {
            position: { x: 460, y: 160 },
            rotation: 0,
            mirror: "none",
          },
          bounds: null,
          pins: [
            {
              name: "1",
              role: "passive",
              direction: "north",
              visibility: "visible",
              localPosition: { x: 0, y: -20 },
              connection: connection(460, 140),
              netId: "net-vout",
            },
            {
              name: "2",
              role: "passive",
              direction: "south",
              visibility: "visible",
              localPosition: { x: 0, y: 20 },
              connection: connection(460, 180),
              netId: null,
            },
          ],
        },
      ],
      nets: [
        {
          id: "net-vout",
          name: "Vout",
          scope: "local",
          powerDomain: "none",
          terminals: [
            { instanceId: "instance-1", pinName: "D" },
            { instanceId: "instance-2", pinName: "1" },
          ],
          routeIds: ["route-1"],
          junctionIds: [],
        },
        {
          id: "net-vdd",
          name: "VDD",
          scope: "global",
          powerDomain: "vdd",
          terminals: [],
          routeIds: [],
          junctionIds: ["junction-1"],
        },
      ],
      routes: [
        {
          ...createRoutePath({
            id: "route-1",
            netId: "net-vout",
            start: {
              kind: "terminal",
              instanceId: "instance-1",
              pinName: "D",
            },
            end: {
              kind: "terminal",
              instanceId: "instance-2",
              pinName: "1",
            },
            bends: [
              { x: 300, y: 160 },
              { x: 460, y: 160 },
            ],
            modes: ["auto", "auto", "auto"],
          }),
          polyline: [
            { x: 300, y: 200 },
            { x: 300, y: 160 },
            { x: 460, y: 160 },
            { x: 460, y: 140 },
          ],
        },
      ],
      junctions: [
        {
          id: "junction-1",
          netId: "net-vdd",
          position: { x: 200, y: 80 },
          role: "route-anchor",
        },
      ],
      noConnects: [],
      annotations: [
        {
          id: "label-1",
          kind: "net-label",
          content: { runs: [{ kind: "text", value: "Vout" }] },
          anchor: { kind: "free", position: { x: 300, y: 150 } },
          netId: "net-vout",
          alignment: "middle",
          rotation: 0,
          locked: false,
        },
      ],
      drafting: { objects: [] },
      layoutGroups: [],
      constraints: [],
      diagnostics: [
        {
          code: "VISUAL_SPACING",
          domain: "visual",
          severity: "warning",
          message: "Label Vout is close to route-1",
          objectIds: ["label-1"],
        },
      ],
    },
  };
}
