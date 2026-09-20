/** Native execution boundary. Routing only: source preparation, diagnostics and
 * numeric interpretation belong to the shared service and VACASK harness. */
import {
  CapabilitiesSchema,
  decodeHostedExecutionPayload,
  validateNativeExecutionInput,
  readExecutionReceipt,
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  boundExecutionStream,
  sha256,
} from "@icm/simulation-service";
import {
  SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
  SIMULATION_EXECUTOR_TRANSFER_HEADER,
  createSimulationInputMetadata,
  verifySimulationEnvironmentMetadata,
} from "@icm/spice-run";

export interface SimulationRunner {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface SimulationEnv {
  VACASK?: { getByName(name: string): SimulationRunner };
  SIMULATION_UPSTREAM_URL?: string;
  SIMULATION_UPSTREAM_TOKEN?: string;
  SIMULATION_DEFAULT_EXECUTOR?: string;
  /** Accepted deployment Profile. Measured identity/scope come from its runtime,
   * not another Worker-owned model path or analysis list. */
  SIMULATION_PROFILE_ID?: string;
}
export interface SimulationRequestBody {
  operation?: unknown;
  language?: unknown;
  mode?: unknown;
  environment?: {
    profileId?: unknown;
    corner?: unknown;
    temperatureC?: unknown;
  };
  files?: unknown;
  dependencies?: unknown;
  entryPath?: unknown;
  runToken?: unknown;
  preparedDeck?: unknown;
  collection?: unknown;
  netlist?: unknown;
  testbench?: unknown;
  timeoutMs?: unknown;
  inputRevision?: unknown;
  executorTarget?: unknown;
}
export type SimulationExecutorTarget = "cloudflare-container" | "operator-host";
const targetValid = (v: unknown): v is SimulationExecutorTarget =>
  v === "cloudflare-container" || v === "operator-host";
const tokenValid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f-]{36}$/u.test(v);
const unavailable = {
  configured: false,
  inputs: [],
  analyses: [],
  parsedAnalyses: [],
  profiles: [],
  maxTimeoutMs: 0,
  maxInputBytes: 0,
  cancel: false,
};
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, ...(headers ? { headers } : {}) });
async function boundedText(
  message: Request | Response,
  maximum: number,
): Promise<string> {
  const reader = message.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return text + decoder.decode();
      bytes += item.value.byteLength;
      if (bytes > maximum) throw new Error("transport-size-limit");
      text += decoder.decode(item.value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
const clip = (text: string) =>
  text.length > 400 ? text.slice(0, 400) + "…" : text;
async function refusal(
  response: Response,
): Promise<{ reason?: string; message?: string }> {
  let text: string;
  try {
    text = (await boundedText(response, 16384)).trim();
  } catch {
    return {
      message: "Executor refusal exceeded the readable response limit.",
    };
  }
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      (typeof v.error === "string" || typeof v.message === "string")
    )
      return {
        ...(typeof v.error === "string" ? { reason: clip(v.error) } : {}),
        ...(typeof v.message === "string" ? { message: clip(v.message) } : {}),
      };
  } catch {
    /* Plain proxy text is still useful diagnostic evidence. */
  }
  return { message: clip(text) };
}
function selectRunner(
  env: SimulationEnv,
  target: SimulationExecutorTarget,
  key: string,
): SimulationRunner | null {
  if (target === "cloudflare-container")
    return env.VACASK?.getByName(key) ?? null;
  if (!env.SIMULATION_UPSTREAM_URL?.trim()) return null;
  const base = new URL(env.SIMULATION_UPSTREAM_URL);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("Invalid operator HTTPS origin");
  return {
    fetch: (path, init) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (
        new Headers(init?.headers).get(SIMULATION_EXECUTOR_TRANSFER_HEADER) ===
        "receipt-v1"
      )
        headers.set(SIMULATION_EXECUTOR_TRANSFER_HEADER, "receipt-v1");
      if (env.SIMULATION_UPSTREAM_TOKEN)
        headers.set("authorization", `Bearer ${env.SIMULATION_UPSTREAM_TOKEN}`);
      return fetch(new URL(new URL(path).pathname, base), {
        ...init,
        headers,
        // Workers supports manual/follow, not the browser's "error" mode.
        // Every caller rejects non-2xx replies, so credentials never follow a redirect.
        redirect: "manual",
      });
    },
  };
}
export async function routeVacaskSimulationRequest(
  request: Request,
  env: SimulationEnv,
  runnerKey?: string,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/simulate") return null;
  if (request.method !== "POST")
    return json({ error: "method-not-allowed" }, 405);
  let value: unknown;
  try {
    value = JSON.parse(await boundedText(request, MAX_BODY_BYTES));
  } catch (error) {
    const large =
      error instanceof Error && error.message === "transport-size-limit";
    return json(
      { error: large ? "request-too-large" : "invalid-json" },
      large ? 413 : 400,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return json({ error: "invalid-request" }, 400);
  const body = value as SimulationRequestBody;
  if (body.executorTarget !== undefined && !targetValid(body.executorTarget))
    return json({ error: "invalid-executor-target" }, 400);
  const configuredTarget = env.SIMULATION_DEFAULT_EXECUTOR?.trim();
  if (configuredTarget && !targetValid(configuredTarget))
    return json({ error: "simulation-executor-configuration-invalid" }, 503);
  const target = (body.executorTarget ??
    configuredTarget ??
    (env.SIMULATION_UPSTREAM_URL?.trim()
      ? "operator-host"
      : "cloudflare-container")) as SimulationExecutorTarget;
  const profileId = env.SIMULATION_PROFILE_ID?.trim();
  let runner: SimulationRunner | null;
  try {
    runner = selectRunner(
      env,
      target,
      runnerKey ?? `profile:${profileId ?? "unconfigured"}`,
    );
  } catch {
    return json({ error: "simulation-executor-configuration-invalid" }, 503);
  }
  if (
    body.operation !== undefined &&
    body.operation !== "capabilities" &&
    body.operation !== "cancel"
  )
    return json({ error: "invalid-operation" }, 400);
  if (body.runToken !== undefined && !tokenValid(body.runToken))
    return json({ error: "invalid-run-token" }, 400);
  if (!runner || !profileId) {
    if (body.operation === "capabilities") return json(unavailable);
    return json(
      {
        error: !runner
          ? !env.VACASK && !env.SIMULATION_UPSTREAM_URL?.trim()
            ? "simulation-not-configured"
            : "simulation-executor-unavailable"
          : "simulation-executor-configuration-invalid",
        execution: { target },
        message: "Select a configured native executor and accepted Profile.",
      },
      503,
    );
  }
  const execution = { target };
  if (body.operation === "cancel") {
    if (!tokenValid(body.runToken))
      return json({ error: "invalid-run-token" }, 400);
    // Cancellation cannot depend on a ready/idle health response.
    try {
      const r = await runner.fetch("http://container/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runToken: body.runToken }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok)
        return json({ error: "cancel-refused", ...(await refusal(r)) }, 502);
      const accepted = JSON.parse(await boundedText(r, 16384));
      return accepted?.accepted === true
        ? json({ accepted: true })
        : json({ error: "cancel-response-unknown" }, 502);
    } catch {
      return json({ error: "cancel-response-unknown" }, 502);
    }
  }
  let health: Record<string, unknown>;
  try {
    const r = await runner.fetch("http://container/health", {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 || r.status === 403)
      return json(
        {
          error: "simulator-unauthorized",
          execution,
          message: "The simulator refused this deployment's credentials.",
        },
        502,
      );
    if (!r.ok)
      return body.operation === "capabilities"
        ? json(unavailable)
        : json(
            { error: "simulator-not-ready", execution, ...(await refusal(r)) },
            503,
          );
    health = JSON.parse(await boundedText(r, 131072));
  } catch (error) {
    return body.operation === "capabilities"
      ? json(unavailable)
      : json(
          {
            error: "simulation-executor-unavailable",
            execution,
            message: clip(
              String(error).replaceAll(
                env.SIMULATION_UPSTREAM_TOKEN || "\u0000",
                "[redacted]",
              ),
            ),
          },
          503,
        );
  }
  const environment = await verifySimulationEnvironmentMetadata(
    health?.environment,
  );
  const capability = CapabilitiesSchema.safeParse(health?.capabilities);
  if (
    !environment ||
    environment.simulator.name !== "vacask" ||
    environment.executor !== "hosted-container" ||
    environment.reproducibility !== "pinned" ||
    !environment.simulator.binarySha256 ||
    environment.profileId !== profileId ||
    !capability.success ||
    !capability.data.configured ||
    capability.data.rawfileCollection !== "native-multi-ascii" ||
    capability.data.inputs.length !== 1 ||
    capability.data.inputs[0] !== "source" ||
    capability.data.profiles.length !== 1 ||
    capability.data.profiles[0]?.id !== profileId ||
    capability.data.modelLibrary !== undefined ||
    !Number.isSafeInteger(capability.data.maxTimeoutMs) ||
    capability.data.maxTimeoutMs <= 0 ||
    capability.data.maxTimeoutMs > 120000 ||
    !Number.isSafeInteger(capability.data.maxInputBytes) ||
    capability.data.maxInputBytes <= 0 ||
    capability.data.maxInputBytes > 2 * 1024 * 1024 ||
    !capability.data.maxInputFiles ||
    !capability.data.maxOutputBytes
  )
    return body.operation === "capabilities"
      ? json(unavailable)
      : json(
          {
            error: "simulation-environment-invalid",
            execution,
            message:
              "Native identity/capabilities differ from the accepted deployment Profile.",
          },
          503,
        );
  const caps = capability.data;
  if (body.operation === "capabilities") return json(caps);
  const profile = caps.profiles[0]!;
  if (
    body.environment?.corner !== undefined &&
    !profile.corners.includes(String(body.environment.corner))
  )
    return json({ error: "simulation-profile-unavailable" }, 400);
  const checked = validateNativeExecutionInput(body, {
    profileId,
    dependencies: profile.dependencies ?? [],
    maxInputFiles: caps.maxInputFiles!,
    maxInputBytes: caps.maxInputBytes,
  });
  if (!checked.ok)
    return json(
      {
        error: checked.error.code,
        message: checked.error.message,
        recovery: checked.error.recovery,
      },
      checked.error.recovery === "reprepare"
        ? 409
        : checked.error.code === "input-too-large"
          ? 413
          : 400,
    );
  const input = checked.input;
  const timeoutMs =
    typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs)
      ? Math.min(caps.maxTimeoutMs, Math.max(1, Math.trunc(body.timeoutMs)))
      : Math.min(60000, caps.maxTimeoutMs);
  let response: Response;
  try {
    response = await runner.fetch("http://container/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIMULATION_EXECUTOR_TRANSFER_HEADER]: "receipt-v1",
      },
      body: JSON.stringify({
        ...input,
        timeoutMs,
        execution,
        ...(body.runToken ? { runToken: body.runToken } : {}),
      }),
      signal: AbortSignal.timeout(150000),
    });
  } catch {
    return json(
      {
        error: "simulator-unreachable",
        execution,
        message:
          "Execution outcome is unknown; do not automatically start another run.",
      },
      502,
    );
  }
  if (response.status === 401 || response.status === 403)
    return json(
      {
        error: "simulator-unauthorized",
        execution,
        message: "The simulator refused this deployment's credentials.",
      },
      502,
    );
  if (!response.ok)
    return json(
      {
        error: "simulator-refused",
        execution,
        status: response.status,
        ...(await refusal(response)),
      },
      502,
      response.headers.has("retry-after")
        ? { "retry-after": response.headers.get("retry-after")! }
        : undefined,
    );
  try {
    const receipt = readExecutionReceipt(
      response.headers.get(EXECUTION_RECEIPT_HEADER),
    );
    if (receipt) {
      const actual = await verifySimulationEnvironmentMetadata(
        receipt.metadata.environment,
      );
      const expected = await createSimulationInputMetadata({
        inputRevision: input.inputRevision,
        netlist: "",
        testbench: input.testbench,
        deck: input.preparedDeck!,
      });
      if (
        !response.body ||
        receipt.runToken !== body.runToken ||
        receipt.execution?.target !== target ||
        !actual ||
        actual.fingerprint !== environment.fingerprint ||
        Object.entries(expected).some(
          ([key, field]) =>
            receipt.metadata.input[key as keyof typeof expected] !== field,
        ) ||
        (receipt.executedFilesSha256 !==
          (await sha256(JSON.stringify(input.files))) &&
          receipt.executedFilesSha256 !== (await sha256("[]")))
      )
        throw new Error("Changed streaming input/runtime evidence");
      return new Response(
        boundExecutionStream(response.body, receipt.byteLength),
        {
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            [EXECUTION_RECEIPT_HEADER]: encodeExecutionReceipt(receipt),
          },
        },
      );
    }
    const output = decodeHostedExecutionPayload(
      input,
      JSON.parse(
        await boundedText(response, SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES),
      ),
    );
    const actual = await verifySimulationEnvironmentMetadata(
      output.result.metadata.environment,
    );
    const expected = await createSimulationInputMetadata({
      inputRevision: input.inputRevision,
      netlist: "",
      testbench: input.testbench,
      deck: input.preparedDeck!,
    });
    if (
      !actual ||
      actual.fingerprint !== environment.fingerprint ||
      Object.entries(expected).some(
        ([key, field]) =>
          output.result.metadata.input[key as keyof typeof expected] !== field,
      ) ||
      (output.executedFiles!.length > 0 &&
        (output.executedFiles!.length !== input.files.length ||
          output.executedFiles!.some(
            (file) =>
              !input.files.some(
                (f) => f.path === file.path && f.text === file.text,
              ),
          )))
    )
      throw new Error("Changed input/runtime evidence");
    return json({
      ...output.result,
      execution,
      rawfiles: output.rawfiles,
      executedFiles: output.executedFiles,
      collectionStatus: output.collectionStatus,
      cancelled: output.cancelled,
    });
  } catch {
    await response.body?.cancel().catch(() => {});
    return json(
      {
        error: "simulator-protocol-invalid",
        execution,
        message:
          "Native result evidence is invalid or mismatched; the run was not retried.",
      },
      502,
    );
  }
}
