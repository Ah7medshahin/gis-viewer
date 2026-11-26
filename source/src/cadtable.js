// Extract tables / survey points from CAD into Excel (select an area on the map)
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const ROLES = [['', '—'], ['id', 'رقم النقطة'], ['e', 'Easting / X'], ['n', 'Northing / Y'], ['z', 'المنسوب Z'], ['desc', 'الوصف'], ['skip', 'تجاهل']];
  let table = null; // table: {head:[], rows:[[]], roles:[], src, crs}

  function cadSources() { return GV.sources.filter(s => s.isCad && !GV.superseded(s) && s.layers.some(l => l.features.length)); }
  const STYLES = [['drag', '▭', 'مستطيل بالسحب'], ['two', '⌗', 'مستطيل بضغطتين'], ['poly', '⬠', 'مضلع (نقطة نقطة)'], ['lasso', '✎', 'رسم حر (Lasso)'], ['click', '👆', 'اضغط على الجدول']];
  let shapes = [], selLayer = null, style = GV.store.get('gv_ctsel') || 'drag';
  function open() {
    const cs = cadSources();
    if (!cs.length) return GV.showMsg('افتح ملف الكاد (DWG/DXF) الأول.');
    const box = $('#ctBody'); box.textContent = '';
    box.appendChild(el('b', null, '1 · طريقة التحديد'));
    const sr = el('div', 'sel-styles');
    STYLES.forEach(([k, i, t]) => { const c = el('button', 'sel-st' + (k === style ? ' on' : '')); c.append(el('span', null, i), el('small', null, t)); c.onclick = () => { style = k; GV.store.set('gv_ctsel', k); sr.querySelectorAll('.sel-st').forEach(x => x.classList.toggle('on', x === c)); }; sr.appendChild(c); });
    box.appendChild(sr);
    box.appendChild(el('p', 'muted small', 'مستطيل بالسحب: اسحب بصباعك أو بالماوس من ركن لركن. "اضغط على الجدول": اضغط على أي خانة في الجدول وأنا هحدد حدوده لوحدي.'));
    box.appendChild(el('b', null, '2 · نوع البيانات'));
    const m1 = el('button', 'tpl'); m1.append(el('span', 'tpl-i', '▦'), el('b', null, 'جدول مرسوم'), el('small', null, 'نصوص مترتبة صفوف وأعمدة (رقم، E، N، منسوب، وصف…)')); m1.onclick = () => pickArea('grid');
    const m2 = el('button', 'tpl'); m2.append(el('span', 'tpl-i', '⌖'), el('b', null, 'نقط رفع مرسومة'), el('small', null, 'بلوكات أو نقط، وجنبها نصوص بالرقم والمنسوب والوصف')); m2.onclick = () => pickArea('points');
    const m3 = el('button', 'tpl'); m3.append(el('span', 'tpl-i', '◫'), el('b', null, 'الرسمة كلها'), el('small', null, 'كل النقط والبلوكات في الكاد من غير تحديد منطقة')); m3.onclick = () => { clearSel(); extract('points'); };
    const g = el('div', 'tpl-grid'); g.append(m1, m2, m3); box.appendChild(g);
    GV.openSheet('#ctSheet');
  }
  function clearSel() { shapes = []; if (selLayer) { GV.map.removeLayer(selLayer); selLayer = null; } }
  const SHP = { color: '#e03131', weight: 2, dashArray: '6 4', fillOpacity: 0.06, interactive: false };
  function drawShapes() { if (selLayer) GV.map.removeLayer(selLayer); selLayer = L.layerGroup(shapes.map(sh => sh.type === 'poly' ? L.polygon(sh.pts, SHP) : L.rectangle(sh.b, SHP))).addTo(GV.map); }
  function pickArea(mode, add) {
    if (!add) clearSel();
    GV.closeSheets(); document.body.classList.add('picking');
    const map = GV.map, cont = map.getContainer(), msg = $('#pickMsg');
    ['#pickDone', '#pickGPS'].forEach(q => $(q).style.display = 'none'); $('#pickPhotoIn').parentElement.style.display = 'none';
    const fin = el('button', 'chip done', 'تم'); fin.style.display = 'none'; $('#pickCancel').before(fin);
    let tmp = null, pts = [], down = null; const wasDrag = map.dragging.enabled(); const ta = cont.style.touchAction;
    const clearTmp = () => { if (tmp) { map.removeLayer(tmp); tmp = null; } };
    const done = () => { GV.pick = null; clearTmp(); fin.remove(); document.body.classList.remove('picking'); $('#pickGPS').style.display = ''; $('#pickPhotoIn').parentElement.style.display = ''; $('#pickCancel').removeEventListener('click', cancel); cont.removeEventListener('pointerdown', pd, true); window.removeEventListener('pointermove', pm, true); window.removeEventListener('pointerup', pu, true); cont.style.touchAction = ta; cont.classList.remove('sel-drawing'); if (wasDrag) map.dragging.enable(); };
    const cancel = () => { done(); if (!add) clearSel(); };
    const finish = sh => { done(); shapes.push(sh); drawShapes(); extract(mode, add); };
    $('#pickCancel').addEventListener('click', cancel);
    const ll = e => map.mouseEventToLatLng(e);
    // drag rectangle / lasso use pointer events
    const pd = e => { if (e.target.closest && e.target.closest('#pickBar,.leaflet-control')) return; if (e.button > 0) return; e.preventDefault(); e.stopPropagation(); down = ll(e); pts = [[down.lat, down.lng]]; };
    const pm = e => { if (!down) return; e.preventDefault(); const p = ll(e); clearTmp(); if (style === 'drag') tmp = L.rectangle(L.latLngBounds(down, p), SHP).addTo(map); else { const lp = map.latLngToContainerPoint(pts[pts.length - 1]), cp = map.latLngToContainerPoint(p); if (lp.distanceTo(cp) >= 4) pts.push([p.lat, p.lng]); tmp = L.polyline(pts, { color: '#e03131', weight: 2, interactive: false }).addTo(map); } };
    const pu = e => { if (!down) return; const p = ll(e); const a = map.latLngToContainerPoint(down), b = map.latLngToContainerPoint(p); const d0 = down; down = null; if (style === 'drag') { if (a.distanceTo(b) < 8) return; finish({ type: 'rect', b: L.latLngBounds(d0, p) }); } else { if (pts.length < 4) return; finish({ type: 'poly', pts }); } };
    if (style === 'drag' || style === 'lasso') {
      msg.textContent = style === 'drag' ? 'اسحب مستطيل حوالين الجدول' : 'ارسم بصباعك/بالماوس حوالين الجدول';
      map.dragging.disable(); cont.style.touchAction = 'none'; cont.classList.add('sel-drawing');
      cont.addEventListener('pointerdown', pd, true); window.addEventListener('pointermove', pm, true); window.addEventListener('pointerup', pu, true);
      GV.pick = () => { }; // swallow clicks on features
    } else if (style === 'two') {
      msg.textContent = 'اضغط على أول ركن للمنطقة'; let a = null;
      GV.pick = p => { if (!a) { a = p; msg.textContent = 'اضغط على الركن التاني'; tmp = L.circleMarker(p, { radius: 6, color: '#e03131', interactive: false }).addTo(map); return; } finish({ type: 'rect', b: L.latLngBounds(a, p) }); };
    } else if (style === 'poly') {
      msg.textContent = 'اضغط نقط حوالين الجدول، وبعدين "تم"'; pts = [];
      const upd = () => { clearTmp(); tmp = L.polygon(pts, Object.assign({}, SHP, { dashArray: null })).addTo(map); fin.style.display = pts.length >= 3 ? '' : 'none'; };
      GV.pick = p => { pts.push([p.lat, p.lng]); upd(); };
      fin.onclick = () => { if (pts.length >= 3) finish({ type: 'poly', pts }); };
    } else {
      msg.textContent = 'اضغط على أي خانة جوه الجدول';
      GV.pick = p => { const sh = autoTable(p, mode); if (!sh) return GV.toast('مش لاقي جدول هنا. اضغط على نص جوه الجدول.'); finish(sh); };
    }
  }
  // click-to-detect: grow a cluster of texts (and the grid lines between them) around the click, in the CAD's own units
  function autoTable(p, mode) {
    let best = null;
    cadSources().forEach(s => { const l0 = s.layers.find(l => l.crsDef); const crs = l0 && GV.resolveCRS(l0.crsDef); if (!crs || !crs.inv) return; let c; try { c = crs.inv([p.lng, p.lat]); } catch (e) { return; }
      const T = [], Ls = [];
      s.layers.forEach(l => { if (!l.visible) return; l.features.forEach(f => { const g = f.geometry; if (!g) return; const pr = f.properties || {}; if (pr.Text != null && String(pr.Text).trim() !== '') T.push({ x: g.coordinates[0], y: g.coordinates[1], h: +pr.Height || 0, w: String(pr.Text).length * (+pr.Height || 0) * 0.8 }); else if (g.type === 'LineString') { const cs = g.coordinates; for (let i = 1; i < cs.length; i++) Ls.push([Math.min(cs[i - 1][0], cs[i][0]), Math.min(cs[i - 1][1], cs[i][1]), Math.max(cs[i - 1][0], cs[i][0]), Math.max(cs[i - 1][1], cs[i][1])]); } else if (mode === 'points' && g.type === 'Point' && !f._sym) T.push({ x: g.coordinates[0], y: g.coordinates[1], h: 0, w: 0 }); }); });
      if (!T.length) return;
      const hs = T.map(t => t.h).filter(Boolean).sort((a, b) => a - b); const h = hs.length ? hs[Math.floor(hs.length / 2)] : 1;
      // seed: a text near the click, or the smallest cell (from lines) around it
      let seed = null, sd = Infinity; T.forEach(t => { const d = Math.hypot(t.x - c[0], t.y - c[1]); if (d < sd) { sd = d; seed = t; } });
      if (!seed || sd > h * 12) return;
      if (best && best.d <= sd) return;
      const gap = h * 3; let bb = [Math.min(seed.x, c[0]), Math.min(seed.y, c[1]), Math.max(seed.x + seed.w, c[0]), Math.max(seed.y + seed.h, c[1])];
      const inT = new Set(), inL = new Set();
      for (let it = 0; it < 200; it++) {
        let grew = false; const ex = [bb[0] - gap, bb[1] - gap, bb[2] + gap, bb[3] + gap];
        T.forEach((t, i) => { if (inT.has(i)) return; if (t.x >= ex[0] && t.x <= ex[2] && t.y >= ex[1] && t.y <= ex[3]) { inT.add(i); bb = [Math.min(bb[0], t.x), Math.min(bb[1], t.y), Math.max(bb[2], t.x + t.w), Math.max(bb[3], t.y + t.h)]; grew = true; } });
        // grid lines touching the cluster and not longer than ~4x the cluster (keeps big frames out)
        const W = Math.max(bb[2] - bb[0], bb[3] - bb[1], h * 10);
        Ls.forEach((q, i) => { if (inL.has(i)) return; if (q[2] - q[0] > W * 3 || q[3] - q[1] > W * 3) return; if (q[2] < ex[0] || q[0] > ex[2] || q[3] < ex[1] || q[1] > ex[3]) return; if (q[0] >= ex[0] && q[2] <= ex[2] && q[1] >= ex[1] && q[3] <= ex[3] || (q[0] < bb[2] && q[2] > bb[0] && q[1] < bb[3] && q[3] > bb[1])) { inL.add(i); bb = [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[2]), Math.max(bb[3], q[3])]; grew = true; } });
        if (!grew) break;
      }
      const pad = h * 0.5; const nb = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
      const ring = [[nb[0], nb[1]], [nb[2], nb[1]], [nb[2], nb[3]], [nb[0], nb[3]]].map(q => { const w = crs.fn(q); return [w[1], w[0]]; });
      best = { d: sd, sh: { type: 'poly', pts: ring, nbox: nb, src: s } };
    });
    return best && best.sh;
  }
  const pip = (lat, lng, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
  let curShapes = null;
  const inRect = (f, s) => { const sh = curShapes; if (!sh || !sh.length) return true; return sh.some(x => { if (x.nbox) { if (x.src !== s || !f.geometry) return false; const c = GV.firstCoord(f.geometry); return c && c[0] >= x.nbox[0] && c[0] <= x.nbox[2] && c[1] >= x.nbox[1] && c[1] <= x.nbox[3]; } if (!f.wgs || !f.wgs.geometry) return false; const c = GV.firstCoord(f.wgs.geometry); if (!c) return false; return x.type === 'rect' ? x.b.contains([c[1], c[0]]) : pip(c[1], c[0], x.pts); }); };
  const natCmp = (a, b) => { const x = num(a), y = num(b); if (x != null && y != null) return x - y; if (x != null) return -1; if (y != null) return 1; return String(a).localeCompare(String(b), undefined, { numeric: true }); };
  function sortById(t) { if (!t || !t.rows || !t.rows.length) return; let ii = t.roles ? t.roles.indexOf('id') : -1; if (ii < 0) ii = t.head.findIndex((_, ci) => { const v = t.rows.map(r => r[ci]).filter(x => x !== '' && x != null); return v.length >= 2 && v.filter(x => { const n = num(x); return n != null && Number.isInteger(n) && n < 100000; }).length >= v.length * 0.8; }); if (ii < 0) return; t.rows.sort((r1, r2) => natCmp(r1[ii], r2[ii])); }
  GV.ctNatCmp = (a, b) => natCmp(a, b);
  const median = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const num = s => { const t = String(s).replace(/,/g, '').trim(); return /^[-+]?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null; };

  function extract(mode, add) {
    curShapes = add ? shapes.slice(-1) : shapes.slice();
    const srcs = cadSources(); const texts = [], pts = [], vlines = [];
    srcs.forEach(s => s.layers.forEach(l => l.features.forEach(f => {
      if (!f.geometry || !inRect(f, s)) return; const p = f.properties || {};
      if (p.Text != null && String(p.Text).trim() !== '') { const c = f.geometry.coordinates; texts.push({ x: c[0], y: c[1], t: String(p.Text).trim(), h: p.Height || 0, layer: l.name }); }
      else if (f.geometry.type === 'Point' && !f._sym) pts.push({ f, l, c: f.geometry.coordinates });
      else if (f.geometry.type === 'LineString' && f.geometry.coordinates.length === 2) { const [a, b] = f.geometry.coordinates; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) > 0) vlines.push(a[0]); }
    })));
    const crs = (srcs.flatMap(s => s.layers).find(l => l.crsDef) || {}).crsDef || null;
    let fresh;
    if (mode === 'grid') { if (!texts.length) { if (add) shapes.pop(), drawShapes(); return GV.showMsg('مفيش نصوص في المنطقة اللي حددتها.'); } fresh = gridTable(texts, vlines); }
    else { if (!pts.length) { if (add) shapes.pop(), drawShapes(); return GV.showMsg('مفيش نقط أو بلوكات في المنطقة. لو الجدول نصوص بس، استخدم "جدول مرسوم".'); } fresh = pointTable(pts, texts); }
    if (add && table && table.mode === mode) {
      const n = table.head.length; const sameHead = t2 => t2.head.join('|') === table.head.join('|');
      const extra = (sameHead(fresh) || /^عمود /.test(fresh.head[0])) ? fresh.rows : [fresh.head].concat(fresh.rows);
      extra.filter(r => r.some(c => c !== '' && num(c) != null)).forEach(r => { const rr = r.slice(0, n); while (rr.length < n) rr.push(''); table.rows.push(rr); });
      sortById(table); GV.toast('اتضاف ' + extra.length + ' صف · الإجمالي ' + table.rows.length);
      render(); return;
    }
    table = fresh; table.crs = crs; table.mode = mode;
    guessRoles(); sortById(table); render();
  }
  function gridTable(texts, vlines) {
    const h = median(texts.map(t => t.h).filter(x => x > 0)) || (() => { const ys = texts.map(t => t.y).sort((a, b) => a - b); const gaps = []; for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 1e-6) gaps.push(ys[i] - ys[i - 1]); return median(gaps) || 1; })();
    const sorted = texts.slice().sort((a, b) => b.y - a.y);
    const rows = []; sorted.forEach(t => { const r = rows.find(r => Math.abs(r.y - t.y) < h * 0.6); if (r) { r.items.push(t); r.y = (r.y * (r.items.length - 1) + t.y) / r.items.length; } else rows.push({ y: t.y, items: [t] }); });
    rows.sort((a, b) => b.y - a.y);
    let cols;
    const vx = Array.from(new Set(vlines.map(x => Math.round(x * 1000) / 1000))).sort((a, b) => a - b);
    if (vx.length >= 3) { cols = vx.slice(0, -1).map((x, i) => ({ a: x, b: vx[i + 1] })); cols.push({ a: vx[vx.length - 1], b: Infinity }); cols.unshift({ a: -Infinity, b: vx[0] }); }
    else {
      const xs = texts.map(t => t.x).sort((a, b) => a - b); cols = []; let cs = xs[0], last = xs[0];
      xs.forEach(x => { if (x - last > h * 2.5) { cols.push({ a: cs - h, b: last + h }); cs = x; } last = x; }); cols.push({ a: cs - h, b: last + h * 30 });
      for (let i = 0; i < cols.length - 1; i++) cols[i].b = cols[i + 1].a;
    }
    const grid = rows.map(r => { const cells = cols.map(() => []); r.items.sort((a, b) => a.x - b.x).forEach(t => { let ci = cols.findIndex(c => t.x >= c.a - 1e-9 && t.x < c.b); if (ci < 0) ci = t.x < cols[0].a ? 0 : cols.length - 1; cells[ci].push(t.t); }); return cells.map(c => c.join(' ')); });
    const keep = grid.filter(r => r.some(c => c !== ''));
    const nonEmptyCols = cols.map((_, ci) => keep.some(r => r[ci] !== '')); const g2 = keep.map(r => r.filter((_, ci) => nonEmptyCols[ci]));
    // header = the row (among the first 5) with the most text cells; rows above it are the title
    const txtN = r => r.filter(c => c && num(c) == null).length;
    let hi = -1, best = 1; g2.slice(0, 5).forEach((r, i) => { const k = txtN(r); if (k > best && k >= r.filter(Boolean).length * 0.6) { best = k; hi = i; } });
    let head = null; if (hi >= 0 && g2.slice(hi + 1).some(r => r.some(c => num(c) != null))) head = g2[hi];
    const title = head ? g2.slice(0, hi).map(r => r.filter(Boolean).join(' ')).filter(Boolean).join(' ') : '';
    let body = head ? g2.slice(hi + 1) : g2;
    const n = Math.max(...g2.map(r => r.length));
    let H = head ? head.slice() : Array.from({ length: n }, () => '');
    while (H.length < n) H.push('');
    body = body.map(r => { const rr = r.slice(); while (rr.length < n) rr.push(''); return rr; }).filter(r => !(head && r.join('|') === head.join('|')));
    // the same columns repeated side by side (Point#, E, N, Z, Desc | Point#, E, N, Z, Desc …) → one set of columns, groups stacked under each other
    const norm = x => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
    let period = 0;
    if (head) for (let p = 2; p <= n / 2; p++) {
      if (!norm(H[0]) || norm(H[0]) !== norm(H[p])) continue;
      let ok = true, matched = 0; for (let i = 0; i + p < n; i++) { const x = norm(H[i]), y = norm(H[i + p]); if (x && y) { if (x !== y) { ok = false; break; } matched++; } }
      if (ok && matched >= p - 1) { period = p; break; }
    }
    if (period) {
      const groups = Math.ceil(n / period); const out = [];
      for (let g = 0; g < groups; g++) body.forEach(r => { const sl = r.slice(g * period, g * period + period); while (sl.length < period) sl.push(''); if (sl.some(c => c !== '')) out.push(sl); });
      body = out; H = H.slice(0, period);
    }
    // drop title / section rows inside the data (e.g. "AS BUILLT STL- Z04") and repeated header rows
    const hasNum = r => r.some(c => c !== '' && num(c) != null);
    const hk = H.map(norm).join('|');
    if (body.filter(hasNum).length >= body.length * 0.5) body = body.filter(r => hasNum(r) && r.map(norm).join('|') !== hk);
    return { head: H.map((h0, i) => h0 || 'عمود ' + (i + 1)), rows: body, title, stacked: period ? Math.ceil(n / period) : 0 };
  }
  function pointTable(pts, texts) {
    const tg = new Map(); const hs = median(texts.map(t => t.h).filter(x => x > 0)) || 1; const R = Math.max(hs * 6, 1.5);
    texts.forEach((t, i) => { const k = Math.floor(t.x / R) + ',' + Math.floor(t.y / R); if (!tg.has(k)) tg.set(k, []); tg.get(k).push(i); });
    const used = new Set(); const attrKeys = new Set();
    pts.forEach(p => Object.keys(p.f.properties || {}).forEach(k => { if (!/^(Layer|Entity|Color|Block|Text|Height|Rotation)$/.test(k)) attrKeys.add(k); }));
    const ak = Array.from(attrKeys);
    let maxLbl = 0;
    const rows = pts.map(p => {
      const c = p.c; const near = [];
      const ci = Math.floor(c[0] / R), cj = Math.floor(c[1] / R);
      for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) (tg.get(a + ',' + b) || []).forEach(ti => { const t = texts[ti]; const d = Math.hypot(t.x - c[0], t.y - c[1]); if (d <= R) near.push({ t, d, ti }); });
      near.sort((x, y) => (y.t.y - x.t.y) || (x.t.x - y.t.x)); // top to bottom like a label stack
      const lbl = near.filter(n => !used.has(n.ti)).map(n => { used.add(n.ti); return n.t.t; });
      maxLbl = Math.max(maxLbl, lbl.length);
      const z = c.length > 2 && c[2] ? c[2] : null;
      return { attrs: ak.map(k => p.f.properties[k] == null ? '' : String(p.f.properties[k])), x: c[0], y: c[1], z, lbl, block: p.f.properties.Block || '', layer: p.l.name };
    });
    maxLbl = Math.min(maxLbl, 6);
    const head = ['X', 'Y', 'Z (الرسمة)'].concat(ak).concat(Array.from({ length: maxLbl }, (_, i) => 'نص ' + (i + 1))).concat(['البلوك', 'اللير']);
    return { head, rows: rows.map(r => [r.x.toFixed(3), r.y.toFixed(3), r.z != null ? (+r.z).toFixed(3) : ''].concat(r.attrs).concat(Array.from({ length: maxLbl }, (_, i) => r.lbl[i] || '')).concat([r.block, r.layer])) };
  }
  function guessRoles() {
    const t = table; t.roles = t.head.map(() => '');
    const colVals = ci => t.rows.map(r => r[ci]).filter(v => v !== '' && v != null);
    t.head.forEach((h, ci) => {
      const hs = String(h).toLowerCase(); const vals = colVals(ci); const nums = vals.map(num).filter(v => v != null); const ratio = vals.length ? nums.length / vals.length : 0;
      if (/^(x|east|easting|e)\b|^x$/.test(hs) || /شرق/.test(hs)) t.roles[ci] = 'e';
      else if (/^(y|north|northing|n)\b|^y$/.test(hs) || /شمال/.test(hs)) t.roles[ci] = 'n';
      else if (/(elev|level|^z|rl|gl|منسوب)/.test(hs)) t.roles[ci] = 'z';
      else if (/(desc|code|remark|وصف|ملاحظ|type)/.test(hs)) t.roles[ci] = 'desc';
      else if (/(point|pt|no|id|رقم|نقطة)/.test(hs)) t.roles[ci] = 'id';
      else if (ratio > 0.8 && nums.length) { const m = median(nums); if (m > 100000 && m < 900000 && !t.roles.includes('e')) t.roles[ci] = 'e'; else if (m > 1000000 && m < 9500000 && !t.roles.includes('n')) t.roles[ci] = 'n'; else if (Math.abs(m) < 5000 && nums.some(v => !Number.isInteger(v)) && !t.roles.includes('z')) t.roles[ci] = 'z'; else if (nums.every(Number.isInteger) && !t.roles.includes('id')) t.roles[ci] = 'id'; }
      else if (ratio < 0.3 && vals.length && !t.roles.includes('desc') && t.mode === 'grid') t.roles[ci] = 'desc';
    });
    if (t.mode === 'points') {
      // labels: pick numeric with decimals as Z, integer/short code as id, text as desc
      t.head.forEach((h, ci) => { if (!/^نص /.test(h)) return; const vals = colVals(ci); const nums = vals.map(num).filter(v => v != null); const r = vals.length ? nums.length / vals.length : 0;
        if (r > 0.8 && nums.some(v => !Number.isInteger(v)) && !t.roles.includes('z')) t.roles[ci] = 'z'; else if (r > 0.8 && !t.roles.includes('id')) t.roles[ci] = 'id'; else if (r < 0.5 && vals.length && !t.roles.includes('desc')) t.roles[ci] = 'desc'; });
      if (!t.roles.includes('z')) t.roles[2] = 'z';
    }
  }
  function render() {
    const t = table; const box = $('#ctBody'); box.textContent = '';
    const top = el('div', 'fc-acts');
    const again = el('button', 'chip', '→ تحديد تاني'); again.onclick = open;
    const more = el('button', 'chip', '＋ زوّد جزء تاني من الجدول'); more.title = 'لو الجدول مكمّل في مكان تاني في الرسمة'; more.onclick = () => pickArea(t.mode, true);
    const st = el('select', 'chip'); STYLES.forEach(([k, i, x]) => { const o = el('option', null, i + ' ' + x); o.value = k; st.appendChild(o); }); st.value = style; st.onchange = () => { style = st.value; GV.store.set('gv_ctsel', style); };
    top.append(again, more, st, el('b', null, t.rows.length.toLocaleString('en') + ' صف · ' + t.head.length + ' عمود'));
    if (t.title || t.stacked) box.appendChild(el('p', 'small ok-note', (t.title ? '📋 ' + t.title + (t.stacked ? ' — ' : '') : '') + (t.stacked ? 'الجدول كان ' + t.stacked + ' أجزاء جنب بعض بنفس الأعمدة، اترصّوا تحت بعض في عمود واحد' : '')));
    box.appendChild(top);
    box.appendChild(el('p', 'muted small', 'حدد وظيفة كل عمود (اتعرف تلقائي). ممكن تعدّل اسم العمود. الصفوف اللي فيها E و N هتتحول لنقط.'));
    const wrap = el('div', 'tbl-wrap ct'); const tb = el('table'); tb.id = 'ctTbl';
    const th = el('tr'); const tr2 = el('tr');
    t.head.forEach((h, ci) => {
      const c = el('th'); const inp = el('input'); inp.value = h; inp.oninput = () => t.head[ci] = inp.value; c.appendChild(inp); th.appendChild(c);
      const c2 = el('th'); const s = el('select'); ROLES.forEach(([v, x]) => { const o = el('option', null, x); o.value = v; s.appendChild(o); }); s.value = t.roles[ci] || ''; s.onchange = () => t.roles[ci] = s.value; c2.appendChild(s); tr2.appendChild(c2);
    });
    tb.append(th, tr2);
    t.rows.slice(0, 300).forEach(r => { const tr = el('tr'); t.head.forEach((_, ci) => tr.appendChild(el('td', null, r[ci] == null ? '' : r[ci]))); tb.appendChild(tr); });
    wrap.appendChild(tb); box.appendChild(wrap);
    if (t.rows.length > 300) box.appendChild(el('p', 'muted small', 'معروض أول 300 صف، والملف هيطلع بالكامل.'));
    const warn = checkRows(); if (warn) { const w = el('div', 'cmp'); w.style.setProperty('--sc', '#f08c00'); w.appendChild(el('b', null, '⚠ ' + warn)); box.appendChild(w); }
    const acts = el('div', 'fc-acts');
    const x = el('button', 'open-btn sm', 'نزّل Excel'); x.onclick = () => save('xlsx');
    const c = el('button', 'chip', 'CSV'); c.onclick = () => save('csv');
    const p = el('button', 'chip', 'حوّلها لنقط على الخريطة'); p.onclick = toPoints;
    acts.append(x, c, p); box.appendChild(acts);
    GV.openSheet('#ctSheet');
  }
  function checkRows() {
    const t = table; const ei = t.roles.indexOf('e'), ni = t.roles.indexOf('n'), zi = t.roles.indexOf('z');
    const msgs = [];
    if (ei >= 0 && ni >= 0) { const bad = t.rows.filter(r => num(r[ei]) == null || num(r[ni]) == null).length; if (bad) msgs.push(bad + ' صف إحداثياته مش أرقام'); }
    if (zi >= 0) { const zs = t.rows.map(r => num(r[zi])).filter(v => v != null); const m = median(zs); const odd = zs.filter(v => Math.abs(v - m) > 100).length; if (odd) msgs.push(odd + ' منسوب بعيد جدًا عن الباقي'); }
    const ii = t.roles.indexOf('id'); if (ii >= 0) { const s = new Map(); t.rows.forEach(r => s.set(r[ii], (s.get(r[ii]) || 0) + 1)); const d = Array.from(s.values()).filter(v => v > 1).length; if (d) msgs.push(d + ' رقم نقطة متكرر'); }
    return msgs.join(' · ');
  }
  function outRows() { const t = table; return [t.head.filter((_, i) => t.roles[i] !== 'skip')].concat(t.rows.map(r => r.filter((_, i) => t.roles[i] !== 'skip').map(v => { const n = num(v); return n != null && String(v).length < 16 ? n : v; }))); }
  async function save(kind) {
    const rows = outRows();
    if (kind === 'csv') { const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; await GV.saveFile('cad_table.csv', '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')); return; }
    await GV.saveFile('cad_table.xlsx', await GV.xlsx([{ name: 'جدول الكاد', rows }]));
  }
  async function toPoints() {
    const t = table; const ei = t.roles.indexOf('e'), ni = t.roles.indexOf('n'), zi = t.roles.indexOf('z');
    if (ei < 0 || ni < 0) return GV.toast('حدد عمود Easting وعمود Northing الأول');
    const feats = t.rows.map(r => { const x = num(r[ei]), y = num(r[ni]); if (x == null || y == null) return null; const z = zi >= 0 ? num(r[zi]) : null; const p = {}; t.head.forEach((h, i) => { if (t.roles[i] !== 'skip') p[h || ('c' + i)] = num(r[i]) != null && String(r[i]).length < 16 ? num(r[i]) : r[i]; }); return { type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: z != null ? [x, y, z] : [x, y] } }; }).filter(Boolean);
    if (!feats.length) return GV.toast('مفيش صفوف فيها إحداثيات صالحة');
    GV.closeSheets();
    await GV.addGroups([{ name: 'نقط من جدول الكاد', type: 'CSV', layers: [{ name: 'نقط الجدول', features: feats, crs: t.crs }] }]);
  }
  // find every drawn table in the CAD automatically (clusters of text in rows/columns with numbers)
  function findTables() {
    const found = [];
    cadSources().filter(s => !s.orgOut).forEach(s => {
      const l0 = s.layers.find(l => l.crsDef); const crs = l0 ? l0.crsDef : null;
      const T = [], V = [];
      s.layers.forEach(l => { if (/(PRF|PROFILE|BAND|SECTION)/i.test(l.name)) return; l.features.forEach(f => { const g = f.geometry; if (!g) return; const p = f.properties || {}; if (p.Text != null && String(p.Text).trim() !== '') T.push({ x: g.coordinates[0], y: g.coordinates[1], t: String(p.Text).trim(), h: +p.Height || 0, layer: l.name, al: p.Align, va: p.VAlign }); else if (g.type === 'LineString' && g.coordinates.length === 2) { const [a, b] = g.coordinates; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) > 0) V.push({ x: a[0], y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) }); } }); });
      if (T.length < 6) return;
      const h = median(T.map(t => t.h).filter(Boolean)) || 1; const gx = h * 6, gy = h * 3.2;
      T.forEach(t => { const w = Math.max(t.t.length * (t.h || h) * 0.8, h); if (t.al === 'c') { t.x0 = t.x - w / 2; t.x1 = t.x + w / 2; } else if (t.al === 'r') { t.x0 = t.x - w; t.x1 = t.x; } else { t.x0 = t.x; t.x1 = t.x + w; } });
      const par = T.map((_, i) => i); const fd = i => par[i] === i ? i : (par[i] = fd(par[i]));
      const cell = Math.max(gx, gy); const G = new Map(); T.forEach((t, i) => { const k = Math.floor(t.x / cell) + ',' + Math.floor(t.y / cell); if (!G.has(k)) G.set(k, []); G.get(k).push(i); });
      T.forEach((t, i) => { const ci = Math.floor(t.x / cell), cj = Math.floor(t.y / cell); for (let a = ci - 2; a <= ci + 2; a++) for (let b = cj - 1; b <= cj + 1; b++) (G.get(a + ',' + b) || []).forEach(j => { if (j <= i) return; const u = T[j]; const dx = Math.max(0, Math.max(t.x0, u.x0) - Math.min(t.x1, u.x1)); const dy = Math.abs(t.y - u.y); if (dx <= gx && dy <= gy) par[fd(i)] = fd(j); }); });
      const cl = new Map(); T.forEach((t, i) => { const r = fd(i); if (!cl.has(r)) cl.set(r, []); cl.get(r).push(t); });
      // join pieces of the same table split by empty rows/section titles: same columns (x overlap) and a small vertical gap
      let parts = Array.from(cl.values()).map(ts => ({ ts, b: [Math.min(...ts.map(t => t.x)), Math.min(...ts.map(t => t.y)), Math.max(...ts.map(t => t.x1)), Math.max(...ts.map(t => t.y))] }));
      for (let again = true; again;) { again = false;
        outer: for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { const a = parts[i].b, c = parts[j].b; const ov = Math.min(a[2], c[2]) - Math.max(a[0], c[0]); const wmin = Math.min(a[2] - a[0], c[2] - c[0]); const gap = Math.max(a[1], c[1]) - Math.min(a[3], c[3]);
          const vov = Math.min(a[3], c[3]) - Math.max(a[1], c[1]), hmin = Math.min(a[3] - a[1], c[3] - c[1]), hgap = Math.max(a[0], c[0]) - Math.min(a[2], c[2]);
          if ((ov > 0.6 * wmin && wmin > h * 10 && gap <= h * 9) || (hmin > h * 4 && vov > 0.8 * hmin && hgap <= gx * 2.5)) { parts[i] = { ts: parts[i].ts.concat(parts[j].ts), b: [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])] }; parts.splice(j, 1); again = true; break outer; } } }
      // small leftovers (e.g. a lone "Point #" column after a gap) that sit inside a big table's area belong to it
      const big = parts.filter(p => p.ts.length >= 9), small = parts.filter(p => p.ts.length < 9);
      small.forEach(sp => { const t = big.find(bp => sp.b[0] >= bp.b[0] - h * 2 && sp.b[2] <= bp.b[2] + h * 2 && sp.b[1] >= bp.b[1] - h * 9 && sp.b[3] <= bp.b[3] + h * 9); if (t) { t.ts = t.ts.concat(sp.ts); t.b = [Math.min(t.b[0], sp.b[0]), Math.min(t.b[1], sp.b[1]), Math.max(t.b[2], sp.b[2]), Math.max(t.b[3], sp.b[3])]; } });
      big.forEach(({ ts }) => {
        const bb = [Math.min(...ts.map(t => t.x)), Math.min(...ts.map(t => t.y)), Math.max(...ts.map(t => t.x1)), Math.max(...ts.map(t => t.y + (t.h || h)))];
        const vl = V.filter(v => v.x >= bb[0] - h && v.x <= bb[2] + h && v.y1 >= bb[1] - h && v.y0 <= bb[3] + h).map(v => v.x);
        let t2; try { t2 = gridTable(ts, vl); } catch (e) { return; }
        if (t2.rows.length < 2 || t2.head.length < 2) return;
        const numCols = t2.head.filter((_, ci) => { const vals = t2.rows.map(r => r[ci]).filter(v => v !== '' && v != null); return vals.length >= 2 && vals.filter(v => num(v) != null).length / vals.length > 0.7; }).length;
        if (numCols < 2) return;
        const prev = table; table = Object.assign(t2, { crs, mode: 'grid' }); guessRoles(); sortById(t2); table = prev;
        const hasXY = t2.roles.includes('e') && t2.roles.includes('n');
        if (!hasXY && t2.head.filter(h => /^عمود \d+$/.test(h)).length >= t2.head.length * 0.5) { table = prev; return; }
        const bbw = [[bb[0] - h, bb[1] - h], [bb[2] + h, bb[3] + h]];
        found.push({ table: t2, src: s, bbox: bb, hasXY, hasZ: t2.roles.includes('z'), score: (hasXY ? 100 : 0) + t2.rows.length, bbw });
      });
    });
    return found.sort((a, b) => b.score - a.score);
  }
  function showTable(t) { table = t; render(); }
  GV.ctPrep = (t, crs) => { const prev = table; table = Object.assign(t, { crs: crs || null, mode: t.mode || 'grid' }); guessRoles(); sortById(t); table = prev; return t; };
  function tableToFeats(t) { const ei = t.roles.indexOf('e'), ni = t.roles.indexOf('n'), zi = t.roles.indexOf('z'); if (ei < 0 || ni < 0) return []; return t.rows.map(r => { const x = num(r[ei]), y = num(r[ni]); if (x == null || y == null) return null; const z = zi >= 0 ? num(r[zi]) : null; const p = {}; t.head.forEach((h, i) => { if (t.roles[i] !== 'skip') p[h || ('c' + i)] = num(r[i]) != null && String(r[i]).length < 16 ? num(r[i]) : r[i]; }); return { type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: z != null ? [x, y, z] : [x, y] } }; }).filter(Boolean); }
  GV.ctAllPoints = () => { clearSel(); extract('points'); };
  GV.ctFindTables = findTables; GV.ctGrid = (texts, vl) => gridTable(texts, vl || []); GV.ctNum = num; GV.ctShow = showTable; GV.ctToFeats = tableToFeats;
  GV.ctRows = t => [t.head.filter((_, i) => t.roles[i] !== 'skip')].concat(t.rows.map(r => r.filter((_, i) => t.roles[i] !== 'skip').map(v => { const n = num(v); return n != null && String(v).length < 16 ? n : v; })));
  $('#btnCT').addEventListener('click', open);
  GV.openCadTable = open;
})();
