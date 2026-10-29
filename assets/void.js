/* The Void - standalone mini map */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const KIND = {
    town: { label: 'Place', color: '#c8ae7d', glyph: '🏘' },
    trial: { label: 'Time Trial', color: '#6fc0d8', glyph: '⏱' },
    service: { label: 'Service', color: '#d97b52', glyph: '' },
  };

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => (el.hidden = true), 250); }, 1800);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
    }
    toast('Copied ' + text);
  }

  fetch('data/map-void.json').then((r) => r.json()).then((meta) => {
    return fetch('data/pois-void.json').then((r) => r.json()).then((data) => start(meta, data));
  }).catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend',
      `<div class="void-error">Failed to load: ${esc(err.message)} (serve over HTTP)</div>`);
  });

  function start(meta, data) {
    const SCALE = Math.pow(2, meta.nativeZoom);
    const crs = L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(1 / SCALE, 0, -1 / SCALE, 0),
    });
    const toLL = (x, z) => L.latLng(-(z - meta.minZ), x - meta.minX);
    const bounds = L.latLngBounds(toLL(meta.minX, meta.maxZ + 1), toLL(meta.maxX + 1, meta.minZ));

    const map = L.map('vmap', {
      crs,
      minZoom: meta.minZoom,
      maxZoom: meta.maxZoom,
      zoomControl: false,
      zoomSnap: 1,
      maxBounds: bounds.pad(0.25),
      maxBoundsViscosity: 0.7,
      attributionControl: true,
      preferCanvas: true,
    });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution(
      'Map data <a href="https://wynntils.com" target="_blank" rel="noopener">Wynntils</a> · ' +
      '<a href="https://wynncraft.com" target="_blank" rel="noopener">Wynncraft</a>');

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('tiles-void/{z}/{x}/{y}.webp', {
      tileSize: meta.tileSize,
      minZoom: meta.minZoom,
      maxZoom: meta.maxZoom,
      maxNativeZoom: meta.nativeZoom,
      minNativeZoom: meta.minZoom,
      noWrap: true,
      bounds,
      keepBuffer: 3,
    }).addTo(map);

    // start focused on the island cluster
    map.setView(toLL(13824, -4200), 7);

    map.on('zoomend', () => {
      $('#hud-zoom').textContent = 'Z' + map.getZoom();
      document.getElementById('vmap').classList.toggle('pixelated', map.getZoom() > meta.nativeZoom);
    });
    $('#hud-zoom').textContent = 'Z' + map.getZoom();

    const items = [];
    for (const p of data.places) items.push({ ...p, k: 'town' });
    for (const p of data.combat) items.push({ ...p, k: p.c === 'trial' ? 'trial' : 'cave' });
    for (const p of data.services) items.push({ ...p, k: 'service' });

    for (const it of items) {
      const ll = toLL(it.x, it.z);
      if (it.k === 'service') {
        const icon = L.divIcon({
          className: 'svc-wrap',
          html: `<div class="svc" style="--c:${KIND.service.color}" title="${esc(it.n)}"></div>`,
          iconSize: [9, 9], iconAnchor: [4.5, 4.5],
        });
        L.marker(ll, { icon }).bindPopup(popup(it), { className: 'wpop', maxWidth: 330 }).addTo(map);
      } else if (it.k === 'town') {
        const icon = L.divIcon({
          className: 'pin-wrap',
          html: `<div class="pin small" style="--c:${KIND.town.color}">${KIND.town.glyph}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        });
        const m = L.marker(ll, { icon, title: it.n }).bindPopup(popup(it), { className: 'wpop', maxWidth: 330 }).addTo(map);
        L.tooltip({ permanent: true, direction: 'bottom', offset: [0, 10], className: 'plbl town', interactive: false })
          .setLatLng(ll).setContent(esc(it.n)).addTo(map);
      } else {
        const icon = L.divIcon({
          className: 'pin-wrap',
          html: `<div class="pin" style="--c:${KIND.trial.color}">${KIND.trial.glyph}</div>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        });
        L.marker(ll, { icon, title: it.n }).bindPopup(popup(it), { className: 'wpop', maxWidth: 330 }).addTo(map);
      }
    }

    map.on('mousemove', (e) => {
      const x = Math.round(e.latlng.lng + meta.minX);
      const z = Math.round(meta.minZ - e.latlng.lat);
      $('#hud-pos').textContent = `X ${x} · Z ${z}`;
      $('#copy-pos').dataset.x = x;
      $('#copy-pos').dataset.z = z;
    });
    $('#copy-pos').addEventListener('click', () => {
      const { x, z } = $('#copy-pos').dataset;
      if (x) copyText(`X ${x} Z ${z}`);
    });

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, x, y, z } = b.dataset;
      if (act === 'loc') copyText(`[${x}, ${y}, ${z}]`);
      else if (act === 'xz') copyText(`X ${x} Z ${z}`);
      else if (act === 'center') map.setView(toLL(+x, +z), Math.max(map.getZoom(), 7), { animate: false });
    });

    function popup(it) {
      const k = it.k === 'service' ? KIND.service : (it.k === 'trial' ? KIND.trial : KIND.town);
      return `<div class="pp" style="--c:${k.color};--cc:${k.color}">
        <div class="pp-k"><span class="dot"></span>${esc(k.label)}</div>
        <h3>${esc(it.n)}</h3>
        <div class="pp-c">X <b>${it.x}</b> · Y <b>${it.y ?? 0}</b> · Z <b>${it.z}</b></div>
        <div class="pp-acts">
          <button data-act="loc" data-x="${it.x}" data-y="${it.y ?? 0}" data-z="${it.z}">Copy /loc</button>
          <button data-act="xz" data-x="${it.x}" data-z="${it.z}">Copy X/Z</button>
          <button data-act="center" data-x="${it.x}" data-z="${it.z}">Center</button>
        </div>
      </div>`;
    }
  }
})();
