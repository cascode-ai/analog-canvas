// The community wall with the reference datasets in it (#1697): one wall,
// one order, and totals, filter counts and tag counts that add up across
// the community store and every dataset's.

import { withGalleryStore } from "./gallery-datasets";
import { callGallery } from "./gallery-requests";
import { GALLERY_SOURCES } from "./gallery-sources";
import type { GalleryEnv } from "./gallery-store";
import {
  compareWallKeys,
  wallOrder,
  wallPageLimit,
  type WallSortKey,
} from "./gallery-store-wall";

interface WallPage {
  entries?: (Record<string, unknown> & {
    sortKey: WallSortKey;
    cursor: string;
  })[];
  nextCursor?: string | null;
  total?: number;
  filterCounts?: Record<string, unknown>;
  [field: string]: unknown;
}

/** The community store first, then each dataset's, in the registry's order. */
function wallStores(env: GalleryEnv): GalleryEnv[] {
  return [
    env,
    ...GALLERY_SOURCES.map((source) => withGalleryStore(env, source)),
  ];
}

/** One operation in every store; a dataset that fails adds nothing. */
async function everyStore<T>(
  env: GalleryEnv,
  operation: string,
  body: Record<string, unknown>,
): Promise<[T, ...(T | null)[]]> {
  const [community, ...datasets] = await Promise.all(
    wallStores(env).map((store, index) =>
      callGallery<T>(store, operation, body).then(
        ({ status, payload }) =>
          index === 0 || status === 200 ? payload : null,
        (error: unknown) => {
          if (index === 0) throw error;
          return null;
        },
      ),
    ),
  );
  return [community as T, ...datasets];
}

/** Counts added key by key, nested records too. */
function addCounts(
  into: Record<string, unknown>,
  from: Record<string, unknown> | undefined,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(from ?? {})) {
    if (typeof value === "number") into[key] = Number(into[key] ?? 0) + value;
    else if (value && typeof value === "object")
      into[key] = addCounts(
        { ...((into[key] as Record<string, unknown> | undefined) ?? {}) },
        value as Record<string, unknown>,
      );
  }
  return into;
}

/**
 * A page of the merged wall. Each store answers its first page after the
 * cursor in the same order; the merged page is the first of all of them,
 * and the last one's cursor resumes every store. Contributors stay the
 * community's: the datasets are listed beside them with `sources`, how many
 * of each dataset's circuits the filtered wall holds.
 */
export async function mergedWallList(
  env: GalleryEnv,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [community, ...datasets] = await everyStore<WallPage>(env, "list", {
    ...body,
    sortKeys: true,
  });
  const { order } = wallOrder(body);
  const limit = wallPageLimit(body);
  const pages = [community, ...datasets].filter(
    (page): page is WallPage => page !== null,
  );
  const merged = pages
    .flatMap((page) => page.entries ?? [])
    .sort((left, right) => compareWallKeys(order, left.sortKey, right.sortKey));
  const page = merged.slice(0, limit);
  const more =
    merged.length > limit || pages.some((each) => each.nextCursor != null);
  const filterCounts = community.filterCounts
    ? datasets.reduce<Record<string, unknown>>(
        (sum, dataset) => addCounts(sum, dataset?.filterCounts),
        structuredClone(community.filterCounts),
      )
    : undefined;
  return {
    ...community,
    entries: page.map(({ sortKey: _key, cursor: _cursor, ...entry }) => entry),
    nextCursor: more && page.length > 0 ? page.at(-1)!.cursor : null,
    total: pages.reduce((sum, each) => sum + Number(each.total ?? 0), 0),
    ...(filterCounts ? { filterCounts } : {}),
    sources: Object.fromEntries(
      GALLERY_SOURCES.map((source, index) => [
        source.key,
        Number(datasets[index]?.total ?? 0),
      ]),
    ),
  };
}

/** Tag and family counts of the merged wall, sorted as one store sorts them. */
export async function mergedTagCounts(
  env: GalleryEnv,
  body: Record<string, unknown>,
): Promise<{
  tags: { tag: string; count: number }[];
  groups: { group: string; count: number }[];
}> {
  const answers = await everyStore<{
    tags?: { tag: string; count: number }[];
    groups?: { group: string; count: number }[];
  }>(env, "tags", body);
  const tags = new Map<string, number>();
  const groups = new Map<string, number>();
  for (const answer of answers) {
    for (const { tag, count } of answer?.tags ?? [])
      tags.set(tag, (tags.get(tag) ?? 0) + count);
    for (const { group, count } of answer?.groups ?? [])
      groups.set(group, (groups.get(group) ?? 0) + count);
  }
  return {
    tags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
      .map(([tag, count]) => ({ tag, count })),
    groups: [...groups.entries()].map(([group, count]) => ({ group, count })),
  };
}
