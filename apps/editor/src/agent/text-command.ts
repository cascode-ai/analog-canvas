import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import { resolveAnnotationText } from "@icm/derived";
import {
  createDraftText,
  flattenRichText,
  rewriteRichTextContent,
  type RichTextDocument,
  type SchematicDocument,
} from "@icm/model";

import {
  createTextEditingSession,
  proposeTextEditingCommit,
  updateTextEditingSession,
  type TextEditingSession,
} from "../features/text-editing/text-editing";

type SetText = Extract<AgentAuthoringCommand, { kind: "set-text" }>;
type AddText = Extract<AgentAuthoringCommand, { kind: "add-text" }>;

/**
 * Plain text as the canvas editor reads it after typing: the characters
 * replace the old ones in their runs, and where the object's default is bold
 * the typed text is recorded bold, as the editor records it.
 */
function typedContent(
  session: TextEditingSession,
  text: string,
): RichTextDocument {
  const rewritten = rewriteRichTextContent(session.content, text);
  if (!rewritten)
    throw new Error(
      "This text contains a formula or fraction; supply explicit RichText to replace it without losing its structure",
    );
  return session.defaultBold && !JSON.stringify(rewritten).includes('"bold"')
    ? { runs: [{ kind: "span", style: "bold", children: rewritten.runs }] }
    : rewritten;
}

/**
 * Edit a text on the canvas, as double-clicking it and typing does: a note's
 * text, a part's name label (renaming it, or showing an alias where the text
 * cannot be its Reference) or its value label (setting the value).
 */
export function planSetText(
  document: SchematicDocument,
  command: SetText,
): AgentCommandPlan {
  let session: TextEditingSession;
  if (command.target.kind === "annotation") {
    const annotation = document.annotations.find(
      (item) => item.id === command.target.id,
    );
    if (!annotation)
      throw new Error(`Annotation not found: ${command.target.id}`);
    if (annotation.kind === "net-label" || annotation.kind === "power-label")
      throw new Error(
        `${annotation.id} names a Net; rename it with set-net-label`,
      );
    if (annotation.binding) {
      // A bound label shows a name or a value. The same characters in a new
      // look restyle it and change neither; a plain string of them changes
      // nothing, so a label's standard look is not frozen into an override.
      const current = flattenRichText(
        resolveAnnotationText(document, annotation),
      ).trim();
      const next = (
        typeof command.text === "string"
          ? command.text
          : flattenRichText(command.text)
      ).trim();
      if (next === current) {
        if (
          typeof command.text === "string" ||
          JSON.stringify(annotation.formatOverride ?? null) ===
            JSON.stringify(command.text)
        )
          return { edits: [] };
        return {
          edits: [
            {
              kind: "upsert_schematic_annotation",
              annotation: { ...annotation, formatOverride: command.text },
            },
          ],
        };
      }
      if (annotation.binding.kind === "cell-terminal-name")
        throw new Error(
          `${annotation.id} names a Cell Pin; rename the Pin with set-properties reference`,
        );
    }
    session = createTextEditingSession(
      { owner: "annotation", object: annotation },
      document,
    );
  } else {
    const object = document.drafting?.objects.find(
      (item) => item.id === command.target.id,
    );
    if (!object)
      throw new Error(`Drafting object not found: ${command.target.id}`);
    if (object.kind !== "text")
      throw new Error(
        `Drafting object ${object.id} is a ${object.kind}, not text`,
      );
    session = createTextEditingSession({ owner: "drafting", object }, document);
  }
  // Typing the characters already there changes nothing.
  if (
    typeof command.text === "string" &&
    command.text === flattenRichText(session.content)
  )
    return { edits: [] };
  const content =
    typeof command.text === "string"
      ? typedContent(session, command.text)
      : command.text;
  const proposal = proposeTextEditingCommit(
    document,
    updateTextEditingSession(session, { content }),
  );
  switch (proposal.kind) {
    case "unchanged":
      return { edits: [] };
    case "blocked":
      throw new Error(proposal.message ?? "This text cannot be edited");
    case "delete":
      return { edits: [proposal.edit] };
    case "update":
      return { edits: [...(proposal.beforeEdits ?? []), proposal.edit] };
  }
}

/** A new note, as the Text tool places one. */
export function planAddText(command: AddText): AgentCommandPlan {
  return {
    edits: [
      {
        kind: "upsert_drafting_object",
        object: createDraftText({
          id: command.id,
          position: command.position,
          content: command.text,
          ...(command.alignment ? { alignment: command.alignment } : {}),
          ...(command.rotation !== undefined
            ? { rotation: command.rotation }
            : {}),
        }),
      },
    ],
  };
}
