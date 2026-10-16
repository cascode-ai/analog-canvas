import { z } from "zod";
import type { CircuitProject } from "@icm/model";
import type { ProjectStructureEdit } from "./project-transaction.js";

const Id = z.string().min(1);
export const ComponentDraftTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("component"), draftId: Id }),
  z.strictObject({
    kind: z.literal("circuit"),
    sourceId: Id,
    definitionId: Id,
  }),
  z.strictObject({ kind: z.literal("source"), sourceId: Id }),
]);
export type ComponentDraftTarget = z.infer<typeof ComponentDraftTargetSchema>;
export const ComponentDraftCatalogSchema = z.strictObject({
  bytes: z.number().int().nonnegative(),
  entries: z.array(
    z.strictObject({
      target: ComponentDraftTargetSchema,
      name: z.string(),
      bytes: z.number().int().nonnegative(),
      diagnostic: z.string().optional(),
    }),
  ),
  limits: z.array(
    z.strictObject({
      scope: z.string(),
      unit: z.enum(["characters", "bytes", "items"]),
      used: z.number().int().nonnegative(),
      maximum: z.number().int().positive(),
    }),
  ),
});
export type ComponentDraftCatalog = z.infer<typeof ComponentDraftCatalogSchema>;
export const componentDraftKey = (target: ComponentDraftTarget) =>
  JSON.stringify(
    target.kind === "component"
      ? [target.kind, target.draftId]
      : target.kind === "circuit"
        ? [target.kind, target.sourceId, target.definitionId]
        : [target.kind, target.sourceId],
  );
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const textBytes = (text: string) => new TextEncoder().encode(text).byteLength;
function draftName(
  text: string,
  fallback: string,
): { name: string; diagnostic?: string } {
  try {
    const value = JSON.parse(text);
    const name =
      value?.symbol?.name ??
      value?.definition?.symbol?.name ??
      value?.entry?.definition?.symbol?.name ??
      value?.owners?.[0]?.name;
    const prefix =
      value?.kind === "component-variant"
        ? "Variant draft "
        : value?.publication || value?.entry?.definition
          ? "Library draft "
          : "Artwork draft ";
    return {
      name:
        typeof name === "string" && name.trim()
          ? prefix + name
          : prefix + fallback.replace(/^Artwork draft /, ""),
    };
  } catch {
    return { name: fallback, diagnostic: "Unfinished definition" };
  }
}
/** Stored candidates only. Shared source bodies are counted once, never per symbol. */
export function componentDraftCatalog(
  project: CircuitProject,
): ComponentDraftCatalog {
  const entries: ComponentDraftCatalog["entries"] = [];
  const limits: ComponentDraftCatalog["limits"] = [];
  let total = 0;
  const standalone = project.componentAuthoringDrafts ?? [];
  total += project.componentAuthoringDrafts ? bytes(standalone) : 0;
  limits.push({
    scope: "Component drafts",
    unit: "items",
    used: standalone.length,
    maximum: 256,
  });
  for (const draft of standalone) {
    const target: ComponentDraftTarget = {
      kind: "component",
      draftId: draft.id,
    };
    const label = draftName(
      draft.text,
      `Artwork draft ${draft.id.slice(0, 8)}`,
    );
    if (draft.library && !label.name.startsWith("Library draft "))
      label.name =
        "Library draft " +
        (label.name.startsWith("Artwork draft")
          ? draft.id.slice(0, 8)
          : label.name);
    entries.push({ target, ...label, bytes: bytes(draft) });
    limits.push({
      scope: componentDraftKey(target),
      unit: "characters",
      used: draft.text.length,
      maximum: 1_048_576,
    });
  }
  for (const source of project.modelSources ?? []) {
    const draft = source.draft;
    if (!draft) continue;
    total += bytes(draft);
    const candidates = draft.authoring ?? [];
    const shared =
      bytes(draft) - candidates.reduce((sum, d) => sum + bytes(d), 0);
    if (!candidates.length)
      entries.push({
        target: { kind: "source", sourceId: source.id },
        name: `Source ${draft.entry}`,
        bytes: bytes(draft),
      });
    for (const candidate of candidates)
      entries.push({
        target: {
          kind: "circuit",
          sourceId: source.id,
          definitionId: candidate.definitionId,
        },
        name: "Circuit draft " + (candidate.entry || draft.entry),
        bytes: bytes(candidate),
      });
    // The body is intentionally represented separately from per-candidate charges.
    limits.push({
      scope: `${source.id}: shared source (${shared} stored bytes)`,
      unit: "bytes",
      used: draft.files.reduce((n, f) => n + textBytes(f.text), 0),
      maximum: 1_048_576,
    });
    limits.push({
      scope: `${source.id}: artwork`,
      unit: "bytes",
      used: bytes(candidates),
      maximum: 1_048_576,
    });
    limits.push({
      scope: `${source.id}: candidates`,
      unit: "items",
      used: candidates.length,
      maximum: 256,
    });
    limits.push({
      scope: `${source.id}: files`,
      unit: "items",
      used: draft.files.length,
      maximum: 256,
    });
    limits.push({
      scope: `${source.id}: dependencies`,
      unit: "items",
      used: draft.dependencies?.length ?? 0,
      maximum: 256,
    });
    for (const candidate of candidates)
      limits.push({
        scope: `${source.id}:${candidate.definitionId}`,
        unit: "characters",
        used: candidate.artworkText.length,
        maximum: 1_048_576,
      });
  }
  return { entries, bytes: total, limits };
}
/** Build compare-and-swap edits. No executable definitions or source owners are removed. */
export function planComponentDraftDeletion(
  project: CircuitProject,
  targets: ComponentDraftTarget[],
) {
  if (!targets.length) throw Error("Select at least one draft.");
  const catalog = componentDraftCatalog(project);
  const keys = new Set(targets.map(componentDraftKey));
  if (
    keys.size !== targets.length ||
    targets.some(
      (t) =>
        !catalog.entries.some(
          (e) => componentDraftKey(e.target) === componentDraftKey(t),
        ),
    )
  )
    throw Error("The draft selection changed. Refresh before deleting.");
  const after = structuredClone(project);
  const edits: ProjectStructureEdit[] = [];
  for (const target of targets)
    if (target.kind === "component") {
      const draft = project.componentAuthoringDrafts!.find(
        (d) => d.id === target.draftId,
      )!;
      edits.push({
        kind: "remove_component_authoring_draft",
        draftId: draft.id,
        expectedText: draft.text,
      });
      after.componentAuthoringDrafts = after.componentAuthoringDrafts!.filter(
        (d) => d.id !== draft.id,
      );
    }
  for (const source of project.modelSources ?? []) {
    const selected = targets.filter(
      (t) => t.kind !== "component" && t.sourceId === source.id,
    );
    if (!selected.length) continue;
    const draft = source.draft!;
    const definitionIds = selected.flatMap((t) =>
      t.kind === "circuit" ? [t.definitionId] : [],
    );
    edits.push({
      kind: "discard_model_source_draft",
      sourceId: source.id,
      expectedRevision: source.revision,
      expectedDraft: structuredClone(draft),
      ...(definitionIds.length ? { definitionIds } : {}),
    });
    const next = after.modelSources!.find((s) => s.id === source.id)!;
    if (!definitionIds.length) delete next.draft;
    else {
      // Candidate deletion must not rebase or rewrite shared, possibly stale text.
      next.draft!.authoring = draft.authoring!.filter(
        (d) => !definitionIds.includes(d.definitionId),
      );
    }
  }
  return {
    edits,
    sourceCheckpoints: (after.modelSources ?? [])
      .filter((source) =>
        targets.some((t) => t.kind !== "component" && t.sourceId === source.id),
      )
      .map((source) => ({
        sourceId: source.id,
        before: JSON.stringify(
          project.modelSources?.find((s) => s.id === source.id)?.draft ?? null,
        ),
        value: JSON.stringify(source.draft ?? null),
      })),
    reclaimBytes: Math.max(
      0,
      catalog.bytes - componentDraftCatalog(after).bytes,
    ),
  };
}
