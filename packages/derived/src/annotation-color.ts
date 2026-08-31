import type { Annotation, Instance } from "@icm/model";

/**
 * Resolve the component that owns reference/value presentation. Binding is
 * semantic authority and therefore wins over a conflicting visual anchor.
 */
export function annotationOwningInstanceId(
  annotation: Annotation,
): string | undefined {
  if (
    annotation.kind !== "instance-label" &&
    annotation.kind !== "instance-value"
  ) {
    return undefined;
  }
  const binding = annotation.binding;
  if (
    binding?.kind === "instance-reference" ||
    binding?.kind === "instance-value"
  ) {
    return binding.instanceId;
  }
  return annotation.anchor.kind === "object"
    ? annotation.anchor.objectId
    : undefined;
}

/**
 * Text paint is owned by the Annotation. Auto (no textColor) inherits the
 * owning Instance's effective foreground only for reference/value text; every
 * other annotation uses the Document profile foreground.
 */
export function resolveAnnotationTextColor(
  annotation: Annotation,
  owningInstance: Instance | undefined,
  profileForeground: string,
): string {
  return (
    annotation.textColor ??
    (annotationOwningInstanceId(annotation)
      ? owningInstance?.styleOverride?.foreground
      : undefined) ??
    profileForeground
  );
}
