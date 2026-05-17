// Discovery moment overlay.
//
// Two entry points:
// 1. `openDiscoveryOverlay(planets)` — push a known list of planets onto the queue
//    and open the overlay. Used when the engine emits `planet_discovered` while
//    the popover is open.
// 2. `refreshDiscoveryBadge()` — fetch unacknowledged planets from the backend
//    and either pop the badge on Today (if popover just opened with pending ones)
//    or update the count.

import { invoke } from "@tauri-apps/api/core";

import { t } from "../i18n";
import {
  PLANET_BY_ID,
  PLANET_DESCRIPTIONS,
  PLANET_DISPLAY_NAMES,
  RARITY_LABEL,
} from "../universe/catalog";
import type { PlanetCanvasHandle } from "../universe/planet-canvas";
import { disposeAllPlanetOrbs, mountAllPlanetOrbs } from "../universe/planet-mount";
import type { Planet, Rarity } from "../universe/types";

const $overlay = () => document.getElementById("discovery-overlay")!;
const $card = () => document.getElementById("discovery-card")!;
const $queueBar = () => document.getElementById("discovery-queue-bar")!;
const $cur = () => document.getElementById("dq-cur")!;
const $tot = () => document.getElementById("dq-tot")!;
const $prev = () => document.getElementById("dq-prev") as HTMLButtonElement;
const $next = () => document.getElementById("dq-next") as HTMLButtonElement;
const $badge = () => document.getElementById("discoveries-badge") as HTMLButtonElement;
const $badgeCount = () => document.getElementById("discoveries-badge-count")!;

let queue: Planet[] = [];
let index = 0;
let wiredUp = false;

const shortDateFmt = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const RARITY_RING_COLOR: Record<Rarity, string> = {
  common: "rgba(196, 201, 212, 0.7)",
  rare: "rgba(123, 180, 245, 0.85)",
  epic: "rgba(178, 144, 242, 0.85)",
  legendary: "rgba(232, 200, 158, 0.9)",
  mythic: "rgba(240, 140, 109, 0.95)",
};

function ensureWired() {
  if (wiredUp) return;
  $prev().addEventListener("click", () => {
    if (index > 0) {
      index--;
      render();
    }
  });
  $next().addEventListener("click", () => {
    if (index < queue.length - 1) {
      index++;
      render();
    }
  });
  $badge().addEventListener("click", () => {
    void openFromPending();
  });
  wiredUp = true;
}

export async function openDiscoveryOverlay(planets: Planet[]): Promise<void> {
  ensureWired();
  if (planets.length === 0) return;

  // Merge with existing queue, dedup by id.
  const merged = [...queue];
  for (const p of planets) {
    if (!merged.find((existing) => existing.id === p.id)) merged.push(p);
  }
  queue = merged;
  if (index >= queue.length) index = 0;

  $overlay().hidden = false;
  $queueBar().hidden = queue.length <= 1;
  render();
}

async function closeAll(action: "codex" | "dismiss" | "next") {
  const ids = queue.map((p) => p.id);
  $overlay().hidden = true;
  disposeAllPlanetOrbs(discoveryCanvases);
  try {
    await invoke("acknowledge_planets", { planetIds: ids });
  } catch (e) {
    console.error("acknowledge_planets:", e);
  }
  queue = [];
  index = 0;
  await refreshDiscoveryBadge();
  if (action === "codex") {
    window.location.hash = "#codex";
  }
}

function render() {
  if (queue.length === 0) {
    $overlay().hidden = true;
    return;
  }
  const planet = queue[index];
  paintCard(planet);
  $cur().textContent = String(index + 1).padStart(2, "0");
  $tot().textContent = String(queue.length).padStart(2, "0");
  $prev().disabled = index === 0;
  $next().disabled = index === queue.length - 1;
  // Bar stays visible even for single-item queues so the user always sees
  // a "01 / 01 NEW" counter alongside the moment.
  $queueBar().hidden = false;
}

interface SessionInfo {
  id: number;
  started_at: string;
  ended_at: string | null;
  total_tokens: number;
}

