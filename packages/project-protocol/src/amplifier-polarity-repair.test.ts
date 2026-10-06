import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyProject, type SymbolDefinition } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import { createDesignNetlistExport } from "@icm/netlist";
import { renderDocumentSvg } from "@icm/render-svg";
import { parseProject, serializeProject } from "./index.js";

const legacySymbol: SymbolDefinition = JSON.parse(
  readFileSync(
    "fixtures/components/opamp-differential-wide-inputs-swapped-v8.json",
    "utf8",
  ),
);

function legacyProject(symbol: SymbolDefinition = legacySymbol) {
  const project = createEmptyProject(
    "polarity-repair",
    "Polarity repair",
    "dut",
  );
  const document = project.documents[0]!;
  document.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: symbol.id,
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: { parameters: { gain: "20" } },
  });
  for (const [index, pin] of symbol.pins.entries()) {
    const name = `N${index}`;
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "X1", pinName: pin.name }],
    });
    document.connectivityEvidence.push({
      id: `hint-${name}`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  const captured = withProjectComponentDefinitions(project);
  captured.componentDefinitions!.find(
    (definition) => definition.symbol.id === symbol.id,
  )!.symbol = structuredClone(symbol);
  return captured;
}

describe("recognized amplifier polarity snapshot repair", () => {
  it("covers all sixteen recognized forms, keeps current forms and custom snapshots", () => {
    const current = builtInSymbols.filter((symbol) =>
      symbol.id.startsWith("opamp-differential"),
    );
    expect(current).toHaveLength(16);
    for (const symbol of current) {
      const old = {
        ...structuredClone(symbol),
        primitives: symbol.primitives.map((primitive) =>
          primitive.kind === "line" &&
          primitive.part?.includes("input-polarity")
            ? {
                ...primitive,
                from: { ...primitive.from, y: -primitive.from.y },
                to: { ...primitive.to, y: -primitive.to.y },
              }
            : primitive,
        ),
      };
      const repaired = parseProject(JSON.stringify(legacyProject(old)));
      expect(
        repaired.componentDefinitions!.find(
          (definition) => definition.symbol.id === symbol.id,
        )!.symbol,
      ).toEqual(symbol);
      const correct = legacyProject(symbol);
      expect(
        parseProject(JSON.stringify(correct)).componentDefinitions,
      ).toEqual(correct.componentDefinitions);
    }
    const custom = legacyProject();
    const definition = custom.componentDefinitions![0]!;
    definition.symbol.name = "My own booster drawing";
    definition.symbol.primitives.push({
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 2,
    });
    const loaded = parseProject(JSON.stringify(custom));
    expect(loaded.componentDefinitions).toEqual(custom.componentDefinitions);
    expect(serializeProject(parseProject(serializeProject(loaded)))).toBe(
      serializeProject(loaded),
    );
  });

  it("repairs the historical gain-booster symbol without changing its electrical export", () => {
    const original = legacyProject();
    const raw = JSON.stringify(original);
    const before = createDesignNetlistExport(original);
    expect(before.status).toBe("ready");
    const loaded = parseProject(raw);
    const resolved = createProjectSymbolResolver(loaded, []).resolve(
      legacySymbol.id,
    )!.definition;
    const positive = resolved.primitives.find(
      (primitive) => primitive.part === "input-polarity",
    )!;
    if (positive.kind !== "line") throw new Error("Missing positive stroke");
    expect((positive.from.y + positive.to.y) / 2).toBe(-14);
    expect(resolved.pins).toEqual(legacySymbol.pins);
    expect(loaded.documents).toEqual(original.documents);
    expect(createDesignNetlistExport(loaded)).toEqual(before);
    expect(JSON.stringify(original)).toBe(raw);
    const expected = builtInSymbols.find(
      (symbol) => symbol.id === legacySymbol.id,
    )!;
    const { componentDefinitions: _definitions, ...unembedded } = loaded;
    expect(
      renderDocumentSvg(
        loaded.documents[0]!,
        createProjectSymbolResolver(loaded, []),
      ),
    ).toBe(
      renderDocumentSvg(
        loaded.documents[0]!,
        createProjectSymbolResolver(unembedded, [expected]),
      ),
    );
    const saved = serializeProject(loaded);
    expect(serializeProject(parseProject(saved))).toBe(saved);
  });
});
