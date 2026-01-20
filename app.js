// ✅ Versión final extendida de Amadeus Range UI
// Incluye Executive Summary Pro + render completo + análisis técnico detallado

console.log("✅ app.js cargado correctamente en", window.location.href);
const ENDPOINT = "https://amadeus-flight-proxy.yoelpm.workers.dev/search-range";

const els = {
  form: document.getElementById("searchForm"),
  statusBar: document.getElementById("statusBar"),
  results: document.getElementById("results"),
  execSummary: document.getElementById("execSummary"),
  pillBest: document.getElementById("pillBest"),
  pillRange: document.getElementById("pillRange"),
  pillReco: document.getElementById("pillReco"),
  offersTableBody: document.querySelector("#offersTable tbody"),
  offersEmpty: document.getElementById("offersEmpty"),
  heatmapLegend: document.getElementById("heatmapLegend"),
  heatmapGrid: document.getElementById("heatmapGrid"),
  heatmapEmpty: document.getElementById("heatmapEmpty"),
  recoList: document.getElementById("recoList"),
  recoEmpty: document.getElementById("recoEmpty"),
  techMetrics: document.getElementById("techMetrics"),
  btnExport: document.getElementById("btnExport"),
  btnReset: document.getElementById("btnReset"),
  useTimeout: document.getElementById("use_timeout"),
  timeoutMs: document.getElementById("timeout_ms"),
};

let lastResponse = null, lastOffers = null;

// =====================
// Utilidades base
// =====================
function setStatus(type, msg) {
  els.statusBar.classList.remove("hidden", "ok", "err", "warn");
  els.statusBar.classList.add(type);
  els.statusBar.textContent = msg;
}
function showResults() { els.results.classList.remove("hidden"); }
function resetUI() {
  els.results.classList.add("hidden");
  els.statusBar.textContent = "";
  els.statusBar.classList.add("hidden");
  els.statusBar.classList.remove("ok", "err", "warn");
}
function fmtMoney(v, cur = "USD") {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); }
  catch { return `${n.toFixed(0)} ${cur}`; }
}
function escapeHTML(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function safeDate(d) { return d ? d.slice(0, 10) : "—"; }
function getDeep(o, p, f = null) {
  try { return p.split(".").reduce((a, k) => a?.[k], o) ?? f; } catch { return f; }
}

// =====================
// Eventos principales
// =====================
async function postJSON(url, body, { timeoutMs } = {}) {
  const ctrl = new AbortController();
  const t = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } finally { if (t) clearTimeout(t); }
}

async function handleSubmit(e) {
  e.preventDefault();
  resetUI();
  const payload = readFormPayload();
  const errs = validatePayload(payload);
  if (errs.length) return setStatus("err", errs.join(" "));

  setStatus("warn", `Consultando… (${ENDPOINT})`);
  const resp = await postJSON(ENDPOINT, payload, { timeoutMs: 45000 }).catch(err => ({ ok: false, status: 0, data: { message: err.message } }));

  if (!resp.ok || !resp.data) return setStatus("err", `HTTP ${resp.status}: ${resp.data?.message ?? "Error desconocido"}`);

  const data = resp.data;
  lastResponse = data;
  lastOffers = Array.isArray(data.offers) ? data.offers : [];
  els.btnExport.disabled = false;

  const { html, pills } = buildExecutiveSummaryPro(data, payload);
  els.execSummary.innerHTML = html;
  setPills(pills);

  rerenderOffers();
  renderHeatmap(data.heatmap, payload.currency);
  renderRecommendations(data.recommendations, payload.currency);
  renderTechNotes(data);

  showResults();
  setStatus("ok", `OK. Offers: ${lastOffers.length} • Heatmap: ${data.heatmap?.length ?? 0}`);
}

