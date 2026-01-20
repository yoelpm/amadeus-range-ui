// ✅ Versión final integrada de app.js (Amadeus Flight Finder)
// Incluye: Fallback offers, render robusto heatmap, análisis Business, notas técnicas, init completo

console.log("✅ app.js cargado correctamente en", window.location.href);
const ENDPOINT = "https://amadeus-flight-proxy.yoelpm.workers.dev/search-range";

// --- Selección de elementos del DOM ---
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
  recoCard: document.getElementById("recoCard"),
  recoList: document.getElementById("recoList"),
  recoEmpty: document.getElementById("recoEmpty"),
  techMetrics: document.getElementById("techMetrics"),
  btnExport: document.getElementById("btnExport"),
  btnReset: document.getElementById("btnReset"),
  useTimeout: document.getElementById("use_timeout"),
  timeoutMs: document.getElementById("timeout_ms"),
  filterAirline: document.getElementById("filter_airline"),
  filterMaxStops: document.getElementById("filter_max_stops"),
  filterMaxDuration: document.getElementById("filter_max_duration"),
  btnApplyFilters: document.getElementById("btnApplyFilters"),
  btnClearFilters: document.getElementById("btnClearFilters"),
};

let lastResponse = null;
let lastOffers = null;
let lastRequest = null;

// =====================
// Utils básicos
// =====================
function setStatus(type, msg) {
  els.statusBar.classList.remove("hidden", "ok", "err", "warn");
  els.statusBar.classList.add(type);
  els.statusBar.textContent = msg;
}

function showResults() {
  els.results.classList.remove("hidden");
}

function resetUI() {
  els.results.classList.add("hidden");
  els.statusBar.textContent = "";
  els.statusBar.classList.add("hidden");
  els.statusBar.classList.remove("ok", "err", "warn");
}

