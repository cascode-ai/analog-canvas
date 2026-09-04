export interface HostedSimulationProfile {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sourceImage: string;
  readonly platform: string;
  readonly simulator: {
    readonly name: "ngspice";
    readonly version: string;
    readonly binarySha256: string;
  };
  readonly models: {
    readonly id: string;
    readonly contentSha256: string;
    readonly library: {
      readonly directive: "lib";
      readonly runtimePath: string;
      readonly sections: readonly string[];
    };
  };
  readonly startup: {
    readonly filetype: "ascii";
    readonly contentSha256: string;
  };
  readonly qualifiedScope: {
    readonly devices: readonly string[];
    readonly sections: readonly string[];
    readonly analyses: readonly ("op" | "ac" | "tran")[];
  };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function validateHostedSimulationProfile(
  value: unknown,
): HostedSimulationProfile {
  if (!value || typeof value !== "object") {
    throw new Error("The hosted simulation Profile is not an object.");
  }
  const profile = value as Partial<HostedSimulationProfile>;
  if (
    profile.schemaVersion !== 1 ||
    typeof profile.id !== "string" ||
    profile.id.length === 0 ||
    typeof profile.sourceImage !== "string" ||
    !profile.sourceImage.includes("@sha256:") ||
    typeof profile.platform !== "string" ||
    profile.simulator?.name !== "ngspice" ||
    typeof profile.simulator.version !== "string" ||
    !SHA256_PATTERN.test(profile.simulator.binarySha256 ?? "") ||
    typeof profile.models?.id !== "string" ||
    !SHA256_PATTERN.test(profile.models.contentSha256 ?? "") ||
    profile.models.library?.directive !== "lib" ||
    typeof profile.models.library.runtimePath !== "string" ||
    !Array.isArray(profile.models.library.sections) ||
    profile.models.library.sections.length === 0 ||
    profile.startup?.filetype !== "ascii" ||
    !SHA256_PATTERN.test(profile.startup.contentSha256 ?? "") ||
    !Array.isArray(profile.qualifiedScope?.devices) ||
    !Array.isArray(profile.qualifiedScope?.sections) ||
    !Array.isArray(profile.qualifiedScope?.analyses)
  ) {
    throw new Error(
      "The hosted simulation Profile is incomplete or malformed.",
    );
  }
  return profile as HostedSimulationProfile;
}

export interface ObservedHostedEnvironmentIdentity {
  readonly platform: string;
  readonly simulatorVersion: string;
  readonly simulatorBinarySha256: string;
  readonly modelTreeSha256: string;
  readonly startupSha256: string;
}

export function hostedProfileMismatches(
  profile: HostedSimulationProfile,
  observed: ObservedHostedEnvironmentIdentity,
): readonly string[] {
  const mismatches: string[] = [];
  const compare = (label: string, expected: string, actual: string): void => {
    if (actual !== expected) {
      mismatches.push(`${label}: expected ${expected}, observed ${actual}`);
    }
  };
  compare("platform", profile.platform, observed.platform);
  compare(
    "simulator version",
    profile.simulator.version,
    observed.simulatorVersion,
  );
  compare(
    "simulator binary SHA-256",
    profile.simulator.binarySha256,
    observed.simulatorBinarySha256,
  );
  compare(
    "model tree SHA-256",
    profile.models.contentSha256,
    observed.modelTreeSha256,
  );
  compare(
    "startup SHA-256",
    profile.startup.contentSha256,
    observed.startupSha256,
  );
  return mismatches;
}
