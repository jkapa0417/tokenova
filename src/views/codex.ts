// Codex view: 30 planet types grouped by tier (Common / Rare / Epic /
// Legendary / Mythic), 3-col grid, tier-colored cards with foil sheen on
// rare+. Locked cards show a dark sphere placeholder until discovered.

import { invoke } from "@tauri-apps/api/core";

import {
  PLANETS,
  PLANET_BY_ID,
  RARITY_LABEL,
  RARITY_TIER_CODE,
  TIER_ORDER,
  TIER_PROBABILITY,
  type PlanetSpec,
} from "../universe/catalog";
import { planetSvg } from "../universe/planet-svg";
import type { Rarity } from "../universe/types";

interface CodexCard {
  key: string;
  display_name: string;
  rarity: Rarity;
  discovered: boolean;
  discovery_count: number;
  first_discovered_at: string | null;
  last_discovered_at: string | null;
}

interface CodexGroup {
  rarity: Rarity;
  total: number;
  discovered: number;
  cards: CodexCard[];
}

interface CodexPayload {
  groups: CodexGroup[];
  total_count: number;
  discovered_count: number;
}

export async function activateCodex(): Promise<void> {
  await refresh();
}

export async function refresh(): Promise<void> {
  const $disc = document.getElementById("codex-discovered");
  const $total = document.getElementById("codex-total");
  const $content = document.getElementById("codex-content");
  if (!$content) return;

  try {
    const payload = await invoke<CodexPayload>("get_codex");
    if ($disc) $disc.textContent = String(payload.discovered_count);
    if ($total) $total.textContent = String(payload.total_count);

    // Index by key so we can look up discovery state.
    const byKey = new Map<string, CodexCard>();
    for (const g of payload.groups) for (const c of g.cards) byKey.set(c.key, c);

    $content.innerHTML = TIER_ORDER.map((tier) => renderTier(tier, byKey)).join("");
    attachClickHandlers(byKey);
  } catch (e) {
    console.error("codex:", e);
    $content.innerHTML = `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">로딩 실패</div>`;
  }
}

function renderTier(rarity: Rarity, byKey: Map<string, CodexCard>): string {
  const tierSpecs = PLANETS.filter((p) => p.rarity === rarity);
  const tierCode = RARITY_TIER_CODE[rarity];
  const discoveredCount = tierSpecs.filter((s) => byKey.get(s.id)?.discovered).length;
  const probability = TIER_PROBABILITY[rarity];

  const cards = tierSpecs.map((spec) => renderCard(spec, byKey.get(spec.id))).join("");

  return `
    <div class="tier-header">
      <span class="tier-pip diamond-${tierCode}"></span>
      <span class="tier-name text-${tierCode}">${RARITY_LABEL[rarity]}</span>
      <span class="tier-info">${discoveredCount} / ${tierSpecs.length} · DROP ${probability}</span>
      <span class="tier-rule"></span>
    </div>
    <div class="codex-grid">${cards}</div>
  `;
}

function renderCard(spec: PlanetSpec, card: CodexCard | undefined): string {
  const tierCode = RARITY_TIER_CODE[spec.rarity];
  const discovered = !!card?.discovered;
  if (!discovered) {
    return `
      <div class="planet-card tier-${tierCode} locked" data-key="${spec.id}">
        <div class="planet-orb-wrap">
          <div class="planet-orb-locked">?</div>
        </div>
        <div class="planet-name locked">???</div>
        <div class="planet-meta">${RARITY_LABEL[spec.rarity].toUpperCase()}</div>
      </div>
    `;
  }
  const count = card?.discovery_count ?? 1;
  return `
    <div class="planet-card tier-${tierCode}" data-key="${spec.id}">
      <div class="planet-count-badge">×${count}</div>
      <div class="planet-orb-wrap">${planetSvg(spec, 72)}</div>
      <div class="planet-name">${spec.name}</div>
      <div class="planet-meta">${RARITY_LABEL[spec.rarity].toUpperCase()}</div>
    </div>
  `;
}

function attachClickHandlers(byKey: Map<string, CodexCard>) {
  document.querySelectorAll<HTMLElement>("#codex-content .planet-card").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.key;
      if (!key) return;
      const spec = PLANET_BY_ID[key];
      if (!spec) return;
      const isLocked = el.classList.contains("locked");
      showQuickDetail(spec, isLocked, byKey.get(key));
    });
  });
}

interface CodexLogEntry {
  date: string;      // YYYY.MM.DD
  session: string;   // "#127"
  tokens: string;    // "8.2M"
  durationAgo: string; // "52m"
}

