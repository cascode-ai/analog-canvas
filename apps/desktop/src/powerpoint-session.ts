import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { join } from "node:path";

// Both processes use exclusive creation, not a check followed by a write.
// Never steal a stale lock: an interrupted apply has an unknown outcome.
async function withExchange<T>(directory: string, action: () => Promise<T>) {
  const path = join(directory, "exchange.lock");
  const lock = await open(path, "wx").catch(() => {
    throw new Error(
      "PowerPoint is processing an update or its outcome is unknown. Keep the editor open and retry.",
    );
  });
  try {
    return await action();
  } finally {
    await lock.close();
    await unlink(path);
  }
}

async function readOptional(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(join(directory, name), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** File exchange is scoped to the directory supplied by the local PPT launcher. */
export function createPowerPointSession(directory: string | undefined) {
  let sequence = 0;
  const context = directory
    ? (async () => {
        const config = JSON.parse(
          await readFile(join(directory, "session.json"), "utf8"),
        ) as {
          token: string;
          documentId?: string;
          cancellationProtocol?: number;
        };
        const project = JSON.parse(
          await readFile(join(directory, "drawing.icproj"), "utf8"),
        ) as { id: string };
        try {
          sequence = JSON.parse(
            await readFile(join(directory, "result.json"), "utf8"),
          ).sequence;
        } catch {
          /* first launch */
        }
        return { ...config, projectId: project.id };
      })()
    : null;
  let busy = false;
  const handle = async (request: Request): Promise<Response> => {
    if (!directory) return Response.json({ enabled: false });
    const config = (await context)!;
    if (request.method === "GET") {
      let ack: unknown = null;
      try {
        ack = JSON.parse(await readFile(join(directory, "ack.json"), "utf8"));
      } catch {
        /* not committed yet */
      }
      return Response.json({ enabled: true, ...config, ack });
    }
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (busy) return new Response("Save already running", { status: 409 });
    busy = true;
    try {
      const text = await request.text();
      if (text.length > 32 * 1024 * 1024)
        throw new Error("Circuit is too large");
      const value = JSON.parse(text) as {
        token: string;
        project: string;
        svg: string;
        documentId: string;
      };
      if (value.token !== config.token)
        return new Response("Wrong session", { status: 403 });
      if (
        typeof value.project !== "string" ||
        typeof value.svg !== "string" ||
        !value.svg.includes("<svg")
      )
        throw new Error("Missing project or SVG");
      const project = JSON.parse(value.project) as {
        id: string;
        documents: { id: string }[];
      };
      if (project.id !== config.projectId)
        throw new Error(
          "This is not the linked PowerPoint project. Return to its project tab.",
        );
      if (!project.documents.some((d) => d.id === value.documentId))
        throw new Error("Unknown Cell");
      return await withExchange(directory, async () => {
        if (
          (await readOptional(directory, "cancel.json"))?.token === config.token
        )
          return Response.json(
            {
              error:
                "This PowerPoint session was closed without updating. Reopen the drawing from PowerPoint to save again.",
            },
            { status: 410 },
          );
        const result = {
          protocol: 1,
          token: config.token,
          sequence: ++sequence,
          project: value.project,
          svg: value.svg,
          documentId: value.documentId,
        };
        // Keep every explicit commit locally. PPT embeds the current and three previous snapshots.
        await writeFile(
          join(directory, `revision-${sequence}.json`),
          JSON.stringify(result),
          { encoding: "utf8", flag: "wx" },
        );
        await writeFile(
          join(directory, "result.tmp"),
          JSON.stringify(result),
          "utf8",
        );
        await rename(
          join(directory, "result.tmp"),
          join(directory, "result.json"),
        );
        return Response.json({ sequence });
      });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 });
    } finally {
      busy = false;
    }
  };
  const cancel = async (): Promise<{
    status: "cancelled" | "already-applied" | "failed";
    message?: string;
  }> => {
    if (!directory) return { status: "cancelled" };
    const config = (await context)!;
    if (busy)
      return {
        status: "failed",
        message: "A save is still running. Keep the editor open and retry.",
      };
    busy = true;
    try {
      if (config.cancellationProtocol !== 1)
        throw new Error(
          "This PowerPoint add-in does not support cancelling pending saves. Update the add-in before discarding this session.",
        );
      return await withExchange(directory, async () => {
        const ack = await readOptional(directory, "ack.json");
        await writeFile(
          join(directory, "cancel.tmp"),
          JSON.stringify({ token: config.token, throughSequence: sequence }),
          "utf8",
        );
        await rename(
          join(directory, "cancel.tmp"),
          join(directory, "cancel.json"),
        );
        return {
          status:
            ack?.sequence === sequence && ack?.ok === true
              ? "already-applied"
              : "cancelled",
        };
      });
    } catch (error) {
      return { status: "failed", message: String(error) };
    } finally {
      busy = false;
    }
  };
  return { handle, cancel };
}
