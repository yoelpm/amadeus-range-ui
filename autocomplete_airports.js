// =====================
// Autocompletado simple sin dependencias
// =====================
async function initAirportAutocomplete() {
  try {
    const response = await fetch('./airports.json');
    if (!response.ok) throw new Error("No se pudo cargar airports.json");
    const airports = await response.json();

    const inputs = [document.getElementById('origin'), document.getElementById('destination')];

    inputs.forEach(input => {
      const wrapper = document.createElement('div');
      wrapper.classList.add('autocomplete-wrapper');
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      const list = document.createElement('div');
      list.classList.add('autocomplete-list');
      wrapper.appendChild(list);

      input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        list.innerHTML = '';
        if (!val) return;

        const filtered = airports.filter(a =>
          a.iata.toLowerCase().includes(val) ||
          a.ciudad.toLowerCase().includes(val) ||
          a.nombre.toLowerCase().includes(val) ||
          a.pais.toLowerCase().includes(val)
        ).slice(0, 10);

        filtered.forEach(a => {
          const item = document.createElement('div');
          item.classList.add('autocomplete-item');
          item.textContent = `${a.iata} — ${a.ciudad} (${a.nombre}, ${a.pais})`;
          item.addEventListener('click', () => {
            input.value = a.iata;
            list.innerHTML = '';
          });
          list.appendChild(item);
        });
      });

      document.addEventListener('click', e => {
        if (!wrapper.contains(e.target)) list.innerHTML = '';
      });
    });

    console.log("✅ Autocompletado de aeropuertos inicializado correctamente.");
  } catch (err) {
    console.error("❌ Error al inicializar autocompletado:", err);
  }
}

// =====================
// Calendario interactivo con Flatpickr
// =====================
function initCalendars() {
  if (window.flatpickr) {
    flatpickr('#date_center', {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      locale: 'es',
      allowInput: true
    });

    flatpickr('#return_center', {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      locale: 'es',
      allowInput: true
    });
    console.log("✅ Calendarios Flatpickr inicializados.");
  } else {
    console.warn("⚠️ Flatpickr no está disponible.");
  }
}

// =====================
// Inicialización segura
// =====================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initAirportAutocomplete();
    initCalendars();
  });
} else {
  initAirportAutocomplete();
  initCalendars();
}
