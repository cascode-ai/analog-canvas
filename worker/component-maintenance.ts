import { sha256Hex } from "@icm/derived";
import type { ComponentLibrarySql } from "./component-publication-index";
import type { ComponentCatalogRow } from "./component-catalog";
import type { ComponentManagement } from "./component-management";
import {
  COMPONENT_HISTORY_MAX_BYTES,
  definitionBytes,
  historyBytes,
  keepVersion,
} from "./component-versions";
import {
  COMPONENT_LIBRARY_ID,
  componentNameKey,
} from "../apps/editor/src/features/user-components/component-library-contract";

export interface ConsolidationRequest {
  /** Report only; apply needs an explicit `false`. */
  dryRun: boolean;
  /** Fold each author's same-name public records into their newest one. */
  foldDuplicates: boolean;
  /** Records to move to their authors' private libraries. */
  makePrivate: string[];
  /** A dry run's `planDigest`: apply only that exact plan. */
  planDigest?: string;
}

type Member = { id: string; revision: number; name: string; createdAt: string };
export interface ConsolidationGroup {
  authorId: string;
  author: string;
  /** The normalized name the group shares. */
  name: string;
  keep: Member;
  fold: Member[];
  outcome: "would-fold" | "folded" | "skipped" | "failed";
  reason?: string;
}
export interface PrivacyChange {
  id: string;
  outcome:
    "would-make-private" | "made-private" | "unchanged" | "skipped" | "failed";
  reason?: string;
  /** The record's revision after the change, or now. */
  revision?: number;
}

export function readConsolidationRequest(
  body: Record<string, unknown>,
): ConsolidationRequest | string {
  const ids = body.makePrivate ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string" || !COMPONENT_LIBRARY_ID.test(id))
  )
    return "makePrivate must list at most 500 component IDs";
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean")
    return "dryRun must be true or false";
  if (
    body.foldDuplicates !== undefined &&
    typeof body.foldDuplicates !== "boolean"
  )
    return "foldDuplicates must be true or false";
  if (
    body.planDigest !== undefined &&
    (typeof body.planDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(body.planDigest))
  )
    return "planDigest must be a dry run's digest";
  return {
    dryRun: body.dryRun !== false,
    foldDuplicates: body.foldDuplicates !== false,
    makePrivate: [...new Set(ids as string[])],
    ...(body.planDigest ? { planDigest: String(body.planDigest) } : {}),
  };
}

/**
 * Administrator cleanup of historical publications. Each group commits in its
 * own transaction; captured Project copies never change. Only records this
 * region writes are changed; the other region runs its own.
 */
