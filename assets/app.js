/* Wynncraft web map - Leaflet + Wynntils static data */
(() => {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let toastTimer = 0;
  function toast(msg, ms = 1900) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 250);
    }, ms);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
    }
    toast('Copied ' + text);
  }

  // ---------------------------------------------------------------- kinds
  const PLACE_KINDS = {
    province: { label: 'Province', color: '#f0c05a', glyph: '◆', size: 'small' },
    city: { label: 'City', color: '#f0c05a', glyph: '🏰', size: '' },
    town: { label: 'Town / POI', color: '#c8ae7d', glyph: '🏘', size: 'small' },
  };
  const COMBAT_KINDS = {
    dungeon: { label: 'Dungeon', color: '#e0685f', glyph: '⚔', size: '' },
    raid: { label: 'Raid', color: '#b07cf0', glyph: '🐉', size: '' },
    boss: { label: 'Boss Altar', color: '#ff8a3d', glyph: '🔥', size: '' },
    cave: { label: 'Cave', color: '#a4967f', glyph: '▽', size: 'small' },
    grind: { label: 'Grind Spot', color: '#d05c7a', glyph: '💀', size: 'small' },
    trial: { label: 'Time Trial', color: '#6fc0d8', glyph: '⏱', size: 'small' },
    lootrun: { label: 'Lootrun Camp', color: '#8fd06f', glyph: '🎁', size: 'small' },
    shrine: { label: 'Shrine', color: '#d8c26a', glyph: '⛩', size: 'small' },
  };
  const SERVICE_GROUPS = {
    shop: { label: 'Shops', color: '#e0b25a' },
    smith: { label: 'Blacksmiths / ID', color: '#d97b52' },
    travel: { label: 'Travel', color: '#6fb3d9' },
    profession: { label: 'Profession Stations', color: '#9bc46a' },
    other: { label: 'Other', color: '#b39ddb' },
  };

  // ---------------------------------------------------------------- boot
  let META;
  let DATA;
  let map;
  let SCALE;

  const state = {
    places: { on: true, kinds: new Set(Object.keys(PLACE_KINDS)) },
    combat: { on: true, kinds: new Set(Object.keys(COMBAT_KINDS)) },
    services: { on: true, kinds: new Set(Object.keys(SERVICE_GROUPS)) },
  };

  const items = [];            // every marker item
  const labels = [];           // place labels
  const markerFor = new Map(); // item -> L.Marker
  const labelFor = new Map();  // label -> L.Tooltip

  const toLL = (x, z) => L.latLng(-(z - META.minZ), x - META.minX);

  function init() {
    SCALE = Math.pow(2, META.nativeZoom); // world px at native zoom == blocks

    const crs = L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(1 / SCALE, 0, -1 / SCALE, 0),
    });

    const bounds = L.latLngBounds(
      toLL(META.minX, META.maxZ + 1),
      toLL(META.maxX + 1, META.minZ),
    );

    map = L.map('map', {
      crs,
      minZoom: META.minZoom,
      maxZoom: META.maxZoom,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 1,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 90,
      maxBounds: bounds.pad(0.12),
      maxBoundsViscosity: 0.75,
      preferCanvas: true,
      worldCopyJump: false,
      boxZoom: true,
    });

    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution(
      'Map data <a href="https://wynntils.com" target="_blank" rel="noopener">Wynntils</a> · ' +
      '<a href="https://wynncraft.com" target="_blank" rel="noopener">Wynncraft</a> · unofficial fan project',
    );

    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);

    L.tileLayer('tiles/{z}/{x}/{y}.webp', {
      tileSize: META.tileSize,
      minZoom: META.minZoom,
      maxZoom: META.maxZoom,
      maxNativeZoom: META.nativeZoom,
      minNativeZoom: META.minZoom,
      noWrap: true,
      bounds,
      keepBuffer: 3,
      updateWhenIdle: false,
      className: 'world-tiles',
      attribution: '',
    }).addTo(map);

    map.fitBounds(bounds, { padding: [14, 14] });
    map.setMinZoom(map.getZoom());
    // start one step closer than the full-map fit, unless a deep link says otherwise
    if (!location.hash && !new URLSearchParams(location.search).get('poi')) {
      map.setZoom(Math.min(META.maxZoom, map.getZoom() + 1));
    }
    map.setMaxBounds(bounds.pad(0.06));

    buildItems();
    buildSidebar();
    wireSearch();
    wireMapEvents();
    wireUi();
    restoreHash();
    sync();
    updateHudPos(null);
    openPoiFromQuery();

    map.on('zoomend', () => {
      document.getElementById('map').classList.toggle('pixelated', map.getZoom() > META.nativeZoom);
      updateZoomHud();
      sync();
    });
    updateZoomHud();

    if (location.search.includes('nosplash')) hideSplash();
    else setTimeout(hideSplash, 600);
  }

  // ---------------------------------------------------------------- data -> items
  function buildItems() {
    for (const p of DATA.places) {
      if (p.c === 'province') continue; // regions are text-only, no marker
      items.push({ ...p, grp: 'places', kind: p.c, minZoom: p.c === 'town' ? 6 : 4, ll: toLL(p.x, p.z) });
    }
    for (const p of DATA.combat) {
      items.push({
        ...p, grp: 'combat', kind: p.c, ll: toLL(p.x, p.z),
        minZoom: (p.c === 'dungeon' || p.c === 'raid') ? 5 : 7,
      });
    }
    for (const p of DATA.services) {
      items.push({ ...p, grp: 'services', kind: p.g, minZoom: 7, small: true, ll: toLL(p.x, p.z) });
    }

    for (const p of DATA.places) {
      labels.push({
        ...p, kind: p.c, ll: toLL(p.x, p.z),
        minZoom: p.c === 'town' ? 7 : (p.c === 'city' ? 5 : 4),
        cls: p.c === 'town' ? 'town' : p.c,
      });
    }
  }

  // ---------------------------------------------------------------- markers
  function kindInfo(item) {
    if (item.grp === 'places') return PLACE_KINDS[item.c] || PLACE_KINDS.town;
    if (item.grp === 'combat') return COMBAT_KINDS[item.c] || COMBAT_KINDS.cave;
    if (item.grp === 'services') return SERVICE_GROUPS[item.g] || SERVICE_GROUPS.other;
    return { label: 'Gathering', color: '#8fd06f' };
  }

  function makeMarker(item) {
    if (item.grp === 'services') {
      const info = kindInfo(item);
      const icon = L.divIcon({
        className: 'svc-wrap',
        html: `<div class="svc" style="--c:${info.color}" title="${esc(item.n)}"></div>`,
        iconSize: [9, 9],
        iconAnchor: [4.5, 4.5],
      });
      const m = L.marker(item.ll, { icon, keyboard: false, riseOnHover: true });
      m.bindPopup(() => popupHtml(item), { className: 'wpop', maxWidth: 330, autoPanPadding: [50, 50] });
      return m;
    }

    if (item.grp === 'places' && item.c === 'town') {
      const icon = L.divIcon({
        className: 'dot-wrap',
        html: `<div class="town-dot" title="${esc(item.n)}"></div>`,
        iconSize: [9, 9],
        iconAnchor: [4.5, 4.5],
      });
      const m = L.marker(item.ll, { icon, title: item.n, riseOnHover: true, zIndexOffset: 260 });
      m.bindPopup(() => popupHtml(item), { className: 'wpop', maxWidth: 340, autoPanPadding: [50, 50] });
      return m;
    }

    if (item.grp === 'places' && item.c === 'province') {
      const icon = L.divIcon({ className: 'no-icon', html: '', iconSize: [1, 1], iconAnchor: [0, 0] });
      const m = L.marker(item.ll, { icon, keyboard: false, interactive: false });
      return m;
    }

    const info = kindInfo(item);
    const cls = 'pin ' + (info.size === 'small' ? 'small' : '');
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: `<div class="${cls}" style="--c:${info.color}">${info.glyph}</div>`,
      iconSize: info.size === 'small' ? [20, 20] : [28, 28],
      iconAnchor: info.size === 'small' ? [10, 10] : [14, 14],
    });
    const m = L.marker(item.ll, {
      icon,
      title: item.n || info.label,
      riseOnHover: true,
      zIndexOffset: item.grp === 'places' ? 400 : 200,
    });
    m.bindPopup(() => popupHtml(item), { className: 'wpop', maxWidth: 340, autoPanPadding: [50, 50] });
    return m;
  }

  function popupHtml(item) {
    const info = kindInfo(item);
    const hasName = !!item.n;
    const lvl = item.l ? ` · Lv ${item.l}` : '';
    const wiki = (item.grp === 'places' || item.grp === 'combat') && hasName
      ? `<a href="https://wynncraft.wiki.gg/index.php?search=${encodeURIComponent(item.n)}" target="_blank" rel="noopener">Wiki ↗</a>`
      : '';
    return `<div class="pp" style="--c:${info.color};--cc:${info.color}">
      <div class="pp-k"><span class="dot"></span>${esc(info.label)}${lvl}</div>
      <h3>${esc(hasName ? item.n : info.label)}</h3>
      <div class="pp-c">X <b>${item.x}</b> · Y <b>${item.y ?? 0}</b> · Z <b>${item.z}</b></div>
      <div class="pp-acts">
        <button data-act="loc" data-x="${item.x}" data-y="${item.y ?? 0}" data-z="${item.z}">Copy /loc</button>
        <button data-act="xz" data-x="${item.x}" data-z="${item.z}">Copy X/Z</button>
        <button data-act="center" data-x="${item.x}" data-z="${item.z}">Center</button>
        ${wiki}
      </div>
    </div>`;
  }

  function shouldShow(item, zoom) {
    const g = state[item.grp];
    if (!g || !g.on || !g.kinds.has(item.kind)) return false;
    return zoom >= item.minZoom;
  }

  function sync() {
    const zoom = map.getZoom();
    for (const item of items) {
      const show = shouldShow(item, zoom);
      const existing = markerFor.get(item);
      if (show) {
        if (!existing) {
          const m = makeMarker(item);
          markerFor.set(item, m);
          m.addTo(map);
        } else if (!map.hasLayer(existing)) {
          existing.addTo(map);
        }
      } else if (existing && map.hasLayer(existing)) {
        existing.remove();
      }
    }

    for (const lb of labels) {
      const show = zoom >= lb.minZoom;
      const existing = labelFor.get(lb);
      if (show) {
        if (!existing) {
          const t = L.tooltip({
            permanent: true,
            direction: 'bottom',
            offset: [0, lb.kind === 'province' ? 2 : 8],
            className: 'plbl ' + lb.cls,
            interactive: false,
          }).setLatLng(lb.ll).setContent(esc(lb.n));
          labelFor.set(lb, t);
          t.addTo(map);
        } else if (!map.hasLayer(existing)) {
          existing.addTo(map);
        }
      } else if (existing && map.hasLayer(existing)) {
        existing.remove();
      }
    }
  }

  // ---------------------------------------------------------------- sidebar
  function kindCount(grp, kind) {
    if (grp === 'places') return DATA.places.filter((p) => p.c === kind).length;
    if (grp === 'combat') return DATA.combat.filter((p) => p.c === kind).length;
    if (grp === 'services') return DATA.services.filter((p) => p.g === kind).length;
    return 0;
  }

  const GROUP_DEFS = () => [
    {
      id: 'places', name: 'Places & Landmarks', total: DATA.places.filter((p) => p.c !== 'province').length,
      kinds: Object.entries(PLACE_KINDS).filter(([k]) => k !== 'province').map(([k, v]) => ({ k, ...v })),
    },
    {
      id: 'combat', name: 'Combat', total: DATA.combat.length,
      kinds: Object.entries(COMBAT_KINDS).map(([k, v]) => ({ k, ...v })),
    },
    {
      id: 'services', name: 'Services', total: DATA.services.length,
      kinds: Object.entries(SERVICE_GROUPS).map(([k, v]) => ({ k, ...v })),
    },
  ];

  function buildSidebar() {
    const host = $('#layers');
    host.innerHTML = GROUP_DEFS().map((g) => {
      const chips = g.kinds.map((k) => {
        const on = state[g.id].kinds.has(k.k);
        return `<button class="chip ${on ? 'on' : ''}" data-grp="${g.id}" data-kind="${k.k}">
          <span class="sw" style="--c:${k.color}"></span>${esc(k.label)}
          <span class="n">${kindCount(g.id, k.k)}</span>
        </button>`;
      }).join('');
      return `<section class="grp" data-grp="${g.id}">
        <label class="grp-head">
          <input type="checkbox" class="grp-check" data-grp="${g.id}" ${state[g.id].on ? 'checked' : ''}>
          <span class="grp-name">${esc(g.name)}</span>
          <span class="grp-count">${g.total.toLocaleString()}</span>
        </label>
        <div class="grp-body">${chips}</div>
      </section>`;
    }).join('');

    host.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        e.preventDefault();
        const g = state[chip.dataset.grp];
        const k = chip.dataset.kind;
        if (g.kinds.has(k)) g.kinds.delete(k); else g.kinds.add(k);
        if (g.kinds.size) g.on = true;
        chip.classList.toggle('on', g.kinds.has(k));
        const box = host.querySelector(`.grp-check[data-grp="${chip.dataset.grp}"]`);
        if (box) box.checked = g.on;
        sync();
        return;
      }
    });

    host.addEventListener('change', (e) => {
      const box = e.target.closest('.grp-check');
      if (!box) return;
      const g = state[box.dataset.grp];
      g.on = box.checked;
      if (g.on && !g.kinds.size) {
        GROUP_DEFS().find((d) => d.id === box.dataset.grp).kinds.forEach((k) => g.kinds.add(k.k));
        host.querySelectorAll(`.chip[data-grp="${box.dataset.grp}"]`).forEach((c) => c.classList.add('on'));
      }
      sync();
    });
  }

  // ---------------------------------------------------------------- search
  const searchables = [];
  let results = [];
  let activeResult = -1;

  function wireSearch() {
    for (const p of DATA.places) {
      if (p.c === 'province') continue;
      searchables.push({ n: p.n, kind: p.c, grp: 'places', x: p.x, z: p.z, item: items.find((i) => i.grp === 'places' && i.n === p.n && i.x === p.x) });
    }
    for (const p of DATA.combat) {
      searchables.push({ n: p.n, kind: p.c, grp: 'combat', x: p.x, z: p.z, item: items.find((i) => i.grp === 'combat' && i.n === p.n && i.x === p.x) });
    }

    const input = $('#search');
    const box = $('#results');

    const render = (q) => {
      const query = q.trim().toLowerCase();
      if (!query) { box.hidden = true; results = []; return; }
      results = searchables
        .map((s) => {
          const n = s.n.toLowerCase();
          const idx = n.indexOf(query);
          return idx < 0 ? null : { s, score: idx === 0 ? 0 : n.includes(' ' + query) ? 1 : 2 };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score || a.s.n.length - b.s.n.length)
        .slice(0, 24)
        .map((x) => x.s);

      if (!results.length) {
        box.innerHTML = '<div class="res" style="cursor:default;color:#6f8090">No matching places</div>';
        box.hidden = false;
        return;
      }
      const kindOf = (r) => (r.grp === 'places' ? PLACE_KINDS[r.kind] : COMBAT_KINDS[r.kind]) || {};
      box.innerHTML = results.map((r, i) => {
        const k = kindOf(r);
        return `<button class="res" data-i="${i}" style="--c:${k.color || '#888'}">
          <span class="dot"></span>
          <span class="nm">${esc(r.n)}</span>
          <span class="kd">${esc(k.label || '')}</span>
          <span class="co">${r.x}, ${r.z}</span>
        </button>`;
      }).join('');
      box.hidden = false;
      activeResult = -1;
    };

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('focus', () => { if (input.value) render(input.value); });
    input.addEventListener('keydown', (e) => {
      const nodes = [...box.querySelectorAll('.res[data-i]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!nodes.length) return;
        activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
        nodes.forEach((n, i) => n.classList.toggle('active', i === activeResult));
        nodes[activeResult].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (activeResult >= 0 && results[activeResult]) { go(results[activeResult]); }
        else if (results[0]) { go(results[0]); }
      } else if (e.key === 'Escape') {
        box.hidden = true;
        input.blur();
      }
    });

    box.addEventListener('click', (e) => {
      const b = e.target.closest('.res[data-i]');
      if (!b) return;
      go(results[+b.dataset.i]);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) box.hidden = true;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    function go(r) {
      if (!r) return;
      const item = r.item;
      box.hidden = true;
      input.blur();
      if (!item) return;
      const zoom = Math.max(map.getZoom(), 7);
      map.flyTo(item.ll, zoom, { duration: 0.65 });
      setTimeout(() => {
        const m = markerFor.get(item);
        if (m) m.openPopup();
      }, 680);
    }
  }

  // ---------------------------------------------------------------- map events / hud
  let lastHover = null;

  function wireMapEvents() {
    map.on('mousemove', (e) => updateHudPos(e.latlng));
    map.on('mouseout', () => updateHudPos(null));

    map.on('contextmenu', (e) => {
      const x = Math.round(e.latlng.lng + META.minX);
      const z = Math.round(META.minZ - e.latlng.lat);
      dropPin(toLL(x, z), x, z);
    });

    let timer = 0;
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(writeHash, 280);
    });

    $('#copy-pos').addEventListener('click', () => {
      if (!lastHover) { toast('Hover the map first'); return; }
      copyText(`X ${lastHover.x} Z ${lastHover.z}`);
    });

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, x, y, z } = b.dataset;
      if (act === 'loc') copyText(`[${x}, ${y}, ${z}]`);
      else if (act === 'xz') copyText(`X ${x} Z ${z}`);
      else if (act === 'center') map.flyTo(toLL(+x, +z), Math.max(map.getZoom(), 7), { duration: 0.5 });
      else if (act === 'unpin' && window.__pin) { window.__pin.remove(); window.__pin = null; }
    });
  }

  function updateZoomHud() {
    const z = map.getZoom();
    const ratio = Math.pow(2, Math.max(0, META.nativeZoom - z));
    $('#hud-zoom').textContent = `Z${z} · 1:${ratio}`;
  }

  function updateHudPos(latlng) {    if (!latlng) {
      lastHover = null;
      $('#hud-pos').textContent = 'X — · Z —';
      return;
    }
    const x = Math.round(latlng.lng + META.minX);
    const z = Math.round(META.minZ - latlng.lat);
    lastHover = { x, z };
    $('#hud-pos').textContent = `X ${x} · Z ${z}`;
  }

  function dropPin(ll, x, z) {
    if (window.__pin) window.__pin.remove();
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: '<div class="pin" style="--c:#ff5d73;font-size:14px">📍</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 24],
    });
    const pin = L.marker(ll, { icon, draggable: true, zIndexOffset: 900 }).addTo(map);
    const html = (p) => {
      const px = Math.round(p.lng + META.minX);
      const pz = Math.round(META.minZ - p.lat);
      return `<div class="pp" style="--c:#ff5d73;--cc:#ff5d73">
        <div class="pp-k"><span class="dot"></span>Custom marker</div>
        <h3>Pin</h3>
        <div class="pp-c">X <b>${px}</b> · Z <b>${pz}</b></div>
        <div class="pp-acts">
          <button data-act="xz" data-x="${px}" data-z="${pz}">Copy X/Z</button>
          <button data-act="unpin">Remove</button>
        </div>
      </div>`;
    };
    pin.bindPopup(() => html(pin.getLatLng()), { className: 'wpop', maxWidth: 300 });
    pin.on('dragend', () => { if (pin.isPopupOpen()) pin.setPopupContent(html(pin.getLatLng())); });
    pin.openPopup();
    window.__pin = pin;
  }

  // ---------------------------------------------------------------- url hash
  function writeHash() {
    const c = map.getCenter();
    const x = Math.round(c.lng + META.minX);
    const z = Math.round(META.minZ - c.lat);
    const hash = `#x=${x}&z=${z}&zoom=${map.getZoom()}`;
    history.replaceState(null, '', hash);
  }

  function restoreHash() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!h.has('x') || !h.has('z')) return;
    const x = Number(h.get('x'));
    const z = Number(h.get('z'));
    const zoom = clamp(Number(h.get('zoom') || 6), map.getMinZoom(), META.maxZoom);
    if (Number.isFinite(x) && Number.isFinite(z)) map.setView(toLL(x, z), zoom);
  }

  // ?poi=Name deep link: jump to a named place/dungeon and open its card
  function openPoiFromQuery() {
    const name = new URLSearchParams(location.search).get('poi');
    if (!name) return;
    const q = name.trim().toLowerCase();
    const item = items.find((i) => (i.grp === 'places' || i.grp === 'combat') && i.n && i.n.toLowerCase() === q)
      || items.find((i) => (i.grp === 'places' || i.grp === 'combat') && i.n && i.n.toLowerCase().includes(q));
    if (!item) return;
    setTimeout(() => {
      map.setView(item.ll, Math.max(map.getZoom(), 7), { animate: false });
      const m = markerFor.get(item);
      if (m) m.openPopup();
    }, 350);
  }

  // ---------------------------------------------------------------- ui wiring
  function wireUi() {
    $('#reset').addEventListener('click', () => {
      map.flyToBounds(L.latLngBounds(toLL(META.minX, META.maxZ + 1), toLL(META.maxX + 1, META.minZ)), { padding: [14, 14], duration: 0.6 });
    });
    $('#share').addEventListener('click', () => {
      writeHash();
      copyText(location.href);
    });
    $('#open-side').addEventListener('click', () => document.body.classList.add('nav-open'));
    $('#close-side').addEventListener('click', () => document.body.classList.remove('nav-open'));
    map.on('click', () => {
      if (document.body.classList.contains('nav-open')) document.body.classList.remove('nav-open');
    });
  }

  function hideSplash() {
    const el = $('#splash');
    el.classList.add('hide');
    if (location.search.includes('nosplash')) el.style.display = 'none';
  }

  // ---------------------------------------------------------------- start
  Promise.all([
    fetch('data/map.json').then((r) => { if (!r.ok) throw new Error('map.json'); return r.json(); }),
    fetch('data/pois.json').then((r) => { if (!r.ok) throw new Error('pois.json'); return r.json(); }),
  ]).then(([meta, pois]) => {
    META = meta;
    DATA = pois;
    init();
  }).catch((err) => {
    console.error(err);
    $('#splash-msg').textContent = 'Failed to load: ' + err.message + ' (serve over HTTP, see README)';
    $('#splash-msg').style.color = '#ff8b8b';
  });
})();
