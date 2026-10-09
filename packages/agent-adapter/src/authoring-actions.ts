import { z } from "zod";
import {
  RichTextDocumentSchema,
  InstanceNetlistDataSchema,
  SignalFlowParametersSchema,
  StableIdSchema,
} from "@icm/model";
import {
  AgentAuthoringCommandSchema,
  AgentPinAnchorSchema,
} from "./authoring-command.js";
import {
  AgentSemanticIntentSchema,
  AgentWireAtAnchorSchema,
} from "./schema.js";

/**
 * Compact high-level actions accepted by `apply_actions`. They are a projection
 * layer only: every action compiles into existing typed edits or a
 * `wireIntent` (Agent rationale). Electrical semantics stay in the server-side Edit
 * Engine and routing capabilities.
 */

const PointInputSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
});
const RotationInputSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
const MirrorInputSchema = z.enum(["none", "horizontal", "vertical", "both"]);

/** Reference an Instance by stable object ID or authored Reference. */
const InstanceRefSchema = z
  .strictObject({
    kind: z.literal("instance"),
    id: z.string().min(1).optional(),
    reference: z.string().min(1).optional(),
  })
  .superRefine((ref, context) => {
    if ((ref.id === undefined) === (ref.reference === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Provide exactly one of id or reference",
      });
    }
  });

