import { createEmptyProject } from "@icm/model";
import * as renderSvg from "@icm/render-svg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("editor scene reuse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the committed formal scene bounds without a second SVG build", () => {
    const build = vi.spyOn(renderSvg, "buildSvgScene");

    renderToStaticMarkup(
      <App project={createEmptyProject("scene-reuse", "Scene reuse")} />,
    );

    expect(build).toHaveBeenCalledTimes(1);
  });
});
