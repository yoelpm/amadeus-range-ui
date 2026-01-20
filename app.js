console.log("✅ app.js cargado correctamente en", window.location.href);

const ENDPOINT = "https://amadeus-flight-proxy.yoelpm.workers.dev/search-range";
let AIRLINE_DICT = {};
let lastOffers = [];
let lastResponse = null;
let lastRequest = null;

// =====================
// 🔹 Utilidades
// =====================
function fmtMoney(v, c = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(v || 0);
}
function safeDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d) ? s : d.toISOString().slice(0, 10);
}
function getAirlineName(code) {
  return AIRLINE_DICT[code] || code || "—";
}
function escapeHTML(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =====================
// 🔹 Cargar aerolíneas
// =====================
async function loadAirlines() {
  try {
    const res = await fetch("./airlines.json");
    AIRLINE_DICT = await res.json();
    console.log(`✅ Aerolíneas cargadas: ${Object.keys(AIRLINE_DICT).length}`);
  } catch (err) {
    console.warn("⚠️ No se pudo cargar airlines.json", err);
    AIRLINE_DICT = {};
  }
}

// =====================
// 🔹 DOM
// =====================
const els = {
  form: document.getElementById("searchForm"),
  statusBar: document.getElementById("statusBar"),
  results: document.getElementById("results"),
  execSummary: document.getElementById("execSummary"),
  offersTableBody: document.querySelector("#offersTable tbody"),
  offersEmpty: document.getElementById("offersEmpty"),
  heatmapLegend: document.getElementById("heatmapLegend"),
  heatmapGrid: document.getElementById("heatmapGrid"),
  heatmapEmpty: document.getElementById("heatmapEmpty"),
  recoList: document.getElementById("recoList"),
  recoEmpty: document.getElementById("recoEmpty"),
  techMetrics: document.getElementById("techMetrics"),
  filterMaxStops: document.getElementById("filter_max_stops"),
};

// =====================
// 🔹 Estado
// =====================
function setStatus(type, msg) {
  els.statusBar.textContent = msg;
  els.statusBar.className = `status-bar ${type}`;
  els.statusBar.classList.remove("hidden");
}

// =====================
// 🔹 Red
// =====================
async function postJSON(url, data, { timeoutMs = 90000 } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: ctrl.signal,
  });
  clearTimeout(id);
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: json };
}

// =====================
// 🔹 Formulario
// =====================
function readFormPayload() {
  return {
    origin: document.getElementById("origin").value.trim(),
    destination: document.getElementById("destination").value.trim(),
    date_center: document.getElementById("date_center").value,
    return_center: document.getElementById("return_center").value,
    range_days: Number(document.getElementById("range_days").value),
    currency: document.getElementById("currency").value,
    ranking_mode: document.getElementById("ranking_mode").value,
    enable_recommendations: document.getElementById("enable_recommendations")?.checked ?? true,
    enable_price_analysis: document.getElementById("enable_price_analysis")?.checked ?? true,
    enable_choice_prediction: document.getElementById("enable_choice_prediction")?.checked ?? true,
    reco_horizon_days: Number(document.getElementById("reco_horizon_days")?.value || 7),
    reco_top_k: Number(document.getElementById("reco_top_k")?.value || 15),
  };
}

// =====================
// 🔹 Submit
// =====================
async function handleSubmit(e) {
  e.preventDefault();
  setStatus("warn", `Consultando… (${ENDPOINT})`);

  const payload = readFormPayload();
  const resp = await postJSON(ENDPOINT, payload);

  if (!resp.ok) {
    setStatus("err", `HTTP ${resp.status}: ${resp.data?.message || "Error de red"}`);
    return;
  }

  lastResponse = resp.data;
  lastOffers = (resp.data?.offers || []).filter(
    o => !els.filterMaxStops?.value || o.stops_total <= Number(els.filterMaxStops.value)
  );

  renderResults(resp.data, payload);
  setStatus("ok", `OK. Offers: ${lastOffers.length} • Heatmap: ${resp.data?.heatmap?.length || 0}`);
  els.results.classList.remove("hidden");
}

// =====================
// 🔹 Render
// =====================
function renderResults(data, req) {
  // Executive summary
  els.execSummary.innerHTML = `
    <h3>🧭 Resumen ejecutivo</h3>
    <p>Ruta: <strong>${req.origin} → ${req.destination}</strong> (${req.date_center} → ${req.return_center})</p>
    <p>Ofertas procesadas: ${data.dedup_stats?.deduped_offers ?? data.offers?.length ?? 0} / ${
    data.dedup_stats?.raw_offers ?? "—"
  }</p>
  `;

  // Tabla
  rerenderOffers();

  // Heatmap
  renderHeatmap(data.heatmap || [], req.currency);

  // Recomendaciones
  renderRecommendations(data.recommendations, req.currency);

  // Tech info
  const flags = [];
  if (data.recommendations?.price_analysis === null)
    flags.push("⚠️ Price analysis no ejecutado (timeout probable)");
  if (data.recommendations?.choice_prediction_applied === false)
    flags.push("⚠️ Choice prediction desactivado o no aplicado");

  els.techMetrics.textContent = JSON.stringify(
    { stats: data.stats, dedup_stats: data.dedup_stats, flags },
    null,
    2
  );
}