/** Reference a non-Instance object by stable ID or its domain name. */
const NamedObjectRefSchema = z
  .strictObject({
    kind: z.enum([
      "net",
      "route",
      "junction",
      "annotation",
      "drafting",
      "no-connect",
    ]),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .superRefine((ref, context) => {
    if ((ref.id === undefined) === (ref.name === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Provide exactly one of id or name",
      });
    }
  });
export const ObjectRefSchema = z.union([
  InstanceRefSchema,
  NamedObjectRefSchema,
]);
export type ObjectRef = z.infer<typeof ObjectRefSchema>;

// Encode the discriminator structurally: JSON Schema cannot expose refinements.
const NetRefSchema = NamedObjectRefSchema.safeExtend({
  kind: z.literal("net"),
});
const AnnotationRefSchema = NamedObjectRefSchema.safeExtend({
  kind: z.literal("annotation"),
});

const PinTargetSchema = z.strictObject({
  kind: z.literal("pin"),
  instance: z
    .union([z.string().min(1), InstanceRefSchema])
    .describe(
      "Instance Reference, or {kind:'instance', id:'...'} for a stable ID (including formal Cell Pins).",
    ),
  pin: z.string().min(1),
});
const ConnectTargetSchema = z.discriminatedUnion("kind", [
  AgentWireAtAnchorSchema,
  z.strictObject({
    kind: z.literal("route-segment"),
    routeId: z.string().min(1),
    legId: z.string().min(1),
    point: PointInputSchema,
  }),
  PinTargetSchema,
  z.strictObject({ kind: z.literal("net"), net: z.string().min(1) }),
  z.strictObject({ kind: z.literal("junction"), junction: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("point"),
    x: z.number().int(),
    y: z.number().int(),
  }),
]);

const TextInputSchema = z.union([
  z.string().min(1).max(256),
  RichTextDocumentSchema,
]);

/**
 * Four native commands take the form the other actions use (#1301). A
 * place-cell may leave out its Instance ID and orientation, as place-component
 * does: the Helper makes the ID and turns it upright. set-model and
 * set-display-alias take a `target`, as set-property does, besides their
 * native `instanceId`; apply-label-preset takes `targets` besides its native
 * `instanceIds` (#1350). Each is sent as its native command.
 */
type NativeAction = (typeof AgentAuthoringCommandSchema.options)[number];
type FriendlierKind =
  "place-cell" | "set-model" | "set-display-alias" | "apply-label-preset";
const nativeAction = <K extends FriendlierKind>(kind: K) =>
  AgentAuthoringCommandSchema.options.find(
    (option) => option.shape.kind.value === kind,
  ) as Extract<NativeAction, { shape: { kind: { value: K } } }>;
const NativePlaceCell = nativeAction("place-cell");
const NativeSetModel = nativeAction("set-model");
const NativeSetDisplayAlias = nativeAction("set-display-alias");
const NativeApplyLabelPreset = nativeAction("apply-label-preset");
const oneInstance = (
  action: { instanceId?: string | undefined; target?: unknown },
  context: z.RefinementCtx,
) => {
  if ((action.instanceId === undefined) === (action.target === undefined))
    context.addIssue({
      code: "custom",
      message: "Provide exactly one of instanceId or target",
    });
};
const PlaceCellActionSchema = NativePlaceCell.extend({
  instanceId: NativePlaceCell.shape.instanceId
    .optional()
    .describe("Omit for a generated ID, as place-component makes one."),
  placement: NativePlaceCell.shape.placement.extend({
    rotation: NativePlaceCell.shape.placement.shape.rotation.optional(),
    mirror: NativePlaceCell.shape.placement.shape.mirror.optional(),
  }),
});
const SetModelActionSchema = NativeSetModel.extend({
  instanceId: NativeSetModel.shape.instanceId.optional(),
  target: InstanceRefSchema.optional(),
}).superRefine(oneInstance);
const SetDisplayAliasActionSchema = NativeSetDisplayAlias.extend({
  instanceId: NativeSetDisplayAlias.shape.instanceId.optional(),
  target: InstanceRefSchema.optional(),
}).superRefine(oneInstance);
const ApplyLabelPresetActionSchema = NativeApplyLabelPreset.extend({
  targets: z
    .array(InstanceRefSchema)
    .min(1)
    .max(256)
    .optional()
    .describe("The parts by Reference or ID, instead of instanceIds."),
})
  .refine(
    (action) =>
      action.instanceIds === undefined || action.targets === undefined,
    { message: "Give instanceIds or targets, not both" },
  )
  .describe(NativeApplyLabelPreset.description ?? "");
const friendlierKinds = new Set<string>([
  "place-cell",
  "set-model",
  "set-display-alias",
  "apply-label-preset",
]);
const otherNativeActions = AgentAuthoringCommandSchema.options.filter(
  (
    option,
  ): option is Exclude<
    NativeAction,
    { shape: { kind: { value: FriendlierKind } } }
  > => !friendlierKinds.has(option.shape.kind.value),
);

export const AuthoringActionSchema = z.discriminatedUnion("kind", [
  PlaceCellActionSchema,
  SetModelActionSchema,
  SetDisplayAliasActionSchema,
  ApplyLabelPresetActionSchema,
  ...otherNativeActions,
  z.strictObject({
    kind: z.literal("focus"),
    intent: AgentSemanticIntentSchema,
  }),
  z.strictObject({ kind: z.literal("undo") }),
  z.strictObject({ kind: z.literal("redo") }),
  z.strictObject({
    kind: z.literal("set-source-control"),
    target: InstanceRefSchema,
    control: InstanceNetlistDataSchema.shape.control
      .unwrap()
      .nullable()
      .describe(
        "Replace only electrical control; null clears it. Stable IDs come from Snapshot. Parameters, binding and visual Annotation are preserved.",
      ),
  }),
  z
    .strictObject({
      kind: z.literal("place-component"),
      /** Reviewed built-in Razavi symbol ID from the authoring catalog. */
      symbol: z.string().min(1),
      id: StableIdSchema.optional().describe(
        "Your own stable ID for the part, refused if taken. Later actions of the same list name it by this ID, a ground or one of several VDD markers included.",
      ),
      reference: z
        .string()
        .min(1)
        .max(128)
        .optional()
        .describe(
          "A device's Reference, or a Port's name. Left out, a device takes the next free name, as a GUI insert does (the receipt's placed list names it); VDD defaults to VDD. Omit for ground.",
        ),
      position: PointInputSchema.optional().describe(
        "Instance origin; supply exactly one of position, pinAnchor or mirrorOf.",
      ),
      pinAnchor: AgentPinAnchorSchema.optional().describe(
        "Place by a named routing landing instead of the Instance origin; supply exactly one of position, pinAnchor or mirrorOf.",
      ),
      mirrorOf: z
        .object({
          instance: z.string(),
          x: z.number().optional(),
          y: z.number().optional(),
        })
        .optional()
        .describe(
          "The mirror image of a placed part (Reference or ID) about the vertical line x, or the horizontal line y: its origin reflected and its mirror toggled, rotation kept, so a symmetric half needs no coordinate arithmetic. Replaces position/pinAnchor; rotation and mirror come from the part.",
        ),
      rotation: RotationInputSchema.optional(),
      mirror: MirrorInputSchema.optional(),
      variant: z.string().min(1).optional(),
      parameters: z.record(z.string().min(1), z.string().min(1)).optional(),
      showReference: z.boolean().optional(),
      showValue: z
        .boolean()
        .optional()
        .describe(
          "A device's labels from the start. Left out, the name shows alone; showValue:true shows the value given, else the catalog default.",
        ),
      // Checked against the control schema when the action compiles, which
      // keeps this declaration inside a host's 5,000-byte tool budget.
      control: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Controlled-source electrical selection using stable Net or Instance/pin IDs from Snapshot, shaped as set-source-control's control; independent of visual Annotation.",
        ),
      direction: z
        .enum(["input", "output", "inout", "passive"])
        .optional()
        .describe(
          "Cell interface markers only; VDD defaults to inout, ordinary Port to passive.",
        ),
      // Keys, bounds and types are checked when the action compiles: the
      // declaration stays inside a host's 5,000-byte tool budget.
      signalFlow: z
        .record(z.string(), z.union([z.string(), z.number()]))
        .optional()
        .describe(
          "Blocks that draw a formula (catalog formula: true, e.g. integrator): {formula?, coefficient?, bodyWidth?, bodyHeight?}, sizes in multiples of 10. Schematic only; never netlist parameters.",
        ),
    })
    .refine(
      (action) =>
        [action.position, action.pinAnchor, action.mirrorOf].filter(
          (value) => value !== undefined,
        ).length === 1,
      {
        path: ["position"],
        message: "Provide exactly one of position, pinAnchor or mirrorOf",
      },
    ),
  z.strictObject({
    kind: z.literal("connect"),
    from: ConnectTargetSchema,
    to: ConnectTargetSchema,
    /** Optional orthogonal interior points for the visible wire. */
    via: z.array(PointInputSchema).max(256).optional(),
    routingMode: z.enum(["orthogonal", "octilinear", "free"]).optional(),
    cornerOrder: z
      .enum(["auto", "diagonal-first", "orthogonal-first"])
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("disconnect"),
    target: z.discriminatedUnion("kind", [
      PinTargetSchema,
      z.strictObject({ kind: z.literal("route"), route: z.string().min(1) }),
    ]),
    noConnect: z
      .boolean()
      .optional()
      .describe(
        "For a pin. true: leave it unused, such as a flip-flop's QBAR, marked No Connect as the GUI does (disconnected first if wired); it exports as its own floating node. false: remove its No Connect mark.",
      ),
  }),
  z
    .strictObject({
      kind: z.literal("move"),
      target: z.union([
        InstanceRefSchema,
        NamedObjectRefSchema.safeExtend({ kind: z.literal("junction") }),
        AnnotationRefSchema,
      ]),
      position: PointInputSchema.optional(),
      pinAnchor: AgentPinAnchorSchema.optional().describe(
        "Placed Instance only; instead of position. Keeps orientation.",
      ),
    })
    .superRefine((action, ctx) => {
      if ((action.position === undefined) === (action.pinAnchor === undefined))
        ctx.addIssue({
          code: "custom",
          path: ["position"],
          message: "Provide exactly one of position or pinAnchor",
        });
      if (action.pinAnchor && action.target.kind !== "instance")
        ctx.addIssue({
          code: "custom",
          path: ["pinAnchor"],
          message: "pinAnchor requires an Instance target",
        });
    }),
  z.strictObject({
    kind: z.literal("rotate"),
    target: InstanceRefSchema,
    rotation: RotationInputSchema,
  }),
  z
    .strictObject({
      kind: z.literal("mirror"),
      target: InstanceRefSchema,
      axis: z
        .enum(["x", "y"])
        .optional()
        .describe(
          "Reflect the part in place, as circuit_selection's transform mirror does: y flips it left-right, x top-bottom; twice gives it back.",
        ),
      mirror: MirrorInputSchema.optional().describe(
        "An absolute mirror state, kept for older calls; prefer axis, or set-orientation for a state.",
      ),
    })
    .refine(
      (action) => (action.axis === undefined) !== (action.mirror === undefined),
      {
        message: "Give axis (a reflection) or mirror (a state), not both",
      },
    ),
  z
    .strictObject({
      kind: z.literal("set-orientation"),
      target: InstanceRefSchema,
      rotation: RotationInputSchema.optional(),
      mirror: MirrorInputSchema.optional(),
    })
    .refine(
      (action) => action.rotation !== undefined || action.mirror !== undefined,
      { message: "Give rotation, mirror or both" },
    )
    .describe(
      "Set a part's absolute orientation; rotate and mirror axis turn or reflect it from where it is.",
    ),
  z.strictObject({
    kind: z.literal("set-reference"),
    target: InstanceRefSchema,
    reference: z.string().min(1).max(128),
  }),
  z
    .strictObject({
      kind: z.literal("set-signal-flow"),
      target: InstanceRefSchema,
      formula: z.string().min(1).max(256).nullable().optional(),
      coefficient: z.string().min(1).max(64).nullable().optional(),
      bodyWidth: SignalFlowParametersSchema.shape.bodyWidth
        .unwrap()
        .nullable()
        .optional(),
      bodyHeight: SignalFlowParametersSchema.shape.bodyHeight
        .unwrap()
        .nullable()
        .optional(),
    })
    .refine(
      (action) =>
        ["formula", "coefficient", "bodyWidth", "bodyHeight"].some(
          (key) => key in action,
        ),
      { message: "Give formula, coefficient, bodyWidth or bodyHeight" },
    )
    .describe(
      "A formula block's drawn formula, coefficient or minimum body size, as its Properties formula sets them; null clears one. Schematic only: never a netlist parameter (use set-property for those).",
    ),
  z.strictObject({
    kind: z.literal("set-property"),
    target: InstanceRefSchema,
    set: z.record(z.string().min(1), z.string().min(1).max(1024)).optional(),
    unset: z.array(z.string().min(1)).max(64).optional(),
  }),
  z
    .strictObject({
      kind: z.literal("set-block-supply"),
      target: InstanceRefSchema,
      supply: z.enum(["VDD", "VSS"]),
      net: NetRefSchema.nullable(),
    })
    .describe(
      "Choose the Net a block's VDD or VSS uses, as Properties does. net:null returns it to Auto (the Cell's one drawn supply).",
    ),
  z.strictObject({
    kind: z.literal("add-label"),
    target: z
      .union([NetRefSchema, PinTargetSchema])
      .describe(
        "The Net to name, or a pin: then the label names that pin's Net and stands on the wire leaving it, such as a stub just drawn.",
      ),
    text: TextInputSchema,
    position: PointInputSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("edit-text"),
    target: z.union([
      AnnotationRefSchema,
      NamedObjectRefSchema.safeExtend({ kind: z.literal("drafting") }),
    ]),
    text: TextInputSchema,
  }),
  z.strictObject({
    kind: z.literal("annotate"),
    text: TextInputSchema,
    position: PointInputSchema,
    alignment: z.enum(["start", "middle", "end"]).optional(),
    rotation: RotationInputSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("arrange"),
    instances: z.array(InstanceRefSchema).min(2).max(64),
    axis: z.enum(["x", "y"]),
    coordinate: z.number().int().optional(),
  }),
  z.strictObject({
    kind: z.literal("delete"),
    target: ObjectRefSchema,
  }),
]);

export type AuthoringAction = z.infer<typeof AuthoringActionSchema>;
export type ConnectTarget = z.infer<typeof ConnectTargetSchema>;
