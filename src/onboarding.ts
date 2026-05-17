// First-launch welcome modal.
//
// Detection: a localStorage key flagged after dismissal — onboarding is
// per-machine cosmetic state, not worth a DB roundtrip. Re-install on the
// same machine still shows it again (localStorage scoped to the webview's
// origin, which is the same across reinstalls), so users get re-oriented if
// they intentionally wipe and reinstall.
//
// Renders into a fullscreen overlay above all views. Dismiss via close
// button, backdrop click, Escape key, or the "시작하기 / Get started" CTA.

import { getLocale, setLocale, t } from "./i18n";

const STORAGE_KEY = "tokenova.onboarding.seen";

export function maybeShowOnboarding(): void {
  if (localStorage.getItem(STORAGE_KEY) === "true") return;
  // Defer slightly so the first paint of the universe canvas isn't held up.
  setTimeout(() => showOnboarding(), 600);
}

function dismiss(overlay: HTMLElement): void {
  localStorage.setItem(STORAGE_KEY, "true");
  overlay.classList.add("fade-out");
  setTimeout(() => overlay.remove(), 250);
}

function showOnboarding(): void {
  if (document.getElementById("onboarding-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "onboarding-overlay";
  overlay.className = "onboarding-overlay";
  overlay.innerHTML = render();
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss(overlay);
  });
  overlay.querySelector("[data-onb-close]")?.addEventListener("click", () =>
    dismiss(overlay),
  );
  overlay.querySelector("[data-onb-cta]")?.addEventListener("click", () =>
    dismiss(overlay),
  );

  // Language quick-switch inside the welcome card so users land in the right
  // locale without hunting through Settings first.
  overlay.querySelectorAll<HTMLButtonElement>("[data-onb-locale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const locale = btn.dataset.onbLocale as "ko" | "en" | undefined;
      if (!locale) return;
      void setLocale(locale).then(() => {
        // Re-render the modal with new strings.
        overlay.innerHTML = render();
        wireRendered(overlay);
      });
    });
  });

  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") {
      dismiss(overlay);
      document.removeEventListener("keydown", onEsc);
    }
  });
}

function wireRendered(overlay: HTMLElement): void {
  overlay.querySelector("[data-onb-close]")?.addEventListener("click", () =>
    dismiss(overlay),
  );
  overlay.querySelector("[data-onb-cta]")?.addEventListener("click", () =>
    dismiss(overlay),
  );
  overlay.querySelectorAll<HTMLButtonElement>("[data-onb-locale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const locale = btn.dataset.onbLocale as "ko" | "en" | undefined;
      if (!locale) return;
      void setLocale(locale).then(() => {
        overlay.innerHTML = render();
        wireRendered(overlay);
      });
    });
  });
}

function render(): string {
  const isMacOS = /mac/i.test(navigator.platform || "") || /mac/i.test(navigator.userAgent || "");
  const isWindows = /win/i.test(navigator.platform || "") || /windows/i.test(navigator.userAgent || "");
  const cur = getLocale();
  return `
    <div class="onboarding-card">
      <button class="onboarding-close" type="button" data-onb-close aria-label="Close">×</button>

      <div class="onboarding-hero">
        <img src="src-tauri/icons/icon.png" alt="" class="onboarding-logo" />
        <h1 class="onboarding-title">${escapeHtml(t("onboarding.title"))}</h1>
        <p class="onboarding-subtitle">${escapeHtml(t("onboarding.subtitle"))}</p>
      </div>

      <ul class="onboarding-points">
        <li>
          <span class="onb-num">1</span>
          <span>${escapeHtml(t("onboarding.points.tray", { where: isMacOS ? t("onboarding.where.macos") : isWindows ? t("onboarding.where.windows") : t("onboarding.where.linux") }))}</span>
        </li>
        <li>
          <span class="onb-num">2</span>
          <span>${escapeHtml(t("onboarding.points.stars"))}</span>
        </li>
        <li>
          <span class="onb-num">3</span>
          <span>${escapeHtml(t("onboarding.points.archive"))}</span>
        </li>
      </ul>

      <div class="onboarding-prefs">
        <div class="onb-pref-label">${escapeHtml(t("onboarding.language"))}</div>
        <div class="onb-pref-row">
          <button
            type="button"
            data-onb-locale="ko"
            class="onb-pref-btn ${cur === "ko" ? "on" : ""}"
          >한국어</button>
          <button
            type="button"
            data-onb-locale="en"
            class="onb-pref-btn ${cur === "en" ? "on" : ""}"
          >English</button>
        </div>
      </div>

      <button class="onboarding-cta" type="button" data-onb-cta>
        ${escapeHtml(t("onboarding.cta"))}
      </button>

      <p class="onboarding-footer">${escapeHtml(t("onboarding.footer"))}</p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}
