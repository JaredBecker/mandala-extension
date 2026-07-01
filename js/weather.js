// Weather — Open-Meteo, free & keyless. Geocoding turns a typed city name
// into lat/lon; forecast turns lat/lon into a WMO weather code we map to an
// emoji icon.
(function () {
  const WMO_ICON = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌦️', 56: '🌧️', 57: '🌧️',
    61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️',
    80: '🌦️', 81: '🌦️', 82: '🌧️',
    85: '🌨️', 86: '🌨️',
    95: '⛈️', 96: '⛈️', 99: '⛈️'
  };

  function iconFor(code){ return WMO_ICON[code] || '🌡️'; }

  async function geocode(query){
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r) => ({
      label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude
    }));
  }

  async function fetchCurrent(lat, lon){
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('weather fetch failed');
    const data = await res.json();
    return data.current_weather; // { temperature, weathercode, ... }
  }

  function render(state){
    const el = document.getElementById('location-widget');
    const locations = state.locations || [];
    if (locations.length === 0){
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';

    let active = locations.find((l) => l.id === state.activeLocationId) || locations[0];

    el.innerHTML = `
      <span class="icon" id="weatherIcon">…</span>
      <span class="temp" id="weatherTemp">--°</span>
      <span class="place">${active.label}</span>
      <span class="locations" id="weatherDots"></span>
    `;

    const dots = document.getElementById('weatherDots');
    locations.forEach((loc) => {
      const dot = document.createElement('span');
      dot.className = 'loc-dot' + (loc.id === active.id ? ' active' : '');
      dot.title = loc.label;
      dot.addEventListener('click', () => {
        MandalaStorage.patch('activeLocationId', loc.id).then(render);
      });
      dots.appendChild(dot);
    });

    fetchCurrent(active.lat, active.lon).then((cw) => {
      const iconEl = document.getElementById('weatherIcon');
      const tempEl = document.getElementById('weatherTemp');
      if (!iconEl || !tempEl) return;
      iconEl.textContent = iconFor(cw.weathercode);
      tempEl.textContent = `${Math.round(cw.temperature)}°`;
    }).catch(() => {});
  }

  function init(state){
    if (!state.activeLocationId && state.locations.length){
      MandalaStorage.patch('activeLocationId', state.locations[0].id).then(() => render(state));
    } else {
      render(state);
    }
  }

  window.MandalaWeather = { init, render, geocode, iconFor };
})();