// =====================
// Executive Summary Pro
// =====================
function buildExecutiveSummaryPro(data, req) {
  const offers = data.offers ?? [];
  const dedup = data.dedup_stats?.deduped_offers ?? offers.length;
  const raw = data.dedup_stats?.raw_offers ?? "—";

  const best = offers[0];
  const cheapest = getDeep(data, "extrema.cheapest");
  const priciest = getDeep(data, "extrema.priciest");

  const econOffers = offers.filter(o => (o.cabin ?? "").includes("ECONOMY"));
  const bizOffers = offers.filter(o => (o.cabin ?? "").includes("BUSINESS"));
  const bestEcon = econOffers.length ? Math.min(...econOffers.map(o => o.total_price)) : null;
  const bestBiz = bizOffers.length ? Math.min(...bizOffers.map(o => o.total_price)) : null;

  const parts = [];

  parts.push(`<h3>🧭 Resumen ejecutivo</h3>
  <p>Ruta: <strong>${req.origin} → ${req.destination}</strong>, ida ${safeDate(req.date_center)}, vuelta ${safeDate(req.return_center)}.</p>
  <p>Se encontraron ${dedup} ofertas deduplicadas (${raw} brutas).</p>`);

  if (best) parts.push(`<p>Mejor oferta: ${fmtMoney(best.total_price, best.currency)} (${best.airline ?? "—"} / ${best.cabin ?? "—"} / ${best.stops_total ?? 0} escalas).</p>`);

  if (bestEcon && bestBiz) {
    const ratio = bestBiz / bestEcon;
    const tag = ratio <= 1.3 ? "✅ comparable" : "❌ premium";
    parts.push(`<p>Clase Business desde ${fmtMoney(bestBiz, req.currency)} (${(ratio).toFixed(1)}× economy) ${tag}.</p>`);
  }

  if (cheapest?.date && cheapest?.min_price)
    parts.push(`<p>Más barato: ${safeDate(cheapest.date)} → ${fmtMoney(cheapest.min_price, cheapest.currency ?? req.currency)}.</p>`);
  if (priciest?.date && priciest?.min_price)
    parts.push(`<p>Más caro: ${safeDate(priciest.date)} → ${fmtMoney(priciest.min_price, priciest.currency ?? req.currency)}.</p>`);

  if (data.recommendations?.cheapest_date_candidates?.length)
    parts.push(`<p>🌐 Fechas fuera de rango disponibles (${data.recommendations.cheapest_date_candidates.length}).</p>`);

  return {
    html: `<div class="summary-pro">${parts.join("")}</div>`,
    pills: {
      best: best ? fmtMoney(best.total_price, best.currency) : "—",
      range: `${req.date_center} / ${req.return_center} ±${req.range_days}`,
      reco: data.recommendations?.cheapest_date_candidates?.length ? "Reco: sí" : "Reco: no",
    },
  };
}

