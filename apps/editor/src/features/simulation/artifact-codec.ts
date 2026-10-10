import {
  artifactCodec,
  type CodecRequest,
  type EncodedArtifact,
} from "./artifact-codec-core";

// One bounded codec job per window. A Run's generator releases each text before
// producing the next format; worker lifetime ends on success, failure or timeout.
let jobs: Promise<unknown> = Promise.resolve();
export function runArtifactCodec(
  request: CodecRequest,
): Promise<EncodedArtifact | string> {
  const result = jobs.then(async () => {
    // Starting a Worker for each small manifest/log costs more than its work
    // and stalls ordinary runs. Three UTF-8 bytes per UTF-16 unit bounds this
    // inline path to 64 KiB; larger serialization stays off the UI thread.
    const small =
      request.action === "decode"
        ? request.encoding !== "gzip" && request.ref.byteLength <= 64 * 1024
        : request.text.length <= Math.floor((64 * 1024) / 3);
    if (small || typeof Worker === "undefined") return artifactCodec(request);
    let worker: Worker | undefined;
    try {
      worker = new Worker(
        new URL("./artifact-codec.worker.ts", import.meta.url),
        { type: "module" },
      );
      const current = worker;
      return await new Promise<EncodedArtifact | string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("ARTIFACT_CODEC_TIMEOUT")),
          120_000,
        );
        current.onmessage = (
          event: MessageEvent<{
            ok: boolean;
            value: EncodedArtifact | string;
            error: string;
          }>,
        ) => {
          clearTimeout(timeout);
          if (event.data.ok) resolve(event.data.value);
          else reject(new Error(event.data.error));
        };
        current.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("ARTIFACT_CODEC_UNAVAILABLE"));
        };
        try {
          current.postMessage(request);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    } catch (error) {
      if (
        request.action === "encode" ||
        !worker ||
        (error instanceof Error &&
          error.message === "ARTIFACT_CODEC_UNAVAILABLE")
      ) {
        worker?.terminate();
        worker = undefined;
        return artifactCodec(
          request.action === "encode"
            ? { ...request, compression: false }
            : request,
        );
      }
      throw error;
    } finally {
      worker?.terminate();
    }
  });
  jobs = result.then(
    () => {},
    () => {},
  );
  return result;
}
