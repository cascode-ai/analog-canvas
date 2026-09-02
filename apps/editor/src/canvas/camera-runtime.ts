import type { GridRect } from "@icm/model";

import { normalizeCameraRect, type CameraRectInput } from "./fit-view";

export type CameraUpdate =
  GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput);

interface CameraBoundedElement {
  setAttribute(name: string, value: string): void;
}

interface CameraSurface {
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): DOMRect;
  querySelectorAll(selectors: string): NodeListOf<Element>;
}

export interface CameraRuntimeOptions {
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  scheduleCommit?: (callback: () => void, delayMs: number) => number;
  cancelCommit?: (handle: number) => void;
  settleDelayMs?: number;
}

export interface CameraRuntime {
  current(): GridRect;
  set(next: CameraUpdate, grid: number): void;
  schedule(next: CameraUpdate, grid: number): void;
  flush(): void;
  attach(surface: SVGSVGElement): void;
  detach(surface: SVGSVGElement): void;
  refreshSurface(): void;
  measureSurface(surface: SVGSVGElement, refresh?: boolean): DOMRect;
  invalidateSurfaceBounds(): void;
  dispose(): void;
}

function cameraString(camera: GridRect): string {
  return `${camera.x} ${camera.y} ${camera.width} ${camera.height}`;
}

/**
 * Owns the live camera between React commits. High-frequency input overwrites
 * or accumulates one current value, then one animation frame updates the SVG,
 * grid, and input planes. React receives one settled snapshot instead of one
 * root update per hardware event.
 */
export function createCameraRuntime(
  initial: GridRect,
  commit: (camera: GridRect) => void,
  options: CameraRuntimeOptions = {},
): CameraRuntime {
  const requestFrame =
    options.requestFrame ??
    ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  const scheduleCommit =
    options.scheduleCommit ??
    ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const cancelCommit =
    options.cancelCommit ?? ((handle) => window.clearTimeout(handle));
  const settleDelayMs = options.settleDelayMs ?? 120;

  let live = initial;
  let surface: CameraSurface | null = null;
  let boundedElements: CameraBoundedElement[] = [];
  let bounds: DOMRect | null = null;
  let frameHandle: number | null = null;
  let commitHandle: number | null = null;
  let dirty = false;

  const apply = (): void => {
    if (!surface) return;
    surface.setAttribute("viewBox", cameraString(live));
    for (const element of boundedElements) {
      element.setAttribute("x", String(live.x));
      element.setAttribute("y", String(live.y));
      element.setAttribute("width", String(live.width));
      element.setAttribute("height", String(live.height));
    }
  };

  const cancelScheduledCommit = (): void => {
    if (commitHandle === null) return;
    cancelCommit(commitHandle);
    commitHandle = null;
  };

  const cancelScheduledFrame = (): void => {
    if (frameHandle === null) return;
    cancelFrame(frameHandle);
    frameHandle = null;
  };

  const flush = (): void => {
    cancelScheduledFrame();
    cancelScheduledCommit();
    if (!dirty) return;
    apply();
    dirty = false;
    commit(live);
  };

  const scheduleFrame = (): void => {
    if (frameHandle !== null) return;
    frameHandle = requestFrame(() => {
      frameHandle = null;
      apply();
    });
  };

  const scheduleSettledCommit = (): void => {
    cancelScheduledCommit();
    commitHandle = scheduleCommit(() => {
      commitHandle = null;
      flush();
    }, settleDelayMs);
  };

  const resolve = (next: CameraUpdate, grid: number): GridRect =>
    normalizeCameraRect(typeof next === "function" ? next(live) : next, grid);

  return {
    current: () => live,
    set(next, grid) {
      cancelScheduledFrame();
      cancelScheduledCommit();
      live = resolve(next, grid);
      dirty = false;
      apply();
      commit(live);
    },
    schedule(next, grid) {
      live = resolve(next, grid);
      dirty = true;
      scheduleFrame();
      scheduleSettledCommit();
    },
    flush,
    attach(nextSurface) {
      surface = nextSurface;
      boundedElements = [
        ...nextSurface.querySelectorAll("[data-camera-bounds]"),
      ];
      bounds = null;
      apply();
    },
    detach(oldSurface) {
      if (surface !== oldSurface) return;
      surface = null;
      boundedElements = [];
      bounds = null;
    },
    refreshSurface() {
      if (!surface) return;
      boundedElements = [...surface.querySelectorAll("[data-camera-bounds]")];
      apply();
    },
    measureSurface(nextSurface, refresh = false) {
      if (surface !== nextSurface) {
        surface = nextSurface;
        boundedElements = [
          ...nextSurface.querySelectorAll("[data-camera-bounds]"),
        ];
        bounds = null;
      }
      if (refresh || !bounds) bounds = nextSurface.getBoundingClientRect();
      return bounds;
    },
    invalidateSurfaceBounds() {
      bounds = null;
    },
    dispose() {
      cancelScheduledFrame();
      cancelScheduledCommit();
      surface = null;
      boundedElements = [];
      bounds = null;
      dirty = false;
    },
  };
}