// =====================
// Render UI
// =====================
function rerenderOffers() {
  const tb = els.offersTableBody;
  if (!tb) return;
  tb.innerHTML = "";
  if (!lastOffers?.length) return els.offersEmpty.classList.remove("hidden");
  els.offersEmpty.classList.add("hidden");
  lastOffers.slice(0, 10).forEach((o, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="right">${fmtMoney(o.total_price, o.currency)}</td>
      <td>${escapeHTML(o.airline ?? "—")}</td>
      <td>${safeDate(o.departure_date)}</td>
      <td>${safeDate(o.return_date)}</td>
      <td class="right">${o.stops_total ?? 0}</td>
      <td class="right">${escapeHTML(o.duration_out ?? "—")}</td>
      <td class="right">${o.score ?? "—"}</td>
      <td>${o.link ? `<a href="${o.link}" target="_blank">🔗</a>` : "—"}</td>`;
    tb.appendChild(tr);
  });
}
function renderHeatmap(h, cur) {
  els.heatmapGrid.innerHTML = "";
  els.heatmapLegend.innerHTML = "";
  if (!h?.length) return els.heatmapEmpty.classList.remove("hidden");
  els.heatmapEmpty.classList.add("hidden");

  const prices = h.map(x => x.min_price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const grid = document.createElement("div");
  grid.classList.add("heatmap-grid-inner");

  h.forEach(x => {
    const ratio = (x.min_price - min) / (max - min);
    const color = `hsl(${120 - ratio * 120}, 60%, 45%)`;
    const cell = document.createElement("div");
    cell.classList.add("heatmap-cell");
    cell.style.backgroundColor = color;
    cell.title = `${safeDate(x.date)} → ${fmtMoney(x.min_price, cur)}`;
    grid.appendChild(cell);
  });

  els.heatmapGrid.appendChild(grid);
  els.heatmapLegend.innerHTML = `<span>${fmtMoney(min, cur)}</span> → <span>${fmtMoney(max, cur)}</span>`;
}
function renderRecommendations(r, cur) {
  els.recoList.innerHTML = "";
  if (!r?.cheapest_date_candidates?.length) return els.recoEmpty.classList.remove("hidden");
  els.recoEmpty.classList.add("hidden");

  r.cheapest_date_candidates.slice(0, 5).forEach(x => {
    const div = document.createElement("div");
    div.classList.add("reco-item");
    div.innerHTML = `<strong>${safeDate(x.departure_date)} → ${safeDate(x.return_date)}</strong> ${fmtMoney(x.total_price, x.currency ?? cur)} <span class="tag">fuera de rango</span>`;
    els.recoList.appendChild(div);
  });
}
function renderTechNotes(d) {
  const s = d.stats ?? {}, ds = d.dedup_stats ?? {};
  const lines = [];
  lines.push(`raw_offers: ${ds.raw_offers ?? "?"} | deduped: ${ds.deduped_offers ?? "?"}`);
  lines.push(`completadas: ${s.completed ?? "?"} / ${s.started ?? "?"} | fallidas: ${s.failed ?? 0}`);
  lines.push(`deadline: ${s.hard_deadline_ms ?? "?"} ms | timeout por request: ${s.per_call_timeout_ms ?? "?"} ms`);
  if (d.recommendations?.price_analysis === null) lines.push("⚠️ Price analysis: null (timeout probable)");
  if (d.recommendations?.choice_prediction_applied === false) lines.push("⚠️ Choice prediction: no aplicado");
  els.techMetrics.textContent = lines.join("\n");
}
function setPills(p) {
  const pill = { best: els.pillBest, range: els.pillRange, reco: els.pillReco };
  Object.entries(pill).forEach(([k, el]) => {
    const v = p[k];
    if (v) { el.textContent = v; el.classList.remove("hidden"); }
    else el.classList.add("hidden");
  });
}

// =====================
// Form helpers
// =====================
function readFormPayload() {
  return {
    origin: document.getElementById("origin").value.trim().toUpperCase(),
    destination: document.getElementById("destination").value.trim().toUpperCase(),
    date_center: document.getElementById("date_center").value,
    return_center: document.getElementById("return_center").value,
    range_days: Number(document.getElementById("range_days").value || 7),
    currency: document.getElementById("currency").value,
    ranking_mode: document.getElementById("ranking_mode").value,
    enable_recommendations: document.getElementById("enable_recommendations")?.checked ?? true,
    reco_horizon_days: 7, reco_top_k: 15,
    enable_price_analysis: true, enable_choice_prediction: true,
  };
}
function validatePayload(p) {
  const e = [];
  if (!/^[A-Z]{3}$/.test(p.origin)) e.push("Origen inválido.");
  if (!/^[A-Z]{3}$/.test(p.destination)) e.push("Destino inválido.");
  if (!p.date_center) e.push("Fecha ida requerida.");
  if (!p.return_center) e.push("Fecha vuelta requerida.");
  return e;
}
function hydrateDefaults() {
  document.getElementById("origin").value = "EZE";
  document.getElementById("destination").value = "CDG";
  document.getElementById("date_center").value = "2026-07-03";
  document.getElementById("return_center").value = "2026-07-14";
  document.getElementById("range_days").value = 7;
}
function attachEvents() {
  els.form.addEventListener("submit", handleSubmit);
  els.btnReset.addEventListener("click", hydrateDefaults);
  console.log("✅ Eventos conectados");
}

// =====================
// Init
// =====================
hydrateDefaults();
attachEvents();
setStatus("ok", "Listo. Configurá y ejecutá una búsqueda.");