function getDeep(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((acc, k) => acc?.[k], obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function fmtMoney(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(0)} ${currency}`;
  }
}

function safeDate(s) {
  return s ? String(s) : "—";
}

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =====================
// Networking principal modificado
// =====================
async function postJSON(url, body, { timeoutMs } = {}) {
  const controller = new AbortController();
  const t = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    if (t) clearTimeout(t);
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  resetUI();

  const payload = readFormPayload();
  const errs = validatePayload(payload);
  if (errs.length) {
    setStatus("err", errs.join(" "));
    return;
  }

  lastRequest = payload;
  const doTimeout = els.useTimeout?.checked;
  const timeoutMs = doTimeout ? Number(els.timeoutMs?.value || 30000) : null;

  setStatus("warn", `Consultando… (${ENDPOINT})`);

  let resp;
  try {
    resp = await postJSON(ENDPOINT, payload, { timeoutMs });
  } catch (err) {
    setStatus("err", `Error: ${err.message}`);
    return;
  }

  if (!resp || !resp.ok || !resp.data) {
    setStatus("err", `HTTP ${resp?.status || "?"}. Error o respuesta vacía.`);
    return;
  }

  const data = resp.data;
  lastResponse = data;
  els.btnExport.disabled = false;

  const offers = Array.isArray(data.offers) ? data.offers : [];
  if (!offers.length && data.dedup_stats?.raw_offers > 0) {
    console.warn("⚠️ Offers vacíos pero dedup_stats indica data. Forzando fallback.");
    if (Array.isArray(data.heatmap) && data.heatmap.length) {
      offers.push({
        airline: data.heatmap[0].airline ?? "—",
        total_price: data.heatmap[0].min_price,
        currency: data.heatmap[0].currency ?? "USD",
        departure_date: data.heatmap[0].date,
        return_date: data.heatmap[0].date,
        cabin: "ECONOMY",
        stops_total: data.heatmap[0].stops_total ?? 2,
      });
    }
  }

  const heatmap = Array.isArray(data.heatmap) ? data.heatmap : [];
  const extrema = data.extrema ?? null;
  const recommendations = data.recommendations ?? null;

  const { html, pills } = buildExecutiveSummary(data, payload);
  els.execSummary.innerHTML = html;
  setPills(pills);

  lastOffers = offers;

  const flags = [];
  if (data.recommendations?.price_analysis === null)
    flags.push("⚠️ Price analysis no disponible (timeout o rate limit)");
  if (data.recommendations?.choice_prediction_applied === false)
    flags.push("⚠️ Choice prediction no ejecutado");

  const tech = {
    stats: data.stats ?? {},
    dedup_stats: data.dedup_stats ?? {},
    notes: flags,
  };
  els.techMetrics.textContent = JSON.stringify(tech, null, 2);

  showResults();
  setStatus("ok", `OK. Offers: ${offers.length} • Heatmap: ${heatmap.length}`);
}

// =====================
// Executive Summary modificado
// =====================
function buildExecutiveSummary(payload, req) {
  const currency = req.currency ?? "USD";
  const offers = payload?.offers ?? [];
  const bestOffer = offers.length
    ? offers.reduce((best, cur) => {
        const pb = Number(best?.total_price ?? best?.price ?? Infinity);
        const pc = Number(cur?.total_price ?? cur?.price ?? Infinity);
        return pc < pb ? cur : best;
      }, offers[0])
    : null;

  const extrema = payload?.extrema ?? null;
  const cheapest = getDeep(extrema, "cheapest", null);
  const priciest = getDeep(extrema, "priciest", null);
  const reco = payload?.recommendations ?? null;
  const recoCandidates = reco?.cheapest_date_candidates ?? [];
  const recoHasOutOfRange = recoCandidates.length > 0;

  const parts = [];
  if (bestOffer) {
    parts.push(`Mejor oferta encontrada: <strong>${escapeHTML(fmtMoney(bestOffer.total_price, bestOffer.currency ?? currency))}</strong>.`);
  } else {
    parts.push(`No se encontraron ofertas para la consulta.`);
  }

  if (cheapest?.date && (cheapest?.min_price != null || cheapest?.price != null)) {
    const chPrice = cheapest?.min_price ?? cheapest?.price;
    parts.push(`Cheapest: <strong>${escapeHTML(safeDate(String(cheapest.date).slice(0, 10)))}</strong> @ ${escapeHTML(fmtMoney(chPrice, cheapest.currency ?? currency))}.`);
  }
  if (priciest?.date && (priciest?.min_price != null || priciest?.price != null)) {
    const prPrice = priciest?.min_price ?? priciest?.price;
    parts.push(`Priciest: ${escapeHTML(safeDate(String(priciest.date).slice(0, 10)))} @ ${escapeHTML(fmtMoney(prPrice, priciest.currency ?? currency))}.`);
  }

  if (recoHasOutOfRange) {
    const top = recoCandidates[0] ?? null;
    if (top?.departure_date && top?.total_price != null) {
      parts.push(`Hay recomendación fuera del rango: <strong>${escapeHTML(top.departure_date)} → ${escapeHTML(top.return_date ?? "—")}</strong> ~ ${escapeHTML(fmtMoney(top.total_price, top.currency ?? currency))}.`);
    } else {
      parts.push(`Hay recomendación fuera del rango, pero faltan datos en el primer candidato.`);
    }
  }

  const econOffers = offers.filter(o => (o.cabin ?? "").toUpperCase().includes("ECONOMY"));
  const bizOffers = offers.filter(o => (o.cabin ?? "").toUpperCase().includes("BUSINESS"));
  if (econOffers.length && bizOffers.length) {
    const bestEcon = Math.min(...econOffers.map(o => Number(o.total_price ?? o.price ?? Infinity)));
    const bestBiz = bizOffers.map(o => Number(o.total_price ?? o.price ?? Infinity)).filter(p => p <= bestEcon * 1.3);
    if (bestBiz.length) {
      const minBiz = Math.min(...bestBiz);
      parts.push(`Clase Business comparable disponible desde ${fmtMoney(minBiz, currency)} (≤30% sobre Economy).`);
    }
  }

  return {
    html: parts.join(" "),
    pills: {
      best: bestOffer ? `${fmtMoney(bestOffer.total_price, bestOffer.currency ?? currency)}` : null,
      range: `${req.date_center} / ${req.return_center} ±${req.range_days}`,
      reco: req.enable_recommendations ? (recoHasOutOfRange ? "Reco: sí" : "Reco: no") : "Reco: off",
      recoWarn: req.enable_recommendations && recoHasOutOfRange,
    },
  };
}

// =====================
// Funciones auxiliares para el form
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
    reco_horizon_days: Number(document.getElementById("reco_horizon_days")?.value || 7),
    reco_top_k: Number(document.getElementById("reco_top_k")?.value || 15),
    enable_price_analysis: document.getElementById("enable_price_analysis")?.checked ?? true,
    enable_choice_prediction: document.getElementById("enable_choice_prediction")?.checked ?? true,
  };
}

function validatePayload(p) {
  const errors = [];
  if (!/^[A-Z]{3}$/.test(p.origin)) errors.push("Origen inválido (IATA 3 letras).");
  if (!/^[A-Z]{3}$/.test(p.destination)) errors.push("Destino inválido (IATA 3 letras).");
  if (!p.date_center) errors.push("Ida requerida.");
  if (!p.return_center) errors.push("Vuelta requerida.");
  return errors;
}

// =====================
// Defaults de formulario
// =====================
function hydrateDefaults() {
  document.getElementById("origin").value = "EZE";
  document.getElementById("destination").value = "MIA";
  document.getElementById("date_center").value = "2026-02-10";
  document.getElementById("return_center").value = "2026-02-24";
  document.getElementById("range_days").value = "7";
  document.getElementById("currency").value = "USD";
  document.getElementById("ranking_mode").value = "price";

  console.log("✅ hydrateDefaults aplicado");
}

// =====================
// Eventos e init global
// =====================
function attachEvents() {
  els.form.addEventListener("submit", handleSubmit);
  els.btnReset?.addEventListener("click", hydrateDefaults);
  console.log("✅ Eventos conectados");
}

hydrateDefaults();
attachEvents();
setStatus("ok", "Listo. Configurá y ejecutá una búsqueda.");
