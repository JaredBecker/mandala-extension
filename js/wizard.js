// First-run setup: name, then optional weather location(s).
(function () {
  let pendingLocations = [];

  function renderPending(){
    const list = document.getElementById('wizardLocationList');
    list.innerHTML = '';
    pendingLocations.forEach((loc) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = loc.label;
      const del = document.createElement('button');
      del.textContent = '×';
      del.addEventListener('click', () => {
        pendingLocations = pendingLocations.filter((l) => l.id !== loc.id);
        renderPending();
      });
      li.append(span, del);
      list.appendChild(li);
    });
  }

  async function doSearch(){
    const input = document.getElementById('wizardLocationInput');
    const results = document.getElementById('wizardLocationResults');
    results.innerHTML = '<li>Searching…</li>';
    const found = await MandalaWeather.geocode(input.value.trim());
    results.innerHTML = '';
    if (found.length === 0){
      results.innerHTML = '<li>No matches. Try a different spelling.</li>';
      return;
    }
    found.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r.label;
      li.addEventListener('click', () => {
        pendingLocations.push({ id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: r.label, lat: r.lat, lon: r.lon });
        renderPending();
        results.innerHTML = '';
        input.value = '';
      });
      results.appendChild(li);
    });
  }

  async function finish(){
    const name = document.getElementById('wizardName').value.trim();
    await MandalaStorage.patch('profile', { name, onboarded: true });
    await MandalaStorage.patch('locations', pendingLocations);
    if (pendingLocations.length){
      await MandalaStorage.patch('activeLocationId', pendingLocations[0].id);
    }
    document.getElementById('wizard-overlay').classList.add('closing');
    setTimeout(() => location.reload(), 300);
  }

  // shown both automatically on first run and on demand from the panel's
  // "Edit name & location" button — prefills with whatever's already saved
  // so re-opening it later doesn't throw away an existing setup
  function open(state){
    document.getElementById('wizardStepLocation').classList.remove('active');
    document.getElementById('wizardStepName').classList.add('active');
    document.getElementById('wizardName').value = (state && state.profile.name) || '';
    pendingLocations = (state && state.locations) ? state.locations.slice() : [];
    renderPending();
    const overlay = document.getElementById('wizard-overlay');
    overlay.classList.remove('closing');
    overlay.classList.add('active');
  }

  function init(state){
    // button wiring always runs, regardless of onboarding status — this
    // used to live inside the "first run only" branch below, which meant
    // re-opening the wizard later from the panel would show an overlay with
    // no working buttons
    document.getElementById('wizardNameNext').addEventListener('click', () => {
      document.getElementById('wizardStepName').classList.remove('active');
      document.getElementById('wizardStepLocation').classList.add('active');
    });

    document.getElementById('wizardLocationSearchBtn').addEventListener('click', doSearch);
    document.getElementById('wizardLocationInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); doSearch(); }
    });

    document.getElementById('wizardSkip').addEventListener('click', finish);
    document.getElementById('wizardFinish').addEventListener('click', finish);

    const editBtn = document.getElementById('editProfileBtn');
    if (editBtn) editBtn.addEventListener('click', () => open(state));

    if (!state.profile.onboarded){
      open(state);
    }
  }

  window.MandalaWizard = { init };
})();
