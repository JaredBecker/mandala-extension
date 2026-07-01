// Live clock + time-of-day greeting + the small "current location" line.
(function () {
  function timeOfDay(h){
    if (h < 5) return 'night';
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
  }

  function tick(name){
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = `${hh}:${mm}`;
    const greetingEl = document.getElementById('greeting');
    const who = name ? `, ${name}` : '';
    greetingEl.textContent = `Good ${timeOfDay(now.getHours())}${who}.`;
  }

  function init(state){
    tick(state.profile.name);
    setInterval(() => tick(state.profile.name), 15000);
  }

  window.MandalaGreeting = { init };
})();
