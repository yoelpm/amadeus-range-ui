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

  recoCard: document.getElementById("recoCard"),
  recoList: document.getElementById("recoList"),
  recoEmpty: document.getElementById("recoEmpty"),

  techMetrics: document.getElementById("techMetrics"),

  btnExport: document.getElementById("btnExport"),
  btnReset: document.getElementById("btnReset"),

  useTimeout: document.getElementById("use_timeout"),
  timeoutMs: document.getElementById("timeout_ms"),

  // filtros
  filterAirline: document.getElementById("filter_airline"),
  filterMaxStops: document.getElementById("filter_max_stops"),
  filterMaxDuration: document.getElementById("filter_max_duration"),
  btnApplyFilters: document.getElementById("btnApplyFilters"),
  btnClearFilters: document.getElementById("btnClearFilters"),
};

let lastResponse = null;   // response completo (para dictionaries, etc)
let lastOffers = null;     // offers base (sin filtrar)
let lastRequest = null;    // request actual

let sortState = { key: "price", dir: "asc" }; // default: precio asc

function setStatus(type, msg){
  els.statusBar.classList.remove("hidden","ok","err","warn");
  els.statusBar.classList.add(type);
  els.statusBar.textContent = msg;
}
function clearStatus(){
  els.statusBar.classList.add("hidden");
  els.statusBar.textContent = "";
  els.statusBar.classList.remove("ok","err","warn");
}
function showResults(){ els.results.classList.remove("hidden"); }
function hideResults(){ els.results.classList.add("hidden"); }

function normalizeIATA(s){
  return (s || "").trim().toUpperCase().slice(0,3);
}

function fmtMoney(value, currency){
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(0)} ${currency}`;
  }
}

function safeDate(s){
  if (!s) return "—";
  return String(s);
}

function downloadJSON(obj, filename = "amadeus-response.json"){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getDeep(obj, path, fallback = undefined){
  try {
    return path.split(".").reduce((acc, k) => acc?.[k], obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// --------- Airline dictionary ----------
function airlineFullName(code, payload){
  const c = String(code ?? "").trim();
  if (!c) return "—";
  const name = payload?.dictionaries?.carriers?.[c];
  return name ? `${name} (${c})` : c;
}

function googleFlightsLink(origin, destination, depDate, retDate, airlineCode){
  // Link “búsqueda” (no deep-link exacto al offer). Incluye el código para acercar resultados.
  const q = `${origin} ${destination} ${depDate} ${retDate}${airlineCode ? ` ${airlineCode}` : ""}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// --------- Duration helpers ----------
