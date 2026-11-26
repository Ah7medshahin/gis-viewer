/* 📥 Fill your database from another layer or a service: for every feature of the target layer, take a field from the
   source layer by location — the polygon it falls in (district, zone, parcel…) or the nearest feature within a distance
   (street name, survey point level, an asset id…). Empty values only by default; work copy; a sample to check. */
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const srcOf = l => GV.sources.find(s => s.layers.indexOf(l) >= 0);
  const layers = () => GV.sources.filter(s => s.id !== 'qc' && s.id !== 'field' && !(GV.superseded && GV.superseded(s))).flatMap(s => s.layers.map(l => ({ s, l }))).filter(x => x.l.features && x.l.features.length);
  const dM = (a, b) => { const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180) * 111320; return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540); };
  const anchor = g => { if (!g) return null; if (g.type === 'Point') return g.coordinates; const c = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates[0] : g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.type === 'MultiPoint' ? g.coordinates : null; if (!c || !c.length) return null; if (/Line/.test(g.type)) { return c[Math.floor(c.length / 2)]; } let x = 0, y = 0; c.forEach(p => { x += p[0]; y += p[1]; }); return [x / c.length, y / c.length]; };
  const inRing = (p, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if (((r[i][1] > p[1]) !== (r[j][1] > p[1])) && (p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0])) ins = !ins; } return ins; };
  const inPoly = (p, g) => { const P = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return P.some(rings => inRing(p, rings[0]) && !rings.slice(1).some(h => inRing(p, h))); };
  const segD = (p, a, b) => { const k = Math.cos(p[1] * Math.PI / 180); const vx = (b[0] - a[0]) * k, vy = b[1] - a[1], wx = (p[0] - a[0]) * k, wy = p[1] - a[1]; const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / ((vx * vx + vy * vy) || 1))); return Math.hypot(wx - t * vx, wy - t * vy) * 110540; };
  const distTo = (p, g) => { if (g.type === 'Point') return dM(p, g.coordinates); const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? [].concat(...g.coordinates) : g.type === 'MultiPoint' ? g.coordinates.map(c => [c, c]) : []; if (/Polygon/.test(g.type) && inPoly(p, g)) return 0; let d = Infinity; parts.forEach(c => { for (let i = 1; i < c.length; i++) d = Math.min(d, segD(p, c[i - 1], c[i])); }); return d; };
  async function run(cfg) {
    let tl = cfg.t; const s = srcOf(tl); if (s && !s.isCopy && GV.workCopy) { await GV.workCopy(s); tl = GV.liveLayer(tl); }
    const S = cfg.s.features.filter(f => f.wgs && f.wgs.geometry).map(f => ({ f, g: f.wgs.geometry, bb: bbox(f.wgs.geometry) }));
    const items = [], log = []; let n = 0, miss = 0;
    tl.features.forEach(f => { const g = f.wgs && f.wgs.geometry; const p0 = anchor(g); if (!p0) return; const p = f.properties || (f.properties = {}); const cur = p[cfg.tf];
      if (!cfg.overwrite && cur != null && cur !== '' && cur !== 0) return;
      let best = null;
      if (cfg.how === 'in') best = S.find(x => inBB(p0, x.bb, 0) && inPoly(p0, x.g));
      else { let bd = cfg.dist; const pad = cfg.dist / 100000; S.forEach(x => { if (!inBB(p0, x.bb, pad)) return; const d = distTo(p0, x.g); if (d <= bd) { bd = d; best = x; } }); }
      if (!best) { miss++; return; } const v = (best.f.properties || {})[cfg.sf]; if (v == null || v === '') { miss++; return; }
      const before = Object.assign({}, p); p[cfg.tf] = typeof cur === 'number' && isFinite(+v) ? +v : v; n++; items.push({ l: tl, f, before, ll: p0 }); log.push({ f, before }); });
    GV.renderLayers(); if (GV.onDirty) GV.onDirty();
    GV.toast('📥 اتملى ' + cfg.tf + ' في ' + n.toLocaleString('en') + ' عنصر' + (miss ? ' · ' + miss + ' مالقاش قيمة' : ''), 6000);
    if (GV.editSample) GV.editSample('بيانات من ' + cfg.s.name + ' ← ' + tl.name, items, () => { log.forEach(x => { x.f.properties = x.before; }); GV.renderLayers(); GV.toast('رجّعت القيم زي ما كانت'); });
  }
  const bbox = g => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; const w = x => { if (typeof x[0] === 'number') { if (x[0] < a) a = x[0]; if (x[0] > c) c = x[0]; if (x[1] < b) b = x[1]; if (x[1] > d) d = x[1]; } else x.forEach(w); }; w(g.coordinates); return [a, b, c, d]; };
  const inBB = (p, bb, pad) => p[0] >= bb[0] - pad && p[0] <= bb[2] + pad && p[1] >= bb[1] - pad && p[1] <= bb[3] + pad;

  const sh = el('div', 'sheet panel right'); sh.id = 'joinSheet';
  sh.innerHTML = '<div class="grab"></div><div class="sh-head"><h2>📥 بيانات من طبقة أو سيرفيس</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="joinBody"></div>';
  document.body.appendChild(sh); sh.querySelector('[data-close]').onclick = () => sh.classList.remove('open');
  function open(preSrc) {
    const b = $('#joinBody'); b.innerHTML = ''; const L0 = layers(); if (L0.length < 2) { b.appendChild(el('p', 'muted', 'محتاج طبقتين على الأقل: طبقتك، والطبقة/السيرفيس اللي هتاخد منه.')); GV.openSheet('#joinSheet'); return; }
    const sel = (list, lab) => { const s = el('select'); list.forEach((x, i) => { const o = el('option', '', lab(x)); o.value = i; s.appendChild(o); }); return s; };
    const fsel = (l, def) => { const s = el('select'); GV.fieldsOf(l).forEach(k => { const o = el('option', '', k); o.value = k; s.appendChild(o); }); if (def) s.value = def; return s; };
    const s1 = el('div', 'step'); s1.appendChild(el('b', '', '1 · هتاخد البيانات منين (طبقة أو سيرفيس)'));
    const ss = sel(L0, x => (x.s.type === 'ArcGIS Service' ? '🌐 ' : '') + x.l.name + ' — ' + x.s.name); if (preSrc) { const i = L0.findIndex(x => x.l === preSrc); if (i >= 0) ss.value = i; } else { const i = L0.findIndex(x => x.s.type === 'ArcGIS Service'); if (i >= 0) ss.value = i; }
    const sfw = el('div'); s1.append(ss, sfw); b.appendChild(s1);
    const s2 = el('div', 'step'); s2.appendChild(el('b', '', '2 · هتحطها في أنهي طبقة وأنهي حقل'));
    const ts = sel(L0, x => x.l.name + ' — ' + x.s.name); const tfw = el('div'); s2.append(ts, tfw); b.appendChild(s2);
    const s3 = el('div', 'step'); s3.appendChild(el('b', '', '3 · الربط بالمكان'));
    const hw = el('select'); [['in', 'جوه المضلع (حي، منطقة، قطعة أرض…)'], ['near', 'أقرب عنصر في حدود مسافة']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; hw.appendChild(o); });
    const ds = el('input'); ds.type = 'number'; ds.value = 5; ds.style.width = '80px'; const dl = el('span', 'small', ' أقصى مسافة (م): ');
    const ow = el('label', 'ck'); const oc = el('input'); oc.type = 'checkbox'; ow.append(oc, el('span', '', 'اكتب على القيم الموجودة كمان (الافتراضي: الفاضي بس)'));
    const go = el('button', 'open-btn', '📥 املا البيانات');
    s3.append(hw, dl, ds, ow, go); b.appendChild(s3);
    let sf, tf; const upd = () => { const S = L0[+ss.value].l, T = L0[+ts.value].l; sfw.innerHTML = ''; tfw.innerHTML = ''; sf = fsel(S); tf = fsel(T); const same = GV.fieldsOf(T).find(k => GV.fieldsOf(S).some(x => x.toLowerCase() === k.toLowerCase() && !/^(objectid|fid|globalid|shape.*)$/i.test(k))); if (same) { tf.value = same; sf.value = GV.fieldsOf(S).find(x => x.toLowerCase() === same.toLowerCase()); }
      sfw.append(el('span', 'small', 'الحقل: '), sf); tfw.append(el('span', 'small', 'الحقل: '), tf); const poly = S.kind === 'polygon'; hw.value = poly ? 'in' : 'near'; dl.style.display = ds.style.display = poly ? 'none' : ''; };
    ss.onchange = upd; ts.onchange = () => { if (ts.value === ss.value) GV.toast('اختار طبقة غير اللي بتاخد منها'); upd(); }; hw.onchange = () => { dl.style.display = ds.style.display = hw.value === 'in' ? 'none' : ''; };
    if (ts.value === ss.value) ts.value = L0.findIndex((x, i) => i !== +ss.value); upd();
    go.onclick = () => { if (ss.value === ts.value) return GV.toast('اختار طبقتين مختلفتين'); run({ s: L0[+ss.value].l, t: L0[+ts.value].l, sf: sf.value, tf: tf.value, how: hw.value, dist: +ds.value || 5, overwrite: oc.checked }); };
    b.appendChild(el('p', 'muted small', 'التعديل على نسخة شغل والأصل مبيتلمسش، وهتظهرلك عينة تراجعها.'));
    GV.openSheet('#joinSheet');
  }
  GV.openJoin = open;
})();
