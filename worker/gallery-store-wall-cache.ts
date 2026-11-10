import type { SqlStorage } from "./gallery-store";

/** The Gallery's backup revision: imports, maintenance and likes move it. */
function galleryRevision(sql: SqlStorage): number {
  return sql
    .exec<{ revision: number }>(
      "SELECT revision FROM backup_revisions WHERE scope = 'gallery'",
    )
    .one().revision;
}

/**
 * One DO's answers worked out from its Gallery rows, each kept until the
 * revision they follow moves (by default the Gallery's, which every write
 * moves); restart/restore discards the entire cache.
 */
export class GalleryRevisionCache<T> {
  private revision: number | undefined;
  private characters = 0;
  private readonly values = new Map<string, { value: T; characters: number }>();

  constructor(
    private readonly revisionOf: (sql: SqlStorage) => number = galleryRevision,
  ) {}

  read(sql: SqlStorage, key: string, calculate: () => T): T {
    // A transaction-owned revision: a rolled-back write leaves it alone.
    const revision = this.revisionOf(sql);
    if (this.revision !== revision) {
      this.values.clear();
      this.characters = 0;
      this.revision = revision;
    }
    const known = this.values.get(key);
    if (known) {
      this.values.delete(key);
      this.values.set(key, known);
      return known.value;
    }
    const value = calculate();
    const characters = key.length + JSON.stringify(value).length;
    // Bound both arbitrary filter combinations and unusually large aggregates.
    const budget = 1_048_576;
    if (characters > budget) return value;
    while (this.values.size >= 128 || this.characters + characters > budget) {
      const oldest = this.values.keys().next().value!;
      this.characters -= this.values.get(oldest)!.characters;
      this.values.delete(oldest);
    }
    this.values.set(key, { value, characters });
    this.characters += characters;
    return value;
  }
}
