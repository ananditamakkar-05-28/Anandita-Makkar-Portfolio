# Anandita Makkar — portfolio

A static personal portfolio with a WebGL "confocal microscope" background built
with Three.js. There is **no build step**: the folder you have is the folder you
deploy.

```
anandita-portfolio/
├── index.html      the whole site — content, styles, routing, theme, lightbox
├── scene.js        the Three.js confocal stage (ES module)
├── img/            the five poster images
└── README.md
```

Three.js is loaded from a CDN through an import map in `index.html`, so there is
nothing to install and no `node_modules`.

## Running it locally

Because `scene.js` is an ES module, opening `index.html` by double-clicking it
(a `file://` URL) will not work — the browser blocks module loading there. Serve
the folder over HTTP instead:

```bash
cd anandita-portfolio
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploying

### Netlify Drop (quickest)

1. Go to <https://app.netlify.com/drop>.
2. Drag the whole `anandita-portfolio` folder onto the page.
3. You get a live URL within seconds. To use a custom domain or to update the
   site later, claim the site with a free Netlify account — after that you can
   drag the folder onto the same site to redeploy.

No configuration file is needed. If you ever add one, a `netlify.toml` with
`[build] publish = "."` and no build command is all this site wants.

### GitHub Pages

```bash
cd anandita-portfolio
git init
git add .
git commit -m "Portfolio site"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Then in the repository on GitHub: **Settings → Pages → Build and deployment**,
set **Source** to *Deploy from a branch*, choose branch `main` and folder
`/ (root)`, and save. The site appears at
`https://<your-username>.github.io/<your-repo>/` after a minute or two.

Two things to know:

- Every file must be committed, including `img/` and `scene.js`. There is no
  build, so whatever is in the repository is what gets served.
- Do **not** add a `.nojekyll`-style exclusion or a `_config.yml` that ignores
  files; the site has no filenames starting with `_` or `.`, so plain Pages
  serves it as-is.

To publish at `https://<your-username>.github.io/` instead of a subpath, name the
repository `<your-username>.github.io`. All the site's internal links are hash
routes (`#research`) and relative paths (`img/…`), so it works correctly at
either a root domain or a subpath without changes.

## Navigation

The eight sections live in a fixed left sidebar (272px, `--side`), like a docs
site. Top to bottom: the logo and name, a search box that filters the links by
label as you type (Esc clears it, and a quiet "No matches" line appears when
nothing matches), the links in four numbered, collapsible groups — Overview,
Academics, Experience, Get in touch — and the theme toggle pinned to the bottom.

The active route is bold with its channel colour as both the dot and a thin left
accent bar, and its group is expanded and locked open (that group's chevron is
`aria-disabled`, so it cannot be collapsed out from under the page you are on).

Below 900px the sidebar becomes an off-canvas drawer under a slim top bar.
The menu button opens it over a dimmed backdrop; the backdrop, Esc, or picking a
link closes it; body scroll is locked while it is open; focus moves into the
drawer on open and back to the menu button on close. `--side` drops to `0px` at
that breakpoint, which is also what shifts the canvas, scrim and content back to
the full window width.

## How the background works

`scene.js` keeps **one** persistent full-screen scene behind the whole site,
never rebuilt between sections.

- **Three instanced layers**, one draw call each: FITC-green cytoplasm,
  DAPI-blue nuclei and small TRITC-pink puncta. Drift and screen-wrapping happen
  in the vertex shader, so no per-instance matrices are touched per frame.
- **Z-stack focus.** Each instance measures its own distance from a moving focus
  plane and grows, softens and fades accordingly. Scrolling the home page pulls
  that plane from the front of the sample to the back, so different cells come
  into focus as you scroll.
- **Channels follow the route.** Each section carries a `data-ch` attribute;
  `index.html` fires an `am:route` event and the scene lerps the three channel
  weights toward it (Research is FITC, so green brightens and the others dim).
  Home balances all three.
- **The hero disc** is a hole in a dimming scrim over the canvas, so the same
  scene reads at full strength inside the eyepiece and as a quiet backdrop
  everywhere else. The disc frame, tick ring, `20 µm` scale bar and channel
  labels are the original HTML sitting on top.
- **The canvas covers the content area, not the window.** It starts after the
  sidebar (`left: var(--side)`), and the renderer, the camera aspect, the cursor
  parallax and the scrim hole are all measured from that box, so everything
  stays centred on the content rather than the full screen.
- **Themes.** The canvas is transparent, so the page's own `--bg` is the
  background in both themes. Dark uses additive blending plus UnrealBloom —
  fluorescence glowing on near-black. Light switches to the darker light-theme
  channel colours blended normally over the pale page, with bloom off, so it
  reads as a stained brightfield slide. The existing theme button drives both.

### Performance and accessibility

- Device pixel ratio is capped at 2; rendering pauses entirely when the tab is
  hidden, and drops to roughly 30fps when the hero is scrolled out of view.
- On phones (`max-width: 820px` or a coarse pointer) the cell count drops from
  200 to 55, bloom is off and the poster tilt is disabled.
- With `prefers-reduced-motion: reduce` the scene renders a single still frame:
  no animation loop, no cursor parallax, no scroll-driven focus.
- If WebGL is unavailable the full-screen canvas and scrim are hidden and the
  original 2D canvas animation runs in the hero disc instead. This is decided by
  a small inline script before first paint, so there is no flash.
- All text stays real HTML above the canvas — nothing is drawn as text in WebGL.
  The canvas and scrim are `aria-hidden` and `pointer-events: none`, so keyboard
  navigation, focus outlines, the poster lightbox and all ARIA attributes behave
  exactly as before.

### Changing things

Channel colours, backgrounds and panel colours all come from the CSS custom
properties at the top of `index.html` (`--dapi`, `--fitc`, `--tritc`, `--bg`
and friends). `scene.js` reads them at runtime, so editing a colour there
changes the WebGL scene too.

Cell density, depth range and the look of each layer are the constants near the
top of `scene.js` (`CELLS`, `Z_NEAR`, `Z_FAR`) and the per-layer options passed
to `layer()` — `opacity`, `core`, `edge`, `wobble`, `grow` and `coc`.

To pin a different Three.js version, change both URLs in the import map in
`index.html`; they must stay on the same version.
