/** Small read-only retry budget; user cancellation always wins. */
export async function requestGalleryScan(
  url: string,
  fetchLike: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let retryable = true;
    try {
      const timeout = AbortSignal.timeout(15_000);
      const response = await fetchLike(url, {
        credentials: "omit",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (response.ok) return await response.json();
      const error = new Error(`Could not read Gallery (${response.status})`);
      retryable = response.status === 429 || response.status >= 500;
      throw error;
    } catch (error) {
      signal?.throwIfAborted();
      if (!retryable || attempt >= 2) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        },
        250 * (attempt + 1),
      );
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}
