import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { parseNgspiceRawfile } from "@icm/spice-run";
import { prepareFolderExecutionInput } from "./prepare-input.js";
import { CapabilitiesSchema } from "./contract.js";
import { sg13g2Project } from "../test-support/sg13g2-project.js";
import { newFolderProfile } from "@icm/netlist";
import profile from "../../../containers/ngspice/sg13g2/profile.json";
import sky130 from "../../../containers/ngspice/hosted-sky130-profile.json";
import { routeSimulationRequest } from "../../../worker/simulation.js";

const profiles = [sky130, profile].map((p) => ({
  id: p.id,
  engine: "ngspice" as const,
  corners: p.qualifiedScope.sections,
  devices: p.qualifiedScope.devices,
  dependencies: [{ id: p.models.id, sha256: p.models.contentSha256 }],
  cellLibraries:
    p.id === profile.id
      ? profile.cellLibraries.map((l) => ({
          id: l.id,
          sha256: l.contentSha256,
          cells: l.cells,
          directive: "include" as const,
          masters: l.masters,
        }))
      : [],
}));
const caps = CapabilitiesSchema.parse({
  configured: true,
  inputs: ["raw", "structured"],
  rawfileCollection: "declared-single-ascii",
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [profiles[1]],
  modelLibrary: {
    path: profile.models.library.runtimePath,
    section: "nominal",
  },
  maxInputBytes: 2097152,
  maxOutputBytes: 67108864,
  maxTimeoutMs: 120000,
  cancel: true,
});

it("selects the only SG13 Profile and prepares all dependencies without changing the Project", async () => {
  const { project, folder } = sg13g2Project();
  const before = structuredClone(project);
  expect(
    newFolderProfile(profiles, { project, documentId: project.topDocumentId }),
  ).toEqual({ ok: true, profileId: profile.id });
  const prepared = await prepareFolderExecutionInput(project, folder, caps);
  expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
  if (!prepared.ok) return;
  expect(prepared.input.environment).toMatchObject({ profileId: profile.id });
  expect(prepared.input.dependencies).toHaveLength(2);
  expect(prepared.input.preparedDeck).toMatch(
    /\.lib .+ mos-fs_hbt-bcs_res-wcs_cap-bcs/u,
  );
  expect(prepared.input.netlist).toContain("ng=2 m=3");
  expect(project).toEqual(before);
});

