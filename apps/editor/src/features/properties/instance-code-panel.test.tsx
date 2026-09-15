import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InstanceCodePanel } from "./instance-code-panel";

it("renders one bulk code editor without a modal, table or form controls", () => {
  const markup = renderToStaticMarkup(
    <InstanceCodePanel
      project={createEmptyProject("project", "Project")}
      onApply={() => true}
    />,
  );
  expect(markup).toContain('aria-label="Instance JSON"');
  expect(markup.match(/<textarea/gu)).toHaveLength(1);
  expect(markup).not.toMatch(/<table|<select|<button|<input|role="dialog"/u);
});
