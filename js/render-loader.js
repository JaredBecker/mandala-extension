// Renderer bootstrap: prefer the WebGL mandala renderer, fall back to the
// p5.js canvas one. The two are behaviourally equivalent; WebGL renders the
// trail buffer in floating point (no 8-bit fade residue) and is much lighter
// on the CPU, but a small slice of machines (blocklisted GPU drivers,
// hardware acceleration disabled, some VMs/remote desktops) can't create a
// context — for those the classic p5 sketch loads instead, so the extension
// works everywhere regardless.
//
// main.js awaits window.rendererReady before applying stored state, so the
// chosen sketch's globals (applyMandalaState etc.) are guaranteed to exist
// by the time they're called.
(function () {
  // dev override: open newtab.html?renderer=p5 (or =webgl) to force a path
  const forced = new URLSearchParams(location.search).get('renderer');

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // preserve execution order among injected scripts
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function webglAvailable(){
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e){
      return false;
    }
  }

  // p5 (global mode) auto-starts on the window load event, and only if
  // setup()/draw() already exist at that moment. When we inject it after the
  // page has finished loading, that never fires — so kick it manually. The
  // setTimeout in the load-listener branch lets p5's own init microtask run
  // first, so we never create a second instance behind its back.
  function kickP5(){
    if (window.p5 && !window.p5.instance && typeof window.setup === 'function'){
      new window.p5();
    }
  }

  async function loadP5(){
    await loadScript('js/lib/p5.min.js');
    await loadScript('js/sketch.js');
    if (document.readyState === 'complete'){
      kickP5();
    } else {
      window.addEventListener('load', () => setTimeout(kickP5, 0));
    }
    document.documentElement.dataset.renderer = 'p5';
    console.info('Mandala renderer: p5.js canvas');
    return 'p5';
  }

  async function boot(){
    // priority: URL override (dev) > stored setting > auto. storage.js is
    // loaded before this script, and a storage failure just means 'auto'.
    let pref = forced;
    if (!pref){
      try {
        pref = (await MandalaStorage.load()).renderer;
      } catch (e){
        pref = 'auto';
      }
    }
    if (pref !== 'p5' && webglAvailable()){
      try {
        await loadScript('js/sketch-webgl.js');
        // start() does all GL setup up front and returns false (after
        // cleaning up its canvas) if anything at all goes wrong — context
        // creation, shader compile, buffer alloc — so falling through to
        // p5 below is always safe.
        if (window.MandalaWebGL && window.MandalaWebGL.start()){
          return 'webgl';
        }
      } catch (e){
        console.warn('WebGL renderer failed, falling back to p5:', e);
      }
    }
    return loadP5();
  }

  window.rendererReady = boot();
})();
