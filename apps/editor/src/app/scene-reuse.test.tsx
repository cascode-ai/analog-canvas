import { createEmptyProject } from "@icm/model";
import * as renderSvg from "@icm/render-svg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createWebEditorServices } from "../services/web-editor-services";

const services = createWebEditorServices();

describe("editor scene reuse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the committed formal scene bounds without a second SVG build", () => {
    const committed = vi.spyOn(renderSvg, "buildCommittedCanvasScene");
    const preview = vi.spyOn(renderSvg, "buildSvgScene");

    renderToStaticMarkup(
      <App
        services={services}
        project={createEmptyProject("scene-reuse", "Scene reuse")}
      />,
    );

    expect(committed).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
  });
});
