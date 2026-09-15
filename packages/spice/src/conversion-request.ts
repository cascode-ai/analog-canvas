import {
  convertNetlist,
  isNetlistDialect,
  MAX_CONVERSION_BYTES,
} from "./conversion.js";

/** Shared stateless endpoint; request text is never stored, fetched or executed. */
export async function handleNetlistConversionRequest(
  request: Request,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/netlist/convert") return null;
  const respond = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  if (request.method !== "POST")
    return respond({ error: "Use POST with text, source and target." }, 405);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return respond({ error: "Content-Type must be application/json." }, 415);
  // JSON escaping can expand an otherwise valid text; the wire body is bounded too.
  const maxBody = MAX_CONVERSION_BYTES * 2;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maxBody) {
          await reader.cancel();
          return respond({ error: "Request exceeds 1 MiB." }, 413);
        }
        chunks.push(chunk.value);
      }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!body || typeof body !== "object")
      return respond({ error: "Expected a JSON object." }, 400);
    const input = body as Record<string, unknown>;
    if (
      typeof input.text !== "string" ||
      !isNetlistDialect(input.source) ||
      !isNetlistDialect(input.target) ||
      (input.fragment !== undefined && typeof input.fragment !== "boolean")
    )
      return respond(
        {
          error:
            "Supply text, source/target (spice, ngspice or spectre), and optional boolean fragment.",
        },
        400,
      );
    const result = convertNetlist({
      text: input.text,
      source: input.source,
      target: input.target,
      ...(typeof input.fragment === "boolean"
        ? { fragment: input.fragment }
        : {}),
    });
    return respond(
      result,
      result.status === "converted"
        ? 200
        : result.issues.some((i) => i.code === "RESOURCE_LIMIT")
          ? 413
          : 422,
    );
  } catch {
    return respond({ error: "Invalid UTF-8 JSON request." }, 400);
  } finally {
    reader?.releaseLock();
  }
}
