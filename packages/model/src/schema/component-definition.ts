import { z } from "zod";
import { componentInterfaceIssues } from "../component-interface.js";
import { StableIdSchema } from "./common.js";
import { NetlistDeviceClassSchema } from "./instance.js";
import { SymbolDefinitionSchema } from "./symbol-definition.js";
import { CellSymbolPresentationSchema } from "./presentation.js";
import { RichTextDocumentSchema } from "./rich-text.js";

export const ComponentDefinitionSourceSchema = z.strictObject({
  name: z.string(),
  terminals: z.array(
    z.strictObject({
      id: StableIdSchema,
      name: z.string(),
      direction: z.enum(["input", "output", "inout", "passive"]),
      nameContent: RichTextDocumentSchema.optional(),
    }),
  ),
  presentation: CellSymbolPresentationSchema.optional(),
});
export type ComponentDefinitionSource = z.infer<
  typeof ComponentDefinitionSourceSchema
>;

const parameter = z.strictObject({
  name: z.string().min(1),
  label: z.string(),
  required: z.boolean(),
  editor: z.enum(["text", "decimal", "select"]),
  options: z
    .array(z.strictObject({ value: z.string(), label: z.string() }))
    .optional(),
  visibleForSourceWaveforms: z
    .array(z.enum(["pulse", "sin", "pwl"]))
    .optional(),
  unitHint: z.string().optional(),
  placeholder: z.string(),
  help: z.string(),
  authoringVisibility: z.enum(["primary", "compatibility"]).optional(),
  defaultValue: z.string().optional(),
  displayRole: z.enum([
    "value",
    "width",
    "length",
    "multiplier",
    "finger-count",
    "none",
  ]),
});

export const ComponentElectricalSchema = z.strictObject({
  id: StableIdSchema,
  symbolId: StableIdSchema,
  deviceClass: NetlistDeviceClassSchema,
  mosBulkClass: z.enum(["nmos", "pmos"]).optional(),
  referencePrefix: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/u)
    .nullable(),
  pinOrder: z.array(z.string().min(1)).min(1),
  seriesInsertionPinPair: z.tuple([z.string(), z.string()]).optional(),
  pinSemantics: z
    .array(
      z.strictObject({
        pinName: z.string(),
        role: z.enum(["capacitor-top-plate", "capacitor-bottom-plate"]),
      }),
    )
    .optional(),
  targetPolicy: z.enum(["builtin", "required-model", "child-cell", "none"]),
  sourceWaveformDefault: z.enum(["dc", "pulse", "sin", "pwl"]).optional(),
  parameters: z.array(parameter),
  dialects: z.tuple([z.literal("spice"), z.literal("spectre")]),
  capabilities: z.strictObject({
    supportsModel: z.boolean(),
    supportsBulkBinding: z.boolean(),
    supportsValueAnnotation: z.boolean(),
  }),
});

const portBase = {
  name: z.string().min(1),
  direction: z.enum(["input", "output", "inout", "passive"]),
};
export const ComponentSubcircuitSchema = z.strictObject({
  id: StableIdSchema,
  symbolId: StableIdSchema,
  target: z.string().min(1),
  ports: z.array(
    z.union([
      z.strictObject({ ...portBase, pinName: z.string().min(1) }),
      z.strictObject({ ...portBase, supply: z.enum(["VDD", "VSS"]) }),
    ]),
  ),
});

/** Artwork refers to native terminal identity; it does not redeclare port order. */
export const CircuitSymbolBindingSchema = z.strictObject({
  definitionId: StableIdSchema,
  terminals: z
    .array(
      z.union([
        z.strictObject({
          terminalId: StableIdSchema,
          pinName: z.string().min(1),
        }),
        z.strictObject({
          terminalId: StableIdSchema,
          supply: z.enum(["VDD", "VSS"]),
        }),
      ]),
    )
    .max(128),
});

/** One local class, referenced by Instance.symbolId and floating symbols. */
export const ComponentDefinitionSchema = z
  .strictObject({
    symbol: SymbolDefinitionSchema,
    generatedFrom: ComponentDefinitionSourceSchema.optional(),
    electrical: ComponentElectricalSchema.optional(),
    subcircuit: ComponentSubcircuitSchema.optional(),
    circuitBinding: CircuitSymbolBindingSchema.optional(),
  })
  .superRefine((definition, ctx) => {
    if (
      definition.circuitBinding &&
      (definition.electrical ||
        definition.subcircuit ||
        definition.generatedFrom)
    )
      ctx.addIssue({
        code: "custom",
        path: ["circuitBinding"],
        message:
          "Native source owns the target, port order and defaults; remove competing electrical declarations",
      });
    for (const issue of componentInterfaceIssues(definition))
      ctx.addIssue({ code: "custom", ...issue });
  });
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;
