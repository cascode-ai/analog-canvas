import { describe, expect, it } from "vitest";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseSpiceNumber } from "@icm/spice";
import { importNetlistSources } from "./netlist-source-import.js";

/**
 * Every value or parameter the import rewrites (#2294) comes back the same
 * through an export in its dialect and a second import: what the rewrite
 * changed was spelling, not meaning. A rewrite not listed here is not made.
 */
const file = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

async function imported(path: string, text: string): Promise<CircuitProject> {
  const result = await importNetlistSources([file(path, text)], path);
  if (result.status !== "imported")
    throw new Error(
      result.diagnostics.map(({ message }) => message).join("\n"),
    );
  return result.project;
}

/** A value as meant: a SPICE number by its value, other text as written. */
function meant(value: string): string {
  const number = parseSpiceNumber(value);
  return number && !number.trailingUnit
    ? Number(number.value.toPrecision(12)).toString()
    : value;
}

/**
 * What a design is electrically, whatever its spelling: each part's symbol,
 * binding and parameter values, and which part pins share a net. SPICE
 * spells a call with an X before its name, and states an AC phase of 0 a
 * card left out; neither changes what the part is.
 */
function facts(project: CircuitProject) {
  return project.documents
    .map((document) => {
      const parts = document.instances.filter(
        ({ importProvenance }) => importProvenance,
      );
      const name = new Map(
        parts.map((instance) => {
          const call =
            instance.netlist?.binding?.kind === "external-subcircuit";
          const reference = instance.reference ?? instance.id;
          return [
            instance.id,
            call ? reference.replace(/^X(?=[A-Z])/iu, "") : reference,
          ] as const;
        }),
      );
      return {
        cell: document.name,
        parts: parts
          .map((instance) => {
            const { acPhase, ...parameters } =
              instance.netlist?.parameters ?? {};
            const binding = instance.netlist?.binding;
            return {
              reference: name.get(instance.id),
              symbolId: instance.symbolId,
              binding: binding
                ? `${binding.kind}:${"name" in binding ? binding.name : ""}`
                : undefined,
              parameters: Object.fromEntries(
                Object.entries({
                  ...parameters,
                  ...(acPhase !== undefined && meant(acPhase) !== "0"
                    ? { acPhase }
                    : {}),
                })
                  .map(([key, value]) => [key, meant(value)] as const)
                  .sort(([a], [b]) => a.localeCompare(b)),
              ),
            };
          })
          .sort((a, b) =>
            String(a.reference).localeCompare(String(b.reference)),
          ),
        nets: document.nets
          .map((net) =>
            net.terminals
              .filter(({ instanceId }) => name.has(instanceId))
              .map(
                ({ instanceId, pinName }) =>
                  `${name.get(instanceId)}.${pinName}`,
              )
              .sort()
              .join(" "),
          )
          .filter(Boolean)
          .sort(),
      };
    })
    .sort((a, b) => a.cell.localeCompare(b.cell));
}

async function roundTrip(
  path: string,
  text: string,
  format: "spice" | "spectre",
) {
  const first = await imported(path, text);
  const exported = createDesignNetlistExport(first, { format });
  if (exported.status !== "ready")
    throw new Error(
      exported.diagnostics.map(({ message }) => message).join("\n"),
    );
  const second = await imported(
    format === "spectre" ? "again.scs" : "again.sp",
    exported.file.text,
  );
  const result = { first: facts(first), second: facts(second) };
  // The comparison reaches connectivity, not only parts.
  expect(result.first.flatMap(({ nets }) => nets).length).toBeGreaterThan(0);
  return result;
}

describe("import rewrites survive export and import", () => {
  it.each([
    [
      "a controlled source's gain, read as gm or rm",
      "* gains\n.subckt top out cp cn\nV1 sense 0 DC 0\nG1 out 0 cp cn 3m\nH1 out 0 V1 5k\nF1 out 0 V1 4\nE1 out 0 cp cn 2\n.ends top\n",
    ],
    [
      "a source's card tail, split into its DC, AC and waveform",
      "* source\n.subckt top vdd\nV1 vdd 0 DC 1.8 AC 1 PULSE(0 1.8 1n 1n 1n 5n 10n)\n.ends top\n",
    ],
  ])("SPICE: %s", async (_name, text) => {
    const { first, second } = await roundTrip("top.sp", text, "spice");
    expect(second).toEqual(first);
  });

  it("Spectre: a number's suffix, spelled as SPICE reads it", async () => {
    const { first, second } = await roundTrip(
      "top.scs",
      "simulator lang=spectre\nsubckt top a b\nR1 (a b) resistor r=1M\nC1 (a 0) capacitor c=1a\nR2 (b 0) resistor r=1.50k\nends top\n",
      "spectre",
    );
    expect(second).toEqual(first);
    // Each suffix spelled as SPICE reads it: mega as Meg, atto written out.
    expect(first[0]!.parts.map(({ parameters }) => parameters)).toEqual([
      { value: "1e-18" },
      { value: "1000000" },
      { value: "1500" },
    ]);
  });

  it("SPICE: a reviewed SKY130 M card, imported as the call its Profile runs, keeps its size", async () => {
    const { first, second } = await roundTrip(
      "top.sp",
      "* reviewed\n.subckt top d g s b\nM1 d g s b sky130_fd_pr__nfet_01v8 w=1e-6 l=150e-9\n.ends top\n",
      "spice",
    );
    expect(second).toEqual(first);
  });
});
