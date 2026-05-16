// Achievements view: starter list (Phase E scope). Each card shows display
// name + earned date if applicable.

import { invoke } from "@tauri-apps/api/core";

interface AchievementCard {
  key: string;
  display_name: string;
  achieved: boolean;
  achieved_at: string | null;
}

export async function activateAchievements(): Promise<void> {
  const $list = document.getElementById("ach-list");
  if (!$list) return;
  try {
    const items = await invoke<AchievementCard[]>("get_achievements");
    if (items.length === 0) {
      $list.innerHTML = `<li class="ach-empty">업적이 비어 있어요.</li>`;
      return;
    }
    $list.innerHTML = items.map(renderRow).join("");
  } catch (e) {
    console.error("achievements:", e);
    $list.innerHTML = `<li class="ach-empty">로딩 실패</li>`;
  }
}

function renderRow(a: AchievementCard): string {
  const cls = a.achieved ? "ach-on" : "ach-off";
  const icon = a.achieved ? "✦" : "·";
  const when = a.achieved && a.achieved_at
    ? `<div class="ach-when">${new Date(a.achieved_at).toLocaleDateString("ko-KR")} 달성</div>`
    : `<div class="ach-when">미달성</div>`;
  return `
    <li class="ach-row ${cls}">
      <span class="ach-icon">${icon}</span>
      <div class="ach-text">
        <div class="ach-name">${a.display_name}</div>
        ${when}
      </div>
    </li>
  `;
}
