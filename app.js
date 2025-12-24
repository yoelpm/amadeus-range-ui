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
  sortMode: document.getElementById("sortMode"),

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
};

let lastResponse = null;
let lastOffers = null;

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

function showResults(){
  els.results.classList.remove("hidden");
}

function hideResults(){
  els.results.classList.add("hidden");
}

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
  // expects YYYY-MM-DD; show same
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

function pickOfferFields(offer){
  // Intenta ser tolerante a cambios de schema
  const price = offer?.price?.total ?? offer?.price_total ?? offer?.total_price ?? offer?.price ?? offer?.total ?? null;
  const currency = offer?.price?.currency ?? offer?.currency ?? null;
  const score = offer?.score ?? offer?.ranking?.score ?? offer?.choice_prediction?.score ?? null;

  const provider = offer?.validatingAirlineCodes?.join?.(", ")
    ?? offer?.provider
    ?? offer?.source
    ?? "—";

  // itinerary summary
  const itineraries = offer?.itineraries ?? [];
  const leg0 = itineraries?.[0];
  const leg1 = itineraries?.[1];

  const summarizeLeg = (leg) => {
    const segs = leg?.segments ?? [];
    if (!segs.length) return { route: "—", dates: "—" };

    const first = segs[0];
    const last = segs[segs.length - 1];
    const depIATA = first?.departure?.iataCode ?? "—";
    const arrIATA = last?.arrival?.iataCode ?? "—";

    const depAt = first?.departure?.at ?? null;
    const arrAt = last?.arrival?.at ?? null;

    // show only date portion if ISO datetime
    const depD = depAt ? String(depAt).slice(0,10) : null;
    const arrD = arrAt ? String(arrAt).slice(0,10) : null;

    const stops = Math.max(0, segs.length - 1);
    return {
      route: `${depIATA} → ${arrIATA}${stops ? ` (${stops} stop${stops>1?"s":""})` : ""}`,
      dates: `${depD ?? "—"} → ${arrD ?? "—"}`
    };
  };

  const out = summarizeLeg(leg0);
  const back = summarizeLeg(leg1);

  const itinerary = (leg1 && leg1?.segments?.length)
    ? `${out.route} | ${back.route}`
    : out.route;

  const dates = (leg1 && leg1?.segments?.length)
    ? `${out.dates} | ${back.dates}`
    : out.dates;

  return { price, currency, score, provider, itinerary, dates };
}

function sortOffers(offers, mode){
  const copy = [...(offers ?? [])];

  const getPrice = (o) => {
    const { price } = pickOfferFields(o);
    const n = Number(price);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };

  const getScore = (o) => {
    const { score } = pickOfferFields(o);
    const n = Number(score);
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
  };

  switch (mode){
    case "price_desc": copy.sort((a,b)=> getPrice(b)-getPrice(a)); break;
    case "score_asc": copy.sort((a,b)=> getScore(a)-getScore(b)); break;
    case "score_desc": copy.sort((a,b)=> getScore(b)-getScore(a)); break;
    case "price_asc":
    default: copy.sort((a,b)=> getPrice(a)-getPrice(b)); break;
  }
  return copy;
}

