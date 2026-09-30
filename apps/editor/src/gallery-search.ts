/**
 * The one Gallery search rule, shared by the Gallery server, which answers a
 * search over every public circuit, and the browser, which narrows what has
 * already loaded while the answer is on its way. Metadata only: a circuit's
 * name, byline, description and tags, never its Project Code.
 */

/** What a search reads of one circuit. */
export interface GallerySearchableEntry {
  name: string;
  author: string;
  description?: string | null;
  tags?: readonly string[] | null;
}

export function normalizeGallerySearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One insertion, deletion, replacement, or adjacent transposition. */
function galleryTokensWithinOneEdit(left: string, right: string): boolean {
  const lengthDifference = left.length - right.length;
  if (Math.abs(lengthDifference) > 1) return false;
  if (left === right) return true;
  if (lengthDifference === 0) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index++) {
      if (left[index] === right[index]) continue;
      mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    const [first, second] = mismatches;
    return (
      second === first! + 1 &&
      left[first!] === right[second!] &&
      left[second!] === right[first!]
    );
  }
  const shorter = lengthDifference < 0 ? left : right;
  const longer = lengthDifference < 0 ? right : left;
  let shorterIndex = 0;
  let longerIndex = 0;
  let skipped = false;
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex++;
      longerIndex++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longerIndex++;
  }
  return true;
}

function gallerySearchTokenMatches(query: string, candidate: string): boolean {
  if (candidate.includes(query)) return true;
  // Keep short circuit acronyms precise: fuzzy matching OTA against every
  // three-letter neighbour creates more noise than it removes.
  if (query.length < 4 || candidate.length < 4) return false;
  if (!/^[a-z0-9]+$/u.test(query) || !/^[a-z0-9]+$/u.test(candidate)) {
    return false;
  }
  return galleryTokensWithinOneEdit(query, candidate);
}

/**
 * Whether one entry answers a search over its name, author, description and
 * tags. Exact case-insensitive containment wins first; otherwise every query
 * word may tolerate one small Latin-letter typo.
 */
export function galleryEntryMatchesQuery(
  entry: GallerySearchableEntry,
  query: string,
): boolean {
  const normalizedQuery = normalizeGallerySearchText(query);
  if (!normalizedQuery) return true;
  const fields = [
    entry.name,
    entry.author,
    entry.description,
    ...(entry.tags ?? []),
  ]
    .filter((field): field is string => Boolean(field))
    .map(normalizeGallerySearchText)
    .filter(Boolean);
  if (fields.some((field) => field.includes(normalizedQuery))) return true;
  const candidates = fields.flatMap((field) => field.split(" "));
  return normalizedQuery
    .split(" ")
    .every((token) =>
      candidates.some((candidate) =>
        gallerySearchTokenMatches(token, candidate),
      ),
    );
}
