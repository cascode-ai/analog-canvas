import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  compile,
  validateRegistry,
  root,
  writeOutputs,
} from "./generate-agent-docs.mjs";
const registry = JSON.parse(
  await readFile(
    new URL("../docs/agent/distribution.json", import.meta.url),
    "utf8",
  ),
);
test("check mode reports stale/missing outputs without modifying files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-docs-check-"));
  try {
    await writeFile(join(directory, "existing.txt"), "old");
    await assert.rejects(
      writeOutputs(
        new Map([
          ["existing.txt", "new"],
          ["nested/missing.txt", "new"],
        ]),
        directory,
        true,
      ),
      /Stale Agent documentation/,
    );
    assert.equal(
      await readFile(join(directory, "existing.txt"), "utf8"),
      "old",
    );
    assert.deepEqual(await readdir(directory), ["existing.txt"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("registry rejects duplicate identities, unsafe paths and unknown consumers", () => {
  for (const change of [
    (r) => r.documents.push(r.documents[0]),
    (r) => (r.documents[0].source = "../secret"),
    (r) => (r.documents[0].source = "C:/secret"),
    (r) => (r.documents[0].consumers = ["imaginary"]),
    (r) => (r.documents[1].uri = r.documents[0].uri),
    (r) => (r.documents[1].kitPath = r.documents[0].kitPath),
  ]) {
    const copy = structuredClone(registry);
    change(copy);
    assert.throws(() => validateRegistry(copy));
  }
});
test("required dependencies exist, are delivered to consumers, and are acyclic", () => {
  for (const change of [
    (r) => (r.documents[0].requires = ["absent"]),
    (r) => (r.documents[0].requires = [r.documents[0].id]),
    (r) => {
      r.documents[0].requires = [r.documents[1].id];
      r.documents[1].consumers = ["maintainer"];
    },
  ]) {
    const copy = structuredClone(registry);
    change(copy);
    assert.throws(() => validateRegistry(copy));
  }
});
test("missing sources fail before emitting any files", async () => {
  const copy = structuredClone(registry);
  copy.documents[0].source = "docs/agent/missing.md";
  await assert.rejects(compile(copy), /ENOENT/);
});
test("runtime links cannot escape to an undistributed repository document", async () => {
  for (const surface of ["mcp", "kit"]) {
    const copy = structuredClone(registry);
    const target = copy.documents.find((d) => d.id === "reference/recovery");
    if (surface === "mcp") {
      delete target.uri;
      target.consumers = target.consumers.filter(
        (c) => !["mcp", "http-cli"].includes(c),
      );
    } else {
      delete target.kitPath;
      target.consumers = target.consumers.filter((c) => c !== "http-kit");
    }
    await assert.rejects(
      compile(copy),
      new RegExp(`Undistributed ${surface} link`),
    );
  }
});
test("connection template and report make runtime interpolation and ownership explicit", async () => {
  const output = await compile(registry);
  const connection = output.get(
    "apps/editor/src/agent/connection-guidance.generated.ts",
  );
  assert.ok(connection.includes("JSON.stringify({ claimCode })"));
  assert.ok(connection.includes("values[key]!"));
  const report = JSON.parse(
    output.get("docs/agent/distribution.generated.json"),
  );
  for (const item of report.outputs) {
    assert.ok(item.sources.includes("docs/agent/distribution.json"));
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
  }
});
test("generation is deterministic and checked-in projections match", async () => {
  const first = await compile(registry);
  const second = await compile(registry);
  assert.deepEqual(first, second);
  for (const [file, content] of first)
    assert.equal(
      (await readFile(`${root}/${file}`, "utf8")).replaceAll("\r\n", "\n"),
      content,
      file,
    );
});
test("every declared Kit destination and resource is emitted; no phantom fallback", async () => {
  const output = await compile(registry);
  const report = JSON.parse(
    output.get("docs/agent/distribution.generated.json"),
  );
  assert.deepEqual(
    report.documents.map((d) => d.id),
    registry.documents.map((d) => d.id),
  );
  assert.ok(!JSON.stringify(report).includes("codex-fallback"));
  for (const d of registry.documents) {
    if (d.uri)
      assert.ok(
        output
          .get("apps/mcp-server/src/resources.generated.ts")
          .includes(d.uri),
      );
    if (d.kitPath && d.consumers.includes("http-kit"))
      assert.ok(
        output
          .get("packages/agent-adapter/src/agent-docs.generated.ts")
          .includes(d.kitPath),
      );
  }
});

test("layout lookup is self-contained and legacy addresses share its canonical source", async () => {
  const ids = [
    "reference/razavi-style",
    "reference/routing",
    "reference/knowledge/patterns",
  ];
  const entries = ids.map((id) => registry.documents.find((d) => d.id === id));
  const canonical = entries[0];
  assert.equal(
    registry.documents.find((d) => d.source === canonical.source).id,
    canonical.id,
    "ordinary links must resolve to the canonical layout resource, not an alias",
  );
  const { mcpResources } =
    await import("../apps/mcp-server/src/resources.generated.ts");
  const { agentKitFiles } =
    await import("../packages/agent-adapter/src/agent-docs.generated.ts");
  const texts = entries.map(
    (entry) => mcpResources.find((r) => r.uri === entry.uri).text,
  );
  // Kit aliases live at different depths; compare the resolved link targets.
  const kitTexts = entries.map((entry) =>
    agentKitFiles
      .find((f) => f.path === entry.kitPath)
      .content.replace(
        /\]\(([^)]+)\)/g,
        (_, href) =>
          `](${posix.normalize(posix.join(posix.dirname(entry.kitPath), href))})`,
      ),
  );
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.source, canonical.source);
    assert.equal(entry.load, "on-demand");
    assert.deepEqual(entry.requires, []);
    assert.equal(texts[index], texts[0]);
    assert.equal(kitTexts[index], kitTexts[0]);
  }
  for (const heading of ["Structure", "Layout", "Wiring", "Example:"])
    assert.ok(texts[0].includes(`## ${heading}`));
  assert.ok(!texts[0].includes("analog-canvas://reference/routing"));
  assert.ok(!texts[0].includes("analog-canvas://reference/knowledge/patterns"));
  assert.ok(
    mcpResources
      .find((r) => r.uri === "analog-canvas://reference/workflow")
      .text.includes("(analog-canvas://reference/razavi-style)"),
  );
});
