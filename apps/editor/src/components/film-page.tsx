import "../styles/film.css";

import monoFontUrl from "@fontsource-variable/google-sans-code/files/google-sans-code-latin-wght-normal.woff2?url";
import { schematicWebFontFaceCss } from "@icm/exporters/browser-fonts";
import { useMemo } from "react";

import { usePageTitle } from "../app/use-page-title";
import agentDrawing from "./film/agent.svg?raw";
import filmTemplate from "./film/film.html?raw";
import ldoDrawing from "./film/ldo.svg?raw";
import otaDrawing from "./film/ota.svg?raw";
import wallUrl from "./film/wall.webp";

/**
 * A formal SVG export as the film places it: its viewBox, and its layers
 * without the title, the style and the white page rectangle. The film draws
 * the layers on its own sheet and in its own type.
 */
export function filmDrawing(svg: string): { viewBox: string; layers: string } {
  const open = /<svg\b[^>]*>/u.exec(svg);
  const viewBox = open ? /viewBox="([^"]+)"/u.exec(open[0])?.[1] : undefined;
  const end = svg.lastIndexOf("</svg>");
  if (!open || !viewBox || end < 0)
    throw new Error("The film expects a formal SVG export");
  const layers = svg
    .slice(open.index + open[0].length, end)
    .replace(/<title[^>]*>[\s\S]*?<\/title>/u, "")
    .replace(/<style>[\s\S]*?<\/style>/u, "")
    .replace(/^\s*<rect\b[^>]*\/>/u, "");
  return { viewBox, layers };
}

/**
 * The film's whole document: `film/film.html` with this build's label and
 * code faces, the Gallery wall image and the three drawings filled in.
 *
 * The drawings are formal exports of real Projects: `ota.svg` and `ldo.svg`
 * are one Project (the LDO's op-amp calls the OTA Cell), and `agent.svg` is
 * the Gallery's AnalogGenie #714 redraw, drawn by an Agent.
 */
export function filmDocument(): string {
  const fill: Record<string, string> = {
    "%%LABEL_FACES%%": schematicWebFontFaceCss,
    "%%FONT_MONO%%": monoFontUrl,
    "%%WALL%%": wallUrl,
    // The film's links stay on the host it plays on and open in this window.
    "%%SITE%%": "",
    "%%LINK_TARGET%%": "_top",
  };
  for (const [name, svg] of [
    ["OTA", otaDrawing],
    ["LDO", ldoDrawing],
    ["AG", agentDrawing],
  ] as const) {
    const { viewBox, layers } = filmDrawing(svg);
    fill[`%%${name}_VB%%`] = viewBox;
    fill[`%%${name}%%`] = layers;
  }
  return filmTemplate.replace(/%%[A-Z_]+%%/gu, (slot) => fill[slot] ?? slot);
}

/**
 * `/film`: the one-minute film about the site. It is a document of its own
 * (its styles, script and synthesized score), so it plays in a frame, where
 * its styles and script stay out of the app's page. A `srcDoc` frame makes no
 * navigation request, so the service worker never takes the film for the
 * app shell.
 */
export function FilmPage() {
  usePageTitle("Film");
  const html = useMemo(filmDocument, []);
  return (
    <iframe
      className="film-frame"
      title="Analog Canvas film"
      srcDoc={html}
      allow="autoplay"
    />
  );
}
