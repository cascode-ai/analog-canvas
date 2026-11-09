import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AGENT_FILE_RESOURCE_MAX_BYTES } from "@icm/agent-adapter";
import { prepareLocalSource } from "./local-source.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "canvas-local-source-"));
  await mkdir(join(root, "cells"));
  await mkdir(join(root, "draw"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("collects Spectre and RNL dependencies in their original relative layout and versions their bytes", async () => {
  const entry = [
    "simulator lang=spectre",
    '// @RNL(type="header") { @VERSION("0.3");',
    '// @USE-PACKAGE(name="base", version="0.1", path="../draw/base.rnl"); }',
    '// Example only: @USE-PACKAGE(name="unused", path="not-an-input.rnl")',
    'include "../models.scs" section=typ',
    "subckt cell A B",
    "R0 (A B) resistor r=1k",
    "ends cell",
  ].join("\n");
  await writeFile(join(root, "cells", "entry.scs"), entry);
  await writeFile(
    join(root, "draw", "base.rnl"),
    '@RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="common", path="common.rnl"); }',
  );
  await writeFile(join(root, "draw", "common.rnl"), '@VERSION("0.3")');
  await writeFile(join(root, "models.scs"), "simulator lang=spectre\n");

  const first = await prepareLocalSource(root, "cells/entry.scs");
  expect(first.files.map((file) => file.name).sort()).toEqual([
    "cells/entry.scs",
    "draw/base.rnl",
    "draw/common.rnl",
    "models.scs",
  ]);
  expect(await prepareLocalSource(root, "cells/entry.scs")).toEqual(first);
  await writeFile(join(root, "draw", "common.rnl"), '@VERSION("0.3")\n');
  const second = await prepareLocalSource(root, "cells/entry.scs");
  expect(second.version).not.toBe(first.version);
});

it("reports a missing include at its reference and denies paths outside the selected root", async () => {
  const entry = join(root, "cells", "entry.sp");
  await writeFile(entry, 'Example\n.include "../missing.sp"\n');
  await expect(prepareLocalSource(root, entry)).rejects.toMatchObject({
    code: "FILE_DEPENDENCY_MISSING",
    message: expect.stringContaining("cells/entry.sp:2"),
  });
  await writeFile(entry, 'Example\n.include "../../outside.sp"\n');
  await expect(prepareLocalSource(root, entry)).rejects.toMatchObject({
    code: "FILE_OUTSIDE_ROOT",
  });
});

it("leaves an absolute library external and unread, but never an RNL package", async () => {
  // A foundry library the netlist names by an absolute path, whatever it is
  // on this machine, is the simulator's: neither read nor sent.
  const outside = await mkdtemp(join(tmpdir(), "canvas-pdk-"));
  try {
    const pdk = join(outside, "toplevel.scs");
    await writeFile(pdk, "simulator lang=spectre\n");
    const entry = join(root, "cells", "entry.scs");
    await writeFile(
      entry,
      [
        "simulator lang=spectre",
        `include "${pdk.replaceAll("\\", "/")}" section=tt`,
        'include "/pdk/missing/models.scs"',
        'include "../models.scs"',
        "subckt cell A B",
        "R0 (A B) resistor r=1k",
        "ends cell",
      ].join("\n"),
    );
    await writeFile(join(root, "models.scs"), "simulator lang=spectre\n");
    const prepared = await prepareLocalSource(root, entry);
    expect(prepared.files.map((file) => file.name).sort()).toEqual([
      "cells/entry.scs",
      "models.scs",
    ]);

    await writeFile(
      entry,
      [
        "simulator lang=spectre",
        '// @RNL(type="header") { @VERSION("0.3");',
        `// @USE-PACKAGE(name="base", version="0.1", path="/draw/base.rnl"); }`,
      ].join("\n"),
    );
    await expect(prepareLocalSource(root, entry)).rejects.toMatchObject({
      code: "FILE_OUTSIDE_ROOT",
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it("rejects an oversized file during preparation", async () => {
  const file = join(root, "large.sp");
  await writeFile(file, "* fixture\n");
  await truncate(file, AGENT_FILE_RESOURCE_MAX_BYTES + 1);
  await expect(prepareLocalSource(root, file)).rejects.toMatchObject({
    code: "FILE_TRANSFER_LIMIT",
  });
});

it("rejects a dependency whose directory link points outside the source root", async () => {
  const outside = await mkdtemp(join(tmpdir(), "canvas-other-source-"));
  try {
    await writeFile(join(outside, "other.sp"), "* outside\n");
    await symlink(
      outside,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const entry = join(root, "entry.sp");
    await writeFile(entry, '* entry\n.include "linked/other.sp"\n');
    await expect(prepareLocalSource(root, entry)).rejects.toMatchObject({
      code: "FILE_OUTSIDE_ROOT",
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "does not treat a literal entry backslash as a directory",
  async () => {
    await writeFile(join(root, "cells", "entry.sp"), "* different bytes\n");
    const entry = join(root, "cells\\entry.sp");
    await writeFile(entry, "* selected bytes\n");
    await expect(prepareLocalSource(root, entry)).rejects.toMatchObject({
      code: "FILE_CONTENT_INVALID",
    });
  },
);
