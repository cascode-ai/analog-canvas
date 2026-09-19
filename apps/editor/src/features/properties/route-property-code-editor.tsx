import { useMemo, type ReactNode } from "react";

import type { Annotation, SchematicDocument } from "@icm/model";
import { resolveEndpointPoint } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import { AnnotationPropertyCodeEditor } from "./annotation-property-code-editor";
import {
  parseRoutePropertyCode,
  routePropertyCodeAdapter,
  routePropertyCodeValue,
  serializeRoutePropertyCode,
  type RoutePropertyCodeValue,
} from "./route-property-code";

type Route = SchematicDocument["routes"][number];

export function RoutePropertyCodeEditor({
  document,
  route,
  resolver,
  netLabel,
  defaultColor,
  onApply,
  actions,
}: {
  document: SchematicDocument;
  route: Route;
  resolver?: SymbolResolver;
  netLabel: Annotation | null;
  defaultColor: string;
  onApply(value: RoutePropertyCodeValue): { ok: boolean; message?: string };
  actions: ReactNode;
}) {
  const adapter = useMemo(() => routePropertyCodeAdapter(), []);
  const format = (value: RoutePropertyCodeValue) =>
    serializeRoutePropertyCode(value);
  const position = resolver
    ? resolveEndpointPoint(document, resolver, route.start)
    : null;
  return (
    <AnnotationPropertyCodeEditor
      item={{
        type: "wire",
        name: "",
        namePath: "net.name",
        coordinate: position ? [position.x, position.y] : null,
      }}
      baseline={format(routePropertyCodeValue(document, route, netLabel))}
      adapter={adapter}
      parse={parseRoutePropertyCode}
      format={format}
      onApply={onApply}
      defaultColor={defaultColor}
      actions={actions}
      title="Route"
    />
  );
}
