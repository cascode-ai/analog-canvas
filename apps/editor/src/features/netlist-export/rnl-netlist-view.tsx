import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type { CircuitProject } from "@icm/model";
import type { NetlistFormat, NetlistNamingProfile } from "@icm/netlist";
import { createRnlExport, type RnlExport } from "@icm/rnl";

import { RNL_INTRO_URL } from "../../components/site-resource-links";
import type { NativeExternalTarget } from "../../hosts/native-external-links";
import { StaticCodeView } from "../project-code/static-code-view";
import {
  loadRnlRuntime,
  type RnlRuntime,
  type RnlWritten,
} from "./rnl-runtime";

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

export type RnlWriteState =
  | { status: "writing" }
  | { status: "no-runtime" }
  | { status: "written"; written: RnlWritten }
  | { status: "failed"; message: string };

/** Write an export with the runtime, or say why there is nothing to show. */
export async function writeRnlExport(
  exported: Extract<RnlExport, { status: "ready" }>,
  runtime: Pick<RnlRuntime, "write"> | null,
): Promise<RnlWriteState> {
  if (!runtime) return { status: "no-runtime" };
  try {
    const written = await runtime.write({
      write: exported.request,
      svg: false,
      primitives: false,
    });
    return { status: "written", written };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The findings to list under an RNL netlist, errors first. */
export function rnlFindings(
  exported: RnlExport,
  state: RnlWriteState,
): { severity: "error" | "warning"; message: string }[] {
  if (exported.status === "blocked") {
    const rnl = exported.diagnostics.filter(
      (item) => item.severity === "error",
    );
    return (
      rnl.length
        ? rnl
        : exported.netlistDiagnostics.filter(
            (item) => item.severity === "error",
          )
    ).map((item) => ({ severity: "error", message: item.message }));
  }
  const runtime =
    state.status === "written"
      ? state.written.document.diagnostics.filter(
          (item) => item.severity === "error" || item.severity === "warning",
        )
      : [];
  return [
    ...runtime.filter((item) => item.severity === "error"),
    ...exported.diagnostics,
    ...runtime.filter((item) => item.severity === "warning"),
  ].map((item) => ({
    severity: item.severity === "error" ? "error" : "warning",
    message: item.message,
  }));
}

/**
 * A link to the introduction to RNL, in a new tab; the desktop app opens it in
 * the system browser, through its fixed list of links. Left out where the
 * build links nowhere outside itself.
 */
export function AboutRnlLink({
  externalLinksEnabled = true,
  onOpenExternalLink,
}: {
  externalLinksEnabled?: boolean | undefined;
  onOpenExternalLink?: ((target: NativeExternalTarget) => void) | undefined;
}) {
  if (!externalLinksEnabled && !onOpenExternalLink) return null;
  return (
    <a
      className="rnl-about-link"
      data-testid="about-rnl"
      href={RNL_INTRO_URL}
      data-native-external-link={onOpenExternalLink ? "rnl" : undefined}
      onClick={
        onOpenExternalLink
          ? (event) => {
              event.preventDefault();
              onOpenExternalLink("rnl");
            }
          : undefined
      }
      target="_blank"
      rel="noopener noreferrer"
      aria-label="About RNL (opens in a new tab)"
      title="What RNL is: the rich netlist this format writes"
    >
      About RNL
    </a>
  );
}

/**
 * The SPICE+RNL or Spectre+RNL netlist, read-only: the rnl runtime writes the
 * drawing into the netlist, and what RNL could not say is listed below it.
 */
export function RnlNetlistView({
  project,
  format,
  namingProfile,
  rootDocumentId,
  externalLinksEnabled,
  onOpenExternalLink,
}: {
  project: CircuitProject;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  rootDocumentId?: string | undefined;
  externalLinksEnabled?: boolean | undefined;
  onOpenExternalLink?: ((target: NativeExternalTarget) => void) | undefined;
}) {
  const exported = useMemo(
    () =>
      createRnlExport(project, {
        format,
        namingProfile,
        ...(rootDocumentId ? { rootDocumentId } : {}),
      }),
    [project, format, namingProfile, rootDocumentId],
  );
  const [state, setState] = useState<RnlWriteState>({ status: "writing" });
  useEffect(() => {
    if (exported.status !== "ready") return;
    let live = true;
    setState({ status: "writing" });
    void loadRnlRuntime()
      .then(
        (runtime) => writeRnlExport(exported, runtime),
        (error: unknown): RnlWriteState => ({
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "The rnl runtime could not load",
        }),
      )
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [exported]);
  const findings = rnlFindings(exported, state);
  const text = state.status === "written" ? state.written.text : "";
  const lineCount = text.split(/\r\n?|\n/u).length;
  return (
    <div className="rnl-netlist" aria-label="RNL netlist">
      <p className="netlist-edit-hint">
        The drawing, written into the netlist as RNL ·{" "}
        <AboutRnlLink
          externalLinksEnabled={externalLinksEnabled}
          onOpenExternalLink={onOpenExternalLink}
        />
      </p>
      {exported.status === "blocked" ? (
        <p role="alert">RNL cannot write this netlist yet.</p>
      ) : state.status === "writing" ? (
        <p className="netlist-edit-hint">Writing RNL…</p>
      ) : state.status === "no-runtime" ? (
        <p role="alert">
          The RNL formats need the rnl runtime, which this build does not
          include yet.
        </p>
      ) : state.status === "failed" ? (
        <p role="alert">RNL: {state.message}</p>
      ) : (
        <div
          className="netlist-code-viewport"
          data-line-count={lineCount}
          style={
            {
              "--netlist-editor-height": `${lineCount * 19.2 + 22}px`,
            } as CSSProperties
          }
        >
          <Suspense
            fallback={
              <StaticCodeView ariaLabel="Loading RNL netlist" value={text} />
            }
          >
            <ProjectTextEditor
              ariaLabel="RNL netlist code"
              language="netlist"
              value={text}
              readOnly
            />
          </Suspense>
        </div>
      )}
      {findings.length ? (
        <div className="netlist-issues" data-testid="rnl-findings">
          <p className="netlist-issues-heading">
            {findings.length === 1
              ? "1 finding"
              : `${findings.length} findings`}
          </p>
          <ul>
            {findings.map((finding, index) => (
              <li key={index} className={`rnl-finding-${finding.severity}`}>
                {finding.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
