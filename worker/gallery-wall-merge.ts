// The community wall with the reference datasets in it (#1697): one wall,
// one order, and totals, filter counts and tag counts that add up across
// the community store and every dataset's. One dataset's wall, or the
// community's alone, is the same read over one store.

import { withGalleryStore } from "./gallery-datasets";
import { callGallery } from "./gallery-requests";
import { GALLERY_SOURCES, type GallerySource } from "./gallery-sources";
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

/** A store a wall reads, and the dataset it holds (null: the community's). */
export interface WallStore {
  env: GalleryEnv;
  source: GallerySource | null;
}

/**
 * The stores a wall request reads: one dataset's (its `env` already that
 * store), the community's alone, or the community's and every dataset's.
 */
export function wallStoresOf(
  env: GalleryEnv,
  source: GallerySource | null,
  communityOnly: boolean,
): WallStore[] {
  if (source) return [{ env, source }];
  if (communityOnly) return [{ env, source: null }];
  return [
    { env, source: null },
    ...GALLERY_SOURCES.map((each) => ({
      env: withGalleryStore(env, each),
      source: each,
    })),
  ];
}

/**
 * How a circuit was made, as one store answers the choice: AI generated
 * (the AI mark), made by hand (a community circuit without it), or from a
 * reference dataset (whose circuits carry no mark). A store that holds
 * none of the chosen kind is asked for none.
 */
function storeBody(
  body: Record<string, unknown>,
  store: WallStore,
): Record<string, unknown> {
  if (body.ai === "human")
    return { ...body, ai: store.source ? "none" : "human" };
  if (body.ai === "dataset")
    return { ...body, ai: store.source ? null : "none" };
  return body;
}

/** One operation in every store; a dataset that fails adds nothing. */
async function everyStore<T>(
  stores: readonly WallStore[],
  operation: string,
  body: Record<string, unknown>,
): Promise<(T | null)[]> {
  return Promise.all(
    stores.map((store, index) =>
      callGallery<T>(store.env, operation, storeBody(body, store)).then(
        ({ status, payload }) =>
          index === 0 || status === 200 ? payload : null,
        (error: unknown) => {
          if (index === 0) throw error;
          return null;
        },
      ),
    ),
  );
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
 * A page of the wall. Each store answers its first page after the cursor
 * in the same order; the page is the first of all of them, and the last
 * one's cursor resumes every store. Made by hand counts the community's
 * unmarked circuits, Datasets every dataset's. Contributors stay the
 * community's; on the merged wall `sources` says how many of each
 * dataset's circuits the filtered wall holds.
 */
export async function wallList(
  stores: readonly WallStore[],
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const answers = await everyStore<WallPage>(stores, "list", {
    ...body,
    sortKeys: true,
  });
  const first = answers[0]!;
  const { order } = wallOrder(body);
  const limit = wallPageLimit(body);
  const pages = answers.filter((page): page is WallPage => page !== null);
  const merged = pages
    .flatMap((page) => page.entries ?? [])
    .sort((left, right) => compareWallKeys(order, left.sortKey, right.sortKey));
  const page = merged.slice(0, limit);
  const more =
    merged.length > limit || pages.some((each) => each.nextCursor != null);
  const countOf = (answer: WallPage | null, key: string) =>
    Number(answer?.filterCounts?.[key] ?? 0);
  const filterCounts = first.filterCounts
    ? {
        ...answers
          .slice(1)
          .reduce<Record<string, unknown>>(
            (sum, answer) => addCounts(sum, answer?.filterCounts),
            structuredClone(first.filterCounts),
          ),
        human: answers.reduce(
          (sum, answer, index) =>
            stores[index]!.source ? sum : sum + countOf(answer, "human"),
          0,
        ),
        datasets: answers.reduce(
          (sum, answer, index) =>
            stores[index]!.source
              ? sum + countOf(answer, "ai") + countOf(answer, "human")
              : sum,
          0,
        ),
      }
    : undefined;
  const merging = stores.length > 1;
  return {
    ...first,
    entries: page.map(({ sortKey: _key, cursor: _cursor, ...entry }) => entry),
    nextCursor: more && page.length > 0 ? page.at(-1)!.cursor : null,
    total: pages.reduce((sum, each) => sum + Number(each.total ?? 0), 0),
    ...(filterCounts ? { filterCounts } : {}),
    ...(merging
      ? {
          sources: Object.fromEntries(
            stores.flatMap((store, index) =>
              store.source
                ? [[store.source.key, Number(answers[index]?.total ?? 0)]]
                : [],
            ),
          ),
        }
      : {}),
  };
}

/** Tag and family counts of the wall, sorted as one store sorts them. */
export async function wallTagCounts(
  stores: readonly WallStore[],
  body: Record<string, unknown>,
): Promise<{
  tags: { tag: string; count: number }[];
  groups: { group: string; count: number }[];
}> {
  const answers = await everyStore<{
    tags?: { tag: string; count: number }[];
    groups?: { group: string; count: number }[];
  }>(stores, "tags", body);
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

/**
 * The Owner's numbers (#1446): the community's authors, or one author's
 * circuits, with opens in all and in the last seven days (UTC, today
 * included); the most opened circuits come from the whole wall, the
 * reference datasets' too.
 */
export async function ownerData(
  env: GalleryEnv,
  author: string | null,
): Promise<unknown> {
  const since = new Date(Date.now() - 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (author)
    return (await callGallery(env, "owner-data", { author, since })).payload;
  const [community, ...datasets] = await Promise.all(
    wallStoresOf(env, null, false).map((store) =>
      callGallery<{
        mostOpened?: { opens: number; opensLastWeek: number }[];
      }>(store.env, "owner-data", { since }).then(({ payload }) => payload),
    ),
  );
  return {
    ...community,
    mostOpened: [community, ...datasets]
      .flatMap((payload) => payload?.mostOpened ?? [])
      .sort(
        (left, right) =>
          right.opens - left.opens || right.opensLastWeek - left.opensLastWeek,
      )
      .slice(0, 50),
  };
}
