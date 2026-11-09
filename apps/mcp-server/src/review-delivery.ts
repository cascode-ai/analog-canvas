import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  AGENT_API_VERSION,
  matchesAgentReviewTarget,
  type AgentFileResourceRequest,
  type LocalReviewDeliveryArgsSchema,
} from "@icm/agent-adapter";
import type { AgentSessionClient } from "@icm/agent-client";
import type { z } from "zod";
import { requestFailure, sha256 } from "./local-source.js";

export async function reviewDelivery(
  client: AgentSessionClient,
  options: z.infer<typeof LocalReviewDeliveryArgsSchema>,
) {
  const request = async (
    input: Extract<AgentFileResourceRequest, { operation: "review" }>["input"],
  ) => {
    const response = await client.fileResource({
      apiVersion: AGENT_API_VERSION,
      requestId: `review-${randomUUID()}`,
      operation: "review",
      input,
    });
    if (
      !response.ok ||
      response.operation !== "review" ||
      response.result.action !== input.action
    )
      throw requestFailure(
        response.ok ? "REVIEW_LOAD_UNCONFIRMED" : response.error.code,
        response.ok
          ? "Canvas did not confirm the requested review action"
          : response.error.message,
      );
    return response.result;
  };
  if (options.action !== "save") {
    const result = await request(options);
    if (!("delivery" in result) || result.action === "prepare-save")
      throw requestFailure(
        "REVIEW_LOAD_UNCONFIRMED",
        "Review delivery was not confirmed",
      );
    if (result.action === "open-original") {
      const { workspaceId, projectId } = result.delivery.target;
      const bound = await client.bindWorkspace(workspaceId, projectId);
      if (bound.workspaceId !== workspaceId || bound.projectId !== projectId)
        throw requestFailure(
          "REVIEW_LOAD_UNCONFIRMED",
          "The original could not be bound to the task",
        );
    }
    return { ok: true, ...result };
  }
  const outputPath = resolve(options.outputPath);
  if (!/\.icproj\.json$/iu.test(outputPath))
    throw requestFailure(
      "REVIEW_SAVE_PATH_INVALID",
      "Choose a new .icproj.json output path",
    );
  const prepared = await request({
    action: "prepare-save",
    expected: options.expected,
    projectRevision: options.projectRevision,
  });
  if (
    prepared.action !== "prepare-save" ||
    !matchesAgentReviewTarget(prepared.delivery.target, options.expected) ||
    prepared.delivery.projectRevision !== options.projectRevision
  )
    throw requestFailure(
      "REVIEW_TARGET_CHANGED",
      "Canvas did not confirm the Project revision to save",
    );
  const bytes = Buffer.from(prepared.artifact.data, "base64");
  if (
    bytes.length !== prepared.artifact.byteLength ||
    sha256(bytes) !== prepared.artifact.sha256
  )
    throw requestFailure(
      "FILE_INTEGRITY_FAILED",
      "Saved Project bytes did not match Canvas's receipt",
    );
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = await mkdtemp(join(dirname(outputPath), ".canvas-review-"));
  try {
    const staged = join(temporary, "project.icproj.json");
    await writeFile(staged, bytes, { mode: 0o600, flag: "wx" });
    await copyFile(staged, outputPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw requestFailure(
        "REVIEW_SAVE_PATH_EXISTS",
        "Choose a new output path for this Project",
      );
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
  const acknowledgement = await request({
    action: "finish-save",
    saveId: prepared.saveId,
  }).catch(() => null);
  return {
    ok: true,
    action: "save",
    outputPath,
    sha256: prepared.artifact.sha256,
    byteLength: bytes.length,
    savedProjectRevision: prepared.delivery.projectRevision,
    savedTarget: prepared.delivery.target,
    canvasSaved:
      acknowledgement?.action === "finish-save" && acknowledgement.canvasSaved,
  };
}
