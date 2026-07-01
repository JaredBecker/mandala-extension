// To-do list, grouped by the day each task was added. Today's group is
// expanded by default, older days collapse under a clickable date header
// with their own "Clear" so the list doesn't grow forever. Checking a task
// off plays a sound and a flowing strike-through animation; finishing the
// last task in a day plays a bigger "all done" sound instead.
(function () {
  let todos = [];
  const collapsed = new Set(); // dates the user has collapsed/expanded away from default
  let soundState = { volume: 50, muted: false };

  // Web Audio API instead of <audio>/new Audio() — HTMLMediaElement playback
  // registers with the OS/browser media session and briefly pops up a
  // transport overlay; a raw AudioBufferSourceNode doesn't.
  let audioCtx = null;
  const bufferCache = {};

  function getAudioCtx(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  async function loadBuffer(src){
    if (bufferCache[src]) return bufferCache[src];
    const ctx = getAudioCtx();
    const res = await fetch(src);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCache[src] = buffer;
    return buffer;
  }

  function todayKey(){
    return new Date().toISOString().slice(0, 10);
  }

  function formatDateLabel(dateKey){
    const d = new Date(dateKey + 'T00:00:00');
    const opts = { weekday: 'long', month: 'long', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
  }

  async function playSound(src){
    if (soundState.muted) return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = await loadBuffer(src);
      const gain = ctx.createGain();
      gain.gain.value = soundState.volume / 100;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start(0);
    } catch (e) {}
  }

  function tasksForDate(date){
    return todos.filter((t) => t.date === date);
  }

  function groupedDates(){
    const dates = [...new Set(todos.map((t) => t.date))];
    dates.sort((a, b) => b.localeCompare(a)); // most recent first
    return dates;
  }

  function isCollapsed(date){
    const defaultCollapsed = date !== todayKey();
    return collapsed.has(date) ? !defaultCollapsed : defaultCollapsed;
  }

  function render(){
    const list = document.getElementById('todoList');
    list.innerHTML = '';

    groupedDates().forEach((date) => {
      const group = document.createElement('div');
      group.className = 'todo-date-group';

      const header = document.createElement('div');
      header.className = 'todo-date-header';
      header.innerHTML = `
        <span class="todo-date-label">${formatDateLabel(date)}</span>
        <span class="todo-date-actions">
          <button class="todo-clear-btn" title="Clear this day">Clear</button>
          <span class="todo-chevron">${isCollapsed(date) ? '▸' : '▾'}</span>
        </span>
      `;
      header.addEventListener('click', (e) => {
        if (e.target.closest('.todo-clear-btn')) return;
        if (collapsed.has(date)) collapsed.delete(date); else collapsed.add(date);
        render();
      });
      header.querySelector('.todo-clear-btn').addEventListener('click', () => {
        if (!confirm(`Clear all tasks from ${formatDateLabel(date)}?`)) return;
        todos = todos.filter((t) => t.date !== date);
        persist();
        render();
      });

      const items = document.createElement('ul');
      items.className = 'todo-date-items';
      items.style.display = isCollapsed(date) ? 'none' : 'block';

      tasksForDate(date).forEach((t) => {
        const li = document.createElement('li');
        if (t.done) li.classList.add('done');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = t.done;
        cb.addEventListener('change', () => onToggle(t, cb));

        const wrap = document.createElement('span');
        wrap.className = 'todo-text-wrap';
        const span = document.createElement('span');
        span.className = 'todo-text';
        span.textContent = t.text;
        const strike = document.createElement('span');
        strike.className = 'strike-line';
        wrap.append(span, strike);

        const del = document.createElement('button');
        del.textContent = '×';
        del.addEventListener('click', () => {
          todos = todos.filter((x) => x.id !== t.id);
          persist();
          render();
        });

        li.append(cb, wrap, del);
        items.appendChild(li);
      });

      group.append(header, items);
      list.appendChild(group);
    });
  }

  function onToggle(t, checkbox){
    t.done = checkbox.checked;
    const li = checkbox.closest('li');

    if (t.done){
      li.classList.add('done', 'just-checked');
      setTimeout(() => li.classList.remove('just-checked'), 500);

      const remaining = tasksForDate(t.date).filter((x) => !x.done).length;
      playSound(remaining === 0 ? 'sounds/full-complete.mp3' : 'sounds/success.mp3');
    } else {
      li.classList.remove('done');
    }

    persist();
  }

  function persist(){
    MandalaStorage.patch('todos', todos);
  }

  function initSoundControls(){
    const toggle = document.getElementById('todoSoundToggle');
    const volume = document.getElementById('todoSoundVolume');
    volume.value = soundState.volume;
    updateSoundToggleIcon(toggle);

    toggle.addEventListener('click', () => {
      soundState.muted = !soundState.muted;
      updateSoundToggleIcon(toggle);
      MandalaStorage.patch('todoSound', { muted: soundState.muted });
    });

    volume.addEventListener('input', (e) => {
      soundState.volume = parseInt(e.target.value, 10);
      MandalaStorage.patch('todoSound', { volume: soundState.volume });
    });
  }

  function updateSoundToggleIcon(toggle){
    toggle.textContent = soundState.muted ? '🔇' : '🔈';
    toggle.classList.toggle('muted', soundState.muted);
  }

  function init(state){
    todos = state.todos || [];
    soundState = state.todoSound || soundState;
    initSoundControls();
    render();
    loadBuffer('sounds/success.mp3').catch(() => {});
    loadBuffer('sounds/full-complete.mp3').catch(() => {});

    const widget = document.getElementById('todo-widget');
    const toggle = document.getElementById('todo-toggle');
    widget.classList.toggle('collapsed', state.todoCollapsed);
    toggle.addEventListener('click', () => {
      const isCollapsed = widget.classList.toggle('collapsed');
      MandalaStorage.patch('todoCollapsed', isCollapsed);
    });

    document.getElementById('todoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('todoInput');
      const text = input.value.trim();
      if (!text) return;
      todos.push({ id: `todo-${Date.now()}`, text, done: false, date: todayKey() });
      collapsed.delete(todayKey()); // make sure today's group is visible after adding
      input.value = '';
      persist();
      render();
    });
  }

  window.MandalaTodo = { init };
})();
