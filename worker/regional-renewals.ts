export type RenewalResult = "confirmed" | "denied" | "unavailable";
export type RenewalUse = "alarm" | "wake" | "action";
type Check = {
  started: boolean;
  wake: boolean;
  result: Promise<RenewalResult>;
};

/** One in-flight check and at most one waiting check per session generation. */
export class RegionalRenewals {
  private readonly latest = new Map<string, Check>();

  run(
    key: string,
    use: RenewalUse,
    check: () => Promise<RenewalResult>,
  ): Promise<RenewalResult> {
    const previous = this.latest.get(key);
    if (
      previous &&
      (!previous.started ||
        use === "alarm" ||
        (use === "wake" && previous.wake))
    ) {
      if (use === "wake") previous.wake = true;
      return previous.result;
    }

    // A sensitive action can arrive after an older check passed at the
    // authority but before its reply arrives. Share only an unstarted check.
    const next: Check = {
      started: false,
      wake: use === "wake",
      result: (previous?.result ?? Promise.resolve(undefined))
        .then((prior) => {
          next.started = true;
          return prior === "denied" ? prior : check();
        })
        .finally(() => {
          if (this.latest.get(key) === next) this.latest.delete(key);
        }),
    };
    this.latest.set(key, next);
    return next.result;
  }
}
