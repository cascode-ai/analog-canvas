import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { renderDocumentSvg } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("current rendering contract", () => {
  it("renders both Port assets as symbols and labels only from annotations", () => {
    const document = createEmptyDocument("doc", "Ports");
    document.instances.push(
      {
        id: "VIN",
        symbolId: "port",
        properties: {},
        placement: {
          position: { x: 40, y: 80 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "VOUT",
        symbolId: "port-filled",
        properties: {},
        placement: {
          position: { x: 180, y: 80 },
          rotation: 180,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "signal",
      scope: "local",
      terminals: [
        { instanceId: "VIN", pinName: "P" },
        { instanceId: "VOUT", pinName: "P" },
      ],
    });
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
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
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
    document.routes.push({
      id: "rail",
      netId: "net-vdd",
      from: { kind: "junction", junctionId: "rail-left" },
      to: { kind: "junction", junctionId: "rail-right" },
      waypoints: [],
      segmentModes: ["manual"],
      presentation: "power-rail",
    });
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
      'data-text-run="subscript" dx="0.046em" font-size="76%" baseline-shift="-0.28em" style="font-style:normal;font-weight:700">DD',
    );
  });
});
