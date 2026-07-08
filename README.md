<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0c0e1f,50:2b1245,100:0c0e1f&height=230&section=header&text=MANDALA&fontSize=68&fontColor=f2c14e&fontAlignY=38&desc=your%20new%20tab%2C%20drawn%20by%20your%20cursor&descAlignY=58&descSize=18&descColor=5fe8ff&animation=fadeIn" width="100%"/>

![Manifest V3](https://img.shields.io/badge/Manifest-V3-f2c14e?style=for-the-badge&labelColor=0c0e1f)
![Chrome](https://img.shields.io/badge/Chrome-supported-5fe8ff?style=for-the-badge&logo=googlechrome&logoColor=0c0e1f&labelColor=0c0e1f)
![Firefox](https://img.shields.io/badge/Firefox-supported-ff3e94?style=for-the-badge&logo=firefoxbrowser&logoColor=0c0e1f&labelColor=0c0e1f)
![No accounts](https://img.shields.io/badge/accounts-none-f2c14e?style=for-the-badge&labelColor=0c0e1f)

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:f2c14e,50:ff3e94,100:5fe8ff&height=3&section=header" width="100%"/>

</div>

<br/>

A living mandala that blooms from the motion of your mouse — now as your browser's
new tab. Every tab opens to a symmetry-drawing canvas plus the useful stuff you
actually want to see first thing: the time, a greeting, your goal for the day,
weather, a quote, a to-do list, quick links, a focus timer, and a short
breathing moment synced to the mandala's own rotation.

No accounts. No API keys. No tracking. Everything lives in your browser's local
storage; the only outbound calls are to [Open-Meteo](https://open-meteo.com/)
for weather, made only if you add a location.

<div align="center">

### ✦ features

| ✦ The mandala | ✦ On open |
|:---|:---|
| Cursor-drawn symmetry (2–60 arms), mirror reflection | Time + "good morning/afternoon/evening" greeting |
| Flowing line / glowing ribbon / stippled dots / sparkle burst | Daily intention ("what's your main goal today?") |
| Rainbow, gradient, or solid color, 5 palettes, adjustable glow | Multi-location weather with icons, no key required |
| Fade (laser) or permanent trail, ambient auto-rotate | Quote of the day, bundled locally, no network call |
| Presets — Neon Dream, Golden Bloom, Deep Ocean, Chaos Bloom, Surprise me | Quick links, date-filtered to-do list (with a little sound/animation payoff), sticky note, focus timer |
| Draws on its own when idle, cycling a random look every 10s | Box-breathing overlay that slows the mandala's rotation |

</div>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:5fe8ff,50:ff3e94,100:f2c14e&height=3&section=header" width="100%"/>

<div align="center">

### ✦ installing

</div>

**Chrome / Edge / Brave (Chromium)** — live on the Chrome Web Store. Search for
"Mandala" or grab it from your Chromium browser's extension store and open a new
tab.

**Firefox** — the add-on is submitted and awaiting Mozilla's review. Until it's
approved you can load it temporarily:
```
1. Go to about:debugging#/runtime/this-firefox
2. "Load Temporary Add-on…" → select manifest.json
3. Open a new tab
   (temporary add-ons are removed when Firefox closes — reload as needed)
```

Prefer to run it straight from source? Load it unpacked:

**Chromium**
```
1. Go to chrome://extensions
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this repo's folder
4. Open a new tab
```

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:f2c14e,50:ff3e94,100:5fe8ff&height=3&section=header" width="100%"/>

<div align="center">

### ✦ tech

</div>

**[p5.js](https://p5js.org/)** for the canvas and drawing loop &nbsp;·&nbsp;
**[webextension-polyfill](https://github.com/mozilla/webextension-polyfill)**
for one `browser.*` storage API on both browsers &nbsp;·&nbsp; Vanilla JS/CSS,
no framework, no bundler, nothing to compile.

Everything is split into plain files under `css/` and `js/` — no build step.
See [PRIVACY.md](PRIVACY.md) for the data-handling summary.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0c0e1f,50:2b1245,100:0c0e1f&height=120&section=footer&animation=fadeIn" width="100%"/>
