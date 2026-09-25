import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { reportDuplicateIds } from "./validation.js";
export const SourcePositionSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
export const SourceSpanSchema = z
  .strictObject({
    fileId: StableIdSchema,
    start: SourcePositionSchema,
    end: SourcePositionSchema,
  })
  .superRefine((span, context) => {
    if (span.end.offset < span.start.offset) {
      context.addIssue({
        code: "custom",
        message: "Source span end must not precede its start",
        path: ["end", "offset"],
      });
    }
  });

export const SourceContentSchema = z.strictObject({
  text: z.string().max(16 * 1024 * 1024),
  encoding: z.enum(["utf-8", "utf-8-bom", "utf-16-le", "utf-16-be"]),
});
export const SourceFileRecordSchema = z.strictObject({
  id: StableIdSchema,
  path: z.string().min(1),
  hash: z.string().min(1),
  /** Parsed input; source spans and hash refer to this file. */
  content: SourceContentSchema.optional(),
  /** Present only when a frontend converted the original input (e.g. Spectre). */
  originalContent: SourceContentSchema.optional(),
});

/** Frozen terminal membership, independent of mutable Base Net provenance. */
export const ImportReferenceSchema = z
  .strictObject({
    files: z.array(z.strictObject({ fileId: StableIdSchema })).default([]),
    nets: z.array(
      z.strictObject({
        id: StableIdSchema,
        name: z.string(),
        scope: z.enum(["local", "global"]),
        terminals: z.array(
          z.union([
            z.strictObject({
              instanceId: StableIdSchema,
              sourcePosition: z.number().int().nonnegative(),
            }),
            z.strictObject({
              instanceId: StableIdSchema,
              pinName: z.string().min(1),
            }),
          ]),
        ),
      }),
    ),
  })
  .superRefine((reference, context) => {
    reportDuplicateIds(reference.nets, "nets", context);
    const members = new Set<string>();
    reference.nets.forEach((net, netIndex) =>
      net.terminals.forEach((terminal, index) => {
        const key = JSON.stringify(terminal);
        if (members.has(key))
          context.addIssue({
            code: "custom",
            message: "An imported terminal belongs to one reference Net",
            path: ["nets", netIndex, "terminals", index],
          });
        members.add(key);
      }),
    );
  });
export const SourceManifestSchema = z
  .strictObject({
    entry: z.string().min(1).nullable(),
    dialect: z.string().min(1),
    sourcePolicy: z.enum(["copy", "reference"]),
    files: z.array(SourceFileRecordSchema),
  })
  .superRefine((manifest, context) => {
    reportDuplicateIds(manifest.files, "files", context);
  });
export const SymbolLibraryLockSchema = z.strictObject({
  id: StableIdSchema,
  version: z.string().min(1),
  hash: z.string().min(1),
});
