// Quick links grid — user-managed shortcuts. Adding and removing use small
// inline forms instead of native prompt()/confirm() dialogs — the browser
// popups punch straight through the glass aesthetic and block the whole tab.
(function () {
  let links = [];
  let adding = false;      // add-link form open?
  let confirmingId = null; // link awaiting remove confirmation

  function normalizeUrl(url){
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  function renderChip(link){
    if (confirmingId === link.id){
      const box = document.createElement('div');
      box.className = 'link-confirm';
      const label = document.createElement('span');
      label.className = 'link-confirm-label';
      label.textContent = `Remove ${link.label}?`;
      const yes = document.createElement('button');
      yes.className = 'danger';
      yes.textContent = 'Remove';
      yes.addEventListener('click', () => {
        links = links.filter((l) => l.id !== link.id);
        confirmingId = null;
        persist();
        render();
      });
      const no = document.createElement('button');
      no.textContent = 'Keep';
      no.addEventListener('click', () => { confirmingId = null; render(); });
      box.append(label, yes, no);
      return box;
    }

    const a = document.createElement('a');
    a.className = 'link-chip';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Right-click to remove';
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = '🔗';
    a.append(glyph, link.label); // label is user-typed — append as text, never HTML
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      confirmingId = link.id;
      render();
    });
    return a;
  }

  function renderAddArea(el){
    if (!adding){
      const add = document.createElement('button');
      add.id = 'addLinkBtn';
      add.textContent = '+ Add link';
      add.addEventListener('click', () => { adding = true; render(); });
      el.appendChild(add);
      return;
    }

    const form = document.createElement('form');
    form.id = 'linkForm';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Name (e.g. Gmail)';
    nameInput.maxLength = 30;
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'URL (e.g. mail.google.com)';

    const row = document.createElement('div');
    row.className = 'button-row';
    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.textContent = 'Add';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { adding = false; render(); });
    row.append(addBtn, cancelBtn);

    form.append(nameInput, urlInput, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const label = nameInput.value.trim();
      const url = urlInput.value.trim();
      if (!label || !url) return;
      links.push({ id: `link-${Date.now()}`, label, url: normalizeUrl(url) });
      adding = false;
      persist();
      render();
    });

    el.appendChild(form);
    nameInput.focus();
  }

  function render(){
    const el = document.getElementById('links-widget');
    el.innerHTML = '';
    links.forEach((link) => el.appendChild(renderChip(link)));
    renderAddArea(el);
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
