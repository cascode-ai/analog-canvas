/**
 * A fetch for the deploy's simulation checks that waits while the simulator
 * is busy with someone else's circuit (#1507). The hosted simulator runs one
 * circuit at a time and answers another request 502 `simulator-busy`. On
 * 2026-10-08 two deploys in a row met that, failed verification and rolled
 * back, and a rerun minutes later passed. Every other answer, any other
 * refusal included, returns at once, so a real fault still fails the deploy.
 */
export function waitingWhileBusy(
  fetchImpl = fetch,
  {
    patienceMs = 300_000,
    intervalMs = 15_000,
    attemptTimeoutMs = 120_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = (line) => console.log(line),
  } = {},
) {
  return async (input, init) => {
    const deadline = now() + patienceMs;
    let attempt = init;
    for (;;) {
      const response = await fetchImpl(input, attempt);
      if (response.status !== 502) return response;
      const refusal = await response
        .clone()
        .json()
        .catch(() => null);
      if (refusal?.reason !== "simulator-busy" || now() + intervalMs > deadline)
        return response;
      log(
        `The simulator is running another circuit; trying again in ${intervalMs / 1000} s.`,
      );
      await sleep(intervalMs);
      // The caller's time limit was for one attempt, not for the wait.
      attempt = { ...init, signal: AbortSignal.timeout(attemptTimeoutMs) };
    }
  };
}
