// The Statistics tab's Gallery figures from the stores a reader chooses: the
// community's, the reference datasets', or all of them. Each store counts its
// own (gallery-store-stats.ts); this merges them. A dataset's circuits are
// neither people's nor AI's, so its weeks count them apart.

import { withGalleryStore } from "./gallery-datasets";
import { callGallery } from "./gallery-requests";
import { GALLERY_SOURCES } from "./gallery-sources";
import type { GalleryEnv } from "./gallery-store";
import type { GalleryStatsSummary } from "./gallery-store-stats";

export type GalleryStatsSource = "all" | "community" | "datasets";

export function galleryStatsSourceOf(value: string | null): GalleryStatsSource {
  return value === "community" || value === "datasets" ? value : "all";
}

interface StoreStats {
  summary: GalleryStatsSummary;
  topAuthors: { author: string; circuits: number }[];
}

const TOP_TAGS = 12;
const TOP_AUTHORS = 10;

/** Counts keyed alike, added up, in the order first seen. */
function added<Item, Key extends keyof Item, Value extends keyof Item>(
  lists: readonly (readonly Item[])[],
  key: Key,
  value: Value,
): Map<Item[Key], number> {
  const sums = new Map<Item[Key], number>();
  for (const list of lists)
    for (const item of list)
      sums.set(
        item[key],
        (sums.get(item[key]) ?? 0) + (item[value] as unknown as number),
      );
  return sums;
}

const ranked = <Key>(sums: Map<Key, number>) =>
  [...sums.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      right - left || String(leftKey).localeCompare(String(rightKey)),
  );

function merged(stores: readonly StoreStats[]): GalleryStatsSummary {
  const summaries = stores.map((store) => store.summary);
  const total = (field: keyof GalleryStatsSummary) =>
    summaries.reduce((sum, summary) => sum + (summary[field] as number), 0);
  const weeks = new Map<
    string,
    { human: number; ai: number; dataset: number }
  >();
  for (const summary of summaries)
    for (const item of summary.weeks) {
      const week = weeks.get(item.week) ?? { human: 0, ai: 0, dataset: 0 };
      week.human += item.human;
      week.ai += item.ai;
      week.dataset += item.dataset;
      weeks.set(item.week, week);
    }
  const span = summaries[0]?.weeks.length ?? 0;
  return {
    circuits: total("circuits"),
    datasets: total("datasets"),
    authors: total("authors"),
    components: total("components"),
    transistors: total("transistors"),
    counted: total("counted"),
    ai: total("ai"),
    netlist: total("netlist"),
    likes: total("likes"),
    liked: total("liked"),
    types: ranked(
      added(
        summaries.map((summary) => summary.types),
        "type",
        "circuits",
      ),
    ).map(([type, circuits]) => ({ type, circuits })),
    tags: ranked(
      added(
        summaries.map((summary) => summary.tags),
        "tag",
        "circuits",
      ),
    )
      .slice(0, TOP_TAGS)
      .map(([tag, circuits]) => ({ tag, circuits })),
    devices: [
      ...added(
        summaries.map((summary) => summary.devices),
        "kind",
        "count",
      ),
    ].map(([kind, count]) => ({ kind, count })),
    sizes: [
      ...added(
        summaries.map((summary) => summary.sizes),
        "key",
        "circuits",
      ),
    ].map(([key, circuits]) => ({ key, circuits })),
    transistorBins: [
      ...added(
        summaries.map((summary) => summary.transistorBins),
        "key",
        "circuits",
      ),
    ].map(([key, circuits]) => ({ key, circuits })),
    weeks: [...weeks.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-span)
      .map(([week, made]) => ({ week, ...made })),
  };
}

/**
 * The Gallery's statistics from the chosen stores, and how many circuits
 * each store gave. A dataset that fails to answer adds nothing; the
 * community's failure fails the read.
 */
export async function galleryStatsOf(
  env: GalleryEnv,
  source: GalleryStatsSource,
): Promise<{ status: number; payload: unknown }> {
  const stores = [
    ...(source === "datasets" ? [] : [{ env, dataset: null }]),
    ...(source === "community"
      ? []
      : GALLERY_SOURCES.map((dataset) => ({
          env: withGalleryStore(env, dataset),
          dataset,
        }))),
  ];
  const reads = await Promise.all(
    stores.map((store) =>
      callGallery<StoreStats>(store.env, "gallery-stats", {
        allTags: true,
      }).catch(() => null),
    ),
  );
  const community = stores.findIndex((store) => store.dataset === null);
  if (community >= 0 && reads[community]?.status !== 200)
    return (
      reads[community] ?? { status: 503, payload: { error: "unavailable" } }
    );
  const answered = stores.flatMap((store, index) => {
    const read = reads[index];
    if (read?.status !== 200 || !read.payload?.summary) return [];
    const { summary, topAuthors } = read.payload;
    return [
      {
        store,
        stats: store.dataset
          ? {
              topAuthors,
              summary: {
                ...summary,
                datasets: summary.circuits,
                weeks: summary.weeks.map((item) => ({
                  week: item.week,
                  human: 0,
                  ai: 0,
                  dataset: item.human + item.ai + item.dataset,
                })),
              },
            }
          : { summary, topAuthors },
      },
    ];
  });
  return {
    status: 200,
    payload: {
      summary: merged(answered.map((item) => item.stats)),
      topAuthors: answered
        .flatMap((item) => item.stats.topAuthors)
        .sort((left, right) => right.circuits - left.circuits)
        .slice(0, TOP_AUTHORS),
      sources: answered.map((item) => ({
        key: item.store.dataset?.key ?? "community",
        name: item.store.dataset?.name ?? "Community",
        circuits: item.stats.summary.circuits,
      })),
    },
  };
}
