import { readFileSync } from "node:fs";
import { resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { agentOperatingKit } from "@icm/agent-adapter/kit";
import { describe, expect, it } from "vitest";
import { AgentSchematicEditSchema } from "@icm/agent-adapter";
import { z } from "zod";
import { mcpResources } from "./resources.generated.js";
import { agentToolHelp } from "./guidance.generated.js";
import { callTool, listToolDefinitions } from "./tools.js";
import {
  ADVANCED_EDITS_RESOURCE_URI,
  listResourceEntries,
  readResourceContent,
} from "./resources.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

/** Expand local refs to compare constraints, not generated definition names. */
function expandSchema(
  root: Record<string, unknown>,
  value: unknown = root,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => expandSchema(root, item));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (typeof object.$ref === "string") {
    expect(object.$ref.startsWith("#/$defs/")).toBe(true);
    const target = (root.$defs as Record<string, unknown>)[
      object.$ref.slice(8)
    ];
    expect(target).toBeDefined();
    const { $ref: _, ...siblings } = object;
    return Object.keys(siblings).length
      ? { allOf: [expandSchema(root, target), expandSchema(root, siblings)] }
      : expandSchema(root, target);
  }
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => key !== "$defs")
      .map(([key, child]) => [key, expandSchema(root, child)]),
  );
}

interface ManifestResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  source: string;
  kind?: string;
  consumers: string[];
}

/**
 * Contract test (Agent rationale): MCP Resources must project from the exact sources
 * the registry declares, independently of the HTTP Kit projection.
 */
