/* ⛰️ Civil tools: surfaces (DEM GeoTIFF · LandXML TIN · survey points → TIN), ground levels taken from a surface into
   the data, a longitudinal profile of a pipe run (ground vs invert, manholes, slopes) and a LandXML pipe-network
   export for Civil 3D. Edits go to work copies, show a sample to check, and re-run the derived fields (depth, slope). */
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const SURF = []; GV.surfaces = SURF;
  const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
  const r3 = v => Math.round(v * 1000) / 1000;
  const dM = (a, b) => { const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180) * 111320; return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540); };
  const srcOf = l => GV.sources.find(s => s.layers.indexOf(l) >= 0);
  const allLayers = () => GV.sources.filter(s => s.id !== 'qc' && s.id !== 'field' && !(GV.superseded && GV.superseded(s))).flatMap(s => s.layers).filter(l => l.features && l.features.length);
  const wgsCoords = f => { const g = f.wgs && f.wgs.geometry; if (!g) return null; return g; };
  const RE = {
    pg: /^(ground_?elevation|groundelevation|ground_?level|cover_?level|cover|cl|gl|rim(_?level)?|rim_?elevation|surface_?level|ngl|ground)$/i,
    pi: /^(elevation|invert_?level|invert|il|inv|invert_?elevation|bottom_?elevation)$/i,
    sg: /^(start_?pipe_?ground_?elevation|startpipegroundelevation|us_?gl|us_?ground(_?level)?|start_?gl|us_?cover(_?level)?|start_?ground(_?level)?)$/i,
    eg: /^(end_?pipe_?ground_?elevation|endpipegroundelevation|ds_?gl|ds_?ground(_?level)?|end_?gl|ds_?cover(_?level)?|end_?ground(_?level)?)$/i,
    si: /^(start_?pipe_?elevation|startpipeelevation|us_?(pipe_?)?il|us_?inv(ert)?(_?level)?|start_?inv(ert)?(_?level)?|start_?il)$/i,
    ei: /^(end_?pipe_?elevation|endpipeelevation|ds_?(pipe_?)?il|ds_?inv(ert)?(_?level)?|end_?inv(ert)?(_?level)?|end_?il)$/i,
    dia: /^(diameter|dia|nominal_?dia(meter)?|size|pipe_?size|قطر)$/i,
    id: /^(facilityid|facility_?id|asset_?id|assetid|mh_?no|mh_?id|name|label|tag|id|objectid)$/i,
    mh: /(manhole|mh|inspection|chamber|catch|ic$|^ic|منهول|غرف)/i
  };
  const keyOf = (p, re) => Object.keys(p || {}).find(k => re.test(k));

  /* ================= surfaces ================= */
  function tinSurface(name, pts, maxEdge, faces) { // pts: [[lon,lat,z]] in WGS84
    let tri;
    if (faces) tri = faces; else {
      const flat = new Float64Array(pts.length * 2); pts.forEach((p, i) => { flat[2 * i] = p[0]; flat[2 * i + 1] = p[1]; });
      tri = new window.Delaunator(flat).triangles;
    }
    const T = []; let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < tri.length; i += 3) {
      const a = pts[tri[i]], b = pts[tri[i + 1]], c = pts[tri[i + 2]]; if (!a || !b || !c) continue;
      if (maxEdge && (dM(a, b) > maxEdge || dM(b, c) > maxEdge || dM(c, a) > maxEdge)) continue; // no long hull triangles across gaps
      T.push([a, b, c]);
      for (const p of [a, b, c]) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
    }
    if (!T.length) throw new Error('السطح طلع فاضي (النقط قليلة أو متباعدة جداً)');
    const N = Math.max(8, Math.min(512, Math.round(Math.sqrt(T.length / 2)))); const cw = (maxx - minx) / N || 1e-9, ch = (maxy - miny) / N || 1e-9;
    const grid = new Map(); const cell = (x, y) => Math.min(N - 1, Math.max(0, Math.floor((x - minx) / cw))) + ',' + Math.min(N - 1, Math.max(0, Math.floor((y - miny) / ch)));
    T.forEach(t => { const x0 = Math.min(t[0][0], t[1][0], t[2][0]), x1 = Math.max(t[0][0], t[1][0], t[2][0]), y0 = Math.min(t[0][1], t[1][1], t[2][1]), y1 = Math.max(t[0][1], t[1][1], t[2][1]);
      const i0 = Math.floor((x0 - minx) / cw), i1 = Math.floor((x1 - minx) / cw), j0 = Math.floor((y0 - miny) / ch), j1 = Math.floor((y1 - miny) / ch);
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) { const k = i + ',' + j; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(t); } });
    const sample = (x, y) => { if (x < minx || x > maxx || y < miny || y > maxy) return null; const c = grid.get(cell(x, y)); if (!c) return null;
      for (const [a, b, d] of c) { const det = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1]); if (!det) continue;
        const l1 = ((b[1] - d[1]) * (x - d[0]) + (d[0] - b[0]) * (y - d[1])) / det, l2 = ((d[1] - a[1]) * (x - d[0]) + (a[0] - d[0]) * (y - d[1])) / det, l3 = 1 - l1 - l2;
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a[2] + l2 * b[2] + l3 * d[2]; }
      return null; };
    const zs = pts.map(p => p[2]);
    return { id: 'S' + Date.now().toString(36), name, kind: 'TIN', n: T.length, sample, bounds: [[miny, minx], [maxy, maxx]], zmin: Math.min(...zs), zmax: Math.max(...zs), tris: T };
  }
  async function demSurface(name, buf, crsCode) {
    const tiff = await window.GeoTIFF.fromArrayBuffer(buf); const img = await tiff.getImage();
    const w = img.getWidth(), h = img.getHeight(); if (w * h > 60e6) throw new Error('الـ DEM كبير جداً (' + w + '×' + h + ') — قصّه على منطقة المشروع الأول');
    const [ox, , , oy] = [img.getOrigin()[0], 0, 0, img.getOrigin()[1]]; const [rx, ry] = img.getResolution();
    const ras = (await img.readRasters({ samples: [0] }))[0];
    const nd = img.getGDALNoData(); const keys = img.getGeoKeys() || {};
    const epsg = keys.ProjectedCSTypeGeoKey && keys.ProjectedCSTypeGeoKey !== 32767 ? keys.ProjectedCSTypeGeoKey : keys.GeographicTypeGeoKey && keys.GeographicTypeGeoKey !== 32767 ? keys.GeographicTypeGeoKey : null;
    const code = epsg && GV.epsgDef(epsg) ? String(epsg) : crsCode; const crs = GV.resolveCRS(code);
    if (!crs) throw new Error('مش عارف نظام إحداثيات الـ DEM — اختاره من القايمة وجرّب تاني');
    const val = (i, j) => { if (i < 0 || j < 0 || i >= w || j >= h) return null; const v = ras[j * w + i]; return v == null || !isFinite(v) || v === nd || v < -1e30 ? null : v; };
    const sample = (lon, lat) => { const p = crs.inv([lon, lat]); const fx = (p[0] - ox) / rx - 0.5, fy = (p[1] - oy) / ry - 0.5; const i = Math.floor(fx), j = Math.floor(fy), dx = fx - i, dy = fy - j;
      const a = val(i, j), b = val(i + 1, j), c = val(i, j + 1), d = val(i + 1, j + 1);
      if (a == null || b == null || c == null || d == null) { const n = val(Math.round(fx), Math.round(fy)); return n; }
      return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy; };
    const c1 = crs.fn([ox, oy]), c2 = crs.fn([ox + rx * w, oy + ry * h]);
    let zmin = Infinity, zmax = -Infinity; for (let k = 0; k < ras.length; k += Math.max(1, Math.floor(ras.length / 20000))) { const v = ras[k]; if (v != null && isFinite(v) && v !== nd && v > -1e30) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; } }
    return { id: 'S' + Date.now().toString(36), name, kind: 'DEM ' + w + '×' + h + ' (' + (crs.geographic ? (Math.abs(rx) * 111320).toFixed(1) : Math.abs(rx).toFixed(2)) + ' م)', sample, bounds: [[Math.min(c1[1], c2[1]), Math.min(c1[0], c2[0])], [Math.max(c1[1], c2[1]), Math.max(c1[0], c2[0])]], zmin, zmax, crsLabel: crs.label };
  }
  function landXmlSurface(name, txt, crsCode) {
    const crs = GV.resolveCRS(crsCode); if (!crs) throw new Error('اختار نظام إحداثيات الـ LandXML');
    const doc = new DOMParser().parseFromString(txt, 'text/xml'); const surf = doc.querySelector('Surface'); if (!surf) return null;
    const ids = new Map(), pts = [];
    surf.querySelectorAll('Pnts > P').forEach(p => { const v = p.textContent.trim().split(/\s+/).map(Number); if (v.length < 3) return; const ll = crs.fn([v[1], v[0]]); ids.set(p.getAttribute('id'), pts.length); pts.push([ll[0], ll[1], v[2]]); }); // LandXML: northing easting elevation
    const faces = []; surf.querySelectorAll('Faces > F').forEach(f => { if (f.getAttribute('i') === '1') return; const v = f.textContent.trim().split(/\s+/); if (v.length < 3) return; const a = ids.get(v[0]), b = ids.get(v[1]), c = ids.get(v[2]); if (a != null && b != null && c != null) faces.push(a, b, c); });
    return tinSurface((surf.getAttribute('name') || name), pts, 0, faces.length ? faces : null);
  }
  function xyzSurface(name, txt, crsCode, maxEdge) {
    const crs = GV.resolveCRS(crsCode); if (!crs) throw new Error('اختار نظام إحداثيات النقط');
    const rows = txt.split(/\r?\n/).map(r => r.split(/[,;\t ]+/).filter(Boolean)); const pts = [];
    // P,N,E,Z,D (survey PNEZD) or X,Y,Z / E,N,Z — find the three numeric columns that look like E, N, Z
    rows.forEach(r => { const n = r.map(Number); const nums = n.map((v, i) => isFinite(v) ? i : -1).filter(i => i >= 0); if (nums.length < 3) return;
      let e, nn, z; const big = nums.filter(i => Math.abs(n[i]) > 10000); if (big.length >= 2) { const a = n[big[0]], b = n[big[1]]; if (a > b) { nn = a; e = b; } else { e = a; nn = b; } z = n[nums.find(i => i > big[1]) != null ? nums.find(i => i > big[1]) : nums.find(i => big.indexOf(i) < 0)]; }
      else { e = n[nums[0]]; nn = n[nums[1]]; z = n[nums[2]]; }
      if (!isFinite(z)) return; const ll = crs.fn([e, nn]); pts.push([ll[0], ll[1], z]); });
    if (pts.length < 3) throw new Error('مالقيتش نقط فيها E, N, Z في الملف');
    return tinSurface(name, pts, maxEdge);
  }
  function layerSurface(l, field, maxEdge) {
    const pts = [];
    l.features.forEach(f => { const g = wgsCoords(f); if (!g) return; const p = f.properties || {}; const fz = field && field !== '__z' ? num(p[field]) : null;
      const zOf = (c, src) => field === '__z' ? (src && src.length > 2 ? src[2] : null) : fz;
      const geo = f.geometry; const add = (c, sc) => { const z = zOf(c, sc); if (z != null && isFinite(z) && Math.abs(z) < 9000) pts.push([c[0], c[1], z]); };
      if (g.type === 'Point') add(g.coordinates, geo && geo.coordinates);
      else if (field === '__z') { const W = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : []; const S = geo ? (geo.type === 'LineString' ? [geo.coordinates] : geo.type === 'MultiLineString' ? geo.coordinates : geo.type === 'Polygon' ? geo.coordinates : []) : [];
        W.forEach((part, i) => part.forEach((c, j) => add(c, S[i] && S[i][j]))); } });
    if (pts.length < 3) throw new Error('الطبقة مفيهاش نقط بمناسيب كفاية (محتاج 3 على الأقل)');
    return tinSurface(l.name, pts, maxEdge);
  }
  let surfLeaf = null;
  function showSurface(s) { if (surfLeaf) GV.map.removeLayer(surfLeaf); surfLeaf = null; if (!s) return; surfLeaf = L.rectangle(s.bounds, { color: '#b5651d', weight: 1.5, dashArray: '6 4', fill: false, interactive: false }).addTo(GV.map); }
  function addSurface(s) { SURF.push(s); GV.toast('⛰️ اتحمّل السطح: ' + s.name + ' — مناسيب من ' + s.zmin.toFixed(2) + ' لـ ' + s.zmax.toFixed(2), 5000); showSurface(s); try { GV.map.fitBounds(s.bounds, { maxZoom: 17 }); } catch (e) { } }
  GV.surfaceAt = (s, lon, lat) => s.sample(lon, lat);
  GV.addDemBuffer = async (buf, name, crsCode) => { const s = await demSurface(name, buf, crsCode); addSurface(s); return s; };
  // a surface opened from a file
  async function openSurfaceFile(file, crsCode, maxEdge) {
    const n = file.name.toLowerCase(); $('#busy').classList.add('show'); $('#busyText').textContent = 'بقرا السطح…';
    try {
      let s = null;
      if (/\.tiff?$/.test(n)) s = await demSurface(file.name, await file.arrayBuffer(), crsCode);
      else if (/\.xml$/.test(n)) s = landXmlSurface(file.name, await file.text(), crsCode);
      else s = xyzSurface(file.name, await file.text(), crsCode, maxEdge);
      if (!s) throw new Error('الملف مفيهوش سطح');
      addSurface(s); return s;
    } finally { $('#busy').classList.remove('show'); }
  }

  /* ================= ground levels from a surface ================= */
  async function applyLevels(s, picks, opts) {
    const log = [], items = []; let n = 0, outside = 0;
    for (const pk of picks) {
      let l = pk.l; const src = srcOf(l); if (src && !src.isCopy && GV.workCopy) { await GV.workCopy(src); l = GV.liveLayer(l); }
      l.features.forEach(f => { const g = wgsCoords(f); if (!g) return; const p = f.properties || (f.properties = {}); const before = Object.assign({}, p); let ch = 0;
        const put = (k, ll) => { if (!k) return; const cur = num(p[k]); if (cur != null && cur !== 0 && !opts.overwrite) return; const z = s.sample(ll[0], ll[1]); if (z == null) { outside++; return; } const v = r3(z); if (cur === v) return; p[k] = typeof p[k] === 'string' ? String(v) : v; ch++; };
        if (g.type === 'Point') { if (!(pk.pf in p) && pk.pf) p[pk.pf] = null; put(pk.pf, g.coordinates); }
        else if (/LineString/.test(g.type)) { const c = g.type === 'LineString' ? g.coordinates : [].concat(...g.coordinates); if (c.length < 2) return; put(pk.sf, c[0]); put(pk.ef, c[c.length - 1]); }
        if (ch) { n++; items.push({ l, f, before, ll: g.type === 'Point' ? g.coordinates : null }); log.push({ f, before }); } });
      if (GV.recalcLayers && opts.derive) GV.recalcLayers([l]);
    }
    GV.renderLayers(); if (GV.onDirty) GV.onDirty();
    GV.toast('⛰️ اتكتب منسوب الأرض لـ ' + n.toLocaleString('en') + ' عنصر' + (outside ? ' · ' + outside + ' نقطة برا حدود السطح (اتسابت زي ما هي)' : ''), 6000);
    if (GV.editSample) GV.editSample('مناسيب من السطح ' + s.name, items, () => { log.forEach(x => { x.f.properties = x.before; }); GV.renderLayers(); GV.toast('رجّعت المناسيب زي ما كانت'); });
  }

  const sh = el('div', 'sheet panel right'); sh.id = 'civSheet';
  sh.innerHTML = '<div class="grab"></div><div class="sh-head"><h2 id="civTitle">⛰️ مناسيب من سطح</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="civBody"></div>';
  document.body.appendChild(sh); sh.querySelector('[data-close]').onclick = () => { sh.classList.remove('open'); };
  const crsSelect = () => { const s = el('select'); GV.CRS_CHOICES.forEach(([c, l]) => { const o = el('option', '', l); o.value = c; s.appendChild(o); }); s.value = GV.store.get('gv_crs') || '32638'; s.onchange = () => GV.store.set('gv_crs', s.value); return s; };
  let cur = null;
  function surfacePicker(box, redraw) {
    box.appendChild(el('b', '', '1 · السطح'));
    if (SURF.length) { const s = el('select'); SURF.forEach((x, i) => { const o = el('option', '', x.name + ' — ' + x.kind + (x.n ? ' · ' + x.n.toLocaleString('en') + ' مثلث' : '')); o.value = i; s.appendChild(o); }); if (!cur || SURF.indexOf(cur) < 0) cur = SURF[SURF.length - 1]; s.value = SURF.indexOf(cur); s.onchange = () => { cur = SURF[+s.value]; showSurface(cur); }; box.appendChild(s); }
    else box.appendChild(el('div', 'muted small', 'لسه مفيش سطح — افتح ملف أو اعمله من طبقة نقاط عندك.'));
    const row = el('div', 'mp-btns');
    const crs = crsSelect(); const me = el('input'); me.type = 'number'; me.value = GV.store.get('gv_tinedge') || 60; me.style.width = '70px'; me.title = 'أطول ضلع مثلث مسموح (م) — يمنع السطح يعدّي فوق فراغات';
    const fb = el('button', 'chip', '📂 ملف سطح (DEM .tif · LandXML · نقاط CSV/TXT)'); const fi = el('input'); fi.type = 'file'; fi.accept = '.tif,.tiff,.xml,.csv,.txt,.xyz,.pnezd'; fi.style.display = 'none';
    fb.onclick = () => fi.click(); fi.onchange = async () => { const f = fi.files[0]; if (!f) return; GV.store.set('gv_tinedge', me.value); try { cur = await openSurfaceFile(f, crs.value, +me.value || 0); redraw(); } catch (e) { GV.showMsg('مقدرتش أقرا السطح:\n' + (e.message || e)); } fi.value = ''; };
    row.append(fb, fi); box.appendChild(row);
    const r2 = el('div', 'civ-g'); r2.append(el('span', 'small', 'نظام إحداثيات الملف (لو مش جواه):'), crs, el('span', 'small', 'أطول ضلع (م):'), me); box.appendChild(r2);
    // from a layer with levels
    const pl = allLayers().filter(l => l.features.some(f => { const g = f.geometry; return g && ((g.type === 'Point' && g.coordinates.length > 2) || (/Line|Polygon/.test(g.type) && JSON.stringify(g.coordinates).length && (g.coordinates[0] || [])[2] != null)); }) || l.kind === 'point');
    if (pl.length) {
      const r3_ = el('div', 'civ-g'); const ls = el('select'); pl.forEach((l, i) => { const o = el('option', '', l.name + ' (' + l.features.length + ')'); o.value = i; ls.appendChild(o); });
      const fs = el('select'); const fillF = () => { fs.innerHTML = ''; const l = pl[+ls.value]; const o0 = el('option', '', 'Z من الإحداثيات'); o0.value = '__z'; fs.appendChild(o0); GV.fieldsOf(l).filter(k => l.features.slice(0, 50).some(f => num((f.properties || {})[k]) != null)).forEach(k => { const o = el('option', '', k); o.value = k; fs.appendChild(o); }); const g = GV.fieldsOf(l).find(k => /^(z|elev|elevation|level|منسوب|rl|gl|ground.*)$/i.test(k)); if (g) fs.value = g; };
      ls.onchange = fillF; fillF();
      const b = el('button', 'chip', '⛰️ اعمل سطح'); b.onclick = () => { try { GV.store.set('gv_tinedge', me.value); cur = layerSurface(pl[+ls.value], fs.value, +me.value || 0); addSurface(cur); redraw(); } catch (e) { GV.showMsg(e.message || e); } };
      r3_.append(el('span', 'small', 'أو من طبقة عندك:'), ls, fs, b); box.appendChild(r3_);
    }
  }
  function openLevels() {
    $('#civTitle').textContent = '⛰️ مناسيب من سطح'; const b = $('#civBody'); b.innerHTML = '';
    const s1 = el('div', 'step'); surfacePicker(s1, openLevels); b.appendChild(s1);
    if (!SURF.length) { GV.openSheet('#civSheet'); return; }
    const s2 = el('div', 'step'); s2.appendChild(el('b', '', '2 · الطبقات والحقول اللي هتتملي'));
    const tl = allLayers().filter(l => l.kind === 'point' || l.kind === 'line');
    const rows = [];
    tl.forEach(l => { const fs = GV.fieldsOf(l); const r = el('div', 'civ-row'); const ck = el('input'); ck.type = 'checkbox';
      const mk = (re, label, def) => { const s = el('select'); const o0 = el('option', '', '— ' + label + ': متكتبش —'); o0.value = ''; s.appendChild(o0); fs.forEach(k => { const o = el('option', '', label + ': ' + k); o.value = k; s.appendChild(o); }); if (def != null) { const o = el('option', '', label + ': حقل جديد ' + def); o.value = def; s.appendChild(o); } const k = fs.find(x => re.test(x)); s.value = k || ''; return s; };
      let pf, sf, ef;
      if (l.kind === 'point') { pf = mk(RE.pg, 'منسوب الأرض', 'SURF_GL'); ck.checked = !!pf.value; r.append(ck, el('span', '', '● ' + l.name), pf); }
      else { sf = mk(RE.sg, 'أرض البداية'); ef = mk(RE.eg, 'أرض النهاية'); ck.checked = !!(sf.value || ef.value); r.append(ck, el('span', '', '━ ' + l.name), sf, ef); }
      rows.push({ l, ck, pf, sf, ef }); s2.appendChild(r); });
    b.appendChild(s2);
    const s3 = el('div', 'step');
    const ow = el('label', 'ck'); const oc = el('input'); oc.type = 'checkbox'; ow.append(oc, el('span', '', 'اكتب على المناسيب الموجودة كمان (الافتراضي: املأ الفاضي والصفر بس)'));
    const dv = el('label', 'ck'); const dc = el('input'); dc.type = 'checkbox'; dc.checked = true; dv.append(dc, el('span', '', 'حدّث العمق والميول بعدها تلقائي'));
    const go = el('button', 'open-btn', '⛰️ هات المناسيب من السطح');
    go.onclick = () => { const picks = rows.filter(r => r.ck.checked).map(r => ({ l: r.l, pf: r.pf && r.pf.value, sf: r.sf && r.sf.value, ef: r.ef && r.ef.value })).filter(p => p.pf || p.sf || p.ef); if (!picks.length) return GV.toast('اختار طبقة وحقل'); applyLevels(cur, picks, { overwrite: oc.checked, derive: dc.checked }); };
    s3.append(ow, dv, go); b.appendChild(s3);
    b.appendChild(el('p', 'muted small', 'التعديل بيتعمل على نسخة شغل (الأصل مبيتلمسش)، وهتظهرلك عينة تراجعها قبل ما تعتمد.'));
    GV.openSheet('#civSheet');
  }
  GV.openLevels = openLevels;

  /* ================= longitudinal profile ================= */
  const lineLayers = () => allLayers().filter(l => l.kind === 'line');
  const lineEnds = f => { const g = wgsCoords(f); if (!g) return null; const c = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? [].concat(...g.coordinates) : null; return c && c.length > 1 ? c : null; };
  function buildGraph(ls, tol) {
    const E = []; ls.forEach(l => l.features.forEach(f => { const c = lineEnds(f); if (c) E.push({ l, f, c, a: c[0], b: c[c.length - 1] }); }));
    const nodes = []; const key = p => { let n = nodes.find(x => dM(x.p, p) <= tol); if (!n) { n = { p, e: [] }; nodes.push(n); } return n; };
    E.forEach(e => { e.na = key(e.a); e.nb = key(e.b); e.na.e.push(e); e.nb.e.push(e); });
    return { E, nodes };
  }
  function pathBetween(G, e1, e2) {
    if (e1 === e2) return [e1];
    const prev = new Map([[e1, null]]); const q = [e1];
    while (q.length) { const e = q.shift(); if (e === e2) break; for (const n of [e.na, e.nb]) for (const x of n.e) if (!prev.has(x)) { prev.set(x, e); q.push(x); } }
    if (!prev.has(e2)) return null; const out = []; for (let e = e2; e; e = prev.get(e)) out.unshift(e); return out;
  }
  function downstream(G, e1) { // follow digitised direction until an outlet or a junction with no single way on
    const out = [e1]; const seen = new Set(out); let e = e1;
    for (let k = 0; k < 500; k++) { const nx = e.nb.e.filter(x => x !== e && x.na === e.nb && !seen.has(x)); if (nx.length !== 1) break; e = nx[0]; out.push(e); seen.add(e); }
    return out;
  }
  function nodePoint(p, tol) { let best = null, bd = tol; allLayers().filter(l => l.kind === 'point').forEach(l => l.features.forEach(f => { const g = wgsCoords(f); if (!g || g.type !== 'Point') return; const d = dM(g.coordinates, p); if (d <= bd) { bd = d; best = { l, f }; } })); return best; }
  function profileData(path, surf) {
    // orient each pipe along the run
    const run = []; let at = null;
    path.forEach((e, i) => { let rev = false; if (i === 0) { const nx = path[1]; rev = nx ? (e.na === nx.na || e.na === nx.nb) : false; } else rev = e.nb === at; run.push({ e, rev }); at = rev ? e.na : e.nb; });
    let ch = 0; const pipes = [], nodes = [];
    const nodeAt = (p, chg) => { const pt = nodePoint(p, 0.6); const pp = pt ? pt.f.properties || {} : {}; const gl = surf ? surf.sample(p[0], p[1]) : null;
      return { ch: chg, p, pt, name: pt ? String(pp[keyOf(pp, RE.id)] || pt.l.name) : '', gl: gl != null ? gl : num(pp[keyOf(pp, RE.pg)]), il: num(pp[keyOf(pp, RE.pi)]) }; };
    run.forEach(({ e, rev }, i) => {
      const c = rev ? e.c.slice().reverse() : e.c; let L = 0; for (let k = 1; k < c.length; k++) L += dM(c[k - 1], c[k]);
      const p = e.f.properties || {}; const si = num(p[keyOf(p, RE.si)]), ei = num(p[keyOf(p, RE.ei)]), sg = num(p[keyOf(p, RE.sg)]), eg = num(p[keyOf(p, RE.eg)]);
      const a = nodeAt(c[0], ch), b = nodeAt(c[c.length - 1], ch + L);
      const us = rev ? ei : si, ds = rev ? si : ei; const usIL = us != null ? us : a.il, dsIL = ds != null ? ds : b.il;
      if (a.gl == null) a.gl = rev ? eg : sg; if (b.gl == null) b.gl = rev ? sg : eg;
      if (!nodes.length) nodes.push(a); nodes.push(b);
      const dia = num(p[keyOf(p, RE.dia)]);
      const ground = []; if (surf) { const step = Math.max(1, L / 60); let acc = 0; for (let k = 1; k < c.length; k++) { const d = dM(c[k - 1], c[k]); for (let t = 0; t < d; t += step) { const x = c[k - 1][0] + (c[k][0] - c[k - 1][0]) * t / d, y = c[k - 1][1] + (c[k][1] - c[k - 1][1]) * t / d; const z = surf.sample(x, y); if (z != null) ground.push([ch + acc + t, z]); } acc += d; } }
      pipes.push({ e, ch0: ch, ch1: ch + L, L, usIL, dsIL, dia: dia ? (dia > 20 ? dia / 1000 : dia) : null, id: String(p[keyOf(p, RE.id)] || ''), slope: usIL != null && dsIL != null && L > 0 ? (usIL - dsIL) / L * 100 : null, ground });
      ch += L;
    });
    return { pipes, nodes, total: ch };
  }
  function profileSVG(D) {
    const W = 1000, H = 380, m = { l: 56, r: 16, t: 18, b: 44 };
    const ys = []; D.nodes.forEach(n => { if (n.gl != null) ys.push(n.gl); if (n.il != null) ys.push(n.il); }); D.pipes.forEach(p => { if (p.usIL != null) ys.push(p.usIL + (p.dia || 0)); if (p.dsIL != null) ys.push(p.dsIL); p.ground.forEach(g => ys.push(g[1])); });
    if (!ys.length) return null;
    let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = Math.max(0.5, (y1 - y0) * 0.08); y0 -= pad; y1 += pad;
    const X = c => m.l + c / (D.total || 1) * (W - m.l - m.r), Y = z => H - m.b - (z - y0) / (y1 - y0) * (H - m.t - m.b);
    const s = []; const css = getComputedStyle(document.body); const ink = css.getPropertyValue('--ink') || '#222';
    s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;font:11px system-ui;direction:ltr">');
    const step = Math.pow(10, Math.floor(Math.log10((y1 - y0) / 4))); const st2 = (y1 - y0) / step > 8 ? step * 2 : step;
    for (let z = Math.ceil(y0 / st2) * st2; z <= y1; z += st2) s.push('<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(z) + '" y2="' + Y(z) + '" stroke="#8884" stroke-width="0.5"/><text x="' + (m.l - 6) + '" y="' + (Y(z) + 4) + '" text-anchor="end" fill="currentColor">' + z.toFixed(st2 < 1 ? 1 : 0) + '</text>');
    // ground
    const gp = []; D.pipes.forEach(p => { if (p.ground.length) p.ground.forEach(g => gp.push([X(g[0]), Y(g[1])])); }); if (!gp.length) D.nodes.forEach(n => { if (n.gl != null) gp.push([X(n.ch), Y(n.gl)]); });
    if (gp.length > 1) s.push('<polyline points="' + gp.map(p => p.join(',')).join(' ') + '" fill="none" stroke="#b5651d" stroke-width="2"/>');
    // pipes: invert + crown
    D.pipes.forEach(p => { if (p.usIL == null || p.dsIL == null) return; const bad = p.slope != null && p.slope <= 0; const col = bad ? '#d32f2f' : '#1e88e5';
      s.push('<line x1="' + X(p.ch0) + '" y1="' + Y(p.usIL) + '" x2="' + X(p.ch1) + '" y2="' + Y(p.dsIL) + '" stroke="' + col + '" stroke-width="2.2"/>');
      if (p.dia) s.push('<line x1="' + X(p.ch0) + '" y1="' + Y(p.usIL + p.dia) + '" x2="' + X(p.ch1) + '" y2="' + Y(p.dsIL + p.dia) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="4 3"/>');
      const mx = (X(p.ch0) + X(p.ch1)) / 2, my = (Y(p.usIL) + Y(p.dsIL)) / 2 + 14; if (p.slope != null) s.push('<text x="' + mx + '" y="' + my + '" text-anchor="middle" fill="' + col + '">' + p.slope.toFixed(2) + '% · ' + p.L.toFixed(1) + 'م' + (p.dia ? ' · Ø' + Math.round(p.dia * 1000) : '') + '</text>'); });
    // manholes
    D.nodes.forEach(n => { const x = X(n.ch); const top = n.gl, bot = n.il != null ? n.il : null; if (top != null && bot != null) s.push('<rect x="' + (x - 4) + '" y="' + Y(top) + '" width="8" height="' + Math.max(1, Y(bot) - Y(top)) + '" fill="#8886" stroke="currentColor" stroke-width="0.8"/>'); else s.push('<line x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="#8886" stroke-dasharray="2 3"/>');
      s.push('<text x="' + x + '" y="' + (H - m.b + 14) + '" text-anchor="middle" fill="currentColor">' + (n.name || '').slice(0, 14) + '</text><text x="' + x + '" y="' + (H - m.b + 28) + '" text-anchor="middle" fill="#888">' + n.ch.toFixed(1) + '</text>'); });
    s.push('<text x="' + (W - m.r) + '" y="12" text-anchor="end" fill="#888">— الأرض   — قاع الماسورة   - - - راس الماسورة   ▮ منهول   (أحمر = ميل صفر أو عكسي)</text></svg>');
    return s.join('');
  }
  let pickMode = null;
  function openProfile() {
    $('#civTitle').textContent = '📈 بروفايل طولي'; const b = $('#civBody'); b.innerHTML = '';
    const ll = lineLayers(); if (!ll.length) { b.appendChild(el('p', 'muted', 'مفيش طبقة خطوط (مواسير) مفتوحة.')); GV.openSheet('#civSheet'); return; }
    const s1 = el('div', 'step'); s1.appendChild(el('b', '', '1 · طبقة المواسير والسطح'));
    const ls = el('select'); ll.forEach((l, i) => { const o = el('option', '', l.name + ' (' + l.features.length + ')'); o.value = i; ls.appendChild(o); });
    const last = GV.store.get('gv_proflayer'); const li = ll.findIndex(l => l.name === last); if (li >= 0) ls.value = li; ls.onchange = () => GV.store.set('gv_proflayer', ll[+ls.value].name);
    const ss = el('select'); const o0 = el('option', '', 'الأرض من حقول المناسيب (من غير سطح)'); o0.value = ''; ss.appendChild(o0); SURF.forEach((x, i) => { const o = el('option', '', 'الأرض من السطح: ' + x.name); o.value = i; ss.appendChild(o); }); if (SURF.length) ss.value = SURF.length - 1;
    s1.append(ls, ss); b.appendChild(s1);
    const s2 = el('div', 'step'); s2.appendChild(el('b', '', '2 · دوس على الخريطة على أول ماسورة، وبعدين على آخر ماسورة'));
    const st = el('div', 'muted small', ''); s2.appendChild(st);
    const row = el('div', 'mp-btns'); const pick = el('button', 'chip done', '👆 ابدأ اختيار المواسير'); const dn = el('button', 'chip', '⬇️ من الماسورة دي لحد الآخر (مع اتجاه السريان)');
    row.append(pick, dn); s2.appendChild(row); b.appendChild(s2);
    const res = el('div'); b.appendChild(res);
    let G = null, first = null; const lay = () => ll[+ls.value];
    const hitPipe = latlng => { const l = lay(); let best = null, bd = Infinity; const P = [latlng.lng, latlng.lat];
      l.features.forEach(f => { const c = lineEnds(f); if (!c) return; for (let k = 1; k < c.length; k++) { const a = c[k - 1], d = c[k]; const kx = Math.cos(P[1] * Math.PI / 180); const vx = (d[0] - a[0]) * kx, vy = d[1] - a[1], wx = (P[0] - a[0]) * kx, wy = P[1] - a[1]; const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / ((vx * vx + vy * vy) || 1))); const dd = Math.hypot(wx - t * vx, wy - t * vy) * 110540; if (dd < bd) { bd = dd; best = f; } } });
      const px = 25 * (40075016 * Math.cos(latlng.lat * Math.PI / 180) / Math.pow(2, GV.map.getZoom() + 8)); return bd <= Math.max(3, px) ? best : null; };
    const finish = path => { stop(); if (!path) { st.textContent = '❌ مالقيتش طريق متوصل بين الماسورتين في الطبقة دي'; return; } draw(path); };
    const stop = () => { if (pickMode) { if (GV.pick === pickMode) GV.pick = null; GV.map.getContainer().style.cursor = ''; pickMode = null; } };
    const startPick = (single) => { stop(); G = buildGraph([lay()], 0.3); first = null; st.textContent = single ? 'دوس على الماسورة اللي هتبدأ منها' : 'دوس على أول ماسورة…'; GV.map.getContainer().style.cursor = 'crosshair'; sh.classList.add('min');
      pickMode = ll => { const f = hitPipe(ll && ll.lat != null ? ll : L.latLng(ll[0], ll[1])); if (!f) { GV.toast('دوس على ماسورة بالظبط'); return; } const ed = G.E.find(x => x.f === f);
        if (single) { sh.classList.remove('min'); finish(downstream(G, ed)); return; }
        if (!first) { first = ed; st.textContent = '✓ أول ماسورة — دلوقتي دوس على آخر ماسورة'; GV.toast('دلوقتي دوس على آخر ماسورة'); return; }
        sh.classList.remove('min'); finish(pathBetween(G, first, ed)); };
      GV.pick = pickMode; };
    pick.onclick = () => startPick(false); dn.onclick = () => startPick(true);
    let hl = null;
    function draw(path) {
      if (hl) GV.map.removeLayer(hl); hl = L.featureGroup(path.map(e => L.polyline(e.c.map(c => [c[1], c[0]]), { color: '#ff9800', weight: 7, opacity: 0.7, interactive: false }))).addTo(GV.map);
      const surf = ss.value === '' ? null : SURF[+ss.value]; const D = profileData(path, surf);
      res.innerHTML = ''; const svg = profileSVG(D);
      st.textContent = '✓ ' + path.length + ' ماسورة · ' + D.total.toFixed(1) + ' م';
      if (!svg) { res.appendChild(el('p', 'muted', 'المواسير دي مفيهاش مناسيب (لا في الحقول ولا في المنهولات) — هات المناسيب من سطح الأول.')); return; }
      const box = el('div', 'prof-box'); box.innerHTML = svg; res.appendChild(box);
      const warn = D.pipes.filter(p => p.slope != null && p.slope <= 0).length; const shallow = D.pipes.filter((p, i) => { const a = D.nodes[i], bb = D.nodes[i + 1]; return (a && a.gl != null && p.usIL != null && a.gl - p.usIL < 1) || (bb && bb.gl != null && p.dsIL != null && bb.gl - p.dsIL < 1); }).length;
      if (warn || shallow) res.appendChild(el('div', 'small', (warn ? '🔴 ' + warn + ' ماسورة ميلها صفر أو عكسي  ' : '') + (shallow ? '🟠 ' + shallow + ' ماسورة غطاها أقل من 1 م' : '')));
      const rows = [['#', 'الماسورة', 'من (م)', 'لـ (م)', 'الطول', 'القطر', 'قاع البداية', 'قاع النهاية', 'الميل %', 'أرض البداية', 'أرض النهاية']].concat(D.pipes.map((p, i) => [i + 1, p.id, r3(p.ch0), r3(p.ch1), r3(p.L), p.dia ? Math.round(p.dia * 1000) : '', p.usIL, p.dsIL, p.slope != null ? +p.slope.toFixed(3) : '', D.nodes[i] && D.nodes[i].gl != null ? r3(D.nodes[i].gl) : '', D.nodes[i + 1] && D.nodes[i + 1].gl != null ? r3(D.nodes[i + 1].gl) : '']));
      const t = el('table', 'prof-t'); rows.slice(0, 60).forEach((r, i) => { const tr = el('tr'); r.forEach(c => tr.appendChild(el(i ? 'td' : 'th', '', c == null ? '' : String(c)))); t.appendChild(tr); }); res.appendChild(t);
      const acts = el('div', 'mp-btns');
      const sv = el('button', 'chip', '⬇️ صورة البروفايل (SVG)'); sv.onclick = () => GV.saveFile('profile_' + new Date().toISOString().slice(0, 10) + '.svg', new TextEncoder().encode(svg));
      const xl = el('button', 'chip', '⬇️ جدول Excel'); xl.onclick = async () => { const bin = await GV.xlsx([{ name: 'بروفايل', rows }]); await GV.saveFile('profile_' + new Date().toISOString().slice(0, 10) + '.xlsx', bin); };
      acts.append(sv, xl); res.appendChild(acts);
    }
    sh._onClose = () => { stop(); if (hl) GV.map.removeLayer(hl); };
    GV.openSheet('#civSheet');
  }
  GV.openProfile = openProfile;
  new MutationObserver(() => { if (!sh.classList.contains('open') && sh._onClose) { sh._onClose(); sh._onClose = null; } }).observe(sh, { attributes: true, attributeFilter: ['class'] });

  /* ================= LandXML pipe network (Civil 3D) ================= */
  GV.landXML = (layers, epsg) => {
    const lines = layers.filter(l => l.features.some(f => f.geometry && /LineString/.test(f.geometry.type)));
    if (!lines.length) return null;
    const pts = layers.filter(l => l.features.some(f => f.geometry && f.geometry.type === 'Point'));
    const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const tol = epsg && +epsg !== 4326 ? 0.05 : 0.0000005;
    const structs = []; const findS = c => structs.find(s => Math.hypot(s.c[0] - c[0], s.c[1] - c[1]) <= tol);
    pts.forEach(l => l.features.forEach((f, i) => { const g = f.geometry; if (!g || g.type !== 'Point') return; const p = f.properties || {}; structs.push({ c: g.coordinates, name: String(p[keyOf(p, RE.id)] || (l.name + '_' + (i + 1))), rim: num(p[keyOf(p, RE.pg)]), sump: num(p[keyOf(p, RE.pi)]), inv: [], used: false }); }));
    const names = new Set(); const uniq = n => { let k = n, i = 2; while (names.has(k)) k = n + '_' + i++; names.add(k); return k; }; structs.forEach(s => { s.name = uniq(s.name); });
    const pipes = []; let ns = 0;
    lines.forEach(l => l.features.forEach((f, i) => { const g = f.geometry; if (!g) return; const c = g.type === 'LineString' ? g.coordinates : [].concat(...g.coordinates); if (c.length < 2) return;
      const p = f.properties || {}; const a = c[0], b = c[c.length - 1];
      const get = pt => { let s = findS(pt); if (!s) { s = { c: pt, name: uniq('Null_' + (++ns)), nul: true, inv: [] }; structs.push(s); } s.used = true; return s; };
      const sa = get(a), sb = get(b); let L = 0; for (let k = 1; k < c.length; k++) L += Math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]);
      const si = num(p[keyOf(p, RE.si)]), ei = num(p[keyOf(p, RE.ei)]); const dia = num(p[keyOf(p, RE.dia)]);
      const name = uniq(String(p[keyOf(p, RE.id)] || (l.name + '_' + (i + 1))));
      if (si != null) sa.inv.push({ elev: si, dir: 'out', pipe: name }); if (ei != null) sb.inv.push({ elev: ei, dir: 'in', pipe: name });
      pipes.push({ name, a: sa.name, b: sb.name, L, slope: si != null && ei != null && L ? (si - ei) / L : null, dia: dia ? (dia > 20 ? dia : dia * 1000) : 200, layer: l.name }); }));
    const kind = lines.map(l => l.name).join(' '); const net = /storm|rain|sw_|سيول|امطار/i.test(kind) ? 'storm' : /sewer|ss_|foul|صرف/i.test(kind) ? 'sanitary' : 'water';
    const now = new Date(); const o = [];
    o.push('<?xml version="1.0" encoding="UTF-8"?>');
    o.push('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="' + now.toISOString().slice(0, 10) + '" time="' + now.toTimeString().slice(0, 8) + '">');
    o.push('<Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees" diameterUnit="millimeter" elevationUnit="meter"/></Units>');
    if (epsg) o.push('<CoordinateSystem epsgCode="' + xml(epsg) + '"/>');
    o.push('<Application name="GIS Viewer" manufacturer="Ahmed"/>');
    o.push('<PipeNetworks><PipeNetwork name="' + xml(lines.map(l => l.name).join('+').slice(0, 60)) + '" pipeNetType="' + net + '">');
    o.push('<Structs>');
    structs.filter(s => s.used).forEach(s => {
      const lowest = s.inv.length ? Math.min(...s.inv.map(x => x.elev)) : null; const sump = s.sump != null ? s.sump : lowest;
      o.push('<Struct name="' + xml(s.name) + '"' + (s.rim != null ? ' elevRim="' + s.rim + '"' : '') + (sump != null ? ' elevSump="' + sump + '"' : '') + '><Center>' + s.c[1] + ' ' + s.c[0] + '</Center>' + (s.nul ? '' : '<CircStruct diameter="1200"/>') + s.inv.map(x => '<Invert elev="' + x.elev + '" flowDir="' + x.dir + '" refPipe="' + xml(x.pipe) + '"/>').join('') + '</Struct>');
    });
    o.push('</Structs><Pipes>');
    pipes.forEach(p => o.push('<Pipe name="' + xml(p.name) + '" refStart="' + xml(p.a) + '" refEnd="' + xml(p.b) + '" length="' + p.L.toFixed(3) + '"' + (p.slope != null ? ' slope="' + p.slope.toFixed(5) + '"' : '') + ' desc="' + xml(p.layer) + '"><CircPipe diameter="' + p.dia + '"/></Pipe>'));
    o.push('</Pipes></PipeNetwork></PipeNetworks></LandXML>');
    return new TextEncoder().encode(o.join('\n'));
  };

  /* ================= tools ================= */
  { const tools = document.querySelector('#toolsSheet .tools.t3') || document.querySelector('#toolsSheet .tools');
    if (tools) {
      const sec = el('div', 'tsec', 'مدني وسيرفيسات'); const grid = el('div', 'tools t3');
      const add = (ic, t, s, fn) => { const b = el('button', 'tool'); b.innerHTML = '<span>' + ic + '</span><b>' + t + '</b><small>' + s + '</small>'; b.onclick = fn; grid.appendChild(b); };
      add('🌐', 'إضافة سيرفيس', 'ArcGIS Server · WMS · Tiles · ملف أورثو', () => GV.openServices && GV.openServices());
      add('⛰️', 'مناسيب من سطح', 'DEM · LandXML · نقاط رفع ← منسوب الأرض', openLevels);
      add('📈', 'بروفايل طولي', 'الأرض والقاع والمنهولات والميول', openProfile);
      add('📥', 'بيانات من سيرفيس أو طبقة', 'الحي، الشارع، الرقم… بالمكان ← حقولك', () => GV.openJoin && GV.openJoin());
      tools.parentNode.insertBefore(grid, tools.nextSibling); tools.parentNode.insertBefore(sec, grid);
    } }
  const st = document.createElement('style'); st.textContent = '.civ-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}.civ-row select{flex:1;min-width:140px}.civ-g{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}.civ-g select{flex:1;min-width:120px}.prof-box{background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:6px;margin:8px 0;overflow:auto}.prof-t{border-collapse:collapse;font-size:12px;width:100%;margin:6px 0}.prof-t td,.prof-t th{border:1px solid var(--line);padding:3px 5px;text-align:center}#civSheet.min .sh-body{display:none}';
  document.head.appendChild(st);
})();
