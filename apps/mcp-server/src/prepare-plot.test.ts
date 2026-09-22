import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { LocalWorkspace } from "./local-workspace.js";
import { PreparePlotSchema, preparePlot, plotPanels } from "./prepare-plot.js";
import { plotTemplate } from "./plot-template.js";
import type { ResultCatalog } from "@icm/simulation-service/contract";

it("prepares a local copy, selects one table, reuses data and preserves customization", async () => {
  const root = await mkdtemp(join(tmpdir(), "plot-test-"));
  try {
    const workspace = await LocalWorkspace.open(
      { serverUrl: "https://test.example", projectId: "p", sessionId: "s" },
      root,
    );
    const csv = "time [s],v(out) [V]\n0,1\n1,2\n";
    const file = {
      id: "csv",
      fileId: "csv",
      name: "tran.csv",
      role: "table" as const,
      mediaType: "text/csv",
      byteLength: Buffer.byteLength(csv),
      sha256: createHash("sha256").update(csv).digest("hex"),
    };
    const catalog: ResultCatalog = {
      schemaVersion: 1,
      runId: "run",
      preparedId: "prep",
      inputRevision: "1",
      execution: "completed",
      collection: "complete",
      files: [file],
      datasets: [
        {
          id: "d",
          analysisIndex: 0,
          analysis: "tran",
          plotName: "Transient",
          pointCount: 2,
          axis: { name: "time", unit: "s" },
          signals: [{ name: "v(out)", unit: "V", quantity: "voltage" }],
          representations: [{ artifactId: "csv", fileId: "csv", selector: "" }],
        },
      ],
    };
    const request = PreparePlotSchema.parse({
      action: "prepare-plot",
      runId: "run",
      name: "transient",
      panels: [
        { analysisIndex: 0, signals: [{ signal: "v(out)", unit: "mV" }] },
      ],
    });
    const fetch = vi.fn(async () => new Response(csv));
    const result = await preparePlot(workspace, catalog, request, fetch);
    expect(result).toMatchObject({
      ok: true,
      status: "prepared",
      dataStatus: "complete",
      scriptStatus: "prepared",
      imageStatus: "not-generated",
      execution: { check: { executable: "python", args: expect.any(Array) } },
    });
    const path = join(root, "plots", "transient", "plot.py");
    expect(await readFile(path, "utf8")).toBe(plotTemplate);
    const config = JSON.parse(
      await readFile(join(root, "plots", "transient", "plot.json"), "utf8"),
    );
    expect(config.panels[0].curves[0].y.unit).toBe("mV");
    expect(await readFile(config.panels[0].curves[0].csv, "utf8")).toBe(csv);
    await writeFile(path, "# custom");
    expect(await preparePlot(workspace, catalog, request, fetch)).toMatchObject(
      { ok: false, error: { code: "PLOT_ALREADY_EXISTS" } },
    );
    expect(await readFile(path, "utf8")).toBe("# custom");
    await preparePlot(
      workspace,
      catalog,
      { ...request, name: "second" },
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(
      preparePlot(
        workspace,
        catalog,
        {
          ...request,
          panels: [{ analysisIndex: 7, signals: [{ signal: "v(out)" }] }],
        },
        fetch,
      ),
    ).rejects.toThrow("PLOT_REQUIRES_SAMPLED_ANALYSIS");
    expect(
      PreparePlotSchema.safeParse({ ...request, name: "../escape" }).success,
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("expands four presets, groups units and shares AC cursors without inferring gain", () => {
  for (const kind of ["dc", "ac", "tran", "noise"] as const) {
    const catalog: ResultCatalog = {
      schemaVersion: 1,
      runId: "r",
      preparedId: "p",
      inputRevision: "1",
      execution: "completed",
      collection: "complete",
      files: [],
      datasets: [
        {
          id: "d",
          analysisIndex: 0,
          analysis: kind,
          plotName: kind,
          pointCount: 3,
          axis: { name: "x", unit: kind === "tran" ? "s" : "Hz" },
          signals: [
            { name: "voltage", quantity: "voltage", unit: "V" },
            { name: "current", quantity: "current", unit: "A" },
          ],
          representations: [],
        },
      ],
    };
    const request = PreparePlotSchema.parse({
      action: "prepare-plot",
      runId: "r",
      name: kind,
      preset: {
        kind,
        analysisIndex: 0,
        signals: [{ signal: "voltage" }, { signal: "current" }],
        cursors: { A: 10, B: 100 },
      },
    });
    const panels = plotPanels(catalog, request);
    expect(panels).toHaveLength(kind === "ac" ? 3 : 2);
    expect(panels[0]?.signals).toHaveLength(1);
    expect(panels.every((p) => p.cursors?.A === 10)).toBe(true);
    expect(panels[0]?.xScale).toBe(
      ["ac", "noise"].includes(kind) ? "log" : "linear",
    );
    expect(panels[0]?.yScale).toBe(kind === "noise" ? "log" : "linear");
    if (kind === "ac") {
      expect(panels[0]?.signals[0]?.component).toBe("magnitude");
      expect(panels[0]?.signals[0]?.decibels).toBeUndefined();
      expect(panels[2]?.signals.map((s) => [s.component, s.unit])).toEqual([
        ["phase", "deg"],
        ["phase", "deg"],
      ]);
    }
    expect(PreparePlotSchema.safeParse({ ...request, panels }).success).toBe(
      false,
    );
    expect(() =>
      plotPanels(catalog, {
        ...request,
        preset: { ...request.preset!, analysisIndex: 99 },
      }),
    ).toThrow("PLOT_PRESET_ANALYSIS_MISMATCH");
  }
});

it("runs unit, complex, dB and cursor contracts without requiring matplotlib", async () => {
  const root = await mkdtemp(join(tmpdir(), "plot-python-"));
  try {
    const script = join(root, "plot.py");
    await writeFile(script, plotTemplate);
    const csv = join(root, "noise.csv");
    await writeFile(
      csv,
      "frequency [Hz],output noise density [V/sqrt(Hz)]\n10,1e-9\n\nintegrated quantity,value,unit\noutput noise,2e-8,V\n",
    );
    const code = `import runpy, sys, math
m = runpy.run_path(sys.argv[1])
assert m['load_csv'](sys.argv[2]) == {'frequency [Hz]':[10.0], 'output noise density [V/sqrt(Hz)]':[1e-9]}
values, unit = m['vector'](m['load_csv'](sys.argv[2]), {'signal':'outputNoiseDensity','unit':'nV/sqrt(Hz)'})
assert abs(values[0]-1)<1e-12 and unit=='nV/sqrt(Hz)'
assert m['factor']('V', 'mV') == 1000
assert m['factor']('s', 'us') == 1000000
assert abs(m['factor']('V/sqrt(Hz)', 'nV/sqrt(Hz)') - 1e9) < 1e-6
try:
    m['factor']('V', 'A')
    raise AssertionError('accepted incompatible units')
except ValueError: pass
d = {'re(v(out)) [V]': [3.0], 'im(v(out)) [V]': [4.0]}
assert m['vector'](d, {'signal': 'v(out)', 'component': 'magnitude'}) == ([5.0], 'V')
v,u = m['vector'](d, {'signal': 'v(out)', 'component': 'phase', 'unit': 'deg'})
assert abs(v[0]-53.13010235415598)<1e-9 and u=='deg'
try:
    m['vector'](d, {'signal':'v(out)'})
    raise AssertionError('accepted implicit complex')
except ValueError: pass
values,u = m['vector'](d, {'signal':'v(out)','component':'magnitude','decibels':{'factor':20,'reference':1000,'referenceUnit':'mV'}})
assert abs(values[0]-20*math.log10(5))<1e-12 and u=='dB'
try:
    m['vector'](d, {'signal':'v(out)','component':'magnitude','decibels':{'factor':20,'reference':1,'referenceUnit':'A'}})
    raise AssertionError('bad reference accepted')
except (ValueError, KeyError): pass
assert m['cursor_sample']([1,10,100],[2,4,8],40)['x']==10
assert m['cursor_sample']([1,10,100],[2,4,8],40,True)['x']==100
r = m['cursor_readings']([0,1,2],[0,3,6],{'A':1100,'B':1900,'unit':'ms'},'s','V')
assert r['points']['A']['x']==1 and r['delta']=={'x':1,'y':3}
try:
    m['cursor_sample']([0,1],[1,2],2)
    raise AssertionError('clamped outside domain')
except ValueError: pass
`;
    execFileSync(process.platform === "win32" ? "python" : "python3", [
      "-c",
      code,
      script,
      csv,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
