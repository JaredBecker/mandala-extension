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

  // coarse mood bucket for the mandala's "Match my weather" palette —
  // published on window so the renderers can read it without a dependency
  function moodFor(code){
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    if (code === 2 || code === 3) return 'cloud';
    return 'clear';
  }

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

    // built via DOM (not an HTML string) because the label originates from
    // the geocoding API — remote data never gets parsed as markup
    el.textContent = '';
    const mk = (cls, id, text) => {
      const s = document.createElement('span');
      s.className = cls;
      if (id) s.id = id;
      if (text) s.textContent = text;
      el.appendChild(s);
      return s;
    };
    mk('icon', 'weatherIcon', '…');
    mk('temp', 'weatherTemp', '--°');
    mk('place', null, active.label);
    mk('locations', 'weatherDots', null);

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
      window.MandalaWeatherMood = moodFor(cw.weathercode);
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
