# Publishing checklist

Steps you'll need to do yourself (accounts, payment, and store review can't be
automated) — this is the map for both.

## Chrome Web Store

1. **Register as a developer**: [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   with any Google account. One-time **$5 registration fee**, paid once, ever.
2. **Zip the extension**: from the repo root, zip only what ships —
   `manifest.json`, `newtab.html`, `css/`, `js/`, `data/`, `icons/`, and
   `sounds/`. Leave out `README.md`, `PRIVACY.md`, `PUBLISHING.md`, `.git/`,
   and `.claude/`. PowerShell one-liner:

   ```powershell
   tar -a -c -f mandala-1.0.0.zip manifest.json newtab.html css js data icons sounds
   ```

   (Use `tar`, not `Compress-Archive` — the latter writes backslash paths
   inside the zip, which store uploaders can reject.)
3. In the developer dashboard: **New Item** → upload the zip.
4. Fill out the listing:
   - Description, category ("Productivity" or "Fun & Games" both fit),
     screenshots (1280×800 or 640×400 — grab a few of the new-tab page in
     different themes/presets).
   - **Privacy practices** tab: disclose the two things this extension
     actually does — reads/writes `storage.local`, and makes network requests
     to Open-Meteo for weather. Link to `PRIVACY.md` if it asks for a privacy
     policy URL (host it via GitHub's raw file URL or GitHub Pages).
   - Single purpose description: "Replaces the new tab page with an
     interactive mandala plus at-a-glance daily info."
5. Submit for review. Typically **1–3 business days**, sometimes longer for
   new developer accounts or first submissions.

## Firefox Add-ons (AMO)

1. **Create a Firefox account** and go to
   [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) —
   free, no fee.
2. **Submit a new add-on**, upload the same zip (Firefox accepts the same
   Manifest V3 package; `browser_specific_settings.gecko.id` in
   `manifest.json` is already set so Firefox has a stable ID for updates).
3. Firefox's automated linter runs first; it may flag `js/lib/p5.min.js` and
   `js/lib/browser-polyfill.min.js` as **minified/bundled code**, which
   triggers a manual source review. When prompted, either:
   - link to the public source (`p5.js` on [GitHub](https://github.com/processing/p5.js),
     `webextension-polyfill` on [GitHub](https://github.com/mozilla/webextension-polyfill)), or
   - attach the unminified versions in the submission's "source code" upload.
4. Choose **"Listed"** distribution so it appears in AMO's public directory
   and auto-updates for users.
5. Review is usually faster than Chrome's, often same-day, but can take
   longer if the source-review step above is required.

## After both are live

Update the two store URLs into `README.md` badges once you have them, and bump
`"version"` in `manifest.json` for every subsequent update (both stores
require a version bump on re-upload).
