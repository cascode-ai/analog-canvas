import { readFileSync } from "node:fs";
import { resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { agentOperatingKit } from "@icm/agent-adapter/kit";
import { describe, expect, it } from "vitest";
import { AgentSchematicEditSchema } from "@icm/agent-adapter";
import { z } from "zod";
import { mcpResources } from "./resources.generated.js";
import { agentToolHelp } from "./guidance.generated.js";
import { listToolDefinitions } from "./tools.js";
import {
  ADVANCED_EDITS_RESOURCE_URI,
  listResourceEntries,
  readResourceContent,
} from "./resources.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

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
    const expand = (
      root: Record<string, unknown>,
      value: unknown = root,
    ): unknown => {
      if (Array.isArray(value)) return value.map((item) => expand(root, item));
      if (!value || typeof value !== "object") return value;
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === "string") {
        const name = object.$ref.replace("#/$defs/", "");
        const target = (root.$defs as Record<string, unknown>)[name];
        expect(target).toBeDefined();
        return expand(root, target);
      }
      return Object.fromEntries(
        Object.entries(object)
          .filter(([key]) => key !== "$defs")
          .map(([key, child]) => [key, expand(root, child)]),
      );
    };
    expect(expand(compact)).toEqual(expand(original));
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
      expect(projected!.text.split("\n")[0]).toBe(expectedText!.split("\n")[0]);
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
