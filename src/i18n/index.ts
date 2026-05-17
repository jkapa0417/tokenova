// Tiny dictionary-based i18n.
//
// Why a hand-rolled module instead of a library: this app has ~300 strings
// across two locales and no framework. Pulling in i18next adds bundle weight
// + a config dance for the same result. The public surface is small:
//
//   t("nav.today")                              // → "오늘" / "Today"
//   t("today.constellation_count", { n: 3 })    // interpolation
//   await initI18n()                            // run once at startup
//   await setLocale("en")                       // persist + notify
//   subscribeLocale((l) => repaint())           // refresh on change
//   applyDomI18n()                              // fill [data-i18n] attrs
//
// Persisted via the existing get_setting/set_setting Tauri commands under
// key "locale". First run: try the OS UI language; fall back to "ko".

import { invoke } from "@tauri-apps/api/core";

import { ko } from "./locales/ko";
import { en } from "./locales/en";

export type Locale = "ko" | "en";

/// The master dictionary type — derived from `ko` so TypeScript flags missing
/// keys in `en` at compile time. New strings must be added to BOTH locales.
export type Dictionary = typeof ko;

const DICTS: Record<Locale, Dictionary> = { ko, en: en as Dictionary };
const SETTING_KEY = "locale";
const FALLBACK_LOCALE: Locale = "ko";

let currentLocale: Locale = FALLBACK_LOCALE;
const subscribers = new Set<(l: Locale) => void>();

/// Resolve a dotted key (e.g. "today.hud.tokens") against the current dict.
/// Returns the key itself when missing so untranslated keys are visible in
/// dev rather than silently rendering as empty.
function lookup(key: string, locale: Locale): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = DICTS[locale];
  for (const p of parts) {
    if (node == null) return key;
    node = node[p];
  }
  if (typeof node !== "string") return key;
  return node;
}

/// Translate. Supports `{name}` placeholders filled from `params`.
export function t(key: string, params?: Record<string, string | number>): string {
  let out = lookup(key, currentLocale);
  if (out === key) {
    // Fallback to ko before giving up — lets us ship en partially translated.
    if (currentLocale !== FALLBACK_LOCALE) out = lookup(key, FALLBACK_LOCALE);
  }
  if (params) {
    out = out.replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : m,
    );
  }
  return out;
}

export function getLocale(): Locale {
  return currentLocale;
}

export async function setLocale(next: Locale): Promise<void> {
  if (next === currentLocale) return;
  currentLocale = next;
  try {
    await invoke("set_locale", { value: next });
  } catch (e) {
    console.warn("[i18n] persist failed:", e);
  }
  document.documentElement.setAttribute("lang", next);
  applyDomI18n();
  for (const fn of subscribers) fn(next);
}

export function subscribeLocale(fn: (l: Locale) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/// One-time bootstrap. Pulls the saved preference, falls back to system
/// locale heuristic, finally Korean. Should be awaited before first paint.
export async function initI18n(): Promise<void> {
  let resolved: Locale = FALLBACK_LOCALE;
  try {
    const stored = await invoke<string | null>("get_setting", {
      key: SETTING_KEY,
    });
    if (stored === "ko" || stored === "en") {
      resolved = stored;
    } else {
      resolved = detectSystemLocale();
    }
  } catch {
    resolved = detectSystemLocale();
  }
  currentLocale = resolved;
  document.documentElement.setAttribute("lang", resolved);
}

function detectSystemLocale(): Locale {
  const langs = (
    typeof navigator !== "undefined" && Array.isArray(navigator.languages)
      ? navigator.languages
      : [typeof navigator !== "undefined" ? navigator.language : ""]
  ) as string[];
  for (const l of langs) {
    if (!l) continue;
    if (l.toLowerCase().startsWith("ko")) return "ko";
    if (l.toLowerCase().startsWith("en")) return "en";
  }
  return FALLBACK_LOCALE;
}

/// Walk `[data-i18n]` (textContent), `[data-i18n-html]` (innerHTML), and
/// `[data-i18n-attr-*]` (attribute values) descendants of `root` (or
/// document) and fill them with current-locale strings.
///
/// Examples:
///   <span data-i18n="nav.today">…</span>
///   <input data-i18n-attr-placeholder="today.draw_bar.name_placeholder">
export function applyDomI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml!;
    el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith("data-i18n-attr-")) continue;
      const target = attr.name.slice("data-i18n-attr-".length);
      el.setAttribute(target, t(attr.value));
    }
  });
}

/// Locale-aware number formatter — used by HUD readouts. Falls back to
/// "ko-KR" / "en-US" patterns automatically.
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(currentLocale === "ko" ? "ko-KR" : "en-US").format(n);
}
