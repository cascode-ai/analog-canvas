import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  InMemorySymbolResolver,
  type SymbolDefinition,
} from "@icm/symbols";

import { renderDocumentSvg } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("current rendering contract", () => {
  it("renders hierarchical pin names with Razavi math typography", () => {
    const top = createEmptyDocument("top", "Top");
    const child = createEmptyDocument("child", "GainStage");
    child.netlist!.terminals.push({
      id: "terminal-v-in",
      name: "VGS1",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    top.instances.push({
      id: "X1",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "X1",
      netlist: {
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: child.id,
        },
      },
      importProvenance: {
        kind: "subcircuit",
        sourceMasterName: child.netlist!.name,
        sourceTarget: `cell:${child.id}`,
        terminalMapping: [{ sourcePosition: 0, pinName: "VGS1" }],
      },
    });
    const project = createEmptyProject("project", "Hierarchy", top.id);
    project.documents[0] = top;
    project.documents.push(child);

    const svg = renderDocumentSvg(
      top,
      createProjectSymbolResolver(project, builtInSymbols),
    );

    expect(svg).toContain('data-pin-name="VGS1"');
    expect(svg).toContain("font-style:italic;font-weight:700");
    expect(svg).toContain('data-text-run="subscript"');
    expect(svg).toContain("font-style:normal;font-weight:700");
    expect(svg).not.toContain("baseline-shift");
    expect(svg).not.toMatch(/font-size="[\d.]+%"/u);
    expect(svg).toContain("svg{font-size:");
    expect(svg).not.toMatch(/text\{[^}]*font-size:/u);
  });

  it("keeps north and south hierarchy pin names clear of the Cell body edge", () => {
    const top = createEmptyDocument("top", "Top");
    const child = createEmptyDocument("child", "VerticalStage");
    child.netlist!.terminals.push(
      {
        id: "terminal-top",
        name: "TOP",
        netId: "net-top",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-bottom",
        name: "BOTTOM",
        netId: "net-bottom",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );
    child.presentation.cellSymbol = {
      pinPlacements: [
        { terminalId: "terminal-top", side: "north", offset: 0 },
        { terminalId: "terminal-bottom", side: "south", offset: 0 },
      ],
    };
    top.instances.push({
      id: "X1",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "X1",
      netlist: {
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: child.id,
        },
      },
      importProvenance: {
        kind: "subcircuit",
        sourceMasterName: child.netlist!.name,
        sourceTarget: `cell:${child.id}`,
        terminalMapping: [
          { sourcePosition: 0, pinName: "TOP" },
          { sourcePosition: 1, pinName: "BOTTOM" },
        ],
      },
    });
    const project = createEmptyProject("project", "Hierarchy", top.id);
    project.documents[0] = top;
    project.documents.push(child);

    const svg = renderDocumentSvg(
      top,
      createProjectSymbolResolver(project, builtInSymbols),
    );

    expect(svg).toContain('data-pin-name="TOP" x="100" y="98"');
    expect(svg).toContain('data-pin-name="BOTTOM" x="100" y="110"');
  });

  it("keeps non-hierarchical visible pin names on the plain-text path", () => {
    const namedPinSymbol = {
      schemaVersion: 1,
      id: "named-pin-test",
      name: "Named Pin Test",
      viewBox: { x: -20, y: -20, width: 40, height: 40 },
      pins: [
        {
          name: "V_in",
          role: "signal",
          at: { x: -20, y: 0 },
          direction: "west",
          presentation: {
            visibility: "visible",
            showName: true,
            leadLength: 10,
          },
        },
      ],
      primitives: [],
      variants: [],
    } satisfies SymbolDefinition;
    const document = createEmptyDocument("doc", "Named pin");
    document.instances.push({
      id: "U1",
      symbolId: namedPinSymbol.id,
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });

    const svg = renderDocumentSvg(
      document,
      new InMemorySymbolResolver([...builtInSymbols, namedPinSymbol]),
    );

    expect(svg).toContain('data-pin-name="V_in"');
    expect(svg).toContain(">V_in</text>");
    const pinText = svg.match(
      /<text data-pin-name="V_in"[^>]*>.*?<\/text>/u,
    )?.[0];
    expect(pinText).toBeDefined();
    expect(pinText).not.toContain("font-style:italic");
  });

  it("renders an explicit pin display name without changing electrical identity", () => {
    const namedPinSymbol = {
      schemaVersion: 1,
      id: "display-pin-test",
      name: "Display Pin Test",
      viewBox: { x: -20, y: -20, width: 40, height: 40 },
      pins: [
        {
          name: "QBAR",
          role: "output-complement",
          at: { x: 20, y: 0 },
          direction: "east",
          presentation: {
            visibility: "visible",
            showName: true,
            displayName: "Q",
            textStyle: "math-symbol",
            textSizeScale: 0.68,
            leadLength: 10,
          },
        },
      ],
      primitives: [],
      variants: [],
    } satisfies SymbolDefinition;
    const document = createEmptyDocument("doc", "Display pin");
    document.instances.push({
      id: "U1",
      symbolId: namedPinSymbol.id,
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });

    const svg = renderDocumentSvg(
      document,
      new InMemorySymbolResolver([...builtInSymbols, namedPinSymbol]),
    );

    expect(svg).toContain('data-pin-name="QBAR"');
    expect(svg).toContain('data-text-run="overbar"');
    expect(svg).toContain("text-decoration:overline");
    expect(svg).toContain(">Q</tspan>");
    expect(svg).not.toContain(">QBAR</text>");
    expect(svg).toContain("font-style:italic;font-weight:700");
    expect(svg).toContain('font-size="10.28"');
  });

  it("renders both Port assets as symbols and labels only from annotations", () => {
    const document = createEmptyDocument("doc", "Ports");
    document.instances.push(
      {
        id: "VIN",
        symbolId: "port",
        placement: {
          position: { x: 40, y: 80 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "VOUT",
        symbolId: "port-filled",
        placement: {
          position: { x: 180, y: 80 },
          rotation: 180,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "signal",

      terminals: [
        { instanceId: "VIN", pinName: "P" },
        { instanceId: "VOUT", pinName: "P" },
      ],
    });
    document.netlist = {
      name: "Ports",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vin",
          name: "VIN",
          netId: "signal",
          direction: "input",
          interfaceInstanceIds: ["VIN"],
        },
        {
          id: "terminal-vout",
          name: "VOUT",
          netId: "signal",
          direction: "output",
          interfaceInstanceIds: ["VOUT"],
        },
      ],
    };
    document.annotations.push({
      id: "label-vin",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "V_in" }] },
      anchor: {
        kind: "object",
        objectId: "VIN",
        localOffset: { x: -20, y: -10 },
        fallbackPosition: { x: 20, y: 70 },
      },
      alignment: "end",
      rotation: 0,
      locked: false,
    });

    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-symbol-id="port"');
    expect(svg).toContain('data-symbol-id="port-filled"');
    expect(svg).toContain("V_in");
    expect(svg).not.toContain(">VOUT<");
  });

  it("renders a VDD rail as one thick route with a wholly bold italic label", () => {
    const document = createEmptyDocument("doc", "Power rail");
    document.nets.push({
      id: "net-vdd",

      terminals: [],
    });
    document.junctions.push(
      {
        id: "rail-left",
        netId: "net-vdd",
        position: { x: 40, y: 80 },
        role: "route-anchor",
      },
      {
        id: "rail-right",
        netId: "net-vdd",
        position: { x: 180, y: 80 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "rail",
        netId: "net-vdd",
        start: { kind: "junction", junctionId: "rail-left" },
        end: { kind: "junction", junctionId: "rail-right" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
    );
    document.annotations.push({
      id: "rail-label",
      kind: "power-label",
      content: {
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [
              {
                kind: "span",
                style: "bold",
                children: [
                  { kind: "text", value: "V" },
                  {
                    kind: "span",
                    style: "subscript",
                    children: [{ kind: "text", value: "DD" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      netId: "net-vdd",
      anchor: {
        kind: "object",
        objectId: "rail-right",
        localOffset: { x: 10, y: 10 },
        fallbackPosition: { x: 190, y: 90 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-route-presentation="power-rail"');
    expect(svg).not.toContain('data-role="supply-bar"');
    expect(svg).toContain(
      'style="font-style:italic;font-weight:700">V<tspan data-text-run="subscript"',
    );
    expect(svg).toContain(
      'data-text-run="subscript" dx="0.528455" dy="3.216685" font-size="11.48816px" style="font-style:normal;font-weight:700">DD',
    );
    expect(svg).not.toContain("baseline-shift");
  });

  it("does not interpret a BJT base route as a MOS bulk connection", () => {
    const document = createEmptyDocument("doc", "BJT base route");
    document.instances.push({
      id: "Q1",
      symbolId: "npn",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "base-net",

      terminals: [{ instanceId: "Q1", pinName: "B" }],
    });
    document.junctions.push({
      id: "base-anchor",
      netId: "base-net",
      position: { x: 40, y: 100 },
      role: "route-anchor",
    });
    // Older editor builds could persist this presentation solely because the
    // pin happened to be named B. It must now render as an ordinary wire.
    document.routes.push(
      createRoutePath({
        id: "base-route",
        netId: "base-net",
        start: { kind: "terminal", instanceId: "Q1", pinName: "B" },
        end: { kind: "junction", junctionId: "base-anchor" },
        bends: [],
        modes: ["manual"],
        presentation: "bulk-dashed",
      }),
    );

    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-object-id="base-route"');
    expect(svg).not.toContain('data-route-presentation="bulk-dashed"');
    expect(svg).not.toContain('stroke-dasharray="3 3"');
  });
});