// =====================
// 🔹 Tabla de ofertas
// =====================
function rerenderOffers() {
  const tb = els.offersTableBody;
  tb.innerHTML = "";
  if (!lastOffers.length) {
    els.offersEmpty.classList.remove("hidden");
    return;
  }
  els.offersEmpty.classList.add("hidden");

  lastOffers.forEach(o => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtMoney(o.total_price, o.currency)}</td>
      <td>${escapeHTML(getAirlineName(o.airline))}</td>
      <td>${safeDate(o.departure_date)}</td>
      <td>${safeDate(o.return_date)}</td>
      <td class="right">${o.stops_total ?? "—"}</td>
      <td class="right">${o.duration_total ?? "—"}</td>
      <td class="right">${o.score ?? "—"}</td>
    `;
    tb.appendChild(tr);
  });
}

// =====================
// 🔹 Heatmap híbrido (1D / 2D)
// =====================
function renderHeatmap(heatmap, currency) {
  const grid = els.heatmapGrid;
  const legend = els.heatmapLegend;
  grid.innerHTML = "";
  legend.innerHTML = "";

  if (!heatmap?.length) {
    els.heatmapEmpty.classList.remove("hidden");
    return;
  }

  const hasBothDates = heatmap.some(h => h.return_date && h.departure_date && h.return_date !== h.departure_date);
  if (!hasBothDates) return renderHeatmapLinear(heatmap, currency);

  const depDates = [...new Set(heatmap.map(h => h.departure_date))].sort();
  const retDates = [...new Set(heatmap.map(h => h.return_date))].sort();
  const prices = heatmap.map(h => h.min_price || h.total_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  const table = document.createElement("table");
  const header = document.createElement("tr");
  header.innerHTML = "<th></th>" + retDates.map(d => `<th>${safeDate(d)}</th>`).join("");
  table.appendChild(header);

  depDates.forEach(dep => {
    const row = document.createElement("tr");
    row.innerHTML = `<th>${safeDate(dep)}</th>`;
    retDates.forEach(ret => {
      const h = heatmap.find(x => x.departure_date === dep && x.return_date === ret);
      const p = h ? (h.min_price || h.total_price) : null;
      const ratio = p ? (p - min) / (max - min || 1) : 0;
      const color = p ? `hsl(${120 - ratio * 120}, 70%, 45%)` : "#333";
      const td = document.createElement("td");
      td.style.backgroundColor = color;
      td.title = p ? `${fmtMoney(p, currency)} — ${getAirlineName(h.airline)}` : "—";
      row.appendChild(td);
    });
    table.appendChild(row);
  });

  legend.textContent = `${fmtMoney(min, currency)} → ${fmtMoney(max, currency)}`;
  grid.appendChild(table);

  const insights = generateHeatmapInsights(heatmap);
  const insightsDiv = document.createElement("div");
  insightsDiv.className = "heatmap-insights";
  insightsDiv.innerHTML = `<h3>📊 Insights automáticos</h3><ul>${insights.map(i => `<li>${i}</li>`).join("")}</ul>`;
  grid.appendChild(insightsDiv);
}

// 🔸 fallback lineal
function renderHeatmapLinear(heatmap, currency) {
  const grid = els.heatmapGrid;
  const prices = heatmap.map(h => h.min_price || h.total_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const row = document.createElement("div");
  row.className = "heatmap-linear";

  heatmap.forEach(h => {
    const ratio = (h.min_price - min) / range;
    const div = document.createElement("div");
    div.className = "heat-cell";
    div.style.backgroundColor = `hsl(${120 - ratio * 120}, 70%, 45%)`;
    div.title = `${safeDate(h.date || h.departure_date)} • ${fmtMoney(h.min_price, currency)} (${getAirlineName(h.airline)})`;
    row.appendChild(div);
  });

  els.heatmapGrid.appendChild(row);
  els.heatmapLegend.textContent = `${fmtMoney(min, currency)} → ${fmtMoney(max, currency)}`;
}

// =====================
// 🔹 Insights
// =====================
function generateHeatmapInsights(heatmap) {
  if (!Array.isArray(heatmap) || !heatmap.length) return ["Sin datos suficientes."];
  const prices = heatmap.map(h => h.min_price || h.total_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const freq = {};
  for (const h of heatmap) freq[h.airline] = (freq[h.airline] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => getAirlineName(k));
  const cheap = heatmap.filter(h => (h.min_price || h.total_price) === min).map(h => safeDate(h.departure_date));
  return [
    `Precios bajos concentrados alrededor de ${cheap.join(", ")}`,
    `Aerolineas más competitivas: ${top.join(", ")}`,
    `Promedio de tarifas: ${fmtMoney(avg, heatmap[0]?.currency || "USD")}`,
    `Diferencia entre mínimo y máximo: ${fmtMoney(max - min, heatmap[0]?.currency || "USD")}`,
  ];
}

// =====================
// 🔹 Recomendaciones
// =====================
function renderRecommendations(reco, currency) {
  const list = els.recoList;
  list.innerHTML = "";
  if (!reco?.cheapest_date_candidates?.length) {
    els.recoEmpty.classList.remove("hidden");
    return;
  }
  els.recoEmpty.classList.add("hidden");
  reco.cheapest_date_candidates.slice(0, 5).forEach(r => {
    const dep = safeDate(r.departure_date ?? r.date_center ?? "—");
    const ret = safeDate(r.return_date ?? r.date_center ?? "—");
    const airlineName = getAirlineName(r.airline ?? r.airline_code ?? "—");
    const price = r.min_price ?? r.total_price ?? 0;
    const item = document.createElement("div");
    item.className = "reco-item";
    item.innerHTML = `<strong>${airlineName}</strong> ${dep} → ${ret} • ${fmtMoney(price, currency)} <em>fuera de rango</em>`;
    list.appendChild(item);
  });
}

// =====================
// 🔹 Init
// =====================
document.addEventListener("DOMContentLoaded", async () => {
  await loadAirlines();
  els.form.addEventListener("submit", handleSubmit);
  setStatus("ok", "Listo para buscar vuelos ✈️");
});
