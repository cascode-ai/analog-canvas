import type { SqlStorage } from "./gallery-store";
import type { GalleryWallStatistics } from "./gallery-store-wall";

/** One DO's dataset statistics; restart/restore discards the entire cache. */
export class GalleryWallStatisticsCache {
  private revision: number | undefined;
  private characters = 0;
  private readonly values = new Map<
    string,
    { statistics: GalleryWallStatistics; characters: number }
  >();

  read(
    sql: SqlStorage,
    key: string,
    calculate: () => GalleryWallStatistics,
  ): GalleryWallStatistics {
    // The transaction-owned revision includes imports, maintenance and likes.
    const revision = sql
      .exec<{ revision: number }>(
        "SELECT revision FROM backup_revisions WHERE scope = 'gallery'",
      )
      .one().revision;
    if (this.revision !== revision) {
      this.values.clear();
      this.characters = 0;
      this.revision = revision;
    }
    const known = this.values.get(key);
    if (known) {
      this.values.delete(key);
      this.values.set(key, known);
      return known.statistics;
    }
    const statistics = calculate();
    const characters = key.length + JSON.stringify(statistics).length;
    // Bound both arbitrary filter combinations and unusually large aggregates.
    const budget = 1_048_576;
    if (characters > budget) return statistics;
    while (this.values.size >= 128 || this.characters + characters > budget) {
      const oldest = this.values.keys().next().value!;
      this.characters -= this.values.get(oldest)!.characters;
      this.values.delete(oldest);
    }
    this.values.set(key, { statistics, characters });
    this.characters += characters;
    return statistics;
  }
}
