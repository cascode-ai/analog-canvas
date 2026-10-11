let pending: Promise<unknown> = Promise.resolve();

/** One native file dialog/write at a time, including background list refreshes. */
export function nativeProjectRequest(
  route: string,
  body?: unknown,
  recentId?: string,
): Promise<Record<string, unknown>> {
  const result = pending.then(async () => {
    const command = body as
      { id?: string; action?: string; version?: string } | undefined;
    const createsCopy =
      route === "copy-to-library" ||
      (route === "library-action" &&
        ["duplicate", "branch-version"].includes(command?.action ?? ""));
    const journalKey = createsCopy
      ? `icm.desktop.creation:${route}:${command?.id}:${command?.action}:${command?.version}`
      : null;
    let payload = body;
    if (journalKey) {
      const creationKey =
        localStorage.getItem(journalKey) ?? crypto.randomUUID();
      localStorage.setItem(journalKey, creationKey);
      payload = { ...command, creationKey };
    }
    const response = await fetch(`/desktop/project/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(recentId ? { "x-recent-project": recentId } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (!response.ok)
      throw new Error(`File operation failed (${response.status})`);
    const outcome = (await response.json()) as Record<string, unknown>;
    if (journalKey && outcome.status === "done")
      localStorage.removeItem(journalKey);
    return outcome;
  });
  pending = result.catch(() => {});
  return result;
}
