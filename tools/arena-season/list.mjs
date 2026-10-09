// The Owner's inputs to a Season build (#1560): the list of chosen Gallery
// circuits and, when it exists, #1524's private test split. Both are read,
// never written: the tool reports what it finds and the Owner edits them.

/**
 * The Owner's list: one Gallery id per line, in the Season's order. Two
 * optional tab-separated columns give the circuit name and the function
 * class, overriding the entry's own name. Blank lines and lines starting
 * with `#` are skipped, and so is a first row whose id column reads `id`
 * (a spreadsheet's header).
 *
 * @param {string} text
 * @returns {{ line: number, id: string, name?: string, functionClass?: string }[]}
 */
export function parseOwnerList(text) {
  const rows = [];
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const [id = "", name = "", functionClass = ""] = raw
      .split("\t")
      .map((column) => column.trim());
    if (!rows.length && id.toLowerCase() === "id") continue;
    rows.push({
      line: index + 1,
      id,
      ...(name ? { name } : {}),
      ...(functionClass ? { functionClass } : {}),
    });
  }
  return rows;
}

/**
 * The Gallery ids and graph hashes #1524's private test split holds. Its
 * format is not settled yet, so this reads what it plausibly will be: JSON
 * (the exclusion record this tool writes, or an array of ids, hashes or
 * objects with `id`, `gallery`, `galleryId` or `graphHash`), or text with
 * one id or hash first on each line.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseSplit(text) {
  const tokens = new Set();
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    const items = Array.isArray(data)
      ? data
      : (data.entries ?? data.items ?? data.tasks ?? []);
    for (const item of items) {
      if (typeof item === "string") tokens.add(item);
      else if (item && typeof item === "object")
        for (const key of ["id", "gallery", "galleryId", "graphHash"])
          if (typeof item[key] === "string") tokens.add(item[key]);
    }
    return tokens;
  }
  for (const line of text.split(/\r?\n/u)) {
    const first = line.trim().split(/[\s,]+/u)[0];
    if (first && !first.startsWith("#")) tokens.add(first);
  }
  return tokens;
}