it("refuses generated SG13 devices on a SKY130 Profile before submitting a run", async () => {
  const { project, folder, entry } = sg13g2Project();
  folder.input.dependencies = [];
  entry.text = entry.text.replace(/^\.lib .+\n/mu, "");
  const document = project.documents[0]!;
  document.instances = document.instances.filter((i) => i.id !== "X1");
  for (const net of document.nets)
    net.terminals = net.terminals.filter((t) => t.instanceId !== "X1");
  project.externalSubcircuitDefinitions =
    project.externalSubcircuitDefinitions.filter(
      (d) => d.name !== "sg13g2_nand2_1",
    );
  folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
    JSON.stringify({ version: 2, environment: { profileId: sky130.id } });
  const result = await prepareFolderExecutionInput(project, folder, {
    ...caps,
    profiles: [profiles[0]!],
    modelLibrary: { path: sky130.models.library.runtimePath, section: "tt" },
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain("MODEL_SOURCE_PROFILE_CONFLICT");
});

it("refuses a gate strength outside the qualified SG13 cells", async () => {
  const { project, folder } = sg13g2Project();
  project.externalSubcircuitDefinitions.find(
    (d) => d.name === "sg13g2_nand2_1",
  )!.name = "sg13g2_nand2_99";
  const result = await prepareFolderExecutionInput(project, folder, caps);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain("STANDARD_CELL_UNSUPPORTED");
});

const endpoint = process.env.ICM_SG13G2_URL;
it.skipIf(!endpoint)(
  "matches the independent DUT numerically through the real selected-Profile transport",
  async () => {
    const { project, folder, entry } = sg13g2Project();
    const env = { SG13G2_UPSTREAM_URL: endpoint! };
    const request = (body: unknown) =>
      new Request("https://local.test/api/simulate", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const discovered = CapabilitiesSchema.parse(
      await (await routeSimulationRequest(
        request({
          operation: "capabilities",
          accepts: ["cell-libraries", "cell-masters"],
          environment: { profileId: profile.id },
        }),
        env,
      ))!.json(),
    );
    expect(discovered.configured).toBe(true);
    {
      const legacy = await (await routeSimulationRequest(
        request({
          operation: "capabilities",
          accepts: ["cell-libraries"],
          environment: { profileId: profile.id },
        }),
        env,
      ))!.json();
      expect(legacy.profiles[0].cellLibraries).toEqual([]);
      const unsupported = structuredClone(project);
      unsupported.externalSubcircuitDefinitions.find(
        (d) => d.name === "sg13g2_nand2_1",
      )!.name = "sg13g2_nand2_99";
      const refused = await prepareFolderExecutionInput(
        unsupported,
        folder,
        discovered,
      );
      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain("STANDARD_CELL_UNSUPPORTED");
    }
    const reference = readFileSync(
      "netlists/sg13g2-qualification/reference.spice",
      "utf8",
    );
    mkdirSync("output/sg13g2-service-acceptance", { recursive: true });
    const evidence = mkdtempSync("output/sg13g2-service-acceptance/run-");
    writeFileSync(`${evidence}/project.json`, JSON.stringify(project, null, 2));
    for (const analysis of [
      "op",
      "dc VIN 0 1.2 0.1",
      "ac dec 5 1k 1Gig",
      "tran 20p 10n",
      "noise v(out) VIN dec 5 1k 1Meg\nsetplot noise1\nwrite result.raw all\nset appendwrite\nsetplot noise2",
    ]) {
      entry.text = entry.text.replace(
        /\.control[\s\S]*\.endc/u,
        `.control\n${analysis}\nwrite result.raw all\nquit\n.endc`,
      );
      const prepared = await prepareFolderExecutionInput(
        project,
        folder,
        discovered,
      );
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      if (!prepared.ok) return;
      const responses = [];
      for (const original of [true, false]) {
        const input = structuredClone(prepared.input);
        if (!original)
          input.files = input.files.map((file) =>
            file.path === "circuit.spice" ? { ...file, text: reference } : file,
          );
        const response = await routeSimulationRequest(
          request({ ...input, runToken: crypto.randomUUID() }),
          env,
        );
        const result = await response!.json();
        const name = `${analysis.split(" ")[0]}-${original ? "canvas" : "reference"}`;
        writeFileSync(
          `${evidence}/${name}-input.json`,
          JSON.stringify(input, null, 2),
        );
        writeFileSync(
          `${evidence}/${name}-result.json`,
          JSON.stringify(result, null, 2),
        );
        expect(response!.status, JSON.stringify(result)).toBe(200);
        expect(result.outcome.status, result.log).toBe("completed");
        responses.push(result);
      }
      // Numeric checks below read the service's parsed results, not process exit.
      expect(responses[0]).toEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            environment: expect.objectContaining({ profileId: profile.id }),
          }),
        }),
      );
      const plots = responses.map((response) => {
        const parsed = parseNgspiceRawfile(response.rawfile);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error(JSON.stringify(parsed));
        return analysis.startsWith("noise")
          ? parsed.plots.find((p) => /spectral/iu.test(p.plotName))!
          : parsed.plots.at(-1)!;
      });
      const names = analysis.startsWith("noise")
        ? ["onoise_spectrum", "inoise_spectrum"]
        : [
            "v(out)",
            "i(vdd)",
            "i(vrs)",
            "i(vrh)",
            "i(vc)",
            ...[
              "v(hvout)",
              "v(gateout)",
              "i(vhv)",
              "i(vcl)",
              "i(vcv)",
              "i(vpc)",
            ],
          ];
      const transient = analysis.startsWith("tran");
      for (const name of names) {
        const [actual, expected] = plots.map((plot) =>
          plot.vectors.find((v) => v.variable.name === name)!,
        );
        expect(actual, name).toBeDefined();
        expect(expected, name).toBeDefined();
        for (const part of ["real", "imag"] as const) {
          if (!actual![part]) {
            expect(expected![part]).toBeNull();
            continue;
          }
          const referenceData = expected![part]!;
          const times = plots[1]!.vectors[0]!.real;
          let segment = 0;
          for (const [i, value] of actual![part]!.entries()) {
            let wanted = referenceData[i]!;
            if (transient) {
              const t = plots[0]!.vectors[0]!.real[i]!;
              while (segment + 1 < times.length - 1 && times[segment + 1]! < t)
                segment++;
              const a = times[segment]!,
                b = times[segment + 1]!;
              const weight = (t - a) / (b - a);
              wanted =
                referenceData[segment]! * (1 - weight) +
                referenceData[segment + 1]! * weight;
            } else expect(actual![part]!.length).toBe(referenceData.length);
            expect(Number.isFinite(value) && Number.isFinite(wanted)).toBe(
              true,
            );
            const tolerance = transient
              ? 1e-5 + 1e-3 * Math.abs(wanted)
              : 1e-12 + 1e-7 * Math.abs(wanted);
            expect(
              Math.abs(value - wanted),
              `${analysis}: ${name}[${i}]`,
            ).toBeLessThanOrEqual(tolerance);
          }
        }
      }
    }
  },
  120000,
);

it.skipIf(!endpoint)(
  "passes the production smoke over real HTTP with the qualified executor",
  async () => {
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const result = await routeSimulationRequest(
            new Request("http://local.test/api/simulate", {
              method: "POST",
              body: Buffer.concat(chunks).toString("utf8"),
            }),
            { SG13G2_UPSTREAM_URL: endpoint! },
          );
          res.writeHead(result!.status, {
            "content-type": "application/json",
          });
          res.end(await result!.text());
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(error) }));
        }
      })();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const port = (server.address() as { port: number }).port;
      const result = await promisify(execFile)(
        process.execPath,
        ["scripts/production-sg13g2-smoke.mjs", `http://127.0.0.1:${port}`],
        { timeout: 30000 },
      );
      expect(JSON.parse(result.stdout)).toMatchObject({
        profileId: profile.id,
        output: expect.any(Number),
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  40000,
);
