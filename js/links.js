// Quick links grid — user-managed shortcuts.
(function () {
  let links = [];

  function render(){
    const el = document.getElementById('links-widget');
    el.innerHTML = '';
    links.forEach((link) => {
      const a = document.createElement('a');
      a.className = 'link-chip';
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = 'Right-click to remove';
      a.innerHTML = `<span class="glyph">🔗</span>${link.label}`;
      a.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`Remove "${link.label}"?`)){
          links = links.filter((l) => l.id !== link.id);
          persist();
          render();
        }
      });
      el.appendChild(a);
    });

    const add = document.createElement('button');
    add.id = 'addLinkBtn';
    add.textContent = '+ Add link';
    add.addEventListener('click', () => {
      const label = prompt('Link name (e.g. Gmail)');
      if (!label) return;
      let url = prompt('URL (e.g. https://mail.google.com)');
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      links.push({ id: `link-${Date.now()}`, label, url });
      persist();
      render();
    });
    el.appendChild(add);
  }

  function persist(){
    MandalaStorage.patch('links', links);
  }

  function init(state){
    links = state.links || [];
    render();
  }

  window.MandalaLinks = { init };
})();