function paintCard(planet: Planet) {
  const isLast = index === queue.length - 1;
  const spec = PLANET_BY_ID[planet.planet_type];
  const displayName =
    PLANET_DISPLAY_NAMES[planet.planet_type] ?? planet.planet_type;
  const description =
    PLANET_DESCRIPTIONS[planet.planet_type] ??
    t("discovery.insufficient_data");
  const rarityLabel = RARITY_LABEL[planet.rarity];
  const ringColor = RARITY_RING_COLOR[planet.rarity];

  const orbSvg = spec
    ? `<div data-planet-orb data-orb-id="${spec.id}" data-orb-size="180"></div>`
    : `<div style="width:180px; height:180px; border-radius:50%; background:#333; box-shadow:0 0 0 1px ${ringColor};"></div>`;

  // Numbers we have synchronously. Session # falls back to "—" if the planet
  // wasn't tied to a session (legacy rows). Duration + Discovery # populate
  // asynchronously below once their lookups return.
  const sessionLabel = planet.triggering_session_id
    ? `#${planet.triggering_session_id}`
    : "—";
  const discoveredAt = planet.discovered_at
    ? shortDateFmt.format(new Date(planet.discovered_at))
    : t("discovery.just_now");

  $card().innerHTML = `
    <div class="discovery-eyebrow">
      <span class="line"></span>
      <span>NEW DISCOVERY</span>
      <span class="line"></span>
    </div>
    <div class="discovery-planet" data-rarity="${planet.rarity}">
      <div class="halo"></div>
      ${orbSvg}
    </div>
    <div class="discovery-tier">${rarityLabel.toUpperCase()} · ${planet.planet_type.toUpperCase()}</div>
    <div class="discovery-name">${displayName}</div>
    <div class="discovery-desc">${description}</div>
    <div class="discovery-stats">
      <div class="row primary">
        <div class="col">
          <div class="l">SESSION</div>
          <div class="v">${sessionLabel}</div>
        </div>
        <div class="col">
          <div class="l">DURATION</div>
          <div class="v" id="discovery-duration">—</div>
        </div>
        <div class="col">
          <div class="l">DISCOVERY #</div>
          <div class="v" id="discovery-ordinal">—</div>
        </div>
      </div>
      <div class="row secondary">
        <div class="col">
          <div class="l">DISCOVERED</div>
          <div class="v">${discoveredAt}</div>
        </div>
      </div>
    </div>
    <div class="discovery-cta-row">
      <button class="discovery-cta muted" id="discovery-dismiss" type="button">DISMISS</button>
      ${isLast
        ? `<button class="discovery-cta" id="discovery-codex" type="button">OPEN CODEX</button>`
        : `<button class="discovery-cta" id="discovery-next" type="button">NEXT →</button>`}
    </div>
  `;

  // Wire fresh buttons (innerHTML replaces them).
  const dismiss = document.getElementById("discovery-dismiss");
  const next = document.getElementById("discovery-next");
  const codex = document.getElementById("discovery-codex");
  if (dismiss) dismiss.addEventListener("click", () => void closeAll("dismiss"));
  if (next) {
    next.addEventListener("click", () => {
      if (index < queue.length - 1) {
        index++;
        render();
      }
    });
  }
  if (codex) codex.addEventListener("click", () => void closeAll("codex"));

  // Swap stale planet canvas (from the previous queue card) before mounting
  // the new one so we don't leak a rAF.
  disposeAllPlanetOrbs(discoveryCanvases);
  discoveryCanvases = mountAllPlanetOrbs($card());

  void hydrateStats(planet);
}

let discoveryCanvases: PlanetCanvasHandle[] = [];

async function hydrateStats(planet: Planet) {
  // Discovery # — count of planets at or before this id across all time.
  void invoke<number>("get_discovery_ordinal", { planetId: planet.id })
    .then((n) => {
      const $o = document.getElementById("discovery-ordinal");
      if ($o) $o.textContent = `#${n}`;
    })
    .catch((e) => console.error("get_discovery_ordinal:", e));

  // Duration — session.ended_at - session.started_at, formatted as Hh Mm
  // (or just Mm under an hour). Falls back to the gap between session start
  // and the planet's discovered_at when ended_at is missing.
  if (!planet.triggering_session_id) return;
  try {
    const session = await invoke<SessionInfo | null>("get_session_by_id", {
      sessionId: planet.triggering_session_id,
    });
    if (!session) return;
    const start = new Date(session.started_at).getTime();
    const endRaw = session.ended_at ?? planet.discovered_at ?? null;
    const end = endRaw ? new Date(endRaw).getTime() : Date.now();
    const totalMin = Math.max(1, Math.round((end - start) / 60000));
    const $d = document.getElementById("discovery-duration");
    if ($d) $d.textContent = formatDuration(totalMin);
  } catch (e) {
    console.error("get_session_by_id:", e);
  }
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Fetch unacknowledged planets and reflect their count in the badge. */
export async function refreshDiscoveryBadge(): Promise<void> {
  ensureWired();
  let pending: Planet[] = [];
  try {
    pending = await invoke<Planet[]>("get_pending_discoveries");
  } catch (e) {
    console.error("get_pending_discoveries:", e);
    return;
  }
  const badge = $badge();
  const count = $badgeCount();
  if (pending.length === 0) {
    badge.hidden = true;
  } else {
    badge.hidden = false;
    count.textContent = String(pending.length);
  }
}

async function openFromPending() {
  try {
    const pending = await invoke<Planet[]>("get_pending_discoveries");
    if (pending.length > 0) {
      await openDiscoveryOverlay(pending);
    }
  } catch (e) {
    console.error("openFromPending:", e);
  }
}
