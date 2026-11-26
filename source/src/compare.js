/* CAD ↔ GIS match: every network point and line in the database must sit on its CAD twin (shift ≤ tolerance, default 5 cm),
   nothing may exist in one and not the other. Plus a Swipe slider to eyeball the two drawings against each other. */
(function () {
  const GV = window.GV; const { $, el, map } = GV;
  const sheet = el('div', 'sheet panel right'); sheet.id = 'cmpSheet';
  sheet.innerHTML = '<div class="grab"></div><div class="sh-head"><h2>⇄ مطابقة الكاد والـ GIS</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="cmpBody"></div>';
  document.body.appendChild(sheet);
  sheet.querySelector('[data-close]').addEventListener('click', () => { sheet.classList.remove('open'); swipeOff(); });

  const gisSources = () => GV.sources.filter(s => !s.isCad && !s.orgOut && s.id !== 'qc' && s.layers.some(l => l.features.length && l.leaf));
  const cadSources = () => GV.sources.filter(s => (s.isCad || s.orgOut) && !(s.orgOut && /\|bg$/.test(s.orgOut)) && s.layers.some(l => l.features.length && l.leaf));
  const isBgLayer = n => /^(X-|V-|G-|0$|defpoints$)/i.test(n) || /\$0\$|^xr[._ -]|\|/i.test(n);

  function open() {
    const box = $('#cmpBody'); box.textContent = '';
    const G = gisSources(), C = cadSources();
    if (!G.length || !C.length) { box.appendChild(el('p', 'muted', 'افتح الداتا بيز (GDB/SHP) وملف الكاد (DWG/DXF) الاتنين، وبعدين ارجع هنا.')); GV.openSheet('#cmpSheet'); return; }
    box.appendChild(el('p', 'muted small', 'بيقارن كل نقطة وكل خط في الداتا بيز بمثيله في الكاد: لازم يكونوا في نفس المكان (الإزاحة أقصاها المسموح)، ومفيش حاجة موجودة في واحد ومش في التاني.'));
    const mk = (lab, arr, key) => { const f = el('label', 'fld'); f.appendChild(el('span', null, lab)); const s = el('select'); arr.forEach((x, i) => { const o = el('option', null, x.name); o.value = i; s.appendChild(o); }); const sv = GV.store.get(key); const k = arr.findIndex(x => x.name === sv); if (k >= 0) s.value = k; f.appendChild(s); box.appendChild(f); return s; };
    const sg = mk('الداتا بيز (GIS)', G, 'gv_cmp_g'); const sc = mk('الكاد', C, 'gv_cmp_c');
    const r = el('div', 'row2'); const tl = el('label', 'fld'); tl.appendChild(el('span', null, 'الإزاحة المسموحة (سم)')); const tol = el('input'); tol.type = 'number'; tol.step = '0.5'; tol.value = GV.store.get('gv_cmp_tol') || '5'; tl.appendChild(tol);
    const ml = el('label', 'fld'); ml.appendChild(el('span', null, 'أبعد من كده = مش موجود في التاني (م)')); const miss = el('input'); miss.type = 'number'; miss.step = '0.1'; miss.value = GV.store.get('gv_cmp_miss') || '0.5'; ml.appendChild(miss); r.append(tl, ml); box.appendChild(r);
    const acts = el('div', 'fc-acts'); const go = el('button', 'open-btn', '⇄ قارن'); const sw = el('button', 'chip', '◧ Swipe'); acts.append(go, sw); box.appendChild(acts);
    const out = el('div'); box.appendChild(out);
    go.onclick = () => { const g = G[+sg.value], c = C[+sc.value]; GV.store.set('gv_cmp_g', g.name); GV.store.set('gv_cmp_c', c.name); GV.store.set('gv_cmp_tol', tol.value); GV.store.set('gv_cmp_miss', miss.value); out.textContent = ''; out.appendChild(el('p', 'muted', 'بقارن…')); setTimeout(() => { try { run(g, c, (+tol.value || 5) / 100, +miss.value || 0.5, out); } catch (e) { console.error(e); out.textContent = 'حصل خطأ: ' + e.message; } }, 30); };
    sw.onclick = () => { if (swipe) swipeOff(); else swipeOn(C[+sc.value]); sw.classList.toggle('on', !!swipe); };
    GV.openSheet('#cmpSheet');
  }

  // ---- geometry in local metres (from the WGS display coords; accurate to mm over a zone) ----
  function run(gsrc, csrc, tol, miss, out) {
    const lat0 = (map.getCenter().lat) * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
    const M = c => [c[0] * kx, c[1] * ky];
    const parts = g => { if (!g) return []; const t = g.type, c = g.coordinates; if (t === 'Point') return [{ t: 'P', c: [c] }]; if (t === 'MultiPoint') return c.map(x => ({ t: 'P', c: [x] })); if (t === 'LineString') return [{ t: 'L', c }]; if (t === 'MultiLineString') return c.map(x => ({ t: 'L', c: x })); if (t === 'Polygon') return c.map(x => ({ t: 'L', c: x })); if (t === 'MultiPolygon') return c.flatMap(p => p.map(x => ({ t: 'L', c: x }))); return []; };
    // CAD objects are often drawn, not inserted: a manhole as a circle, a valve as an exploded block, a chamber as a closed polyline.
    // Those small shapes count as ONE object at their centre (compared with the GIS point), never as loose CAD lines.
    const bbC = cs => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; cs.forEach(c => { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }); return { c: [(x0 + x1) / 2, (y0 + y1) / 2], r: Math.hypot(x1 - x0, y1 - y0) / 2 }; };
    const collect = (src, cad) => { const P = [], S = [], Lns = []; src.layers.forEach(l => { if (!l.features.length || (cad && isBgLayer(l.name))) return; let ins = null, symPts = [];
      const flushSym = () => { if (ins && symPts.length) { const b = bbC(symPts); if (b.r > 0.01 && b.r < 4) P.push({ l, fi: ins.fi, c: b.c, shape: 'رمز' }); } symPts = []; };
      l.features.forEach((f, fi) => { if (!f.wgs) return; if (cad && f.properties && f.properties.Text != null) return;
        if (f._sym) { if (cad && ins) parts(f.wgs.geometry).forEach(p => p.c.forEach(c => symPts.push(M(c)))); return; }
        if (cad) { flushSym(); ins = null; }
        parts(f.wgs.geometry).forEach(p => { const c = p.c.map(M); if (p.t === 'P') { P.push({ l, fi, c: c[0] }); if (cad && f.properties && f.properties.Block) ins = { fi }; return; }
          if (cad && c.length > 1) { const b = bbC(c); const pr = f.properties || {}; const closed = Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 0.01; if (b.r < 4 && (closed || pr.Radius != null || /CIRCLE|ARC|ELLIPSE/.test(pr.Entity || ''))) { P.push({ l, fi, c: b.c, shape: pr.Radius != null || /CIRCLE/.test(pr.Entity || '') ? 'دايرة' : 'شكل مقفول' }); return; } }
          const li = Lns.length; Lns.push({ l, fi, c }); for (let k = 1; k < c.length; k++) S.push({ li, a: c[k - 1], b: c[k] }); }); });
      if (cad) flushSym(); }); return { P, S, Lns }; };
    const g = collect(gsrc, false), c = collect(csrc, true);
    const cell = Math.max(2, miss * 2); const grid = () => { const m = new Map(); return { add(x0, y0, x1, y1, v) { for (let i = Math.floor(Math.min(x0, x1) / cell); i <= Math.floor(Math.max(x0, x1) / cell); i++) for (let j = Math.floor(Math.min(y0, y1) / cell); j <= Math.floor(Math.max(y0, y1) / cell); j++) { const k = i + ',' + j; if (!m.has(k)) m.set(k, []); m.get(k).push(v); } }, near(x, y, r) { const o = new Set(); for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) (m.get(i + ',' + j) || []).forEach(v => o.add(v)); return o; } }; };
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    const cP = grid(); c.P.forEach((p, i) => cP.add(p.c[0], p.c[1], p.c[0], p.c[1], i)); const cS = grid(); c.S.forEach((s, i) => cS.add(s.a[0], s.a[1], s.b[0], s.b[1], i));
    const gP = grid(); g.P.forEach((p, i) => gP.add(p.c[0], p.c[1], p.c[0], p.c[1], i)); const gS = grid(); g.S.forEach((s, i) => gS.add(s.a[0], s.a[1], s.b[0], s.b[1], i));
    const nearPt = (G2, arr, q, r) => { let b = null; G2.near(q[0], q[1], r).forEach(i => { const d = Math.hypot(arr[i].c[0] - q[0], arr[i].c[1] - q[1]); if (d <= r && (!b || d < b.d)) b = { d, i }; }); return b; };
    const nearSeg = (G2, arr, q, r) => { let b = null; G2.near(q[0], q[1], r).forEach(i => { const d = segD(q, arr[i].a, arr[i].b); if (d <= r && (!b || d < b.d)) b = { d, i }; }); return b; };
    const iss = []; const W = m => [m[0] / kx, m[1] / ky];
    const add = (kind, sev, gl, gfi, at, d, txt) => iss.push({ kind, sev, layer: gl ? gl.name : '', fi: gfi, at: W(at), d, txt, lref: gl });
    // points: GIS point ↔ CAD point (block insertion) or CAD vertex/line
    g.P.forEach(p => { const b = nearPt(cP, c.P, p.c, miss); const s = b && b.d <= tol ? b : nearSeg(cS, c.S, p.c, miss); const best = [b, s].filter(Boolean).sort((x, y) => x.d - y.d)[0];
      if (!best) add('gis_only', 'err', p.l, p.fi, p.c, null, 'نقطة في الـ GIS ملهاش مقابل في الكاد (أقرب حاجة أبعد من ' + miss + ' م)');
      else if (best.d > tol) add('shift', best.d > tol * 4 ? 'err' : 'warn', p.l, p.fi, p.c, best.d, 'نقطة متزحزحة عن الكاد ' + (best.d * 100).toFixed(1) + ' سم' + (b && c.P[b.i] && c.P[b.i].shape && b === best ? ' (عن مركز ال' + c.P[b.i].shape + ' المرسوم في الكاد)' : '')); });
    // lines: every GIS vertex must lie on a CAD line; whole line missing if most of it has no CAD twin
    g.Lns.forEach(ln => { let worst = 0, wAt = null, far = 0; ln.c.forEach(q => { const b = nearSeg(cS, c.S, q, miss); if (!b) { far++; if (!wAt) wAt = q; } else if (b.d > worst) { worst = b.d; wAt = wAt && far ? wAt : q; } });
      if (far >= Math.max(1, ln.c.length * 0.6)) add('gis_only', 'err', ln.l, ln.fi, ln.c[0], null, 'خط في الـ GIS ملوش مقابل في الكاد');
      else if (far) add('shift', 'err', ln.l, ln.fi, wAt, null, far + ' رأس من الخط بعيد عن الكاد أكتر من ' + miss + ' م');
      else if (worst > tol) add('shift', worst > tol * 4 ? 'err' : 'warn', ln.l, ln.fi, wAt, worst, 'الخط متزحزح عن الكاد ' + (worst * 100).toFixed(1) + ' سم (أقصى إزاحة)'); });
    // the other way: CAD network items with nothing in GIS
    let cadOnlyP = 0, cadOnlyL = 0; const cadIss = [];
    const seenObj = new Set(); c.P.forEach(p => { if (nearPt(gP, g.P, p.c, miss) || nearSeg(gS, g.S, p.c, tol)) seenObj.add(p.l.name + '#' + p.fi); });
    const doneObj = new Set(); c.P.forEach(p => { const key = p.l.name + '#' + p.fi; if (seenObj.has(key) || doneObj.has(key)) return; doneObj.add(key); if (true) { cadOnlyP++; if (cadIss.length < 3000) cadIss.push({ kind: 'cad_only', sev: 'warn', layer: p.l.name, fi: p.fi, at: W(p.c), txt: (p.shape ? p.shape + ' في الكاد' : 'رمز في الكاد') + ' (' + ((p.l.features[p.fi].properties || {}).Block || p.l.name) + ') ملوش نقطة في الـ GIS', lref: p.l }); } });
    c.Lns.forEach(ln => { if (ln.c.length < 2) return; const mid = ln.c[Math.floor(ln.c.length / 2)]; const a = ln.c[0], b2 = ln.c[ln.c.length - 1]; const L0 = Math.hypot(b2[0] - a[0], b2[1] - a[1]); if (L0 < 0.3) return; const probe = [[(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2], mid]; if (probe.every(q => !nearSeg(gS, g.S, q, miss))) { cadOnlyL++; if (cadIss.length < 3000) cadIss.push({ kind: 'cad_only', sev: 'warn', layer: ln.l.name, fi: ln.fi, at: W(probe[0]), txt: 'خط في الكاد (' + ln.l.name + ') ملوش مقابل في الـ GIS', lref: ln.l }); } });
    const all = iss.concat(cadIss);
    show(all, { gP: g.P.length, gL: g.Lns.length, cP: c.P.length, cL: c.Lns.length, cadOnlyP, cadOnlyL, tol }, out, gsrc, csrc);
  }

  function show(all, st, out, gsrc, csrc) {
    out.textContent = '';
    const shift = all.filter(i => i.kind === 'shift'), go = all.filter(i => i.kind === 'gis_only'), co = all.filter(i => i.kind === 'cad_only');
    const k = el('div', 'kpis'); [[shift.length, 'إزاحة أكبر من ' + (st.tol * 100) + ' سم', '#f08c00'], [go.length, 'في الـ GIS بس', '#e03131'], [co.length, 'في الكاد بس', '#1c7ed6']].forEach(([v, t, cc]) => { const d = el('div', 'kpi'); d.style.setProperty('--kc', cc); d.append(el('b', null, v.toLocaleString('en')), el('span', null, t)); k.appendChild(d); }); out.appendChild(k);
    out.appendChild(el('p', 'muted small', 'اتقارن ' + st.gP + ' نقطة و ' + st.gL + ' خط من الـ GIS مع ' + st.cP + ' رمز و ' + st.cL + ' خط من شبكة الكاد.' + (shift.length + go.length + co.length ? '' : ' ✓ متطابقين.')));
    if (shift.length) { const mx = Math.max(...shift.filter(i => i.d != null).map(i => i.d), 0); out.appendChild(el('p', 'small', 'أكبر إزاحة: ' + (mx * 100).toFixed(1) + ' سم')); }
    // results as a layer with attributes (open its table, zoom, filter)
    const feats = all.map((i, n) => ({ type: 'Feature', properties: { ID: n + 1, 'النوع': i.kind === 'shift' ? 'إزاحة' : i.kind === 'gis_only' ? 'في الـ GIS بس' : 'في الكاد بس', 'الخطورة': i.sev === 'err' ? 'خطأ' : 'تحذير', 'الطبقة': i.layer, 'العنصر': i.fi != null ? i.fi + 1 : '', 'الإزاحة_سم': i.d != null ? +(i.d * 100).toFixed(1) : '', 'التفاصيل': i.txt, 'الحالة': 'جديد' }, geometry: { type: 'Point', coordinates: i.at } }));
    const old = GV.sources.find(s => s.id === 'cmp'); if (old) GV.removeSource(old);
    if (feats.length) GV.addGroups([{ name: 'فروق الكاد والـ GIS', type: 'QC', layers: [{ name: 'فروق الكاد والـ GIS', features: feats, crs: '4326', color: '#f08c00' }] }], { quiet: true }).then(added => { const s = added[0]; if (!s) return; s.id = 'cmp'; GV.cmpLayer = s.layers[0]; GV.renderLayers(); });
    const grp = [['إزاحة', shift], ['في الـ GIS بس', go], ['في الكاد بس', co]];
    grp.forEach(([t, arr]) => { if (!arr.length) return; const byL = new Map(); arr.forEach(i => { if (!byL.has(i.layer)) byL.set(i.layer, []); byL.get(i.layer).push(i); });
      const sec = el('div', 'step'); sec.appendChild(el('b', null, t + ' (' + arr.length + ')'));
      byL.forEach((items, ln) => { items.sort((a, b) => (b.d || 0) - (a.d || 0)); const r = el('div', 'prob'); const h = el('button', 'qc-type'); const dt = el('span', 'qc-dot'); dt.style.background = t === 'إزاحة' ? '#f08c00' : t === 'في الـ GIS بس' ? '#e03131' : '#1c7ed6'; h.append(dt, el('span', 'qc-t', ln), el('small', 'muted', ''), el('b', null, String(items.length))); r.appendChild(h); let n = 0;
        const a = el('div', 'fc-acts'); const g2 = el('button', 'chip', 'روح للمكان (واحد ورا التاني)'); g2.onclick = () => { const it = items[n++ % items.length]; map.setView([it.at[1], it.at[0]], 21); GV.markSel && GV.markSel(it.at[1], it.at[0]); if (it.lref && it.fi != null && it.kind !== 'cad_only') GV.showFeature(it.lref, it.fi); GV.toast(n + ' من ' + items.length + ' · ' + it.txt, 5000); };
        const tb = el('button', 'chip', 'الجدول'); tb.onclick = () => { if (GV.cmpLayer) { GV.openTable(GV.cmpLayer); setTimeout(() => { const s2 = $('#tblSearch'); s2.value = ln; s2.dispatchEvent(new Event('input')); }, 60); } };
        a.append(g2, tb); r.appendChild(a); sec.appendChild(r); });
      out.appendChild(sec); });
    if (shift.length && GV.openFix) out.appendChild(el('p', 'muted small', 'الإزاحة الصغيرة (أقل من المسافة اللي فوق) بتتصلح بأداة التحرير ✏️ (تحريك بالسناب على الكاد) أو بإعادة التحويل من الكاد. الحاجات اللي في واحد بس محتاجة قرارك: تتضاف ولا تتشال.'));
  }

  // ---- swipe: the CAD drawing shows only left of the handle, GIS everywhere ----
  let swipe = null;
  function swipeOn(csrc) {
    if (!map.getPane('swipe')) { const p = map.createPane('swipe'); p.style.zIndex = 450; }
    const rend = L.canvas({ pane: 'swipe', padding: 0.5, tolerance: 8 });
    const ls = csrc.layers.filter(l => l.leaf); ls.forEach(l => { l._renderer = rend; GV.rebuild(l); });
    const h = el('div', 'swipe-h'); h.innerHTML = '<span>⇆ الكاد | الـ GIS</span>'; map.getContainer().appendChild(h);
    const pane = map.getPane('swipe'); let x = map.getSize().x / 2;
    const clip = () => { const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(map.getSize()); const cx = map.containerPointToLayerPoint([x, 0]).x; pane.style.clip = 'rect(' + nw.y + 'px,' + cx + 'px,' + se.y + 'px,' + nw.x + 'px)'; h.style.left = x + 'px'; };
    h.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId); map.dragging.disable(); const mv = ev => { const r = map.getContainer().getBoundingClientRect(); x = Math.max(10, Math.min(r.width - 10, ev.clientX - r.left)); clip(); }; const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); map.dragging.enable(); }; h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); });
    map.on('move zoom resize', clip); clip(); swipe = { ls, h, clip }; GV.toast('اسحب الخط عشان تقارن الكاد بالـ GIS');
  }
  function swipeOff() { if (!swipe) return; swipe.ls.forEach(l => { delete l._renderer; GV.rebuild(l); }); swipe.h.remove(); map.off('move zoom resize', swipe.clip); const p = map.getPane('swipe'); if (p) p.style.clip = ''; swipe = null; }

  GV.openCompare = open;
  // entry points: the tools sheet + the layer list
  const tools = document.querySelector('#toolsSheet .sh-body') || document.querySelector('#toolsSheet');
  if (tools) { const b = el('button', 'tool'); b.innerHTML = '<span>⇄</span><b>مطابقة الكاد والـ GIS</b><small>إزاحة أكبر من 5 سم · موجود في واحد بس · Swipe</small>'; b.onclick = open; const grid = tools.querySelector('.tools') || tools; grid.appendChild(b); }
})();
