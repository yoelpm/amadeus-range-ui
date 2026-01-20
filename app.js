// ✅ Versión adaptada de app.js (Amadeus Flight Finder)
// Cambios incluidos:
// 1. Fallback de offers vacío
// 2. Render robusto del heatmap
// 3. Análisis Business comparable (≤30% premium)
// 4. Notas técnicas en Tech Metrics

// --- Inicio ---
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

// ... (todas tus declaraciones y funciones previas se mantienen igual)

// =====================
// Networking principal modificado
// =====================
async function handleSubmit(e){
  e.preventDefault();
  resetUI();

  const payload = readFormPayload();
  const errs = validatePayload(payload);
  if (errs.length){
    setStatus("err", errs.join(" "));
    return;
  }

  lastRequest = payload;

  const doTimeout = els.useTimeout.checked;
  const timeoutMs = doTimeout ? Number(els.timeoutMs.value || 30000) : null;

  setStatus("warn", `Consultando… (${ENDPOINT})`);

  let resp;
  try {
    resp = await postJSON(ENDPOINT, payload, { timeoutMs });
  } catch (err){
    if (String(err?.name) === "AbortError"){
      setStatus("err", `Timeout: la request excedió ${timeoutMs}ms.`);
      return;
    }
    setStatus("err", `Error de red: ${err?.message ?? String(err)}`);
    return;
  }

  if (!resp){
    setStatus("err", "Respuesta vacía (no se recibió nada).");
    return;
  }

  if (!resp.ok){
    const msg = resp.data?.error ?? resp.data?.message ?? JSON.stringify(resp.data ?? {});
    setStatus("err", `HTTP ${resp.status}. ${msg || "Error"}`);
    return;
  }

  if (!resp.data || typeof resp.data !== "object"){
    setStatus("err", "Respuesta vacía o no-JSON.");
    return;
  }

  const data = resp.data;
  lastResponse = data;
  els.btnExport.disabled = false;

  // ✅ FIX 1: fallback offers vacío
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
        stops_total: data.heatmap[0].stops_total ?? 2
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
  populateAirlineFilter(offers);
  rerenderOffers();

  // ✅ FIX 2: render robusto del heatmap
  renderHeatmap(heatmap, payload.currency, extrema);
  renderRecommendations(recommendations, payload.currency);

  // ✅ FIX 4: notas técnicas extendidas
  const flags = [];
  if (data.recommendations?.price_analysis === null)
    flags.push("⚠️ Price analysis no disponible (timeout o rate limit)");
  if (data.recommendations?.choice_prediction_applied === false)
    flags.push("⚠️ Choice prediction no ejecutado");

  const tech = {
    stats: data.stats ?? {},
    dedup_stats: data.dedup_stats ?? {},
    notes: flags
  };
  els.techMetrics.textContent = JSON.stringify(tech, null, 2);

  showResults();
  setStatus("ok", `OK. Offers: ${offers.length} • Heatmap: ${heatmap.length}`);
}

