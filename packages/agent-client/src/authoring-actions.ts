import { z } from "zod";
import { RichTextDocumentSchema } from "@icm/model";

/**
 * Compact high-level actions accepted by `apply_actions`. They are a projection
 * layer only: every action compiles into existing typed edits or a
 * `wireIntent` (ADR 0020). Electrical semantics stay in the server-side Edit
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
const MirrorInputSchema = z.enum(["none", "x"]);

/** Reference an Instance by stable object ID or authored Reference. */
export const InstanceRefSchema = z
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

const NetRefSchema = NamedObjectRefSchema.refine((ref) => ref.kind === "net", {
  message: "Expected a net reference",
});

const PinTargetSchema = z.strictObject({
  kind: z.literal("pin"),
  instance: z.string().min(1),
  pin: z.string().min(1),
});
const ConnectTargetSchema = z.discriminatedUnion("kind", [
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

export const AuthoringActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("place-component"),
    /** Reviewed built-in Razavi symbol ID from the authoring catalog. */
    symbol: z.string().min(1),
    /** The sole authored Instance Reference. */
    reference: z.string().min(1).max(128),
    position: PointInputSchema,
    rotation: RotationInputSchema.optional(),
    mirror: MirrorInputSchema.optional(),
    variant: z.string().min(1).optional(),
    parameters: z.record(z.string().min(1), z.string().min(1)).optional(),
  }),
  z.strictObject({
    /** Named VDD rail primitive (`add_power_rail`), never a `vdd` symbol. */
    kind: z.literal("add-power-rail"),
    start: PointInputSchema,
    end: PointInputSchema,
  }),
  z.strictObject({
    kind: z.literal("connect"),
    from: ConnectTargetSchema,
    to: ConnectTargetSchema,
    /** Optional orthogonal interior points for the visible wire. */
    via: z.array(PointInputSchema).max(256).optional(),
  }),
  z.strictObject({
    kind: z.literal("disconnect"),
    target: z.discriminatedUnion("kind", [
      PinTargetSchema,
      z.strictObject({ kind: z.literal("route"), route: z.string().min(1) }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("move"),
    target: z.union([
      InstanceRefSchema,
      NamedObjectRefSchema.refine((ref) => ref.kind === "junction", {
        message: "Expected a junction reference",
      }),
    ]),
    position: PointInputSchema,
  }),
  z.strictObject({
    kind: z.literal("rotate"),
    target: InstanceRefSchema,
    rotation: RotationInputSchema,
  }),
  z.strictObject({
    kind: z.literal("mirror"),
    target: InstanceRefSchema,
    mirror: MirrorInputSchema,
  }),
  z.strictObject({
    kind: z.literal("set-reference"),
    target: InstanceRefSchema,
    reference: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("set-property"),
    target: InstanceRefSchema,
    set: z
      .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    unset: z.array(z.string().min(1)).max(64).optional(),
  }),
  z.strictObject({
    kind: z.literal("add-label"),
    target: NetRefSchema,
    text: TextInputSchema,
    position: PointInputSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("edit-text"),
    target: z.union([
      NamedObjectRefSchema.refine((ref) => ref.kind === "annotation", {
        message: "Expected an annotation reference",
      }),
      NamedObjectRefSchema.refine((ref) => ref.kind === "drafting", {
        message: "Expected a drafting reference",
      }),
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
