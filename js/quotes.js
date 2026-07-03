// Quote of the day — bundled locally, no network call. A randomly chosen
// quote sticks for 24 hours: the pick and its timestamp persist in storage,
// and once the timestamp is a day old the next tab rolls a fresh one
// (never the same quote twice in a row).
(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function init(state){
    const el = document.getElementById('quote');
    try {
      const res = await fetch('data/quotes.json');
      const quotes = await res.json();

      let { index, pickedAt } = state.quote || { index: -1, pickedAt: 0 };
      if (index < 0 || index >= quotes.length || Date.now() - pickedAt > DAY_MS){
        let next;
        do {
          next = Math.floor(Math.random() * quotes.length);
        } while (next === index && quotes.length > 1);
        index = next;
        MandalaStorage.patch('quote', { index, pickedAt: Date.now() });
      }

      const q = quotes[index];
      el.textContent = `"${q.text}" — ${q.author}`;
    } catch (e) {
      el.textContent = '';
    }
  }

  window.MandalaQuotes = { init };
})();