function parseDurationToMinutes(isoDur){
  if (!isoDur || typeof isoDur !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(isoDur);
  if (!m) return null;
  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const mins = Number(m[3] || 0);
  const secs = Number(m[4] || 0);
  return days * 1440 + hours * 60 + mins + Math.round(secs / 60);
}

function durationMinutesFromWorkerOffer(o){
  const out = parseDurationToMinutes(o?.duration_out);
  const back = parseDurationToMinutes(o?.duration_back);
  const sum = (out ?? 0) + (back ?? 0);
  return (out == null && back == null) ? null : sum;
}

function fmtDurationMinutes(mins){
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2,"0")}m`;
}

// --------- Normalize offer row ----------
function getOfferRow(o, payload, req){
  const dep = o?.departure_date ?? o?.departureDate ?? null;
  const ret = o?.return_date ?? o?.returnDate ?? null;

  const airlineCode = o?.airline ?? o?.carrierCode ?? o?.airline_out ?? null;
  const airlineLabel = airlineFullName(airlineCode, payload);

  const cabin = o?.cabin ?? o?.travelClass ?? o?.class ?? "—";

  const stopsTotalRaw = Number(o?.stops_total);
  const stopsTotal = Number.isFinite(stopsTotalRaw) ? stopsTotalRaw : null;

  const durMin = durationMinutesFromWorkerOffer(o);

  const price = Number(o?.total_price ?? o?.price?.total ?? o?.price_total ?? o?.price ?? NaN);
  const currency = o?.currency ?? o?.price?.currency ?? payload?.currency ?? req?.currency ?? "USD";

  const score = Number(o?.value_score ?? o?.choice_probability ?? o?.score ?? NaN);

  const depDate = dep ? String(dep).slice(0,10) : null;
  const retDate = ret ? String(ret).slice(0,10) : null;

  const link = (req?.origin && req?.destination && depDate && retDate)
    ? googleFlightsLink(req.origin, req.destination, depDate, retDate, airlineCode)
    : null;

  return {
    airlineCode,
    airlineLabel,
    cabin,
    depDate,
    retDate,
    stopsTotal,
    durMin,
    price,
    currency,
    score,
    link
  };
}

// =====================
// Filters
// =====================
function applyClientFilters(offers){
  const airline = els.filterAirline?.value || "";
  const maxStops = Number(els.filterMaxStops?.value ?? 999);
  const maxDurHours = Number(els.filterMaxDuration?.value ?? 999);
  const maxDurMin = maxDurHours * 60;

  return (offers ?? []).filter(o => {
    if (airline && String(o?.airline ?? "") !== airline) return false;

    const st = Number(o?.stops_total);
    if (Number.isFinite(maxStops) && Number.isFinite(st) && st > maxStops) return false;

    const dur = durationMinutesFromWorkerOffer(o);
    if (Number.isFinite(maxDurMin) && dur != null && dur > maxDurMin) return false;

    return true;
  });
}

function populateAirlineFilter(offers){
  if (!els.filterAirline) return;
  const set = new Set();
  for (const o of offers ?? []) {
    if (o?.airline) set.add(String(o.airline));
  }
  const list = [...set].sort();

  // label con diccionario si existe
  els.filterAirline.innerHTML =
    `<option value="">Todas</option>` +
    list.map(code => {
      const label = airlineFullName(code, lastResponse);
      return `<option value="${escapeHTML(code)}">${escapeHTML(label)}</option>`;
    }).join("");
}

function clearFiltersToDefaults(){
  if (els.filterAirline) els.filterAirline.value = "";
  if (els.filterMaxStops) els.filterMaxStops.value = "2";
  if (els.filterMaxDuration) els.filterMaxDuration.value = "40";
}

// =====================
// Sorting (table headers)
// =====================
function sortOffersByColumn(offers){
  const key = sortState.key;
  const dir = sortState.dir === "desc" ? -1 : 1;
  const arr = [...(offers ?? [])];

  const v = (o) => {
    const r = getOfferRow(o, lastResponse, lastRequest);
    switch (key){
      case "airline": return r.airlineLabel ?? "";
      case "dep_date": return r.depDate ?? "";
      case "ret_date": return r.retDate ?? "";
      case "stops_total": return r.stopsTotal ?? 999;
      case "duration_total": return r.durMin ?? 1e12;
      case "score": return Number.isFinite(r.score) ? r.score : -1;
      case "price":
      default: return Number.isFinite(r.price) ? r.price : 1e18;
    }
  };

  arr.sort((a,b) => {
    const av = v(a);
    const bv = v(b);
    if (typeof av === "string" || typeof bv === "string"){
      return dir * String(av).localeCompare(String(bv));
    }
    return dir * (Number(av) - Number(bv));
  });
  return arr;
}

function updateSortIndicators(){
  document.querySelectorAll("#offersTable thead th[data-sort]").forEach(th => {
    th.classList.remove("active","asc","desc");
    const k = th.getAttribute("data-sort");
    if (k === sortState.key){
      th.classList.add("active", sortState.dir);
    }
  });
}

// =====================
// Renderers
// =====================
function renderOffersTable(offers){
  els.offersTableBody.innerHTML = "";
  if (!offers?.length){
    els.offersEmpty.classList.remove("hidden");
    return;
  }
  els.offersEmpty.classList.add("hidden");

  offers.forEach((o) => {
    const r = getOfferRow(o, lastResponse, lastRequest);

    const priceStr = fmtMoney(r.price, r.currency);
    const scoreStr = Number.isFinite(r.score) ? r.score.toFixed(4) : "—";
    const stopsStr = (r.stopsTotal == null) ? "—" : String(r.stopsTotal);
    const durStr = fmtDurationMinutes(r.durMin);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="right">${escapeHTML(priceStr)}</td>
      <td>${escapeHTML(`${r.airlineLabel} • ${r.cabin}`)}</td>
      <td>${escapeHTML(r.depDate ?? "—")}</td>
      <td>${escapeHTML(r.retDate ?? "—")}</td>
      <td class="right">${escapeHTML(stopsStr)}</td>
      <td class="right">${escapeHTML(durStr)}</td>
      <td class="right">${escapeHTML(scoreStr)}</td>
      <td>${r.link ? `<a href="${escapeHTML(r.link)}" target="_blank" rel="noopener noreferrer">Ver</a>` : "—"}</td>
    `;
    els.offersTableBody.appendChild(tr);
  });
}

