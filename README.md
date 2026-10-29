# Wynncraft Interactive Map · Wynntils web edition

A static, browser-based interactive map for [Wynncraft](https://wynncraft.com), built from the official **Wynntils** map tiles and point-of-interest data. No game client, no mod, no build step — just open the site.

![screenshot](screenshot.jpg)

## What's inside

| Page | Description |
| --- | --- |
| `index.html` | Main world — 4608 × 6656 blocks (the **Realm of Light** is stitched into the northern ocean), 1 px = 1 block, zoom 1:128 → 1:1 and beyond |
| `void.html` | **The Void** — separate region with its own coordinates, tiles and POIs |

- **Places of interest:** cities & towns, dungeons, raids, boss altars, caves, grind spots, time trials, lootrun camps, shrines, and services
- **Services are colour-coded:** Merchants (one shared amber colour), Blacksmiths, Identifiers, Item Upgraders, Trade Market, Housing Balloons, Mount Enclosures and Travel each get their own colour
- **Excluded on purpose:** market stalls (booths), profession stations and party finders are not marked; province names are plain text only (no pin, no filter)
- **Progressive disclosure:** cities and dungeons at low zoom, towns, services and minor POIs appear as you zoom in
- **Search** (`/` to focus), POI cards with level, exact coordinates, copy `/loc`, Wiki link
- **Share:** `#x=-819&z=-1581&zoom=7` restores the view; `?poi=Ragni` opens a specific POI
- **Map tools:** wheel zoom, drag, `Shift`-drag box zoom, right-click to drop a draggable pin
- **Sidebar filters behave like a tree:** unchecking a group clears all its children, checking one child checks the group, clearing the last child clears the group, and re-checking the group selects all children
- **Mobile:** drawer sidebar, touch zoom
- All names and UI text are the original English strings

## Structure

```
index.html            main world map
void.html             The Void map
screenshot.jpg        preview image (README only)
.nojekyll             skip GitHub Pages' Jekyll processing
assets/               CSS + JS for both pages
data/                 map.json / pois.json / map-void.json / pois-void.json
tiles/                main world tiles (z2–z7, 256 px WebP, 637 files)
tiles-void/           Void tiles (45 files)
vendor/leaflet/       Leaflet 1.9.4, vendored locally (no external CDN)
```

## Data & updates

- Tiles and POIs come from Wynntils' public static storage:
  `https://cdn.wynntils.com/static/Reference/maps.json`, `.../Reference/maps/*.png` (including
  `map-realm-of-light.png` and `map-void.png`), and the `*_mapfeatures.json` files.
- This folder is a build artifact. To refresh the data, run the build scripts in the source project
  (`tools/build_tiles.py`, `tools/build_void_tiles.py`, `tools/build_pois.py`) and copy the regenerated
  `tiles/`, `tiles-void/`, `data/` and `assets/` back into this repository.
- Service locations come from Wynntils' community data and can become outdated; re-run the POI build
  for the latest snapshot.

## Notes

- Unofficial fan project. Map rendering and POI data belong to Wynntils / Wynncraft.
- The official ocean colour is a very vivid blue (`#0029d0`); the build tones it down to a deeper blue for readability. Land pixels are untouched.
- The Realm of Light part is overlaid on top of the main world at its Wynntils coordinates, so it appears as a floating island north of the continent.
- No live data (player positions, territory ownership, market prices) — static map and POIs only.
- The Void has only a handful of POIs (2 places, 1 time trial, 5 services); that is everything in Wynntils' public dataset.