// =====================
// Executive Summary modificado
// =====================
function buildExecutiveSummary(payload, req){
  const currency = req.currency ?? "USD";
  const offers = payload?.offers ?? [];
  const bestOffer = offers.length ? offers.reduce((best, cur) => {
    const pb = Number(getOfferRow(best, payload, req).price);
    const pc = Number(getOfferRow(cur, payload, req).price);
    if (!Number.isFinite(pb)) return cur;
    if (!Number.isFinite(pc)) return best;
    return pc < pb ? cur : best;
  }, offers[0]) : null;

  const extrema = payload?.extrema ?? null;
  const cheapest = getDeep(extrema, "cheapest", null);
  const priciest = getDeep(extrema, "priciest", null);

  const reco = payload?.recommendations ?? null;
  const recoCandidates = reco?.cheapest_date_candidates ?? [];
  const recoHasOutOfRange = recoCandidates.length > 0;

  const parts = [];
  if (bestOffer){
    const r = getOfferRow(bestOffer, payload, req);
    parts.push(`Mejor oferta encontrada: <strong>${escapeHTML(fmtMoney(r.price, r.currency ?? currency))}</strong>.`);
  } else {
    parts.push(`No se encontraron ofertas para la consulta.`);
  }

  if (cheapest?.date && (cheapest?.min_price != null || cheapest?.price != null)){
    const chPrice = cheapest?.min_price ?? cheapest?.price;
    parts.push(`Cheapest: <strong>${escapeHTML(safeDate(String(cheapest.date).slice(0,10)))}</strong> @ ${escapeHTML(fmtMoney(chPrice, cheapest.currency ?? currency))}.`);
  }
  if (priciest?.date && (priciest?.min_price != null || priciest?.price != null)){
    const prPrice = priciest?.min_price ?? priciest?.price;
    parts.push(`Priciest: ${escapeHTML(safeDate(String(priciest.date).slice(0,10)))} @ ${escapeHTML(fmtMoney(prPrice, priciest.currency ?? currency))}.`);
  }

  if (recoHasOutOfRange){
    const top = recoCandidates[0] ?? null;
    const r = getOfferRow(top, payload, req);
    if (r.depDate && r.price != null) {
      parts.push(`Hay recomendación fuera del rango: <strong>${escapeHTML(r.depDate)} → ${escapeHTML(r.retDate ?? "—")}</strong> ~ ${escapeHTML(fmtMoney(r.price, r.currency ?? currency))}.`);
    } else {
      parts.push(`Hay recomendación fuera del rango, pero faltan datos en el primer candidato.`);
    }
  } else if (req.enable_recommendations){
    parts.push(`No hubo fechas fuera de rango que mejoren claramente el resultado.`);
  }

  // ✅ FIX 3: análisis Business comparable
  const econOffers = offers.filter(o => (o.cabin ?? "").toUpperCase().includes("ECONOMY"));
  const bizOffers = offers.filter(o => (o.cabin ?? "").toUpperCase().includes("BUSINESS"));

  if (econOffers.length && bizOffers.length) {
    const bestEcon = Math.min(...econOffers.map(o => Number(o.total_price ?? o.price ?? Infinity)));
    const bestBiz = bizOffers
      .map(o => Number(o.total_price ?? o.price ?? Infinity))
      .filter(p => p <= bestEcon * 1.3);
    if (bestBiz.length) {
      const minBiz = Math.min(...bestBiz);
      parts.push(`Clase Business comparable disponible desde ${fmtMoney(minBiz, currency)} (≤30% sobre Economy).`);
    }
  }

  return {
    html: parts.join(" "),
    pills: {
      best: bestOffer ? `${fmtMoney(getOfferRow(bestOffer, payload, req).price, getOfferRow(bestOffer, payload, req).currency ?? currency)}` : null,
      range: `${req.date_center} / ${req.return_center} ±${req.range_days}`,
      reco: req.enable_recommendations ? (recoHasOutOfRange ? "Reco: sí" : "Reco: no") : "Reco: off",
      recoWarn: req.enable_recommendations && recoHasOutOfRange
    }
  };
}
// =====================
// Inicialización global
// =====================
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

  // Si existen los toggles
  const enableRecommendations = document.getElementById("enable_recommendations");
  if (enableRecommendations) enableRecommendations.checked = true;

  const enablePriceAnalysis = document.getElementById("enable_price_analysis");
  if (enablePriceAnalysis) enablePriceAnalysis.checked = true;

  const enableChoicePrediction = document.getElementById("enable_choice_prediction");
  if (enableChoicePrediction) enableChoicePrediction.checked = true;

  const recoHorizon = document.getElementById("reco_horizon_days");
  if (recoHorizon) recoHorizon.value = 7;

  const recoTopK = document.getElementById("reco_top_k");
  if (recoTopK) recoTopK.value = 15;

  console.log("✅ hydrateDefaults aplicado");
  
hydrateDefaults();
attachEvents();
setStatus("ok", "Listo. Configurá y ejecutá una búsqueda.");
// --- Fin ---