function makeSwatch(label, kind){
  const el = document.createElement("div");
  el.className = "swatch";
  const dot = document.createElement("div");
  dot.className = "dot";
  if (kind === "cheapest") dot.style.background = "rgba(107,255,176,.25)";
  if (kind === "priciest") dot.style.background = "rgba(255,107,107,.22)";
  el.appendChild(dot);
  const t = document.createElement("span");
  t.textContent = label;
  el.appendChild(t);
  return el;
}

function renderHeatmap(heatmap, currency, extrema){
  els.heatmapGrid.innerHTML = "";
  els.heatmapLegend.innerHTML = "";

  if (!heatmap?.length){
    els.heatmapEmpty.classList.remove("hidden");
    return;
  }
  els.heatmapEmpty.classList.add("hidden");

  // ✅ FIX: dedup por fecha (tomamos min_price mínimo por día)
  const byDate = new Map();
  for (const x of heatmap ?? []) {
    const dateRaw = x?.date ?? x?.day ?? x?.departure_date ?? x?.outbound_date ?? null;
    if (!dateRaw) continue;
    const d = String(dateRaw).slice(0,10);

    const p = x?.min_price ?? x?.minPrice ?? x?.price ?? null;
    const cur = x?.currency ?? currency ?? "USD";

    if (!byDate.has(d)) {
      byDate.set(d, { date: d, min_price: p, currency: cur });
    } else {
      const prev = byDate.get(d);
      const prevP = prev?.min_price;
      if (prevP == null) {
        prev.min_price = p;
        prev.currency = cur;
      } else if (p != null && Number(p) < Number(prevP)) {
        prev.min_price = p;
        prev.currency = cur;
      }
      byDate.set(d, prev);
    }
  }

  const rows = [...byDate.values()].sort((a,b)=> String(a.date).localeCompare(String(b.date)));

  const cheapestDate = getDeep(extrema, "cheapest.date", null);
  const priciestDate = getDeep(extrema, "priciest.date", null);

  els.heatmapLegend.appendChild(makeSwatch("Cheapest", "cheapest"));
  els.heatmapLegend.appendChild(makeSwatch("Priciest", "priciest"));
  els.heatmapLegend.appendChild(makeSwatch("Other", "other"));

  rows.forEach(r => {
    const cell = document.createElement("div");
    cell.className = "cell";

    const priceStr = fmtMoney(r.min_price, r.currency);
    const isCheapest = cheapestDate && String(r.date).slice(0,10) === String(cheapestDate).slice(0,10);
    const isPriciest = priciestDate && String(r.date).slice(0,10) === String(priciestDate).slice(0,10);

    if (r.min_price == null) cell.classList.add("na");
    if (isCheapest) cell.classList.add("cheapest");
    if (isPriciest) cell.classList.add("priciest");

    const sub = (r.min_price == null) ? "sin dato" : `min_price: ${Number(r.min_price).toFixed(0)}`;

    cell.innerHTML = `
      <div class="d">${escapeHTML(safeDate(String(r.date).slice(0,10)))}</div>
      <div class="p">${escapeHTML(priceStr)}</div>
      <div class="sub">${escapeHTML(sub)}</div>
    `;
    els.heatmapGrid.appendChild(cell);
  });
}

