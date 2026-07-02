// Pomodoro focus timer. Work sessions feed the daily "focused today" total
// (state.focusTimer, date-keyed, resets each calendar day — same store the
// old stopwatch used, so history carries over). Config + live run state
// persist in state.pomodoro, so an in-progress session resumes when a new
// tab opens; a phase that expired while no tab was open advances quietly
// and waits paused instead of pretending time passed.
//
// Flow: focus ends -> break starts automatically (that's the moment you
// want zero friction); break ends -> next focus waits for a click (no
// burning pomodoros while you're away). Every cyclesToLong-th break is the
// long one. During any running break the mandala's rotation gently slows —
// same mechanism breathing.js uses — and hands back on pause/focus.
(function () {
  const RING_CIRCUMFERENCE = 276.46; // 2*pi*44, must match the CSS dasharray
  const PHASE_LABEL = { work: 'Focus', short: 'Break', long: 'Long break' };

  let cfg = { workMin: 25, shortMin: 5, longMin: 15, cyclesToLong: 4 };
  let run = { phase: 'work', running: false, endsAt: 0, remainingSec: null, cycleCount: 0 };
  let focusSeconds = 0;
  let tickInterval = null;
  let els = null;

  function todayKey(){
    return new Date().toISOString().slice(0, 10);
  }

  function formatMinutes(seconds){
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function formatClock(sec){
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function phaseSeconds(phase){
    const mins = phase === 'work' ? cfg.workMin : (phase === 'short' ? cfg.shortMin : cfg.longMin);
    return mins * 60;
  }

  // remaining time is derived from a wall-clock deadline while running (so
  // it can't drift with interval jitter) and from the frozen remainder while
  // paused; null remainder means "full phase, not started yet"
  function remaining(){
    if (run.running) return Math.max(0, Math.round((run.endsAt - Date.now()) / 1000));
    return run.remainingSec === null ? phaseSeconds(run.phase) : run.remainingSec;
  }

  function persistRun(){
    MandalaStorage.patch('pomodoro', { run });
  }

  function persistCfg(){
    MandalaStorage.patch('pomodoro', cfg);
  }

  function persistFocus(){
    MandalaStorage.patch('focusTimer', { date: todayKey(), seconds: focusSeconds });
  }

  // soft two-note synth chime — no media element (see todo.js for why), no
  // sound file needed, and it honours the existing task-sound mute switch
  async function chime(kind){
    try {
      const stored = await MandalaStorage.load();
      if (stored.todoSound && stored.todoSound.muted) return;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'workEnd' ? [659.25, 880] : [880, 659.25]; // up = earned a break, down = back to it
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.55);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch (e) {}
  }

  // slow the mandala during running breaks, but never fight the breathing
  // overlay, which drives the same control and restores it on its own exit
  function setMandalaCalm(active){
    const overlay = document.getElementById('breathing-overlay');
    if (overlay && overlay.classList.contains('active')) return;
    if (typeof setBreathingRotate === 'function') setBreathingRotate(active, 0.05);
  }

  function render(){
    const total = phaseSeconds(run.phase);
    const rem = remaining();
    els.time.textContent = formatClock(rem);
    els.phase.textContent = PHASE_LABEL[run.phase];
    els.start.textContent = run.running ? 'Pause' : (run.remainingSec !== null && run.remainingSec < total ? 'Resume' : 'Start');
    const frac = total > 0 ? rem / total : 0;
    els.progress.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - frac)).toFixed(1);
    els.widget.classList.toggle('on-break', run.phase !== 'work');
    els.value.textContent = formatMinutes(focusSeconds);

    // round-progress dots: filled = focus sessions done since the last long break
    const done = Math.min(run.cycleCount, cfg.cyclesToLong);
    els.dots.textContent = '●'.repeat(done) + '○'.repeat(Math.max(0, cfg.cyclesToLong - done));
  }

  function ensureTick(){
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      if (!run.running){
        clearInterval(tickInterval);
        tickInterval = null;
        return;
      }
      if (run.phase === 'work'){
        focusSeconds += 1;
        if (focusSeconds % 10 === 0) persistFocus();
      }
      if (remaining() <= 0){
        completePhase(false);
      }
      render();
    }, 1000);
  }

  function startRunning(){
    run.endsAt = Date.now() + remaining() * 1000;
    run.remainingSec = null;
    run.running = true;
    ensureTick();
    setMandalaCalm(run.phase !== 'work');
    persistRun();
    render();
  }

  function stopRunning(){
    run.remainingSec = remaining();
    run.running = false;
    setMandalaCalm(false);
    persistRun();
    render();
  }

  // advance to the next phase; silent skips (button / stale resume) don't chime
  function completePhase(silent){
    const wasWork = run.phase === 'work';
    if (wasWork){
      run.cycleCount += 1;
      run.phase = run.cycleCount >= cfg.cyclesToLong ? 'long' : 'short';
    } else {
      if (run.phase === 'long') run.cycleCount = 0;
      run.phase = 'work';
    }
    run.remainingSec = null;
    run.running = false;
    if (!silent) chime(wasWork ? 'workEnd' : 'breakEnd');
    if (wasWork){
      startRunning(); // breaks start themselves...
    } else {
      persistFocus();
      setMandalaCalm(false);
      persistRun(); // ...focus waits for the user
      render();
    }
  }

  function wireSettings(){
    const fields = [
      ['pomoWorkMin', 'workMin', 1, 120],
      ['pomoShortMin', 'shortMin', 1, 60],
      ['pomoLongMin', 'longMin', 1, 60],
      ['pomoCycles', 'cyclesToLong', 2, 8]
    ];
    fields.forEach(([id, key, lo, hi]) => {
      const input = document.getElementById(id);
      input.value = cfg[key];
      input.addEventListener('change', () => {
        const v = Math.min(hi, Math.max(lo, parseInt(input.value, 10) || cfg[key]));
        input.value = v;
        cfg[key] = v;
        persistCfg();
        render(); // an untouched phase picks up its new length immediately
      });
    });

    const btn = document.getElementById('pomoSettingsBtn');
    const box = document.getElementById('pomoSettings');
    btn.addEventListener('click', () => {
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
  }

  function init(state){
    els = {
      widget: document.getElementById('focus-widget'),
      time: document.getElementById('pomoTime'),
      phase: document.getElementById('pomoPhase'),
      progress: document.getElementById('pomoProgress'),
      start: document.getElementById('pomoStart'),
      skip: document.getElementById('pomoSkip'),
      value: document.getElementById('focusValue'),
      dots: document.getElementById('pomoDots')
    };

    cfg = {
      workMin: state.pomodoro.workMin,
      shortMin: state.pomodoro.shortMin,
      longMin: state.pomodoro.longMin,
      cyclesToLong: state.pomodoro.cyclesToLong
    };
    run = state.pomodoro.run;
    focusSeconds = state.focusTimer.date === todayKey() ? state.focusTimer.seconds : 0;

    if (run.running){
      if (run.endsAt <= Date.now()){
        // expired while no tab was open: advance quietly and wait paused
        run.running = false;
        completePhase(true);
        if (run.running) stopRunning(); // completePhase auto-starts breaks; stay paused on a stale resume
      } else {
        ensureTick();
        setMandalaCalm(run.phase !== 'work');
      }
    }

    els.start.addEventListener('click', () => {
      if (run.running) stopRunning(); else startRunning();
    });
    els.skip.addEventListener('click', () => completePhase(true));

    wireSettings();
    render();
  }

  window.MandalaFocusTimer = { init };
})();
