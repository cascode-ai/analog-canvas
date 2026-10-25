import { afterAll, describe, expect, it } from "vitest";
import { startCore, type WriteRequest } from "@rich-netlist/runtime";
import { canvasPackageLock, canvasPackageVersion } from "./rnl-canvas-package";
import { withCanvasPackage } from "./rnl-core";
import { canvasPackageTexts } from "./rnl-core.test-support";

const bare = startCore();
const packages = await canvasPackageTexts;
const packageText = packages.find(
  (item) => item.version === canvasPackageVersion,
)!.text;
const core = withCanvasPackage(bare, packages);
afterAll(() => core.terminate());

const write: WriteRequest["write"] = {
  dialect: "spice",
  netlist: '\nE1 out 0 in 0 2\n.include "/user/parts.inc"\n.end\n',
  author: "test",
  ops: [
    {
      op: "use-package",
      name: "analog-canvas-extensions",
      version: canvasPackageVersion,
    },
    {
      op: "set",
      level: "file",
      object: "#E1",
      symbol: "$CANVAS_VCVS_CIRCLE",
      at: [0, 0],
    },
  ],
};

const files = { "/user/parts.inc": "R1 out 0 1k\n" };
const errors = (diagnostics: { severity: string }[]) =>
  diagnostics.filter((item) => item.severity === "error");

describe("explicit Canvas package workspace", () => {
  it("writes, snapshots and rebuilds a Canvas symbol with the user's includes", async () => {
    const original = {
      write: { ...write, file: "top.sp" },
      files,
      svg: false,
      primitives: true,
    };
    const before = structuredClone(original);
    const written = await core.write(original);
    expect(errors(written.document.diagnostics)).toEqual([]);
    expect(original).toEqual(before);
    const request = {
      entry: "top.sp",
      files: {
        ...files,
        "top.sp": written.text.replace('"/user/parts.inc"', '"pool.inc"'),
        "/user/pool.inc": "R2 out 0 2k\n",
      },
      pool: ["/user/pool.inc"],
      package_dirs: ["/user/packages"],
      primitives: true,
    };
    const unchanged = structuredClone(request);
    const first = await core.build(request);
    const snapshot = await core.snapshot({
      ...request,
      parts: { host: true, model: true },
    });
    const rebuilt = await core.build(request);
    expect(errors(first.diagnostics)).toEqual([]);
    expect(errors(snapshot.diagnostics)).toEqual([]);
    expect(rebuilt).toEqual(first);
    expect(request).toEqual(unchanged);
    expect(first.levels[0]!.primitives!.length).toBeGreaterThan(0);
  });

  it("adds the extension to the catalog using package directories", async () => {
    const catalog = await core.catalog({
      catalog: {},
      files: { "/user/note.txt": "keep" },
      package_dirs: ["/user"],
    });
    expect(
      catalog.symbols.some(
        (symbol) =>
          symbol.package === "analog-canvas-extensions" &&
          symbol.symbol === "$CANVAS_VCVS_CIRCLE",
      ),
    ).toBe(true);
    expect(
      catalog.symbols.some((symbol) => symbol.symbol === "$RESISTOR"),
    ).toBe(true);
  });

  it.each([
    "/.analog-canvas/rnl/0.2/analog-canvas-extensions.rnl",
    "\\.analog-canvas\\rnl\\0.2\\analog-canvas-extensions.rnl",
    "/.analog-canvas/other/../rnl/0.2/analog-canvas-extensions.rnl",
  ])(
    "does not replace a user file at its private virtual path (%s)",
    async (path) => {
      const text =
        '@RNL(type="header") { @VERSION("0.3"); @PACKAGE(name="user-kept", version="1") }';
      const catalog = await core.catalog({
        catalog: {},
        files: { [path]: text },
        package_dirs: ["/.analog-canvas/rnl/0.2"],
      });
      expect(catalog.packages.some((pkg) => pkg.name === "user-kept")).toBe(
        true,
      );
      expect(
        catalog.symbols.some(
          (symbol) => symbol.symbol === "$CANVAS_VCVS_CIRCLE",
        ),
      ).toBe(true);
    },
  );

  it.each(canvasPackageLock.versions.map(({ version }) => version))(
    "reads a file written with Canvas %s",
    async (version) => {
      const written = await core.write({
        write: {
          ...write,
          netlist: "\nE1 out 0 in 0 2\n.end\n",
          ops: write.ops.map((op) =>
            op.op === "use-package" ? { ...op, version } : op,
          ),
        },
        svg: false,
      });
      expect(written.text).toContain(
        `@USE-PACKAGE(name="analog-canvas-extensions", version="${version}")`,
      );
      expect(errors(written.document.diagnostics)).toEqual([]);
      const built = await core.build({
        entry: "/top.sp",
        files: { "/top.sp": written.text },
        svg: false,
      });
      expect(errors(built.diagnostics)).toEqual([]);
    },
  );

  it("indexes the library with the Canvas package in its pool", async () => {
    expect(
      await core.library({ library: { reload: true }, pool: [], files }),
    ).toEqual([]);
  });

  it("lists the formats and detects a file's", async () => {
    const { list, detected } = await core.formats({
      formats: { detect: { "/a.scs": "r1 (a 0) resistor r=1k\n" } },
    });
    expect(list.map((format) => format.name)).toEqual(
      expect.arrayContaining(["spice", "spectre"]),
    );
    expect(detected["/a.scs"]).toBe("spectre");
  });

  it("requires the optional package on a standard-only core", async () => {
    const request = {
      write: { ...write, netlist: "\nE1 out 0 in 0 2\n.end\n" },
      svg: false,
    };
    const missing = await bare.write(request);
    expect(
      errors(missing.document.diagnostics).some(
        (item) =>
          "message" in item &&
          String(item.message).includes("analog-canvas-extensions"),
      ),
    ).toBe(true);
    const provided = await core.write(request);
    expect(errors(provided.document.diagnostics)).toEqual([]);
    const entry = "/top.sp";
    const withoutPool = await bare.build({
      entry,
      files: { [entry]: provided.text, "/optional/canvas.rnl": packageText },
      svg: false,
    });
    expect(errors(withoutPool.diagnostics).length).toBeGreaterThan(0);
    const explicit = await bare.build({
      entry,
      files: { [entry]: provided.text, "/optional/canvas.rnl": packageText },
      pool: ["/optional/canvas.rnl"],
      svg: false,
    });
    expect(errors(explicit.diagnostics)).toEqual([]);
  });
});