function renderRecommendations(reco, currency){
  const candidates = reco?.cheapest_date_candidates ?? reco?.candidates ?? [];
  els.recoList.innerHTML = "";

  if (!candidates?.length){
    els.recoEmpty.classList.remove("hidden");
    els.recoCard.classList.remove("hidden");
    return;
  }
  els.recoEmpty.classList.add("hidden");
  els.recoCard.classList.remove("hidden");

  candidates.forEach((c, idx) => {
    // candidates vienen en tu schema normalizado del worker (igual que offers)
    const r = getOfferRow(c, lastResponse, lastRequest);

    const priceStr = fmtMoney(r.price, r.currency);
    const stopsStr = (r.stopsTotal == null) ? "—" : String(r.stopsTotal);
    const durStr = fmtDurationMinutes(r.durMin);

    const div = document.createElement("div");
    div.className = "reco-item";
    div.innerHTML = `
      <div class="title">#${idx + 1} • ${escapeHTML(r.depDate ?? "—")} → ${escapeHTML(r.retDate ?? "—")}</div>
      <div class="meta">${escapeHTML(`${r.airlineLabel} • ${r.cabin} • escalas: ${stopsStr} • duración: ${durStr}`)}</div>
      <div class="price">${escapeHTML(priceStr)}</div>
      <div class="meta">${r.link ? `<a href="${escapeHTML(r.link)}" target="_blank" rel="noopener noreferrer">Ver en Google Flights</a>` : ""}</div>
    `;
    els.recoList.appendChild(div);
  });
}

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
// Networking
// =====================
async function postJSON(url, body, { timeoutMs } = {}){
  const controller = new AbortController();
  const t = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") || "";
    const isJSON = contentType.includes("application/json");

    let data = null;
    if (isJSON){
      data = await res.json().catch(() => null);
    } else {
      const txt = await res.text().catch(() => "");
      data = tryParseJSON(txt);
    }

    return { ok: res.ok, status: res.status, data };
  } finally {
    if (t) clearTimeout(t);
  }
}

function tryParseJSON(s){
  try { return JSON.parse(s); } catch { return null; }
}

// =====================
// UI plumbing
// =====================
function resetUI(){
  clearStatus();
  hideResults();
  els.btnExport.disabled = true;
  lastResponse = null;
  lastOffers = null;
  lastRequest = null;
}

function setPills(p){
  const { best, range, reco, recoWarn } = p;

  if (best){
    els.pillBest.textContent = `Best: ${best}`;
    els.pillBest.className = "pill ok";
    els.pillBest.classList.remove("hidden");
  } else {
    els.pillBest.classList.add("hidden");
  }

  if (range){
    els.pillRange.textContent = `Range: ${range}`;
    els.pillRange.className = "pill";
    els.pillRange.classList.remove("hidden");
  } else {
    els.pillRange.classList.add("hidden");
  }

  if (reco){
    els.pillReco.textContent = reco;
    els.pillReco.className = `pill ${recoWarn ? "warn" : ""}`;
    els.pillReco.classList.remove("hidden");
  } else {
    els.pillReco.classList.add("hidden");
  }
}

function hydrateDefaults(){
  // defaults (tu screenshot)
  document.getElementById("origin").value = "EZE";
  document.getElementById("destination").value = "MIA";
  document.getElementById("date_center").value = "2026-02-10";
  document.getElementById("return_center").value = "2026-02-24";
  document.getElementById("range_days").value = "7";
  document.getElementById("currency").value = "USD";
  document.getElementById("ranking_mode").value = "price";

  document.getElementById("enable_recommendations").checked = true;
  document.getElementById("reco_horizon_days").value = "7";
  document.getElementById("reco_top_k").value = "15";
  document.getElementById("enable_price_analysis").checked = true;
  document.getElementById("enable_choice_prediction").checked = true;

  clearFiltersToDefaults();
  sortState = { key: "price", dir: "asc" };
  updateSortIndicators();
}

