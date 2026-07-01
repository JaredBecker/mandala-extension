// "Focused Today" stopwatch, Momentum-style. Resets on a new calendar day.
(function () {
  function todayKey(){
    return new Date().toISOString().slice(0, 10);
  }

  function formatMinutes(seconds){
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function init(state){
    const key = todayKey();
    let seconds = state.focusTimer.date === key ? state.focusTimer.seconds : 0;
    let running = false;
    let interval = null;

    const valueEl = document.getElementById('focusValue');
    const btn = document.getElementById('focusToggle');
    valueEl.textContent = formatMinutes(seconds);

    function persist(){
      MandalaStorage.patch('focusTimer', { date: key, seconds });
    }

    btn.addEventListener('click', () => {
      running = !running;
      btn.textContent = running ? 'Pause' : 'Start';
      if (running){
        interval = setInterval(() => {
          seconds += 1;
          valueEl.textContent = formatMinutes(seconds);
          if (seconds % 10 === 0) persist();
        }, 1000);
      } else {
        clearInterval(interval);
        persist();
      }
    });
  }

  window.MandalaFocusTimer = { init };
})();
