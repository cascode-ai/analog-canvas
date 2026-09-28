import { BackendError, z } from "./contracts.js";

const ConversionOverridesSchema = z.strictObject({
  scale: z.number().finite().positive().optional(),
  busMode: z.enum(["reject", "bundled"]).optional(),
  disabledInstances: z.enum(["keep", "omit"]).optional(),
  isolatedPorts: z.enum(["keep", "omit"]).optional(),
  unmappedDevices: z.enum(["generic-box", "error"]).optional(),
});

const PresentationOverridesSchema = z.strictObject({
  caseSensitive: z.boolean().optional(),
  powerNets: z.array(z.string().min(1)).max(128).optional(),
  groundNets: z.array(z.string().min(1)).max(128).optional(),
  bulkVisibility: z.enum(["all", "hide-power-ground"]).optional(),
  plainLabels: z.boolean().optional(),
  showInstanceNames: z.boolean().optional(),
  decorateOpenEnds: z.boolean().optional(),
  boxStubLength: z.number().finite().nonnegative().max(1000).optional(),
});

export const UserConfigSchema = z.strictObject({
  version: z.literal(1),
  conversion: ConversionOverridesSchema.optional(),
  presentation: PresentationOverridesSchema.optional(),
});

export const ResolvedUserConfigSchema = z.strictObject({
  version: z.literal(1),
  conversion: z.strictObject({
    scale: z.number().finite().positive(),
    busMode: z.enum(["reject", "bundled"]),
    disabledInstances: z.enum(["keep", "omit"]),
    isolatedPorts: z.enum(["keep", "omit"]),
    unmappedDevices: z.enum(["generic-box", "error"]),
  }),
  presentation: z.strictObject({
    caseSensitive: z.boolean(),
    powerNets: z.array(z.string().min(1)).max(128),
    groundNets: z.array(z.string().min(1)).max(128),
    bulkVisibility: z.enum(["all", "hide-power-ground"]),
    plainLabels: z.boolean(),
    showInstanceNames: z.boolean(),
    decorateOpenEnds: z.boolean(),
    boxStubLength: z.number().finite().nonnegative().max(1000),
  }),
});

export const PresentationConfigSchema = z.strictObject({
  version: z.literal(1),
  ...ResolvedUserConfigSchema.shape.presentation.shape,
});

export type ResolvedUserConfig = z.infer<typeof ResolvedUserConfigSchema>;

export const DEFAULT_USER_CONFIG: ResolvedUserConfig =
  ResolvedUserConfigSchema.parse({
    version: 1,
    conversion: {
      scale: 160,
      busMode: "reject",
      disabledInstances: "keep",
      isolatedPorts: "omit",
      unmappedDevices: "generic-box",
    },
    presentation: {
      caseSensitive: false,
      powerNets: [
        "VDD",
        "VDD!",
        "VCC",
        "VCC!",
        "AVDD",
        "DVDD",
        "PVDD",
        "VDDIO",
        "VDDA",
        "VDDD",
      ],
      groundNets: [
        "GND",
        "GND!",
        "VSS",
        "VSS!",
        "AGND",
        "DGND",
        "PGND",
        "AVSS",
        "DVSS",
        "VSSA",
        "VSSD",
        "0",
      ],
      bulkVisibility: "hide-power-ground",
      plainLabels: false,
      showInstanceNames: true,
      decorateOpenEnds: true,
      boxStubLength: 40,
    },
  });

export function resolveUserConfig(
  input: unknown = { version: 1 },
): ResolvedUserConfig {
  try {
    const value = UserConfigSchema.parse(input);
    const resolved = ResolvedUserConfigSchema.parse({
      version: 1,
      conversion: { ...DEFAULT_USER_CONFIG.conversion, ...value.conversion },
      presentation: {
        ...DEFAULT_USER_CONFIG.presentation,
        ...value.presentation,
      },
    });
    const normalize = resolved.presentation.caseSensitive
      ? (name: string) => name
      : (name: string) => name.toLocaleLowerCase("en-US");
    for (const [kind, names] of [
      ["powerNets", resolved.presentation.powerNets],
      ["groundNets", resolved.presentation.groundNets],
    ] as const) {
      const normalized = names.map(normalize);
      if (normalized.length !== new Set(normalized).size)
        throw new BackendError(
          "INVALID_CONFIG",
          `${kind} contains duplicate names`,
        );
    }
    const power = new Set(resolved.presentation.powerNets.map(normalize));
    const conflicts = resolved.presentation.groundNets.filter((name) =>
      power.has(normalize(name)),
    );
    if (conflicts.length)
      throw new BackendError(
        "INVALID_CONFIG",
        "A net name cannot be configured as both power and ground",
        { conflicts },
      );
    return resolved;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    if (error instanceof z.ZodError)
      throw new BackendError(
        "INVALID_CONFIG",
        "Personal configuration is invalid",
        error.issues,
      );
    throw error;
  }
}

export function presentationFromUserConfig(config: ResolvedUserConfig) {
  return PresentationConfigSchema.parse({ version: 1, ...config.presentation });
}
