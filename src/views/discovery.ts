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

import {
  PLANET_BY_ID,
  PLANET_DESCRIPTIONS,
  PLANET_DISPLAY_NAMES,
  RARITY_LABEL,
} from "../universe/catalog";
import { planetSvg } from "../universe/planet-svg";
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

const dateFmt = new Intl.DateTimeFormat("ko-KR", {
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
  $queueBar().hidden = queue.length <= 1;
}

function paintCard(planet: Planet) {
  const isLast = index === queue.length - 1;
  const spec = PLANET_BY_ID[planet.planet_type];
  const displayName =
    PLANET_DISPLAY_NAMES[planet.planet_type] ?? planet.planet_type;
  const description =
    PLANET_DESCRIPTIONS[planet.planet_type] ??
    "관측 데이터가 부족합니다. 더 많은 항해가 필요합니다.";
  const rarityLabel = RARITY_LABEL[planet.rarity];
  const ringColor = RARITY_RING_COLOR[planet.rarity];
  const discoveredAt = planet.discovered_at
    ? dateFmt.format(new Date(planet.discovered_at))
    : "방금";

  const orbSvg = spec
    ? planetSvg(spec, 180)
    : `<div style="width:180px; height:180px; border-radius:50%; background:#333; box-shadow:0 0 0 1px ${ringColor};"></div>`;

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
      <div class="col">
        <div class="l">DISCOVERED</div>
        <div class="v">${discoveredAt}</div>
      </div>
      <div class="col">
        <div class="l">SEED</div>
        <div class="v">${planet.seed & 0xffff}</div>
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
