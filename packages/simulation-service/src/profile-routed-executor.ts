import type { Capabilities } from "./contract.js";
import type { Executor } from "./executor.js";

/**
 * One Executor over two: runs of the named Profiles go to `local` (the
 * editor's in-browser simulator), every other Profile to `hosted`. A run is
 * cancelled where it was started. Discovery without a Profile lists both:
 * the hosted Profiles, with the local ones in place of any hosted entry of
 * the same id, so a deployment without a hosted simulator still offers them.
 */
export function createProfileRoutedExecutor(
  local: { profileIds: readonly string[]; executor: Executor },
  hosted: Executor,
): Executor {
  const isLocal = (profileId: string | undefined) =>
    profileId !== undefined && local.profileIds.includes(profileId);
  const localRuns = new Set<string>();
  return {
    async capabilities(profileId) {
      if (profileId !== undefined)
        return (isLocal(profileId) ? local.executor : hosted).capabilities(
          profileId,
        );
      const [own, remote] = await Promise.allSettled([
        local.executor.capabilities(),
        hosted.capabilities(),
      ]);
      if (remote.status === "rejected") {
        if (own.status === "fulfilled") return own.value;
        throw remote.reason;
      }
      if (own.status === "rejected") return remote.value;
      const ownProfiles = own.value.profiles.filter((profile) =>
        isLocal(profile.id),
      );
      return {
        ...remote.value,
        configured: remote.value.configured || own.value.configured,
        profiles: [
          ...ownProfiles,
          ...remote.value.profiles.filter((profile) => !isLocal(profile.id)),
        ],
      } satisfies Capabilities;
    },
    async execute(input, runToken, timeoutMs, identity) {
      if (!isLocal(input.environment.profileId))
        return hosted.execute(input, runToken, timeoutMs, identity);
      localRuns.add(runToken);
      try {
        return await local.executor.execute(
          input,
          runToken,
          timeoutMs,
          identity,
        );
      } finally {
        localRuns.delete(runToken);
      }
    },
    cancel(runToken, profileId) {
      return localRuns.has(runToken) || isLocal(profileId)
        ? local.executor.cancel(runToken, profileId)
        : hosted.cancel(runToken, profileId);
    },
  };
}
