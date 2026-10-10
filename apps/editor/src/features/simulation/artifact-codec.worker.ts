import { artifactCodec, type CodecRequest } from "./artifact-codec-core";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<CodecRequest>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = (event) => {
  void artifactCodec(event.data).then(
    (value) => scope.postMessage({ ok: true, value }),
    (error: unknown) =>
      scope.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "ARTIFACT_CODEC_FAILED",
      }),
  );
};
