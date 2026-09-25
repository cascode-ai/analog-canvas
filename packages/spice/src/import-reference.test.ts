import { describe, expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
} from "../../project-protocol/src/index.js";
import { importSpiceSources } from "./importer.js";
import { convertNetlist } from "./conversion.js";

const input = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});
const text =
  "* private source comment\n.subckt child A B\nR1 A B 1k\n.ends child\n.end\n";

describe("immutable import reference storage", () => {
  it("archives source content and terminal membership through the portable format", async () => {
    const result = await importSpiceSources(
      [input("input.spi", text)],
      "input.spi",
    );
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const project = result.project!;
    const doc = project.documents.find((d) => d.name === "child")!;
    expect(doc.importReference?.nets).toHaveLength(2);
    expect(doc.importReference?.nets[0]?.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: "R1", sourcePosition: 0 }),
        expect.objectContaining({ pinName: "P" }),
      ]),
    );
    expect(project.source.files[0]?.content).toEqual({
      text,
      encoding: "utf-8",
    });
    const loaded = parseProject(serializeProject(project));
    expect(
      loaded.documents.find((d) => d.id === doc.id)?.importReference,
    ).toEqual(doc.importReference);
    expect(loaded.source).toEqual(project.source);
  });

  it("does not manufacture a reference when loading older authoring data", async () => {
    const project = (
      await importSpiceSources([input("input.spi", text)], "input.spi")
    ).project!;
    for (const document of project.documents) delete document.importReference;
    for (const file of project.source.files) delete file.content;
    const encoded = JSON.parse(serializeProject(project));
    encoded.schemaVersion = 62;
    const loaded = parseProject(JSON.stringify(encoded));
    expect(loaded.documents.every((d) => d.importReference === undefined)).toBe(
      true,
    );
    expect(loaded.source.files[0]?.content).toBeUndefined();
  });

  it("archives local includes alongside the entry", async () => {
    const entry = "* entry\n.include child.spi\nX1 A B child\n.end\n";
    const child = text.replace(".end\n", "");
    const result = await importSpiceSources(
      [input("input.spi", entry), input("child.spi", child)],
      "input.spi",
    );
    expect(result.successful).toBe(true);
    expect(result.project?.source.files.map((f) => f.content?.text)).toEqual(
      expect.arrayContaining([entry, child]),
    );
  });

  it("keeps original Spectre text separate from converted parser input", async () => {
    const original = "subckt child (A B)\nR1 (A B) resistor r=1k\nends child\n";
    const converted = convertNetlist({
      text: original,
      source: "spectre",
      target: "spice",
      fragment: true,
    });
    if (converted.status === "blocked")
      throw new Error(JSON.stringify(converted.issues));
    const result = await importSpiceSources(
      [input("input.scs", converted.text)],
      "input.scs",
      {},
      { originalSources: [input("input.scs", original)] },
    );
    expect(result.successful).toBe(true);
    expect(result.project?.source.files[0]?.originalContent?.text).toBe(
      original,
    );
    expect(result.project?.source.files[0]?.content?.text).toBe(converted.text);
  });
});
