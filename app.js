console.log("✅ app.js cargado correctamente en", window.location.href);

const ENDPOINT = "https://amadeus-flight-proxy.yoelpm.workers.dev/search-range";
let AIRLINE_DICT = {};
let lastOffers = [];
let lastResponse = null;
let lastRequest = null;

// =====================
// 🔹 Utilidades básicas
// =====================
function fmtMoney(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value || 0);
}

function safeDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  return isNaN(d) ? str : d.toISOString().slice(0, 10);
}

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getDeep(obj, path, def = null) {
  return path.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : def), obj);
}

// =====================
// 🔹 Carga de aerolíneas
// =====================
async function loadAirlines() {
  try {
    const res = await fetch("./airlines.json");
    if (!res.ok) throw new Error("No se pudo cargar airlines.json");
    AIRLINE_DICT = await res.json();
    console.log(`✅ Aerolíneas cargadas: ${Object.keys(AIRLINE_DICT).length}`);
  } catch (e) {
    console.error("❌ Error al cargar airlines.json", e);
    AIRLINE_DICT = {};
  }
}

function getAirlineName(code) {
  return AIRLINE_DICT[code] || code || "—";
}

// =====================
// 🔹 Elementos del DOM
// =====================
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
  btnReset: document.getElementById("btnReset")
};

// =====================
// 🔹 Networking principal
// =====================
async function postJSON(url, data, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: ctrl.signal
  });
  clearTimeout(id);
  const json = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data: json };
}

// =====================
// 🔹 Helpers de UI
// =====================
function setStatus(type, msg) {
  els.statusBar.textContent = msg;
  els.statusBar.className = `status-bar ${type}`;
  els.statusBar.classList.remove("hidden");
}

function showResults() {
  els.results.classList.remove("hidden");
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
    reco_top_k: Number(document.getElementById("reco_top_k")?.value || 15)
  };
}

function hydrateDefaults() {
  document.getElementById("origin").value = "EZE";
  document.getElementById("destination").value = "CDG";
  document.getElementById("date_center").value = "2026-07-02";
  document.getElementById("return_center").value = "2026-07-14";
  document.getElementById("range_days").value = "7";
  document.getElementById("currency").value = "USD";
  document.getElementById("ranking_mode").value = "price";
  console.log("✅ hydrateDefaults aplicado");
}

function attachEvents() {
  els.form.addEventListener("submit", handleSubmit);
  document.querySelectorAll("#offersTable th.sortable").forEach(th => {
    th.addEventListener("click", () => sortOffers(th.dataset.sort));
  });
}

// =====================
// 🔹 Submit principal
// =====================
async function handleSubmit(e) {
  e.preventDefault();
  setStatus("warn", `Consultando… (${ENDPOINT})`);

  const payload = readFormPayload();
  const resp = await postJSON(ENDPOINT, payload, { timeoutMs: 90000 });

  if (!resp.ok) {
    setStatus("err", `HTTP ${resp.status}: ${resp.data?.message || "Error de red"}`);
    return;
  }

  const data = resp.data;
  lastResponse = data;
  lastOffers = data.offers ?? [];

  renderResults(data, payload);
  showResults();
  setStatus("ok", `OK. Offers: ${lastOffers.length} • Heatmap: ${data.heatmap?.length || 0}`);
}

// =====================
// 🔹 Render general
// =====================
function renderResults(data, req) {
  // Executive summary
  els.execSummary.innerHTML = `
    <h3>🧭 Resumen ejecutivo</h3>
    <p>Ruta: <strong>${req.origin} → ${req.destination}</strong>, ida ${safeDate(req.date_center)}, vuelta ${safeDate(req.return_center)}.</p>
    <p>Se encontraron ${data.dedup_stats?.deduped_offers ?? data.offers?.length ?? 0} ofertas deduplicadas (${data.dedup_stats?.raw_offers ?? "—"} brutas).</p>
  `;

  // Ranking
  rerenderOffers();

  // Heatmap
  renderHeatmap(data.heatmap ?? [], req.currency);

  // Recomendaciones
  renderRecommendations(data.recommendations, req.currency);

  // Tech metrics
  const flags = [];
  if (data.recommendations?.price_analysis === null)
    flags.push("⚠️ Price analysis: null (timeout probable)");
  if (data.recommendations?.choice_prediction_applied === false)
    flags.push("⚠️ Choice prediction: no aplicado");

  els.techMetrics.textContent = JSON.stringify(
    { stats: data.stats, dedup_stats: data.dedup_stats, notes: flags },
    null,
    2
  );
}

