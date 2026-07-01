// Single persistent scratchpad, lives in the panel's Tools tab.
(function () {
  function init(state){
    const text = document.getElementById('stickyText');
    text.value = state.stickyNote || '';

    let timer = null;
    text.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { MandalaStorage.patch('stickyNote', text.value); }, 500);
    });
  }

  window.MandalaSticky = { init };
})();