function renderOffersTable(offers, currencyFallback){
  els.offersTableBody.innerHTML = "";
  if (!offers?.length){
    els.offersEmpty.classList.remove("hidden");
    return;
  }
  els.offersEmpty.classList.add("hidden");

  offers.forEach((o, idx) => {
    const f = pickOfferFields(o);
    const tr = document.createElement("tr");

    const cur = f.currency ?? currencyFallback ?? "USD";
    const priceStr = fmtMoney(f.price, cur);
    const scoreStr = (f.score == null || Number.isNaN(Number(f.score))) ? "—" : Number(f.score).toFixed(4);

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHTML(f.itinerary)}</td>
      <td>${escapeHTML(f.dates)}</td>
      <td class="right">${escapeHTML(priceStr)}</td>
      <td class="right">${escapeHTML(scoreStr)}</td>
      <td>${escapeHTML(String(f.provider ?? "—"))}</td>
    `;
    els.offersTableBody.appendChild(tr);
  });
}

function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderHeatmap(heatmap, currency, extrema){
  els.heatmapGrid.innerHTML = "";
  els.heatmapLegend.innerHTML = "";

  if (!heatmap?.length){
    els.heatmapEmpty.classList.remove("hidden");
    return;
  }
  els.heatmapEmpty.classList.add("hidden");

  // heatmap[] expected items: { date, min_price, currency? } (tolerant)
  const rows = heatmap
    .map(x => ({
      date: x?.date ?? x?.day ?? x?.departure_date ?? x?.outbound_date ?? null,
      min_price: x?.min_price ?? x?.minPrice ?? x?.price ?? null,
      currency: x?.currency ?? currency ?? "USD",
      meta: x
    }))
    .filter(x => x.date);

  // extrema: cheapest/priciest (optional)
  const cheapestDate = getDeep(extrema, "cheapest.date", null) ?? getDeep(extrema, "cheapest_day", null);
  const priciestDate = getDeep(extrema, "priciest.date", null) ?? getDeep(extrema, "priciest_day", null);

  // legend
  els.heatmapLegend.appendChild(makeSwatch("Cheapest", "cheapest"));
  els.heatmapLegend.appendChild(makeSwatch("Priciest", "priciest"));
  els.heatmapLegend.appendChild(makeSwatch("Other", "other"));

  // sort by date asc
  rows.sort((a,b)=> String(a.date).localeCompare(String(b.date)));

  rows.forEach(r => {
    const cell = document.createElement("div");
    cell.className = "cell";

    const priceStr = fmtMoney(r.min_price, r.currency);
    const isCheapest = cheapestDate && String(r.date).slice(0,10) === String(cheapestDate).slice(0,10);
    const isPriciest = priciestDate && String(r.date).slice(0,10) === String(priciestDate).slice(0,10);

    if (r.min_price == null) cell.classList.add("na");
    if (isCheapest) cell.classList.add("cheapest");
    if (isPriciest) cell.classList.add("priciest");

    // extra: show raw min_price numeric if you want
    const sub = (r.min_price == null) ? "sin dato" : `min_price: ${Number(r.min_price).toFixed(0)}`;

    cell.innerHTML = `
      <div class="d">${escapeHTML(safeDate(String(r.date).slice(0,10)))}</div>
      <div class="p">${escapeHTML(priceStr)}</div>
      <div class="sub">${escapeHTML(sub)}</div>
    `;
    els.heatmapGrid.appendChild(cell);
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
    const date = c?.date ?? c?.day ?? c?.outbound_date ?? c?.departure_date ?? null;
    const price = c?.price ?? c?.min_price ?? c?.estimated_price ?? null;
    const cur = c?.currency ?? currency ?? "USD";
    const reason = c?.reason ?? c?.note ?? null;

    const div = document.createElement("div");
    div.className = "reco-item";
    div.innerHTML = `
      <div class="title">#${idx + 1} • ${escapeHTML(safeDate(String(date ?? "—").slice(0,10)))}</div>
      <div class="meta">${escapeHTML(reason ?? "Candidata recomendada")}</div>
      <div class="price">${escapeHTML(fmtMoney(price, cur))}</div>
    `;
    els.recoList.appendChild(div);
  });
}

function buildExecutiveSummary(payload, req){
  const currency = req.currency ?? "USD";

  // best offer: assume offers sorted already or compute min
  const offers = payload?.offers ?? [];
  const bestOffer = offers.length ? offers.reduce((best, cur) => {
    const pb = Number(pickOfferFields(best).price);
    const pc = Number(pickOfferFields(cur).price);
    if (!Number.isFinite(pb)) return cur;
    if (!Number.isFinite(pc)) return best;
    return pc < pb ? cur : best;
  }, offers[0]) : null;

  const extrema = payload?.extrema ?? null;
  const cheapest = getDeep(extrema, "cheapest", null);
  const priciest = getDeep(extrema, "priciest", null);

  const reco = payload?.recommendations ?? null;
  const recoCandidates = reco?.cheapest_date_candidates ?? [];
  const recoHasOutOfRange = !!recoCandidates?.length;

  const bestPrice = bestOffer ? pickOfferFields(bestOffer).price : null;
  const bestCur = bestOffer ? (pickOfferFields(bestOffer).currency ?? currency) : currency;

  const centerOut = req.date_center;
  const centerRet = req.return_center;
  const range = req.range_days;

  const parts = [];
  if (bestOffer){
    parts.push(`Mejor oferta encontrada: <strong>${escapeHTML(fmtMoney(bestPrice, bestCur))}</strong>.`);
  } else {
    parts.push(`No se encontraron ofertas para la consulta.`);
  }

  if (cheapest?.date && cheapest?.price != null){
    parts.push(`Cheapest (según <code>extrema</code>): <strong>${escapeHTML(safeDate(String(cheapest.date).slice(0,10)))}</strong> @ ${escapeHTML(fmtMoney(cheapest.price, cheapest.currency ?? currency))}.`);
  }
  if (priciest?.date && priciest?.price != null){
    parts.push(`Priciest: ${escapeHTML(safeDate(String(priciest.date).slice(0,10)))} @ ${escapeHTML(fmtMoney(priciest.price, priciest.currency ?? currency))}.`);
  }

  if (recoHasOutOfRange){
    const top = recoCandidates[0];
    const rd = top?.date ?? null;
    const rp = top?.price ?? top?.min_price ?? null;
    parts.push(`Hay recomendación fuera del rango: <strong>${escapeHTML(safeDate(String(rd ?? "—").slice(0,10)))}</strong> ~ ${escapeHTML(fmtMoney(rp, top?.currency ?? currency))}.`);
  } else if (req.enable_recommendations){
    parts.push(`No hubo fechas fuera de rango que mejoren claramente el resultado.`);
  }

  return {
    html: parts.join(" "),
    pills: {
      best: bestOffer ? `${fmtMoney(bestPrice, bestCur)}` : null,
      range: `${centerOut} / ${centerRet} ±${range}`,
      reco: req.enable_recommendations ? (recoHasOutOfRange ? "Reco: sí" : "Reco: no") : "Reco: off",
      recoWarn: req.enable_recommendations && recoHasOutOfRange
    }
  };
}

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
      // tolerante: a veces responde json sin header correcto
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

function resetUI(){
  clearStatus();
  hideResults();
  els.btnExport.disabled = true;
  lastResponse = null;
  lastOffers = null;
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
  // Defaults sensatos como tu ejemplo
  document.getElementById("origin").value = "EZE";
  document.getElementById("destination").value = "MAD";
  document.getElementById("date_center").value = "2026-02-10";
  document.getElementById("return_center").value = "2026-02-24";
  document.getElementById("range_days").value = "7";
  document.getElementById("currency").value = "USD";
  document.getElementById("ranking_mode").value = "balanced";

  document.getElementById("enable_recommendations").checked = true;
  document.getElementById("reco_horizon_days").value = "60";
  document.getElementById("reco_top_k").value = "12";
  document.getElementById("enable_price_analysis").checked = true;
  document.getElementById("enable_choice_prediction").checked = true;
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

async function handleSubmit(e){
  e.preventDefault();
  resetUI();

  const payload = readFormPayload();
  const errs = validatePayload(payload);
  if (errs.length){
    setStatus("err", errs.join(" "));
    return;
  }

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
    // 4xx/5xx
    const msg = resp.data?.error ?? resp.data?.message ?? JSON.stringify(resp.data ?? {});
    setStatus("err", `HTTP ${resp.status}. ${msg || "Error"}`);
    return;
  }

  if (!resp.data || typeof resp.data !== "object"){
    setStatus("err", "Respuesta vacía o no-JSON.");
    return;
  }

  const data = resp.data;

  // store for export
  lastResponse = data;
  els.btnExport.disabled = false;

  // render
  const offers = data.offers ?? [];
  const heatmap = data.heatmap ?? [];
  const extrema = data.extrema ?? null;
  const recommendations = data.recommendations ?? null;

  const { html, pills } = buildExecutiveSummary(data, payload);
  els.execSummary.innerHTML = html;
  setPills(pills);

  // table initial sort
  lastOffers = offers;
  const sorted = sortOffers(offers, els.sortMode.value);
  renderOffersTable(sorted, payload.currency);

  renderHeatmap(heatmap, payload.currency, extrema);
  renderRecommendations(recommendations, payload.currency);

  // tech metrics panel
  const tech = {
    stats: data.stats ?? null,
    dedup_stats: data.dedup_stats ?? null,
    meta: recommendations?.meta ?? recommendations?.flags ?? null,
  };
  els.techMetrics.textContent = JSON.stringify(tech, null, 2);

  showResults();
  setStatus("ok", `OK. Offers: ${offers.length} • Heatmap: ${heatmap.length}`);
}

function attachEvents(){
  els.form.addEventListener("submit", handleSubmit);

  els.sortMode.addEventListener("change", () => {
    if (!lastOffers) return;
    const payload = readFormPayload();
    const sorted = sortOffers(lastOffers, els.sortMode.value);
    renderOffersTable(sorted, payload.currency);
  });

  els.btnExport.addEventListener("click", () => {
    if (!lastResponse) return;
    const payload = readFormPayload();
    const fname = `amadeus_${payload.origin}_${payload.destination}_${payload.date_center}_${payload.return_center}.json`;
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
