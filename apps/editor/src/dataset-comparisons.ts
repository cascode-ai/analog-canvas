// /datasets: each dataset circuit's original figure beside our redraw.
// The page reads every comparison once and sorts, filters and counts them
// itself; this module is that logic, the page only draws it.

export type ComparisonVerdict = "match" | "notation" | "error" | "unclear";

/** One row of GET /api/gallery/sources/<key>/comparisons, with its dataset. */
export interface DatasetComparison {
  id: string;
  source: string;
  name: string;
  verdict: ComparisonVerdict;
  category: string;
  detail: string;
  reason: string;
  families: string[];
  components: number;
  previewRevision: string;
  figureRevision: string;
}

export const VERDICTS: readonly {
  key: ComparisonVerdict;
  label: string;
  what: string;
  icon: string;
}[] = [
  { key: "match", label: "Match", what: "netlists agree", icon: "✓" },
  {
    key: "notation",
    label: "Notation",
    what: "written differently",
    icon: "≈",
  },
  { key: "error", label: "Dataset error", what: "dataset is wrong", icon: "✕" },
  { key: "unclear", label: "Unclear", what: "figure ambiguous", icon: "?" },
];

export function verdictOf(key: ComparisonVerdict) {
  return VERDICTS.find((verdict) => verdict.key === key) ?? VERDICTS[0]!;
}

export const FAMILIES = [
  "MOS",
  "BJT",
  "Op-amp",
  "Inductor",
  "Diode",
  "Switch",
] as const;

/** Device-count bands of the size chart; the last is open. */
export const SIZE_BINS: readonly (readonly [number, number])[] = [
  [0, 4],
  [5, 8],
  [9, 12],
  [13, 20],
  [21, 40],
  [41, Infinity],
];

export function sizeBinLabel(index: number): string {
  const [low, high] = SIZE_BINS[index]!;
  return high === Infinity ? `${low}+` : `${low === 0 ? 1 : low}–${high}`;
}

export function sizeBinOf(components: number): number {
  return SIZE_BINS.findIndex(
    ([low, high]) => components >= low && components <= high,
  );
}

export const SORTS = {
  id: "ID",
  largest: "Largest first",
  smallest: "Smallest first",
  name: "Name",
  errors: "Errors first",
} as const;
export type ComparisonSort = keyof typeof SORTS;

export const VIEWS = {
  pair: "Pair",
  netlists: "Pair + netlists",
  grid: "Grid",
} as const;
export type ComparisonView = keyof typeof VIEWS;

/** What the reader picked; the page's URL holds it. */
export interface ComparisonFilters {
  source: string | null;
  verdict: ComparisonVerdict | null;
  category: string | null;
  size: number | null;
  family: string | null;
  query: string;
  sort: ComparisonSort;
  view: ComparisonView;
}

export const NO_FILTERS: ComparisonFilters = {
  source: null,
  verdict: null,
  category: null,
  size: null,
  family: null,
  query: "",
  sort: "id",
  view: "pair",
};

type Facet = "source" | "verdict" | "category" | "size" | "family";

/**
 * The rows every filter but the facets named keeps. A chart counts the
 * rows the other filters leave, so its own choice never hides its siblings.
 */
export function rowsWithout(
  rows: readonly DatasetComparison[],
  filters: ComparisonFilters,
  ...skip: Facet[]
): DatasetComparison[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (skip.includes("source") ||
        !filters.source ||
        row.source === filters.source) &&
      (skip.includes("verdict") ||
        !filters.verdict ||
        row.verdict === filters.verdict) &&
      (skip.includes("category") ||
        !filters.category ||
        row.category === filters.category) &&
      (skip.includes("size") ||
        filters.size === null ||
        sizeBinOf(row.components) === filters.size) &&
      (skip.includes("family") ||
        !filters.family ||
        row.families.includes(filters.family)) &&
      (!query ||
        row.id.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query)),
  );
}

