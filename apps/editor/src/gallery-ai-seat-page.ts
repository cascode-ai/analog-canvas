/** AI seat history is newest first, with id breaking creation-time ties. */
export interface AiSeatPosition {
  createdAt: string;
  id: string;
}

export function aiSeatCursor(entry: AiSeatPosition, status?: string): string {
  return [`ai-seats:${status ?? "all"}`, entry.createdAt, entry.id].join("|");
}

export function readAiSeatCursor(
  cursor: string,
  status?: string,
): AiSeatPosition | { offset: number } | null {
  // Prior Agents issued decimal offsets. Resume once, then emit a keyset cursor.
  if (/^\d+$/.test(cursor) && Number.isSafeInteger(Number(cursor)))
    return { offset: Number(cursor) };
  const parts = cursor.split("|");
  const [scope, createdAt, id] = parts;
  return parts.length === 3 &&
    scope === `ai-seats:${status ?? "all"}` &&
    createdAt &&
    createdAt.length <= 64 &&
    id &&
    id.length <= 128
    ? { createdAt, id }
    : null;
}
