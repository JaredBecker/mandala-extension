// Box-breathing overlay (4-4-4-4), the one feature native to the mandala
// theme rather than borrowed from Momentum. While active it gently slows
// the mandala's ambient rotation; sketch.js restores the user's own
// rotate-speed setting on exit.
(function () {
  const PHASES = [
    { label: 'Breathe in…', scale: 1.35 },
    { label: 'Hold…', scale: 1.35 },
    { label: 'Breathe out…', scale: 1 },
    { label: 'Hold…', scale: 1 }
  ];
  const PHASE_MS = 4000;

  let timer = null;
  let phaseIndex = 0;

  function runPhase(){
    const ring = document.getElementById('breathRing');
    const label = document.getElementById('breathLabel');
    const phase = PHASES[phaseIndex % PHASES.length];
    label.textContent = phase.label;
    ring.style.transform = `scale(${phase.scale})`;
    phaseIndex += 1;
    timer = setTimeout(runPhase, PHASE_MS);
  }

  function start(){
    document.getElementById('breathing-overlay').classList.add('active');
    phaseIndex = 0;
    runPhase();
    if (typeof setBreathingRotate === 'function') setBreathingRotate(true, 0.08);
  }

  function stop(){
    document.getElementById('breathing-overlay').classList.remove('active');
    clearTimeout(timer);
    if (typeof setBreathingRotate === 'function') setBreathingRotate(false);
  }

  function init(){
    document.getElementById('breatheToggleBtn').addEventListener('click', start);
    document.getElementById('breatheExit').addEventListener('click', stop);
  }

  window.MandalaBreathing = { init };
})();
