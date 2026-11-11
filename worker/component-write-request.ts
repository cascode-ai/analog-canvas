import {
  COMPONENT_DEFINITION_MAX_BYTES,
  parseSharedComponentPayload,
} from "../apps/editor/src/features/user-components/component-library-contract";

/** The same payload checks for local writes and delegated writer commands. */
export async function readComponentWrite(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (
    new TextEncoder().encode(text).length >
    COMPONENT_DEFINITION_MAX_BYTES + 1024
  )
    return Response.json(
      { error: "Component definition is too large" },
      { status: 413 },
    );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
    if (
      !body ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0
    )
      throw new Error("Expected a component revision");
    if (request.method === "PUT") {
      if (
        body.idempotencyKey !== undefined &&
        (typeof body.idempotencyKey !== "string" ||
          !/^[a-zA-Z0-9_-]{1,128}$/u.test(body.idempotencyKey))
      )
        throw Error(
          "Use an idempotency key of 1–128 letters, digits, underscores or hyphens",
        );
      const parsed = parseSharedComponentPayload({
        definition: body.definition,
        ...(body.circuit === undefined ? {} : { circuit: body.circuit }),
      });
      body.definition = parsed.definition;
      body.circuit = parsed.circuit;
    } else if (
      body.action !== "delete" &&
      body.action !== "restore" &&
      !["shared", "official", "deleted"].includes(String(body.status))
    )
      throw new Error("Invalid component status");
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid component definition",
      },
      { status: 400 },
    );
  }
  return body;
}