export class ComponentMaintenance {
  constructor(
    private readonly sql: ComponentLibrarySql,
    private readonly transaction: <T>(fn: () => T) => T,
    private readonly management: ComponentManagement,
    private readonly foreign: () => Set<string>,
  ) {}
  private row(id: string) {
    return this.sql
      .exec<ComponentCatalogRow>("SELECT * FROM components WHERE id=?", id)
      .toArray()[0];
  }
  /** Authors' same-name public records, newest first; groups of two or more. */
  private groups() {
    const rows = this.sql
      .exec<{
        id: string;
        revision: number;
        author_id: string;
        author: string;
        name: string;
        created_at: string;
      }>(
        `SELECT id,revision,author_id,author,name,created_at FROM components
        WHERE status='shared' ORDER BY author_id, created_at DESC, id`,
      )
      .toArray();
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = JSON.stringify([row.author_id, componentNameKey(row.name)]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()]
      .filter((members) => members.length > 1)
      .map((members) => {
        const [keep, ...fold] = members.map((row) => ({
          id: row.id,
          revision: row.revision,
          name: row.name,
          createdAt: row.created_at,
        }));
        return {
          authorId: members[0]!.author_id,
          author: members[0]!.author,
          name: componentNameKey(members[0]!.name),
          keep: keep!,
          fold,
        };
      });
  }
  private fold(group: Omit<ConsolidationGroup, "outcome">, at: string) {
    this.transaction(() => {
      const keep = this.row(group.keep.id);
      if (keep?.status !== "shared" || keep.revision !== group.keep.revision)
        throw Error("The kept record changed");
      for (const member of group.fold) {
        const row = this.row(member.id);
        if (row?.status !== "shared" || row.revision !== member.revision)
          throw Error(`${member.id} changed`);
        this.sql.exec(
          `INSERT OR IGNORE INTO component_versions
          SELECT ?, source_id, revision, name, definition, saved_at
          FROM component_versions WHERE component_id=?`,
          keep.id,
          row.id,
        );
        keepVersion(this.sql, keep.id, row);
        this.sql.exec(
          "UPDATE components SET status='superseded', superseded_by=?, revision=revision+1, updated_at=? WHERE id=?",
          keep.id,
          at,
          row.id,
        );
        this.sql.exec(
          "UPDATE component_content_index SET revision=revision+1 WHERE component_id=?",
          row.id,
        );
      }
    });
  }
  /** What a run would change now; the digest names exactly that plan. */
  private plan(request: ConsolidationRequest) {
    const foreign = this.foreign();
    const groups: ConsolidationGroup[] = [];
    if (request.foldDuplicates)
      for (const group of this.groups()) {
        const members = [group.keep, ...group.fold];
        const bytes =
          historyBytes(this.sql, group.keep.id) +
          group.fold.reduce(
            (sum, member) =>
              sum +
              historyBytes(this.sql, member.id) +
              definitionBytes(this.row(member.id)!.definition),
            0,
          );
        const reason = members.some((member) => foreign.has(member.id))
          ? "foreign-writer"
          : bytes > COMPONENT_HISTORY_MAX_BYTES
            ? "history-full"
            : undefined;
        groups.push(
          reason
            ? { ...group, outcome: "skipped", reason }
            : { ...group, outcome: "would-fold" },
        );
      }
    const folded = new Set(
      groups
        .filter((group) => group.outcome === "would-fold")
        .flatMap((group) => group.fold.map((member) => member.id)),
    );
    const privacy: PrivacyChange[] = request.makePrivate.map((id) => {
      const row = this.row(id);
      if (!row) return { id, outcome: "skipped", reason: "not-found" };
      if (folded.has(id))
        return {
          id,
          outcome: "skipped",
          reason: "folded",
          revision: row.revision,
        };
      if (row.status === "private")
        return { id, outcome: "unchanged", revision: row.revision };
      if (row.status !== "shared")
        return {
          id,
          outcome: "skipped",
          reason: `status-${row.status}`,
          revision: row.revision,
        };
      if (foreign.has(id))
        return { id, outcome: "skipped", reason: "foreign-writer" };
      return { id, outcome: "would-make-private", revision: row.revision };
    });
    const planDigest = sha256Hex(
      JSON.stringify([
        groups
          .filter((group) => group.outcome === "would-fold")
          .map((group) => [
            [group.keep.id, group.keep.revision],
            group.fold.map((member) => [member.id, member.revision]),
          ]),
        privacy
          .filter((change) => change.outcome === "would-make-private")
          .map((change) => [change.id, change.revision]),
      ]),
    );
    return { groups, privacy, planDigest };
  }
  run(request: ConsolidationRequest, actor: string) {
    const planned = this.plan(request);
    if (request.dryRun) return report(true, planned);
    if (request.planDigest && request.planDigest !== planned.planDigest)
      return {
        ...report(true, planned),
        error: "The library changed since that dry run. Review this plan.",
        code: "COMPONENT_PLAN_CHANGED",
      };
    const at = new Date().toISOString();
    const failure = (error: unknown) =>
      error instanceof Error ? error.message : String(error);
    const groups = planned.groups.map((group): ConsolidationGroup => {
      if (group.outcome !== "would-fold") return group;
      try {
        this.fold(group, at);
        return { ...group, outcome: "folded" };
      } catch (error) {
        return { ...group, outcome: "failed", reason: failure(error) };
      }
    });
    const privacy = planned.privacy.map((change): PrivacyChange => {
      if (change.outcome !== "would-make-private") return change;
      try {
        const refusal = this.transaction(() => {
          const row = this.row(change.id);
          const result = this.management.apply(row, {
            action: "make-private",
            admin: true,
            userId: actor,
            revision: change.revision,
          });
          return result instanceof Response ? "the record changed" : null;
        });
        if (refusal) return { ...change, outcome: "failed", reason: refusal };
        return {
          id: change.id,
          outcome: "made-private",
          revision: this.row(change.id)!.revision,
        };
      } catch (error) {
        return { ...change, outcome: "failed", reason: failure(error) };
      }
    });
    return report(false, { groups, privacy, planDigest: planned.planDigest });
  }
}

function report(
  dryRun: boolean,
  {
    groups,
    privacy,
    planDigest,
  }: {
    groups: ConsolidationGroup[];
    privacy: PrivacyChange[];
    planDigest: string;
  },
) {
  return {
    dryRun,
    planDigest,
    groups,
    private: privacy,
    totals: {
      groups: groups.filter((group) =>
        ["would-fold", "folded"].includes(group.outcome),
      ).length,
      records: groups.reduce(
        (sum, group) =>
          sum +
          (["would-fold", "folded"].includes(group.outcome)
            ? group.fold.length
            : 0),
        0,
      ),
      private: privacy.filter((change) =>
        ["would-make-private", "made-private"].includes(change.outcome),
      ).length,
      skipped:
        groups.filter((group) => group.outcome === "skipped").length +
        privacy.filter((change) => change.outcome === "skipped").length,
      failed:
        groups.filter((group) => group.outcome === "failed").length +
        privacy.filter((change) => change.outcome === "failed").length,
    },
  };
}
