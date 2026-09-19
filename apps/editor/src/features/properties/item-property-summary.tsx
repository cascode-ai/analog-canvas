import { lazy, Suspense } from "react";
import {
  itemPropertyCode,
  type ItemPropertyIdentity,
} from "./item-property-code";

const PropertyJsonEditor = lazy(
  () => import("./component-property-json-editor"),
);
const adapter = {
  parse: () => ({ ok: true as const }),
  spans: () => [],
  changes: () => [],
};

/** Terminal geometry and bulk appearance belong to their owning component. */
export function ItemPropertySummary({
  item,
  color,
}: {
  item: ItemPropertyIdentity;
  color: string;
}) {
  const native = JSON.stringify({ appearance: { color } });
  const source = itemPropertyCode(native, item).format(native);
  return (
    <section className="component-property-code-editor">
      <Suspense fallback={<pre>{source}</pre>}>
        <PropertyJsonEditor
          value={source}
          historyKey={0}
          readOnly
          ariaLabel="Canvas item properties (read-only)"
          adapter={adapter}
          defaultForeground={color}
          onChange={() => {}}
        />
      </Suspense>
      <small>
        Properties follow the owning component. Null means not applicable.
      </small>
    </section>
  );
}
