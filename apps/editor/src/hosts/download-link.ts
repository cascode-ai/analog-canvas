// The one way the Web editor hands the browser a file to save (2026-10-14).

/**
 * How long a downloaded file's bytes stay reachable after its link is
 * clicked. Safari and Firefox read the link after the click returns, and only
 * once the person has chosen where to save when they are set to ask; a link
 * released at once left them nothing to save, so the export "did nothing".
 */
export const DOWNLOAD_LINK_LIFETIME_MS = 60_000;

interface DownloadAnchor {
  href: string;
  download: string;
  click(): void;
  remove?(): void;
}

export interface DownloadEnvironment {
  createElement(tag: "a"): DownloadAnchor;
  /** Puts the link in the page while it is clicked, where every browser
   * follows it. */
  append?(anchor: DownloadAnchor): void;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  setTimeout(handler: () => void, ms: number): unknown;
}

function browserEnvironment(): DownloadEnvironment {
  return {
    createElement: (tag) => window.document.createElement(tag),
    append: (anchor) => window.document.body?.append(anchor as unknown as Node),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  };
}

/** Asks the browser to save `blob` as `fileName`; throws if the click does. */
export function downloadBlob(
  blob: Blob,
  fileName: string,
  environment: DownloadEnvironment = browserEnvironment(),
): void {
  const url = environment.createObjectURL(blob);
  const anchor = environment.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  environment.append?.(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove?.();
    environment.setTimeout(
      () => environment.revokeObjectURL(url),
      DOWNLOAD_LINK_LIFETIME_MS,
    );
  }
}
