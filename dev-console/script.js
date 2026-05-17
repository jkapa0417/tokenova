// Tokenova dev console — talks to the running app over plain HTTP.
//
// The app binds 127.0.0.1:7777 only in debug builds AND only when started
// with TOKENOVA_DEV_CONSOLE=1, so a stranger can't reach this in production.

const ENDPOINT = "http://127.0.0.1:7777";

const els = {
  endpoint: document.getElementById("endpoint"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  stateOut: document.getElementById("state-out"),
  refresh: document.getElementById("refresh"),
  form: document.getElementById("token-form"),
  log: document.getElementById("log"),
  clearLog: document.getElementById("clear-log"),
  triggerPlanet: document.getElementById("trigger-planet"),
  triggerMythic: document.getElementById("trigger-mythic"),
  discoverAll: document.getElementById("discover-all"),
  clearTokens: document.getElementById("clear-tokens"),
  clearToday: document.getElementById("clear-today"),
  resetBootstrap: document.getElementById("reset-bootstrap"),
};

els.endpoint.textContent = ENDPOINT;

function logLine(kind, label, body) {
  const li = document.createElement("li");
  const ts = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  const cls = kind === "err" ? "err" : "ok";
  li.innerHTML = `
    <span class="ts">${ts}</span>
    <span class="${cls}">${label}</span>
    <span class="body">${escapeHtml(body)}</span>
  `;
  els.log.prepend(li);
  while (els.log.children.length > 60) els.log.lastChild.remove();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function call(path, body) {
  const url = `${ENDPOINT}${path}`;
  const init = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep as text */ }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${text}`);
  }
  return json ?? {};
}

function setStatus(ok) {
  els.statusDot.classList.toggle("ok", ok);
  els.statusDot.classList.toggle("bad", !ok);
  els.statusText.textContent = ok ? "connected" : "offline";
}

async function refresh() {
  try {
    const state = await call("/state");
    els.stateOut.textContent = JSON.stringify(state, null, 2);
    setStatus(true);
  } catch (e) {
    els.stateOut.textContent = String(e);
    setStatus(false);
  }
}

// Form submit — inject token event with the typed values.
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(els.form);
  const body = {
    provider: String(data.get("provider") || "dev_console"),
    model: String(data.get("model") || "") || null,
    input_tokens: Number(data.get("input_tokens") || 0),
    output_tokens: Number(data.get("output_tokens") || 0),
    cache_read: Number(data.get("cache_read") || 0),
    cache_write: Number(data.get("cache_write") || 0),
  };
  try {
    const res = await call("/token-event", body);
    const total = body.input_tokens + body.output_tokens + body.cache_read + body.cache_write;
    logLine("ok", "TOKEN", `+${total} (${body.provider}) → ${JSON.stringify(res)}`);
    void refresh();
  } catch (err) {
    logLine("err", "TOKEN", String(err));
  }
});

// Quick presets — fill the input/output fields with common totals.
els.form.querySelectorAll(".quick[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset;
    const map = { small: 1000, medium: 5000, large: 50000 };
    const total = map[preset] ?? 1000;
    els.form.elements.input_tokens.value = Math.round(total / 2);
    els.form.elements.output_tokens.value = total - Math.round(total / 2);
    els.form.elements.cache_read.value = 0;
    els.form.elements.cache_write.value = 0;
  });
});

els.refresh.addEventListener("click", refresh);
els.clearLog.addEventListener("click", () => { els.log.innerHTML = ""; });

els.triggerPlanet.addEventListener("click", async () => {
  try {
    const res = await call("/trigger-planet", { session_total_tokens: 6000 });
    logLine("ok", "PLANET", JSON.stringify(res));
    void refresh();
  } catch (e) { logLine("err", "PLANET", String(e)); }
});

els.triggerMythic.addEventListener("click", async () => {
  try {
    const res = await call("/trigger-mythic", {});
    logLine("ok", "MYTHIC", JSON.stringify(res));
    void refresh();
  } catch (e) { logLine("err", "MYTHIC", String(e)); }
});

els.discoverAll.addEventListener("click", async () => {
  if (!confirm("Daily cap을 무시하고 카탈로그의 모든 행성을 한꺼번에 발견 처리할까요?")) return;
  try {
    const res = await call("/discover-all", {});
    logLine("ok", "DISCOVER-ALL", `${res.inserted_count}개 행성 삽입`);
    void refresh();
  } catch (e) { logLine("err", "DISCOVER-ALL", String(e)); }
});

els.clearTokens.addEventListener("click", async () => {
  if (!confirm("오늘의 token_events를 전부 삭제하고 열린 세션도 닫을까요?")) return;
  try {
    const res = await call("/clear-tokens", {});
    logLine("ok", "CLEAR-TOKENS", JSON.stringify(res));
    void refresh();
  } catch (e) { logLine("err", "CLEAR-TOKENS", String(e)); }
});

els.clearToday.addEventListener("click", async () => {
  if (!confirm("Today의 planets / stars / codex 전부 삭제할까요?")) return;
  try {
    const res = await call("/clear-today", {});
    logLine("ok", "CLEAR", JSON.stringify(res));
    void refresh();
  } catch (e) { logLine("err", "CLEAR", String(e)); }
});

els.resetBootstrap.addEventListener("click", async () => {
  if (!confirm("First-run sentinel을 지울까요? 다음 실행 때 모든 JSONL이 다시 baseline 됩니다.")) return;
  try {
    const res = await call("/reset-bootstrap", {});
    logLine("ok", "BOOTSTRAP", JSON.stringify(res));
  } catch (e) { logLine("err", "BOOTSTRAP", String(e)); }
});

// Initial fetch + periodic refresh so state stays live.
refresh();
setInterval(refresh, 2000);