/** How many rows hold each value of a key, largest first. */
export function countBy<T extends string>(
  rows: readonly DatasetComparison[],
  key: (row: DatasetComparison) => T,
): [T, number][] {
  const counts = new Map<T, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const idNumber = (id: string) => Number(id.split("-")[1]) || 0;
const VERDICT_ORDER: Record<ComparisonVerdict, number> = {
  error: 0,
  unclear: 1,
  notation: 2,
  match: 3,
};

export function sortedComparisons(
  rows: readonly DatasetComparison[],
  sort: ComparisonSort,
): DatasetComparison[] {
  const byId = (a: DatasetComparison, b: DatasetComparison) =>
    a.source.localeCompare(b.source) ||
    idNumber(a.id) - idNumber(b.id) ||
    a.id.localeCompare(b.id);
  const compare = {
    id: byId,
    largest: (a: DatasetComparison, b: DatasetComparison) =>
      b.components - a.components || byId(a, b),
    smallest: (a: DatasetComparison, b: DatasetComparison) =>
      a.components - b.components || byId(a, b),
    name: (a: DatasetComparison, b: DatasetComparison) =>
      a.name.localeCompare(b.name) || byId(a, b),
    errors: (a: DatasetComparison, b: DatasetComparison) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || byId(a, b),
  }[sort];
  return [...rows].sort(compare);
}

/**
 * Pick a verdict: picking it again clears it, and a category of another
 * verdict goes with the change.
 */
export function toggleVerdict(
  filters: ComparisonFilters,
  verdict: ComparisonVerdict,
  rows: readonly DatasetComparison[],
): ComparisonFilters {
  const next = filters.verdict === verdict ? null : verdict;
  const keepsCategory =
    !filters.category ||
    !next ||
    rows.some(
      (row) => row.verdict === next && row.category === filters.category,
    );
  return {
    ...filters,
    verdict: next,
    category: keepsCategory ? filters.category : null,
  };
}

/** Pick a category of a verdict, which picks that verdict too. */
export function toggleCategory(
  filters: ComparisonFilters,
  category: string,
  verdict: ComparisonVerdict,
): ComparisonFilters {
  return filters.category === category
    ? { ...filters, category: null }
    : { ...filters, category, verdict };
}

const isVerdict = (value: string | null): value is ComparisonVerdict =>
  VERDICTS.some((verdict) => verdict.key === value);

/** The filters a /datasets address names; anything unknown is left out. */
export function filtersFromSearch(search: string): ComparisonFilters {
  const params = new URLSearchParams(search);
  const verdict = params.get("verdict");
  const sort = params.get("sort") ?? "";
  const view = params.get("view") ?? "";
  const size = SIZE_BINS.findIndex(
    (_, index) => sizeBinLabel(index) === params.get("size"),
  );
  const family = params.get("contains");
  return {
    source: params.get("source"),
    verdict: isVerdict(verdict) ? verdict : null,
    category: params.get("category"),
    size: size >= 0 ? size : null,
    family:
      family && (FAMILIES as readonly string[]).includes(family)
        ? family
        : null,
    query: params.get("q") ?? "",
    sort: sort in SORTS ? (sort as ComparisonSort) : "id",
    view: view in VIEWS ? (view as ComparisonView) : "pair",
  };
}

/** The address of a set of filters, so a view can be shared. */
export function searchOfFilters(filters: ComparisonFilters): string {
  const params = new URLSearchParams();
  if (filters.source) params.set("source", filters.source);
  if (filters.verdict) params.set("verdict", filters.verdict);
  if (filters.category) params.set("category", filters.category);
  if (filters.size !== null) params.set("size", sizeBinLabel(filters.size));
  if (filters.family) params.set("contains", filters.family);
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.sort !== "id") params.set("sort", filters.sort);
  if (filters.view !== "pair") params.set("view", filters.view);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Share of a total as a whole percent. */
export function percent(part: number, whole: number): number {
  return whole ? Math.round((100 * part) / whole) : 0;
}

/** The address of one dataset circuit's original figure. */
export function comparisonFigureUrl(row: DatasetComparison): string {
  return `/api/gallery/sources/${encodeURIComponent(row.source)}/comparisons/${encodeURIComponent(row.id)}/figure?v=${encodeURIComponent(row.figureRevision)}`;
}

/** A link to one circuit on the page. */
export function comparisonLink(origin: string, row: DatasetComparison): string {
  return `${origin}/datasets?source=${encodeURIComponent(row.source)}&q=${encodeURIComponent(row.id)}`;
}
