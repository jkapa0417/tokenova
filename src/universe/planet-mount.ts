// Helper: scan a container for `<* data-planet-orb data-orb-id data-orb-size>`
// elements and mount the canvas-based PlanetCanvas on each. Returns an array of
// handles so the caller can dispose all canvases when re-rendering or closing.
//
// Lets every consumer (codex grid, discovery moment, gallery overlay pin,
// today inline pin) share the same teardown discipline.

import { PLANET_BY_ID } from "./catalog";
import { mountPlanetCanvas, type PlanetCanvasHandle } from "./planet-canvas";

export function mountAllPlanetOrbs(
  container: ParentNode,
  opts: { animated?: boolean } = {},
): PlanetCanvasHandle[] {
  const handles: PlanetCanvasHandle[] = [];
  container.querySelectorAll<HTMLElement>("[data-planet-orb]").forEach((host) => {
    if (host.dataset.orbMounted === "true") return;
    const id = host.dataset.orbId;
    const sizeStr = host.dataset.orbSize;
    if (!id || !sizeStr) return;
    const spec = PLANET_BY_ID[id];
    if (!spec) return;
    const size = parseInt(sizeStr, 10);
    host.dataset.orbMounted = "true";
    handles.push(
      mountPlanetCanvas(host, spec, { size, animated: opts.animated ?? true }),
    );
  });
  return handles;
}

export function disposeAllPlanetOrbs(handles: PlanetCanvasHandle[]): void {
  for (const h of handles) h.dispose();
  handles.length = 0;
}