// =====================
// 🔹 Tabla de ofertas
// =====================
function rerenderOffers() {
  const tbody = els.offersTableBody;
  tbody.innerHTML = "";
  if (!lastOffers?.length) {
    els.offersEmpty.classList.remove("hidden");
    return;
  }
  els.offersEmpty.classList.add("hidden");

  lastOffers.forEach(o => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="right">${fmtMoney(o.total_price, o.currency)}</td>
      <td>${escapeHTML(getAirlineName(o.airline))}</td>
      <td>${safeDate(o.departure_date)}</td>
      <td>${safeDate(o.return_date)}</td>
      <td class="right">${o.stops_total ?? "—"}</td>
      <td class="right">${o.duration_total ?? "—"}</td>
      <td class="right">${o.score ?? "—"}</td>
      <td>${o.id ?? "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

// =====================
// 🔹 Ordenamiento por encabezado
// =====================
function sortOffers(key) {
  if (!lastOffers?.length) return;
  const dir = (sortOffers.lastKey === key && sortOffers.lastDir === "asc") ? "desc" : "asc";
  sortOffers.lastKey = key;
  sortOffers.lastDir = dir;
  lastOffers.sort((a, b) => {
    const va = a[key] ?? 0, vb = b[key] ?? 0;
    return dir === "asc" ? va - vb : vb - va;
  });
  rerenderOffers();
}

// =====================
// 🔹 Heatmap doble entrada
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
  els.heatmapEmpty.classList.add("hidden");

  const depDates = [...new Set(heatmap.map(h => h.departure_date))].sort();
  const retDates = [...new Set(heatmap.map(h => h.return_date))].sort();

  const prices = heatmap.map(h => h.min_price || h.total_price || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const table = document.createElement("table");
  table.className = "heatmap-matrix";
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th></th>" + retDates.map(d => `<th>${safeDate(d)}</th>`).join("");
  table.appendChild(headerRow);

  depDates.forEach(dep => {
    const row = document.createElement("tr");
    row.innerHTML = `<th>${safeDate(dep)}</th>`;
    retDates.forEach(ret => {
      const cellData = heatmap.find(h => h.departure_date === dep && h.return_date === ret);
      const price = cellData ? (cellData.min_price || cellData.total_price) : null;
      const ratio = price ? (price - min) / range : null;
      const color = !price ? "#222" : ratio < 0.3 ? "#4caf50" : ratio < 0.6 ? "#fbc02d" : "#e53935";
      const cell = document.createElement("td");
      cell.style.backgroundColor = color;
      cell.title = price
        ? `${fmtMoney(price, currency)}\n${getAirlineName(cellData.airline)}`
        : "—";
      row.appendChild(cell);
    });
    table.appendChild(row);
  });

  grid.appendChild(table);
  legend.textContent = `${fmtMoney(min, currency)} → ${fmtMoney(max, currency)}`;

  // Insights automáticos
  const insights = generateHeatmapInsights(heatmap);
  const insightsDiv = document.createElement("div");
  insightsDiv.className = "heatmap-insights";
  insightsDiv.innerHTML = `<h3>🌡️ Insights automáticos</h3><ul>${insights.map(i => `<li>${i}</li>`).join("")}</ul>`;
  grid.appendChild(insightsDiv);
}

// =====================
// 🔹 Insights automáticos del heatmap
// =====================
function generateHeatmapInsights(heatmap) {
  if (!Array.isArray(heatmap) || !heatmap.length) return ["Sin datos suficientes para análisis."];

  const prices = heatmap.map(h => h.min_price || h.total_price || 0).filter(Boolean);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  const airlineCount = {};
  for (const h of heatmap) {
    const a = h.airline;
    if (!a) continue;
    airlineCount[a] = (airlineCount[a] || 0) + 1;
  }
  const topAirlines = Object.entries(airlineCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code]) => getAirlineName(code));

  const cheapest = heatmap
    .filter(h => (h.min_price || h.total_price) === min)
    .map(h => safeDate(h.date || h.departure_date));

  return [
    `Precios bajos concentrados alrededor de ${cheapest.slice(0, 3).join(", ")}.`,
    `Aerolineas más competitivas: ${topAirlines.join(", ")}.`,
    `Promedio de tarifas en el rango: ${fmtMoney(avg, heatmap[0]?.currency ?? "USD")}.`,
    `Diferencia entre mínimo y máximo: ${fmtMoney(max - min, heatmap[0]?.currency ?? "USD")}.`
  ];
}

// =====================
// 🔹 Recomendaciones fuera del rango
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
    item.innerHTML = `
      <strong>${airlineName}</strong> • ${dep} → ${ret} 
      <span>${fmtMoney(price, currency)}</span> 
      <em class="muted">fuera de rango</em>
    `;
    list.appendChild(item);
  });
}

// =====================
// 🔹 Inicialización
// =====================
document.addEventListener("DOMContentLoaded", async () => {
  await loadAirlines();
  hydrateDefaults();
  attachEvents();
  setStatus("ok", "Listo. Configurá y ejecutá una búsqueda.");
});