describe("mcp resources single-source projection", () => {
  it("ships a compact complete offline schema without changing the HTTP Kit source", () => {
    const source = readFileSync(
      resolve(repoRoot, "fixtures/agent-api/agent-circuit-request.schema.json"),
      "utf8",
    );
    const resource = readResourceContent(ADVANCED_EDITS_RESOURCE_URI);
    expect(Buffer.byteLength(resource.text)).toBeLessThan(
      Buffer.byteLength(source) / 3,
    );
    expect(expandSchema(JSON.parse(resource.text))).toEqual(
      expandSchema(JSON.parse(source)),
    );
    expect(
      agentOperatingKit.files
        .find(
          (file) =>
            file.path === "references/agent-circuit-request.schema.json",
        )!
        .content.trim(),
    ).toBe(source.replaceAll("\r\n", "\n").trim());
  });
  it("bounds discovery size while retaining complete contracts and runtime validation", async () => {
    const tools = listToolDefinitions();
    expect(Buffer.byteLength(JSON.stringify(tools))).toBeLessThan(100_000);
    for (const tool of tools) {
      const complete = JSON.parse(
        readResourceContent(`analog-canvas://contract/tools/${tool.name}`).text,
      );
      expect(complete.type).toBe("object");
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if ("$ref" in value) {
          const ref = String(value.$ref);
          expect(ref.startsWith("#/$defs/")).toBe(true);
          expect(
            (tool.inputSchema.$defs as Record<string, unknown>)[ref.slice(8)],
          ).toBeDefined();
        }
        for (const child of Object.values(value)) visit(child);
      };
      visit(tool.inputSchema);
    }
    const complete = readResourceContent(
      "analog-canvas://contract/tools/simulation_output",
    );
    expect(complete.text).toContain('"expression"');
    expect(complete.text).toContain('"operand"');
    // The advertised compact entry does not loosen dispatch validation.
    const response = await callTool(
      "simulation_output",
      {
        action: "upsert",
        folderId: "test",
        label: "bad",
        expression: { kind: "invented" },
      },
      {} as never,
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain(
      "SIMULATION_HELPER_INPUT_INVALID",
    );
  });
  it("returns a complete compact annotation contract with identical expanded semantics", () => {
    const kind = "upsert_schematic_annotation";
    const original = z.toJSONSchema(
      AgentSchematicEditSchema.options.find(
        (o) => o.shape.kind.value === kind,
      )!,
      { target: "draft-2020-12", reused: "ref" },
    );
    const text = readResourceContent(
      `analog-canvas://contract/edits/${kind}`,
    ).text;
    const compact = JSON.parse(text);
    expect(expandSchema(compact)).toEqual(expandSchema(original));
    expect(text.length).toBeLessThan(24000);
  });
  it("distributes exactly the help for the callable tool inventory", () => {
    const tools = listToolDefinitions();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      Object.keys(agentToolHelp).sort(),
    );
    for (const tool of tools)
      expect(tool.description).toBe(
        agentToolHelp[tool.name as keyof typeof agentToolHelp],
      );
    for (const text of Object.values(agentToolHelp)) {
      for (const [uri] of text.matchAll(/analog-canvas:\/\/[^\s;]+/g)) {
        const concrete = uri
          .replace("{kind}", "set_instance_reference")
          .replace(/[.,]$/, "");
        expect(() => readResourceContent(concrete)).not.toThrow();
      }
    }
  });
  it("discloses the required Cell edit envelope without reading the full contract", () => {
    const schema = JSON.parse(
      readResourceContent(
        "analog-canvas://contract/edits/set_cell_symbol_presentation",
      ).text,
    );
    expect(schema["x-transaction"]).toMatchObject({
      form: "structureEdits",
      example: { structureEdits: [{ kind: "transact_document" }] },
    });
    expect(schema.properties.kind.const).toBe("set_cell_symbol_presentation");
  });
  it("resolves distributed links inside the actual resource and Kit namespaces", () => {
    for (const resource of mcpResources) {
      for (const [, uri] of resource.text.matchAll(
        /\]\((analog-canvas:\/\/[^)]+)\)/g,
      )) {
        expect(() => readResourceContent(uri!)).not.toThrow();
      }
    }
    const paths = new Set(agentOperatingKit.files.map((file) => file.path));
    for (const file of agentOperatingKit.files) {
      for (const [, href] of file.content.matchAll(/\]\(([^\s)]+)\)/g)) {
        if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href!)) continue;
        expect(
          paths.has(
            posix.normalize(
              posix.join(posix.dirname(file.path), href!.split("#")[0]!),
            ),
          ),
          `${file.path}: ${href}`,
        ).toBe(true);
      }
    }
  });
  it("shares the native authoring and result handoff policy with HTTP Kit", () => {
    const source = agentOperatingKit.files.find(
      (file) => file.path === "references/authoring-contract.md",
    )!;
    const resource = readResourceContent("analog-canvas://reference/authoring");
    const withoutLinkTargets = (text: string) =>
      text.replace(/\]\([^)]+\)/g, "]");
    expect(withoutLinkTargets(resource.text)).toBe(
      withoutLinkTargets(source.content),
    );
    for (const contract of [
      "place-components",
      "set-instance-display",
      "set-net-label",
      "Cell terminal",
    ])
      expect(resource.text).toContain(contract);
    expect(resource.text).not.toContain("Retry-After");
    expect(
      readResourceContent("analog-canvas://reference/simulation-workflow").text,
    ).toContain("project-folder");
    expect(
      readResourceContent("analog-canvas://reference/simulation-workflow").text,
    ).toContain("legacy-only");
    expect(
      readResourceContent("analog-canvas://reference/simulation-result-handoff")
        .text,
    ).toContain("evidence bundle");
    expect(
      readResourceContent("analog-canvas://reference/quickstart").text,
    ).toContain("analog-canvas://reference/authoring");
  });
  it("serves compact per-edit schemas from the canonical contract", () => {
    const resource = readResourceContent(
      "analog-canvas://contract/edits/set_instance_reference",
    );
    const schema = JSON.parse(resource.text);
    expect(schema.properties.kind.const).toBe("set_instance_reference");
    expect(schema.required).toContain("reference");
    expect(resource.text.length).toBeLessThan(3000);
    expect(() =>
      readResourceContent("analog-canvas://contract/edits/not_an_edit"),
    ).toThrow("Unknown edit kind");
  });
  const manifest = JSON.parse(
    readFileSync(resolve(repoRoot, "docs/agent/distribution.json"), "utf8"),
  ) as { documents: ManifestResource[] };

  it("matches every manifest entry with identical content from its source", () => {
    const exposed = manifest.documents.filter((entry) => entry.uri);
    expect(mcpResources).toHaveLength(exposed.length);
    const kitFiles = new Map(
      agentOperatingKit.files.map((file) => [file.path, file.content]),
    );
    for (const entry of exposed) {
      const projected = mcpResources.find((r) => r.uri === entry.uri);
      expect(projected, `missing resource ${entry.uri}`).toBeDefined();
      const expectedText =
        entry.kind === "catalog"
          ? kitFiles.get("references/razavi-authoring-catalog.json")
          : readFileSync(resolve(repoRoot, entry.source), "utf8");
      expect(expectedText, `missing source ${entry.source}`).toBeDefined();
      expect(projected).toMatchObject({
        uri: entry.uri,
        name: entry.name,
        description: entry.description,
        mimeType: entry.mimeType,
      });
      // Markdown links are deliberately rewritten for the resource namespace.
      // Full output/source integrity is checked by the generator contract suite.
      if (entry.mimeType !== "application/schema+json")
        expect(projected!.text.split("\n")[0]).toBe(
          expectedText!.split("\n")[0],
        );
    }
  });

  it("exposes the stable reference set and the optional advanced-edits contract", () => {
    const uris = mcpResources.map((resource) => resource.uri);
    for (const uri of [
      "analog-canvas://reference/quickstart",
      "analog-canvas://reference/authoring",
      "analog-canvas://reference/routing",
      "analog-canvas://reference/razavi-style",
      "analog-canvas://reference/diagnostics",
      "analog-canvas://reference/recovery",
      "analog-canvas://catalog/builtins",
      ADVANCED_EDITS_RESOURCE_URI,
    ]) {
      expect(uris).toContain(uri);
    }
  });

  it("serves declared resources and rejects unknown URIs", () => {
    const quickstart = readResourceContent(
      "analog-canvas://reference/quickstart",
    );
    expect(quickstart.text).toContain("# Analog Canvas MCP quickstart");
    expect(() => readResourceContent("analog-canvas://reference/nope")).toThrow(
      /Unknown resource/,
    );
    expect(listResourceEntries()).toHaveLength(mcpResources.length);
  });
});
