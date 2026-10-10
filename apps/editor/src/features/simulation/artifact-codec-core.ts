import type { ArtifactRef } from "@icm/simulation-service/contract";
import { MAX_ARTIFACT_BYTES, sha256 } from "@icm/simulation-service/files";

export type EncodedArtifact = {
  body: Blob;
  encoding?: "gzip";
  storedBytes: number;
};
export type CodecRequest =
  | { action: "encode"; text: string; mediaType: string; compression: boolean }
  | {
      action: "decode";
      body: Blob;
      encoding: string | undefined;
      ref: ArtifactRef;
    }
  | { action: "digest"; text: string };

async function originalText(body: Blob) {
  try {
    // Blob.text() removes a UTF-8 BOM. Keep it as original file content so
    // reopened evidence and its public digest still describe the same bytes.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await body.arrayBuffer(),
    );
  } catch {
    throw new Error("ARTIFACT_CODEC_INTEGRITY");
  }
}

async function verifiedText(body: Blob, ref: ArtifactRef) {
  const text = await originalText(body);
  if ((await sha256(text)) !== ref.sha256)
    throw new Error("ARTIFACT_CODEC_INTEGRITY");
  return text;
}

/** Private lossless representation; public length and digest always describe UTF-8. */
export async function artifactCodec(
  request: CodecRequest,
): Promise<EncodedArtifact | string> {
  if (request.action === "digest") return sha256(request.text);
  if (request.action === "encode") {
    const body = new Blob([request.text], { type: request.mediaType });
    if (body.size > MAX_ARTIFACT_BYTES) throw new Error("ARTIFACT_CAPACITY");
    if (
      request.compression &&
      body.size >= 64 * 1024 &&
      typeof CompressionStream !== "undefined"
    ) {
      try {
        const compressed = await new Response(
          body.stream().pipeThrough(new CompressionStream("gzip")),
        ).blob();
        if (compressed.size < body.size * 0.9)
          return {
            body: compressed,
            encoding: "gzip",
            storedBytes: compressed.size,
          };
      } catch {
        /* A writer failure may safely retain the exact identity bytes. */
      }
    }
    return { body, storedBytes: body.size };
  }
  if (
    request.encoding !== undefined &&
    request.encoding !== "identity" &&
    request.encoding !== "gzip"
  )
    throw new Error("ARTIFACT_CODEC_UNSUPPORTED");
  if (request.ref.byteLength > MAX_ARTIFACT_BYTES)
    throw new Error("ARTIFACT_CODEC_LIMIT");
  if (request.encoding !== "gzip") {
    if (request.body.size !== request.ref.byteLength)
      throw new Error("ARTIFACT_CODEC_INTEGRITY");
    return verifiedText(request.body, request.ref);
  }
  const reader = request.body
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > request.ref.byteLength)
        throw new Error("ARTIFACT_CODEC_LIMIT");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (bytes !== request.ref.byteLength)
    throw new Error("ARTIFACT_CODEC_INTEGRITY");
  const body = new Blob(chunks);
  return verifiedText(body, request.ref);
}