function readFormPayload(){
  const origin = normalizeIATA(document.getElementById("origin").value);
  const destination = normalizeIATA(document.getElementById("destination").value);

  const date_center = document.getElementById("date_center").value;
  const return_center = document.getElementById("return_center").value;

  const range_days = Number(document.getElementById("range_days").value);
  const currency = document.getElementById("currency").value;
  const ranking_mode = document.getElementById("ranking_mode").value;

  const enable_recommendations = document.getElementById("enable_recommendations").checked;
  const reco_horizon_days = Number(document.getElementById("reco_horizon_days").value || 0);
  const reco_top_k = Number(document.getElementById("reco_top_k").value || 0);

  const enable_price_analysis = document.getElementById("enable_price_analysis").checked;
  const enable_choice_prediction = document.getElementById("enable_choice_prediction").checked;

  return {
    origin,
    destination,
    date_center,
    return_center,
    range_days,
    currency,
    enable_recommendations,
    reco_horizon_days,
    reco_top_k,
    enable_price_analysis,
    enable_choice_prediction,
    ranking_mode
  };
}

function validatePayload(p){
  const errors = [];
  if (!/^[A-Z]{3}$/.test(p.origin)) errors.push("Origen inválido (IATA 3 letras).");
  if (!/^[A-Z]{3}$/.test(p.destination)) errors.push("Destino inválido (IATA 3 letras).");
  if (!p.date_center) errors.push("Ida (centro) requerida.");
  if (!p.return_center) errors.push("Vuelta (centro) requerida.");
  if (!Number.isFinite(p.range_days) || p.range_days < 0) errors.push("range_days inválido.");
  if (!p.currency) errors.push("currency requerida.");
  return errors;
}

function rerenderOffers(){
  if (!lastOffers) return;
  const filtered = applyClientFilters(lastOffers);
  const sorted = sortOffersByColumn(filtered);
  renderOffersTable(sorted);
  updateSortIndicators();
}

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

  const offers = data.offers ?? [];
  const heatmap = data.heatmap ?? [];
  const extrema = data.extrema ?? null;
  const recommendations = data.recommendations ?? null;

  const { html, pills } = buildExecutiveSummary(data, payload);
  els.execSummary.innerHTML = html;
  setPills(pills);

  lastOffers = offers;
  populateAirlineFilter(offers);
  rerenderOffers();

  renderHeatmap(heatmap, payload.currency, extrema);
  renderRecommendations(recommendations, payload.currency);

  const tech = {
    stats: data.stats ?? null,
    dedup_stats: data.dedup_stats ?? null,
  };
  els.techMetrics.textContent = JSON.stringify(tech, null, 2);

  showResults();
  setStatus("ok", `OK. Offers: ${offers.length} • Heatmap: ${heatmap.length}`);
}

function attachEvents(){
  els.form.addEventListener("submit", handleSubmit);

  // filtros: aplicar/limpiar
  els.btnApplyFilters?.addEventListener("click", () => rerenderOffers());
  els.btnClearFilters?.addEventListener("click", () => {
    clearFiltersToDefaults();
    rerenderOffers();
  });

  // auto-aplicar
  els.filterAirline?.addEventListener("change", () => rerenderOffers());
  els.filterMaxStops?.addEventListener("input", () => rerenderOffers());
  els.filterMaxDuration?.addEventListener("input", () => rerenderOffers());

  // header sort
  document.querySelectorAll("#offersTable thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (!key) return;

      if (sortState.key === key){
        sortState.dir = (sortState.dir === "asc") ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.dir = "asc";
      }
      updateSortIndicators();
      rerenderOffers();
    });
  });

  els.btnExport.addEventListener("click", () => {
    if (!lastResponse) return;
    const p = readFormPayload();
    const fname = `amadeus_${p.origin}_${p.destination}_${p.date_center}_${p.return_center}.json`;
    downloadJSON(lastResponse, fname);
  });

  els.btnReset.addEventListener("click", () => {
    hydrateDefaults();
    resetUI();
    setStatus("ok", "Defaults cargados.");
  });
}

// init
hydrateDefaults();
attachEvents();
setStatus("ok", "Listo. Configurá y ejecutá una búsqueda.");
