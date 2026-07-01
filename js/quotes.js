// Quote of the day — bundled locally, deterministic per calendar day, no network call.
(function () {
  function dayOfYear(d){
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }

  async function init(){
    const el = document.getElementById('quote');
    try {
      const res = await fetch('data/quotes.json');
      const quotes = await res.json();
      const q = quotes[dayOfYear(new Date()) % quotes.length];
      el.textContent = `"${q.text}" — ${q.author}`;
    } catch (e) {
      el.textContent = '';
    }
  }

  window.MandalaQuotes = { init };
})();