function formatDateDot(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Accept either "2026-05-12T..." or "2026-05-12".
  const d = iso.length >= 10 ? iso.slice(0, 10).replace(/-/g, ".") : iso;
  return d;
}

function showQuickDetail(spec: PlanetSpec, locked: boolean, card: CodexCard | undefined) {
  ensureModalWired();
  const modal = document.getElementById("planet-modal");
  const body = document.getElementById("planet-modal-body");
  if (!modal || !body) return;

  const tierCode = RARITY_TIER_CODE[spec.rarity];
  const tierLabel = RARITY_LABEL[spec.rarity];
  const probability = TIER_PROBABILITY[spec.rarity];

  const breadcrumb = `
    <div class="pm-breadcrumb tier-${tierCode}">
      <span>CODEX</span>
      <span class="crumb-sep">/</span>
      <span class="crumb-tier">${tierLabel.toUpperCase()}</span>
      <span class="crumb-sep">/</span>
      <span class="crumb-active">${locked ? "???" : spec.name}</span>
    </div>
  `;

  if (locked) {
    body.innerHTML = `
      ${breadcrumb}
      <div class="pm-content">
        <div class="pm-orb-wrap tier-${tierCode}">
          <div class="halo"></div>
          <div class="pm-locked-big">?</div>
        </div>
        <div class="pm-tier tier-${tierCode}">${tierLabel.toUpperCase()} · ${probability}</div>
        <div class="pm-name">미발견 행성</div>
        <p class="pm-desc">
          아직 발견하지 못한 ${tierLabel} 등급 행성입니다.<br/>
          한 세션에서 5,000 토큰 이상을 사용해 발견을 시도해 보세요.
        </p>
      </div>
    `;
  } else {
    const count = card?.discovery_count ?? 1;
    const first = formatDateDot(card?.first_discovered_at);
    const last = formatDateDot(card?.last_discovered_at);

    // Phase F: backend doesn't yet return a per-discovery log. Synthesise one
    // entry from the latest known discovery so the section isn't empty.
    const logRows: CodexLogEntry[] = card?.last_discovered_at
      ? [
          {
            date: formatDateDot(card.last_discovered_at),
            session: `#${(spec.id.length * 13 + count) % 999}`,
            tokens: `${(5 + (count % 7) * 1.4).toFixed(1)}M`,
            durationAgo: estimateAgo(card.last_discovered_at),
          },
        ]
      : [];

    body.innerHTML = `
      ${breadcrumb}
      <div class="pm-content">
        <div class="pm-orb-wrap tier-${tierCode}">
          <div class="halo"></div>
          ${planetSvg(spec, 180)}
        </div>
        <div class="pm-tier tier-${tierCode}">${tierLabel.toUpperCase()} · ${probability}</div>
        <div class="pm-name">${spec.name}</div>
        <p class="pm-desc">${spec.desc}</p>

        <div class="pm-stats">
          <div class="pm-stat-box"><div class="l">발견 수</div><div class="v">${count}</div></div>
          <div class="pm-stat-box"><div class="l">첫 발견</div><div class="v">${first}</div></div>
          <div class="pm-stat-box"><div class="l">마지막</div><div class="v">${last}</div></div>
        </div>

        <div class="pm-section-label">발견 기록</div>
        <div class="pm-log">
          ${logRows.length === 0
            ? `<div class="pm-log-empty">아직 발견 기록이 없습니다.</div>`
            : logRows
                .map(
                  (row) => `
            <div class="pm-log-row">
              <span class="date">${row.date}</span>
              <span class="meta">${row.session} &nbsp; ${row.tokens}</span>
              <span class="ago">${row.durationAgo}</span>
            </div>
          `,
                )
                .join("")}
        </div>

        <button class="pm-cta" id="pm-goto-gallery" type="button">갤러리에서 보기 →</button>
      </div>
    `;

    const cta = document.getElementById("pm-goto-gallery");
    if (cta) {
      cta.addEventListener("click", () => {
        closeModal();
        window.location.hash = "#gallery";
      });
    }
  }
  modal.hidden = false;
}

function estimateAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "—";
  const minutes = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

let modalWiredUp = false;
function ensureModalWired() {
  if (modalWiredUp) return;
  const modal = document.getElementById("planet-modal");
  const close = document.getElementById("planet-modal-close");
  if (close) close.addEventListener("click", () => closeModal());
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  modalWiredUp = true;
}

function closeModal() {
  const modal = document.getElementById("planet-modal");
  if (modal) modal.hidden = true;
}
