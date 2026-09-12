import { test, expect, beforeAll } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  // Exercise the actual standalone CLI, including on a clean CI checkout.
  // Unit CI intentionally does not prebuild workspace dist artifacts.
  execSync(
    "pnpm --filter @icm/agent-adapter... --filter @icm/exporters... build",
    {
      stdio: "pipe",
      timeout: 180000,
    },
  );
}, 190000);

test("complete example Projects preserve their circuits and use native source-only experiments", () => {
  const directory = mkdtempSync(join(tmpdir(), "icm-native-projects-test-"));
  try {
    execFileSync(
      process.execPath,
      ["scripts/build-native-simulation-examples.mjs", directory],
      { stdio: "pipe", timeout: 60000 },
    );
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    expect(manifest.projects.map((p) => p.folders.length)).toEqual([
      4, 3, 4, 8,
    ]);
    for (const item of manifest.projects) {
      const project = JSON.parse(readFileSync(item.file, "utf8"));
      for (const document of project.documents) {
        if (item.slug !== "04-sky130-ota")
          for (const name of ["in", "out"])
            expect(document.connectivityEvidence).toContainEqual(
              expect.objectContaining({ kind: "name-claim", name }),
            );
        expect(document.instances.every((i) => i.placement !== null)).toBe(
          true,
        );
        const inspection = JSON.parse(
          readFileSync(
            join(directory, `${item.slug}-${document.id}-inspection.json`),
            "utf8",
          ),
        );
        expect(inspection.document.diagnostics).toEqual([]);
      }
      for (const folder of project.simulationFolders) {
        const config = JSON.parse(
          folder.input.files.find((f) => f.path === folder.input.configPath)
            .text,
        );
        expect(config).toEqual({
          version: 2,
          environment: { profileId: manifest.profileId },
        });
        const source = folder.input.files.find(
          (f) => f.path === folder.input.entry,
        ).text;
        expect(source).toContain("write out.raw");
        expect(source).not.toContain("/opt/");
        expect(folder.input.circuitBindings).toHaveLength(1);
      }
    }
    const original = JSON.parse(
      readFileSync("netlists/native-ota/source.icproj.json", "utf8"),
    );
    const ota = JSON.parse(readFileSync(manifest.projects[3].file, "utf8"));
    const before = original.documents.find((d) => d.id === "document-ota-5t");
    const after = ota.documents.find((d) => d.id === "document-ota-5t");
    expect(after.netlist.terminals.map((t) => t.name)).toEqual(
      before.netlist.terminals.map((t) => t.name),
    );
    expect(
      after.instances.map((i) => ({ id: i.id, netlist: i.netlist })),
    ).toEqual(before.instances.map((i) => ({ id: i.id, netlist: i.netlist })));
    const closed = ota.simulationFolders.find((f) => f.id === "ota-closed");
    const testbench = ota.documents.find(
      (d) => d.id === "document-ota-5t-testbench",
    );
    for (const name of ["vinp", "vinn", "vdd", "ibias"]) {
      const net = testbench.nets.find((n) =>
        n.terminals.some((t) => t.instanceId === "XDUT" && t.pinName === name),
      );
      expect(testbench.connectivityEvidence).toContainEqual(
        expect.objectContaining({ kind: "name-claim", netId: net.id, name }),
      );
    }
    expect(
      closed.input.files.find((f) => f.path === "testbench.spice").text,
    ).toContain("XDUT 0 ibias vdd vout vinp vout ota_5t");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90000);
