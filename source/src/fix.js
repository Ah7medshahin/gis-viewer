// Automatic fixes for QC problems (works on copies, then commits; one-step undo + change log)
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const OPTS = [
    ['unit', 'تصحيح السكيل ووحدات الرسمة وتبديل X و Y', true, 'الكاد', null, 'cad'],
    ['far', 'مسح العناصر البعيدة جدًا عن الرسمة', false, 'الكاد', 'غالبًا عناصر متنسية أو عند (0,0). راجعها في فحص الكاد الأول.', 'cad'],
    ['close', 'قفل البوليلاين اللي أولها وآخرها قريبين من بعض', false, 'الكاد', 'للحدود والمباني. سيبه مقفول لو عندك خطوط مفتوحة مقصودة.', 'cad'],
    ['join', 'دمج الخطوط المتقطعة على نفس اللير (من غير تفرع ولا بلوك عند نقطة الالتقاء)', false, 'الكاد', 'مفيد للحدود والطرق. في المواسير التقسيمة ممكن تكون مقصودة عند الفيتنجز.', 'cad'],
    ['vtx', 'تنضيف الرؤوس المكررة والسبايك', true, 'الهندسة'],
    ['zero', 'مسح الخطوط اللي طولها صفر', true, 'الهندسة'],
    ['dup', 'مسح العناصر المتكررة (نفس الشكل بالظبط)', true, 'الهندسة'],
    ['multi', 'فك الـ Multipart لعناصر منفصلة (نفس البيانات)', true, 'الهندسة'],
    ['snapEnd', 'قفل الفجوات: توصيل أطراف الخطوط القريبة (Undershoot/Overshoot)', true, 'الطوبولوجي'],
    ['snapPt', 'لزق النقط القريبة على الخط', true, 'الطوبولوجي'],
    ['vertex', 'إضافة vertex مكان الأجهزة ونقط الاتصال في نص الخط', true, 'Utility Network'],
    ['attr', 'تنضيف القيم: المسافات الزيادة وتوحيد الكتابة', true, 'البيانات'],
    ['splitDev', 'قسم الخطوط عند المحابس/الغرف/الأعمدة وعند تفريعات Tee (زي الداتا المسلّمة)', true, 'الطوبولوجي', 'زي قواعد البيانات المسلّمة: الماسورة بتتقسم عند كل محبس وكل Tee بين رئيسيين، ماسورة الانحدار من غرفة لغرفة، والكابل من عمود لعمود. التوصيلات المنزلية مش بتقسم الماسورة (بيتحط vertex بس).'],
    ['split', 'قسم الخطين عند التقاطعات اللي من غير نود', false, 'الطوبولوجي', 'شغّله بس لو التقاطعات المفروض تبقى متوصلة. لو خطين عدّايين فوق بعض بأعماق مختلفة سيبه مقفول.'],
    ['derive', 'املى الحقول المحسوبة الفاضية: US/DS_MH_ID من الغرف، SLOPE، DEPTH، X/Y وبداية/نهاية الخط', true, 'البيانات', 'بيملى الفاضي بس — أي قيمة مكتوبة مبتتغيرش (لو مختلفة بتطلع في الفحص).', 'gis'],
    ['xy', 'تحديث حقول X و Y من مكان النقطة (حتى لو مكتوبة)', false, 'البيانات', null, 'gis'],
    ['len', 'تحديث حقول الطول (زي ACTUALLENGTH) من الطول الحقيقي', false, 'البيانات', 'مقفول من الأول لأن قيمة الطول المسلّمة ممكن تكون مقصودة. شغّله بس لو عايز تغيّرها.', 'gis'],
    ['z0', 'إضافة Z = 0 للداتا اللي مفيهاش مناسيب (تحضير Utility Network)', false, 'Utility Network', null, 'gis']
  ];
  const NAMES = { derive: 'حقل محسوب اتملى', splitDev: 'خط اتقسم عند جهاز/Tee', unit: 'السكيل اتصحح', far: 'عنصر بعيد اتمسح', close: 'بوليلاين اتقفلت', join: 'خطوط اتدمجت', vtx: 'رؤوس مكررة/سبايك اتشالت', zero: 'خط طوله صفر اتمسح', dup: 'عنصر متكرر اتمسح', multi: 'Multipart اتفك', snapEnd: 'طرف خط اتوصل', snapPt: 'نقطة اتلزقت على الخط', vertex: 'vertex اتضاف', attr: 'قيمة اتنضفت', split: 'خط اتقسم عند تقاطع', xy: 'حقل X/Y اتحدث', len: 'حقل طول اتحدث', z0: 'عنصر اتضافله Z' };
  const opts = {}; OPTS.forEach(o => opts[o[0]] = o[2]);

  let ctx = null;
  const cadSel = src => src.layers.filter(l => l.leaf && l.features.length).map(l => ({ l, role: 'mixed' }));
  function openFix(o) {
    if (o && o.cad) { const src = o.src; if (!src) return; if (!src.layers.some(l => l.leaf)) return GV.showMsg('اختار نظام الإحداثيات للكاد الأول (من ⌖ جنب الطبقة).'); ctx = { cad: true, src, cfg: { sel: cadSel(src), snap: +(GV.store.get('gv_cadsnap') || 0.005), near: +(GV.store.get('gv_cadnear') || 0.5) } }; }
    else { const q = GV.qcLast; if (!q || !q.cfg) return GV.showMsg('اعمل فحص للداتا الأول.'); ctx = { cad: false, cfg: q.cfg }; }
    if (o && o.only) OPTS.forEach(([k]) => { opts[k] = o.only.indexOf(k) >= 0; }); else if (!(o && o.cad)) OPTS.forEach(([k, , d]) => { opts[k] = d; });
    const box = $('#fixBody'); box.textContent = '';
    $('#fixTitle').textContent = ctx.cad ? 'إصلاح الكاد أوتوماتيك' : 'حل المشاكل أوتوماتيك';
    if (ctx.cad) {
      box.appendChild(el('p', 'muted small', 'الملف: ' + ctx.src.name + '. التعديلات على نسخة الكاد اللي مفتوحة هنا، وفي الآخر تنزّلها DXF. الأصل عندك مش بيتغير.'));
      const r = el('div', 'row2');
      const a = el('input'); a.type = 'number'; a.step = '0.001'; a.value = ctx.cfg.snap; a.oninput = () => { ctx.cfg.snap = +a.value || 0.005; GV.store.set('gv_cadsnap', a.value); clearTimeout(a._t); a._t = setTimeout(preview, 300); };
      const b = el('input'); b.type = 'number'; b.step = '0.1'; b.value = ctx.cfg.near; b.oninput = () => { ctx.cfg.near = +b.value || 0.5; GV.store.set('gv_cadnear', b.value); clearTimeout(b._t); b._t = setTimeout(preview, 300); };
      const la = el('label', 'fld'); la.append(el('span', null, 'لازقين لو المسافة أقل من (م)'), a); const lb = el('label', 'fld'); lb.append(el('span', null, 'أقصى مسافة للسنابينج (م)'), b);
      r.append(la, lb); box.appendChild(r);
    } else box.appendChild(el('p', 'muted small', 'التعديلات بتتعمل على الطبقات اللي فحصتها، وتقدر تتراجع عنها بضغطة. المسافات المستخدمة: الاتصال ' + ctx.cfg.snap + ' م، وأقصى مسافة للتوصيل ' + ctx.cfg.near + ' م.'));
    let grp = null;
    OPTS.forEach(([k, t, def, g, note, mode]) => {
      if (mode && mode !== (ctx.cad ? 'cad' : 'gis')) return;
      if (g !== grp) { grp = g; box.appendChild(el('h4', 'fix-g', g)); }
      const lab = el('label', 'ck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = opts[k]; cb.onchange = () => { opts[k] = cb.checked; preview(); };
      const sp = el('span'); sp.appendChild(el('span', null, t)); const c = el('b', 'fix-n'); c.id = 'fixN_' + k; sp.appendChild(c); if (note) sp.appendChild(el('small', 'muted fix-note', note));
      lab.append(cb, sp); box.appendChild(lab);
    });
    const go = el('button', 'open-btn', 'طبّق التعديلات'); go.id = 'fixGo'; go.style.width = '100%'; go.style.justifyContent = 'center'; go.onclick = apply;
    box.appendChild(go);
    if (GV.fixUndo) { const u = el('button', 'chip', '↶ تراجع عن آخر حل تلقائي'); u.onclick = undo; box.appendChild(u); }
    GV.openSheet('#fixSheet', ctx.cad ? null : { back: '#qcResSheet' });
    setTimeout(preview, 30);
  }
  function preview() {
    try { const r = run(true); if (ctx.cad) r.counts.unit = unitFix() ? 1 : 0; OPTS.forEach(([k]) => { const n = r.counts[k] || 0; const e = $('#fixN_' + k); if (e) e.textContent = opts[k] || n ? ' ' + n.toLocaleString('en') : ''; }); const tot = Object.keys(r.counts).filter(k => opts[k] && $('#fixN_' + k)).reduce((a, k) => a + r.counts[k], 0); $('#fixGo').textContent = tot ? 'طبّق ' + tot.toLocaleString('en') + ' تعديل' : 'مفيش حاجة تتصلح بالاختيارات دي'; $('#fixGo').disabled = !tot; }
    catch (e) { console.error(e); }
  }

  const clone = g => g ? JSON.parse(JSON.stringify(g)) : null;
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const isProj = l => { const d = String(l.crsDef || ''); return /^(326|327|204)\d\d$/.test(d) || /^PROJ/i.test(d); };

  function run(dry) {
    const cfg = ctx.cfg; const snap = cfg.snap, near = cfg.near;
    const ign = f => f.orig && (f.orig._sym || (f.orig.properties && f.orig.properties.Text != null));
    const counts = {}, log = [];
    const okRule = (k, w, f) => !!(GV.qcRuleMatch && GV.qcRuleMatch(k, w.l.name, f.properties || {}));
    const W = []; // working layers
    cfg.sel.forEach(({ l, role }) => { const crs = GV.resolveCRS(l.crsDef); if (!crs || !crs.inv) return; W.push({ l, role, crs, feats: l.features.map(f => ({ orig: f, properties: Object.assign({}, f.properties), geometry: clone(f.geometry) })) }); });
    if (!W.length) return { counts, log, W };
    // metric frame
    const all = []; W.forEach(w => w.l.features.forEach(f => { const c = f.wgs && f.wgs.geometry && GV.firstCoord(f.wgs.geometry); if (c) all.push(c); }));
    const lon0 = median(all.map(c => c[0])), lat0 = median(all.map(c => c[1])); const KX = Math.cos(lat0 * Math.PI / 180) * 111320, KY = 110540;
    const toM = (w, c) => { const g = w.crs.fn(c); return [(g[0] - lon0) * KX, (g[1] - lat0) * KY]; };
    const toW = m => [m[0] / KX + lon0, m[1] / KY + lat0];
    const toN = (w, m, z) => { const n = w.crs.inv(toW(m)); return z != null ? [n[0], n[1], z] : [n[0], n[1]]; };
    const note = (op, w, f, m, detail) => { counts[op] = (counts[op] || 0) + 1; if (!dry && opts[op]) log.push({ op, layer: w.l.name, detail: detail || '', ll: m ? toW(m) : null, f }); };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

    /* ---- 1. multipart ---- */
    if (ctx.cad && (opts.far || dry)) { const an = GV.analyzeCad(ctx.src); const fw = an.W.find(x => x.fix && x.fix.hideFar); if (fw) W.forEach(w => { w.feats = w.feats.filter(f => { if (!fw.fix.hideFar.has(f.orig)) return true; counts.far = (counts.far || 0) + 1; if (!dry && opts.far) log.push({ op: 'far', layer: w.l.name, detail: '', ll: null }); return !opts.far; }); }); }
    W.forEach(w => { const out = []; w.feats.forEach(f => { if (ign(f)) { out.push(f); return; } const g = f.geometry; if (g && /^Multi/.test(g.type) && g.coordinates.length > 1) { note('multi', w, f, toM(w, GV.firstCoord(g)), g.coordinates.length + ' أجزاء'); if (opts.multi) { g.coordinates.forEach(c => out.push({ orig: f.orig, properties: Object.assign({}, f.properties), geometry: { type: g.type.replace('Multi', ''), coordinates: c } })); return; } } out.push(f); }); w.feats = out; });
    /* ---- 2. vertices / spikes ---- */
    W.forEach(w => w.feats.forEach(f => {
      const g = f.geometry; if (!g || ign(f)) return;
      const rings = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' || g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
      rings.forEach(r => {
        let changed = 0; const isRing = g.type.indexOf('Polygon') >= 0;
        for (let i = r.length - 1; i > 0; i--) if (dist(toM(w, r[i]), toM(w, r[i - 1])) < 1e-4 && r.length > 2) { if (opts.vtx) r.splice(i, 1); changed++; }
        if (!isRing) for (let i = r.length - 2; i > 0; i--) { const a = toM(w, r[i - 1]), b = toM(w, r[i]), c = toM(w, r[i + 1]); const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]]; const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2); if (n1 > 1e-4 && n2 > 1e-4 && (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2) > 0.9998) { if (opts.vtx) r.splice(i, 1); changed++; } }
        if (changed) note('vtx', w, f, toM(w, r[0]), changed + ' رأس');
      });
    }));
    /* ---- 3. zero length ---- */
    W.forEach(w => { w.feats = w.feats.filter(f => { const g = f.geometry; if (!g || ign(f) || g.type.indexOf('LineString') < 0) return true; const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; let len = 0; ls.forEach(c => { for (let i = 1; i < c.length; i++) len += dist(toM(w, c[i]), toM(w, c[i - 1])); }); if (len < 0.001) { note('zero', w, f, toM(w, GV.firstCoord(g))); return !opts.zero; } return true; }); });
    /* ---- 4. duplicates ---- */
    W.forEach(w => { const seen = new Set(); w.feats = w.feats.filter(f => { if (!f.geometry || ign(f)) return true; let k = JSON.stringify(f.geometry.coordinates, (kk, v) => typeof v === 'number' ? Math.round(v * 1000) : v); if ((f.geometry.type === 'Point' && okRule('close_ok', w, f)) || !ctx.cad) k += '|' + JSON.stringify(Object.keys(f.properties || {}).filter(x => !/^(objectid|fid|globalid|shape_?(length|area|leng)?|oid)$/i.test(x)).sort().map(x => [x, f.properties[x]])); if (seen.has(k)) { note('dup', w, f, toM(w, GV.firstCoord(f.geometry))); return !opts.dup; } seen.add(k); return true; }); });

    /* ---- topology structures ---- */
    const lines = [], pts = [];
    W.forEach(w => w.feats.forEach(f => {
      const g = f.geometry; if (!g) return;
      if (ign(f)) return;
      if ((w.role === 'line' || w.role === 'mixed') && (g.type === 'LineString' || g.type === 'MultiLineString')) (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(c => { if (c.length >= 2) lines.push({ w, f, c, m: c.map(p => toM(w, p)) }); });
      if ((w.role === 'point' || w.role === 'mixed') && g.type === 'Point') pts.push({ w, f, g, m: toM(w, g.coordinates) });
    }));
    const cell = Math.max(near * 2, 2);
    const grid = new Map(); const key = (i, j) => i + ',' + j;
    const gadd = (x0, y0, x1, y1, v) => { for (let i = Math.floor(Math.min(x0, x1) / cell); i <= Math.floor(Math.max(x0, x1) / cell); i++) for (let j = Math.floor(Math.min(y0, y1) / cell); j <= Math.floor(Math.max(y0, y1) / cell); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); } };
    const gnear = (x, y, r) => { const out = new Set(); for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) (grid.get(key(i, j)) || []).forEach(v => out.add(v)); return out; };
    lines.forEach((ln, li) => { for (let i = 1; i < ln.m.length; i++) gadd(ln.m[i - 1][0] - near, ln.m[i - 1][1] - near, ln.m[i][0] + near, ln.m[i][1] + near, { t: 's', li, i }); gadd(ln.m[0][0], ln.m[0][1], ln.m[0][0], ln.m[0][1], { t: 'e', li, k: 0 }); const z = ln.m.length - 1; gadd(ln.m[z][0], ln.m[z][1], ln.m[z][0], ln.m[z][1], { t: 'e', li, k: z }); });
    pts.forEach((p, pi) => gadd(p.m[0], p.m[1], p.m[0], p.m[1], { t: 'p', pi }));
    const segProj = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy; let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const x = [a[0] + t * dx, a[1] + t * dy]; return { d: dist(p, x), t, x }; };
    const inserts = []; // {li, i (seg end idx), t, m}
    const zAt = (ln, i, t) => { const a = ln.c[i - 1], b = ln.c[i]; return a.length > 2 && b.length > 2 ? a[2] + (b[2] - a[2]) * t : (a.length > 2 ? a[2] : null); };
    const setEnd = (ln, k, m) => { const z = ln.c[k].length > 2 ? ln.c[k][2] : null; const n = toN(ln.w, m, z); ln.c[k][0] = n[0]; ln.c[k][1] = n[1]; ln.m[k] = m.slice(); };
    const anchored = new Set();
    if (ctx.cad) lines.forEach((ln, li) => {
      if (ln.m.length < 4) return; const a = ln.m[0], z = ln.m[ln.m.length - 1]; const d = dist(a, z); if (d <= 1e-4 || d > near) return;
      const freeEnd = (k) => { let free = true; gnear(ln.m[k][0], ln.m[k][1], snap).forEach(v => { if (v.t === 'e' && v.li !== li && dist(lines[v.li].m[v.k], ln.m[k]) <= snap) free = false; if (v.t === 's' && v.li !== li) { const r = segProj(ln.m[k], lines[v.li].m[v.i - 1], lines[v.li].m[v.i]); if (r.d <= snap) free = false; } }); return free; };
      if (!freeEnd(0) || !freeEnd(ln.m.length - 1)) return;
      note('close', ln.w, ln.f, a, 'الفجوة ' + (d * 100).toFixed(1) + ' سم');
      if (!opts.close) return; setEnd(ln, ln.m.length - 1, a.slice()); anchored.add(li + ':0'); anchored.add(li + ':' + (ln.m.length - 1));
    });
    /* ---- 5. endpoints ---- */
    lines.forEach((ln, li) => [0, ln.m.length - 1].forEach(k => {
      const E = ln.m[k]; let conn = false; let best = null;
      gnear(E[0], E[1], near).forEach(v => {
        if (v.t === 'e') { if (v.li === li) return; const o = lines[v.li].m[v.k]; const d = dist(E, o); if (d <= snap) conn = true; else if (d < near && (!best || d < best.d - 1e-9 || (best.kind !== 'e' && d <= best.d + snap))) best = { kind: 'e', d, m: o.slice(), li: v.li, k: v.k }; }
        else if (v.t === 'p') { const o = pts[v.pi].m; const d = dist(E, o); if (d <= snap) conn = true; else if (d < near && (!best || d < best.d)) best = { kind: 'p', d, m: o.slice() }; }
        else if (v.t === 's') { if (v.li === li) return; const L2 = lines[v.li]; const r = segProj(E, L2.m[v.i - 1], L2.m[v.i]); if (r.d <= snap) { conn = true; if (r.t > 1e-6 && r.t < 1 - 1e-6 && dist(r.x, L2.m[v.i - 1]) > snap && dist(r.x, L2.m[v.i]) > snap) { note('vertex', ln.w, ln.f, r.x, 'نقطة اتصال في نص ' + L2.w.l.name); if (opts.vertex) inserts.push({ li: v.li, i: v.i, t: r.t, m: r.x }); } } else if (r.d < near && (!best || r.d < best.d - snap)) best = { kind: 's', d: r.d, m: r.x, li: v.li, i: v.i, t: r.t }; }
      });
      if (conn || !best || anchored.has(li + ':' + k)) return;
      note('snapEnd', ln.w, ln.f, E, 'اتحرك ' + (best.d * 100).toFixed(1) + ' سم');
      if (!opts.snapEnd) return;
      if (best.kind === 'e') anchored.add(best.li + ':' + best.k);
      if (best.kind === 's') { const L2 = lines[best.li]; if (dist(best.m, L2.m[best.i - 1]) <= snap) best.m = L2.m[best.i - 1].slice(); else if (dist(best.m, L2.m[best.i]) <= snap) best.m = L2.m[best.i].slice(); else if (opts.vertex) { inserts.push({ li: best.li, i: best.i, t: best.t, m: best.m }); note('vertex', ln.w, ln.f, best.m, 'نقطة الاتصال'); } }
      setEnd(ln, k, best.m); anchored.add(li + ':' + k);
    }));
    /* ---- 6/7. points ---- */
    pts.forEach(p => {
      let best = null;
      gnear(p.m[0], p.m[1], near).forEach(v => { if (v.t !== 's') return; const ln = lines[v.li]; const r = segProj(p.m, ln.m[v.i - 1], ln.m[v.i]); if (!best || r.d < best.d) best = Object.assign(r, { li: v.li, i: v.i }); });
      if (!best) return;
      if (best.d > near) return;
      const ln = lines[best.li]; const a = ln.m[best.i - 1], b = ln.m[best.i];
      let target = best.x, ins = true;
      if (dist(best.x, a) <= snap) { target = a; ins = false; } else if (dist(best.x, b) <= snap) { target = b; ins = false; }
      if (ins && okRule('midspan_ok', p.w, p.f)) { ins = false; target = best.x; }
      const needMove = best.d > snap;
      if (needMove) note('snapPt', p.w, p.f, p.m, 'اتحركت ' + (dist(p.m, target) * 100).toFixed(1) + ' سم');
      if (ins) note('vertex', p.w, p.f, target, 'الجهاز في نص الخط');
      const doMove = needMove ? opts.snapPt : (ins && opts.vertex);
      if (!doMove) return;
      if (ins && opts.vertex) inserts.push({ li: best.li, i: best.i, t: best.t, m: target });
      const z = p.g.coordinates.length > 2 ? p.g.coordinates[2] : null; p.g.coordinates = toN(p.w, target, z); p.m = target;
    });
    /* ---- 8. crossings ---- */
    const splits = new Map(); // li -> [m points]
    if (opts.splitDev || dry) {
      const elOf = (w, f) => { const pr = f.properties || {}; const t = [pr.Block, pr.FEATURETYPE, pr.TYPE, pr.Type].filter(Boolean).join(' '); const e = t && GV.netElemOf ? GV.netElemOf(t) : null; return e && !/^(MAIN|SERV|CABL|FORC|MVCB|DUCT|CULV)$/.test(e) ? e : (GV.netElemOf ? GV.netElemOf(w.l.name) : null); };
      const SPL = { VALV: 1, MHOL: 1, INSP: 1, OUTF: 1, POLE: 1, PANL: 1 };
      const addSplit = (li, i, t, m) => { inserts.push({ li, i, t, m }); if (!splits.has(li)) splits.set(li, []); splits.get(li).push(m.slice()); };
      pts.forEach(p => {
        if (!SPL[elOf(p.w, p.f)]) return; let best = null;
        gnear(p.m[0], p.m[1], Math.max(snap, 0.001)).forEach(v => { if (v.t !== 's') return; const ln = lines[v.li]; const r = segProj(p.m, ln.m[v.i - 1], ln.m[v.i]); if (r.d <= Math.max(snap, 0.001) && (!best || r.d < best.d)) best = Object.assign(r, { li: v.li, i: v.i }); });
        if (!best) return; const ln = lines[best.li]; const eT = Math.max(snap, 0.05); if (dist(p.m, ln.m[0]) <= eT || dist(p.m, ln.m[ln.m.length - 1]) <= eT) return; const vx = ln.m.find(q => dist(q, p.m) <= eT); if (vx) { best.m0 = vx; }
        note('splitDev', ln.w, ln.f, p.m, 'عند ' + p.w.l.name); if (opts.splitDev) { if (best.m0) { if (!splits.has(best.li)) splits.set(best.li, []); splits.get(best.li).push(best.m0.slice()); } else addSplit(best.li, best.i, best.t, p.m.slice()); }
      });
      const lEl = lines.map(ln => GV.netElemOf ? GV.netElemOf(ln.w.l.name) : null);
      lines.forEach((ln, li) => { if (lEl[li] !== 'MAIN' && lEl[li] !== 'FORC') return; [0, ln.m.length - 1].forEach(k => { const E = ln.m[k];
        gnear(E[0], E[1], Math.max(snap, 0.001)).forEach(v => { if (v.t !== 's' || v.li === li || lEl[v.li] !== lEl[li]) return; const o = lines[v.li]; const r = segProj(E, o.m[v.i - 1], o.m[v.i]); if (r.d > Math.max(snap, 0.001)) return; const eT = Math.max(snap, 0.05); if (dist(E, o.m[0]) <= eT || dist(E, o.m[o.m.length - 1]) <= eT) return;
          note('splitDev', o.w, o.f, E, 'Tee مع ' + ln.w.l.name); if (opts.splitDev) addSplit(v.li, v.i, r.t, E.slice()); }); }); });
    }
    if (opts.split || dry) {
      const segX = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]; const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null; const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) ? { t, u, x: [a[0] + t * r[0], a[1] + t * r[1]] } : null; };
      const done = new Set();
      lines.forEach((ln, li) => { for (let i = 1; i < ln.m.length; i++) { const a = ln.m[i - 1], b = ln.m[i]; gnear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist(a, b) / 2 + 0.01).forEach(v => { if (v.t !== 's' || v.li <= li) return; const o = lines[v.li]; const x = segX(a, b, o.m[v.i - 1], o.m[v.i]); if (!x) return; const kk = li + ':' + i + '|' + v.li + ':' + v.i; if (done.has(kk)) return; done.add(kk); note('split', ln.w, ln.f, x.x, 'مع ' + o.w.l.name); if (!opts.split) return; inserts.push({ li, i, t: x.t, m: x.x }, { li: v.li, i: v.i, t: x.u, m: x.x }); [li, v.li].forEach(L => { if (!splits.has(L)) splits.set(L, []); splits.get(L).push(x.x); }); }); } });
    }
    /* ---- apply inserts ---- */
    const byLine = new Map(); inserts.forEach(s => { if (!byLine.has(s.li)) byLine.set(s.li, []); byLine.get(s.li).push(s); });
    byLine.forEach((arr, li) => { const ln = lines[li]; arr.sort((a, b) => b.i - a.i || b.t - a.t); const seen = new Set(); arr.forEach(s => { const k = s.i + ':' + s.t.toFixed(6); if (seen.has(k)) return; seen.add(k); if (ln.m.some(p => dist(p, s.m) <= 1e-4)) return; const z = zAt(ln, s.i, s.t); ln.c.splice(s.i, 0, toN(ln.w, s.m, z)); ln.m.splice(s.i, 0, s.m.slice()); }); });
    /* ---- split features ---- */
    if ((opts.split || opts.splitDev) && splits.size) {
      const GT = (f, cur) => f.geometry.type === 'MultiLineString' ? { type: 'MultiLineString', coordinates: [cur] } : { type: 'LineString', coordinates: cur };
      const splitFeat = new Map(); // feature -> list of split metric pts
      splits.forEach((ptsM, li) => { const ln = lines[li]; if (ln.f.geometry.type !== 'LineString' && !(ln.f.geometry.type === 'MultiLineString' && ln.f.geometry.coordinates.length === 1)) return; splitFeat.set(ln.f, { ln, pts: ptsM }); });
      W.forEach(w => { const out = []; w.feats.forEach(f => { const s = splitFeat.get(f); if (!s) { out.push(f); return; } const c = s.ln.c, m = s.ln.m; let cur = [c[0]]; for (let i = 1; i < c.length; i++) { cur.push(c[i]); if (i < c.length - 1 && s.pts.some(p => dist(p, m[i]) <= 1e-4)) { out.push({ orig: f.orig, properties: Object.assign({}, f.properties), geometry: GT(f, cur), _split: 1 }); cur = [c[i]]; } } out.push({ orig: f.orig, properties: Object.assign({}, f.properties), geometry: GT(f, cur), _split: 1 }); }); w.feats = out; });
    }

    /* ---- derived fields (fill empties only): our delivered-data conventions ---- */
    if (!ctx.cad && (opts.derive || dry)) {
      const E_ = v => v == null || String(v).trim() === '' || /^null$/i.test(String(v).trim());
      const key = (p, re) => Object.keys(p).find(k => re.test(k));
      const elOfL = w => GV.netElemOf ? GV.netElemOf(w.l.name) : null;
      const MH = []; W.forEach(w => { if (!/^(MHOL|INSP|OUTF)$/.test(elOfL(w) || '')) return; w.feats.forEach(f => { const g = f.geometry; if (!g || g.type !== 'Point') return; const p = f.properties || {}; const id = ['MH_ID', 'MANHOLE_ANNO', 'MANHOLE_ID', 'ID', 'NAME', 'LABEL'].map(k => p[key(p, new RegExp('^' + k + '$', 'i'))]).find(v => !E_(v)); if (id != null) MH.push({ m: toM(w, g.coordinates), id: String(id).trim() }); }); });
      const mhAt = m => { let b = null, bd = Math.max(near, 0.5); MH.forEach(x => { const d = dist(x.m, m); if (d <= bd) { bd = d; b = x; } }); return b; };
      const set = (w, f, p, k, v, why) => { if (k == null || !E_(p[k]) || v == null || (typeof v === 'number' && !isFinite(v))) return; note('derive', w, f, null, k + ' = ' + v + (why ? ' (' + why + ')' : '')); if (opts.derive) p[k] = v; };
      // ---- start/end pipe levels from the network itself: the structure at the end of the pipe, the pipe that meets it, or the main it sits on ----
      { const RE = { sg: /^(start_?pipe_?ground_?elevation|us_?gl|us_?ground(_?level)?|start_?gl|us_?cover(_?level)?)$/i, si: /^(start_?pipe_?elevation|us_?(pipe_?)?il|us_?inv(ert)?(_?level)?|start_?inv(ert)?)$/i, eg: /^(end_?pipe_?ground_?elevation|ds_?gl|ds_?ground(_?level)?|end_?gl|ds_?cover(_?level)?)$/i, ei: /^(end_?pipe_?elevation|ds_?(pipe_?)?il|ds_?inv(ert)?(_?level)?|end_?inv(ert)?)$/i, pg: /^(ground_?elevation|ground_?level|cover_?level|cover|cl|gl|rim(_?level)?)$/i, pi: /^(elevation|invert_?level|invert|il|inv)$/i };
        const num = v => { const n = parseFloat(v); return E_(v) || !isFinite(n) ? null : n; }; const K = m => Math.round(m[0] / 0.05) + ',' + Math.round(m[1] / 0.05);
        const nodeAt = new Map(); const put = (m, gl, il, src) => { if (gl == null && il == null) return; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = (Math.round(m[0] / 0.05) + dx) + ',' + (Math.round(m[1] / 0.05) + dy); const o = nodeAt.get(k) || {}; if (gl != null && o.gl == null) { o.gl = gl; o.gs = src; } if (il != null && o.il == null) { o.il = il; o.is = src; } nodeAt.set(k, o); } };
        const LN = [], PTS = []; W.forEach(w => w.feats.forEach(f => { const g = f.geometry; if (!g || ign(f)) return; const p = f.properties || {};
          if (g.type === 'Point') PTS.push({ m: toM(w, g.coordinates), gl: num(p[key(p, RE.pg)]), il: /^(METR|HYDT|POLE|PANL)$/.test(elOfL(w) || '') ? null : num(p[key(p, RE.pi)]) });
          else if (g.type === 'LineString' && g.coordinates.length > 1) LN.push({ w, f, c: g.coordinates.map(c => toM(w, c)) }); }));
        // the pipe that meets this end knows the joint level best; the structure's own level comes next
        // segment grid so a pipe end finds the pipe it sits on without scanning the whole network
        const SG = new Map(); LN.forEach(q => { for (let k = 1; k < q.c.length; k++) { const A = q.c[k - 1], B = q.c[k]; for (let i = Math.floor((Math.min(A[0], B[0]) - 0.1) / 5); i <= Math.floor((Math.max(A[0], B[0]) + 0.1) / 5); i++) for (let j = Math.floor((Math.min(A[1], B[1]) - 0.1) / 5); j <= Math.floor((Math.max(A[1], B[1]) + 0.1) / 5); j++) { const kk = i + ',' + j; if (!SG.has(kk)) SG.set(kk, new Set()); SG.get(kk).add(q); } } });
        for (let pass = 0; pass < 3; pass++) {
          LN.forEach(o => { const p = o.f.properties || {}; const a = o.c[0], b = o.c[o.c.length - 1]; put(a, num(p[key(p, RE.sg)]), num(p[key(p, RE.si)]), 'الخط اللي متوصل بيه'); put(b, num(p[key(p, RE.eg)]), num(p[key(p, RE.ei)]), 'الخط اللي متوصل بيه'); });
          if (pass === 0) PTS.forEach(q => put(q.m, q.gl, q.il, 'النقطة اللي عند طرف الخط'));
          LN.forEach(o => { const p = o.f.properties || (o.f.properties = {}); [[o.c[0], RE.sg, RE.si], [o.c[o.c.length - 1], RE.eg, RE.ei]].forEach(([m, rg, ri]) => { const kg = key(p, rg), ki = key(p, ri); if ((!kg || !E_(p[kg])) && (!ki || !E_(p[ki]))) return; let n = nodeAt.get(K(m));
            if (!n || (n.gl == null && n.il == null)) { // sits mid-span on another pipe (lateral on a main): interpolate that pipe's levels at the spot
              const cand = new Set(); SG.get(Math.floor(m[0] / 5) + ',' + Math.floor(m[1] / 5))?.forEach(x => cand.add(x)); for (const q of cand) { if (q === o) continue; const qp = q.f.properties || {}; const g1 = num(qp[key(qp, RE.sg)]), g2 = num(qp[key(qp, RE.eg)]), i1 = num(qp[key(qp, RE.si)]), i2 = num(qp[key(qp, RE.ei)]); if (g1 == null && i1 == null) continue; let acc = 0, tot = 0, at = null; for (let k = 1; k < q.c.length; k++) tot += dist(q.c[k], q.c[k - 1]);
                for (let k = 1; k < q.c.length && at == null; k++) { const A = q.c[k - 1], B = q.c[k], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy; let t = L2 ? ((m[0] - A[0]) * dx + (m[1] - A[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); if (Math.hypot(m[0] - A[0] - t * dx, m[1] - A[1] - t * dy) <= 0.05) at = acc + t * Math.sqrt(L2); acc += Math.sqrt(L2); }
                if (at != null && tot > 0) { const r = at / tot; n = { gl: g1 != null && g2 != null ? +(g1 + (g2 - g1) * r).toFixed(3) : null, il: i1 != null && i2 != null ? +(i1 + (i2 - i1) * r).toFixed(3) : null, gs: 'محسوب على الخط الرئيسي في نقطة الاتصال', is: 'محسوب على الخط الرئيسي في نقطة الاتصال' }; break; } } }
            if (!n) return; if (kg && n.gl != null) set(o.w, o.f, p, kg, n.gl, n.gs); if (ki && n.il != null) set(o.w, o.f, p, ki, n.il, n.is); }); });
        } }
      W.forEach(w => { const proj = isProj(w.l); w.feats.forEach(f => {
        const g = f.geometry; if (!g || ign(f)) return; const p = f.properties || (f.properties = {});
        if (g.type === 'LineString' || g.type === 'MultiLineString') {
          const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates; if (!parts.length || parts[0].length < 2) return;
          const a = parts[0][0], b = parts[parts.length - 1][parts[parts.length - 1].length - 1]; const ma = toM(w, a), mb = toM(w, b);
          let L0 = 0; parts.forEach(c => { for (let i = 1; i < c.length; i++) L0 += dist(toM(w, c[i]), toM(w, c[i - 1])); });
          if (MH.length) { const ua = mhAt(ma), ub = mhAt(mb); set(w, f, p, key(p, /^(us_?mh_?id|from_?mh)$/i), ua && ua.id, 'الغرفة اللي في أول الخط'); set(w, f, p, key(p, /^(ds_?mh_?id|to_?mh)$/i), ub && ub.id, 'الغرفة اللي في آخر الخط'); }
          const us = parseFloat(p[key(p, /^(us_?(pipe_?)?il|us_?invert|start_?invert|startpipeelevation)$/i)]), ds = parseFloat(p[key(p, /^(ds_?(pipe_?)?il|ds_?invert|end_?invert|endpipeelevation)$/i)]);
          if (isFinite(us) && isFinite(ds) && L0 > 0) set(w, f, p, key(p, /^slope$/i), +((us - ds) / L0 * 100).toFixed(2), '(US−DS)/الطول×100');
          if (proj) { set(w, f, p, key(p, /^start_?x_?coord(inate)?s?_?$/i), +a[0].toFixed(3)); set(w, f, p, key(p, /^start_?y_?coord(inate)?s?_?$/i), +a[1].toFixed(3)); set(w, f, p, key(p, /^end_?x_?coord(inate)?s?_?$/i), +b[0].toFixed(3)); set(w, f, p, key(p, /^end_?y_?coord(inate)?s?_?$/i), +b[1].toFixed(3)); }
        } else if (g.type === 'Point') {
          const cv = parseFloat(p[key(p, /^(cover_?level|cover|cl|ground_?level|groundelevation)$/i)]), iv = parseFloat(p[key(p, /^(invert_?level|invert|il)$/i)]);
          if (isFinite(cv) && isFinite(iv) && cv > iv) set(w, f, p, key(p, /^depth$/i), +(cv - iv).toFixed(3), 'COVER − INVERT');
          if (proj) { const c = g.coordinates; set(w, f, p, key(p, /^(x|x_?coord(inate)?s?_?)$/i), +c[0].toFixed(3)); set(w, f, p, key(p, /^(y|y_?coord(inate)?s?_?)$/i), +c[1].toFixed(3)); }
        }
      }); });
    }
    /* ---- 9. attributes ---- */
    W.forEach(w => {
      const fields = new Set(); w.feats.slice(0, 500).forEach(f => Object.keys(f.properties || {}).forEach(k => fields.add(k)));
      fields.forEach(k => {
        if (/^(Text|Layer|Entity|Color|Block)$/.test(k) && w.l.cad) return;
        const strs = w.feats.map(f => f.properties[k]).filter(v => typeof v === 'string');
        if (!strs.length) return;
        const groups = new Map(); strs.forEach(s => { const nk = s.trim().replace(/\s+/g, ' ').toLowerCase(); if (!groups.has(nk)) groups.set(nk, new Map()); const g = groups.get(nk); const t = s.trim().replace(/\s+/g, ' '); g.set(t, (g.get(t) || 0) + 1); });
        const canon = new Map(); groups.forEach((g, nk) => { let best = null, bn = -1; g.forEach((n, t) => { if (n > bn) { bn = n; best = t; } }); canon.set(nk, best); });
        w.feats.forEach(f => { const v = f.properties[k]; if (typeof v !== 'string') return; const c = canon.get(v.trim().replace(/\s+/g, ' ').toLowerCase()); const nv = v.trim() === '' ? null : c; if (nv !== v) { note('attr', w, f, null, k + ': "' + v + '" ← "' + (nv == null ? '' : nv) + '"'); if (opts.attr) f.properties[k] = nv; } });
      });
      if (ctx.cad) return;
      const proj = isProj(w.l);
      if (w.role === 'point' && proj) w.feats.forEach(f => { if (!f.geometry || f.geometry.type !== 'Point') return; const p = f.properties; const c = f.geometry.coordinates; Object.keys(p).forEach(k => { const isX = /^(x|east(ing)?|x_?coord(inate)?s?_?|point_x)$/i.test(k), isY = /^(y|north(ing)?|y_?coord(inate)?s?_?|point_y)$/i.test(k); if (!isX && !isY) return; const nv = +(isX ? c[0] : c[1]).toFixed(3); if (p[k] == null || Math.abs(+p[k] - nv) > 0.05) { note('xy', w, f, null, k + ' = ' + nv); if (opts.xy) p[k] = nv; } }); });
      if (w.role === 'line') w.feats.forEach(f => { const g = f.geometry; if (!g) return; const p = f.properties; const lk = Object.keys(p).filter(k => /^(length|len|actual_?length|lateral_?length|shape_?len|pipe_?length|cabel_lenghth|طول)/i.test(k)); if (!lk.length) return; let L0 = 0; (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).forEach(c => { for (let i = 1; i < c.length; i++) L0 += proj ? Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]) : dist(toM(w, c[i]), toM(w, c[i - 1])); }); lk.forEach(k => { if (p[k] == null || p[k] === '' || Math.abs(+p[k] - L0) > 0.05) { const op = f._split || p[k] == null || p[k] === '' ? 'derive' : 'len'; note(op, w, f, null, k + ': ' + p[k] + ' ← ' + L0.toFixed(3) + (f._split ? ' (بعد التقسيم)' : '')); if (opts[op]) p[k] = +L0.toFixed(3); } }); });
      const has3 = w.feats.some(f => { const c = f.geometry && GV.firstCoord(f.geometry); return c && c.length > 2; });
      if (!has3) w.feats.forEach(f => { if (!f.geometry) return; note('z0', w, f, null); if (opts.z0) { const add = c => { if (typeof c[0] === 'number') { if (c.length < 3) c.push(0); } else c.forEach(add); }; add(f.geometry.coordinates); } });
    });
    if (ctx.cad && (opts.join || dry)) W.forEach(w => {
      const k3 = c => { const m = toM(w, c); return Math.round(m[0] / Math.max(snap, 0.001)) + ',' + Math.round(m[1] / Math.max(snap, 0.001)); };
      const deg = new Map(); const busy = new Set();
      W.forEach(w2 => w2.feats.forEach(f => { const g = f.geometry; if (!g || ign(f)) return; if (g.type === 'LineString') [g.coordinates[0], g.coordinates[g.coordinates.length - 1]].forEach(c => { const k = k3(c); deg.set(k, (deg.get(k) || 0) + 1); }); else if (g.type === 'Point') busy.add(k3(g.coordinates)); else if (g.type === 'MultiLineString') g.coordinates.forEach(cc => [cc[0], cc[cc.length - 1]].forEach(c => { const k = k3(c); deg.set(k, (deg.get(k) || 0) + 2); })); }));
      let merged = true, guard = 0;
      while (merged && guard++ < 50) {
        merged = false; const ends = new Map();
        w.feats.forEach((f, i) => { const g = f.geometry; if (!g || ign(f) || g.type !== 'LineString' || f._dead) return; [0, 1].forEach(e => { const c = e ? g.coordinates[g.coordinates.length - 1] : g.coordinates[0]; const k = k3(c); if (deg.get(k) === 2 && !busy.has(k)) { if (!ends.has(k)) ends.set(k, []); ends.get(k).push({ i, e }); } }); });
        ends.forEach((arr, k) => {
          if (arr.length !== 2 || arr[0].i === arr[1].i) return; const A = w.feats[arr[0].i], B = w.feats[arr[1].i]; if (A._dead || B._dead) return;
          if ((A.orig && A.orig._color) !== (B.orig && B.orig._color)) return;
          let a = A.geometry.coordinates.slice(), b = B.geometry.coordinates.slice();
          if (arr[0].e === 0) a.reverse(); if (arr[1].e === 1) b.reverse();
          note('join', w, A, toM(w, a[a.length - 1]));
          if (!opts.join) return;
          A.geometry = { type: 'LineString', coordinates: a.concat(b.slice(1)) }; B._dead = true; merged = true;
          deg.set(k, 0);
        });
        if (!opts.join) break;
      }
      w.feats = w.feats.filter(f => !f._dead);
    });
    return { counts, log, W };
  }
  function unitFix() { if (!ctx || !ctx.cad) return null; const an = GV.analyzeCad(ctx.src); const x = an.W.find(w => w.fix && (w.fix.s || w.fix.swap)); return x ? x.fix : null; }

  async function apply() {
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بصلّح الداتا…'; await new Promise(r => setTimeout(r, 30));
    try {
      const before = GV.qcLast ? { err: GV.qcLast.issues.filter(i => i.sev === 'err').length, warn: GV.qcLast.issues.filter(i => i.sev === 'warn').length } : null;
      let backup = null;
      if (ctx.cad) { const cp = await GV.workCopy(ctx.src); if (cp !== ctx.src) { ctx.src = cp; ctx.cfg.sel = cadSel(cp); } }
      else { for (const x of ctx.cfg.sel) if (x.l.src && !x.l.src.isCopy) await GV.workCopy(x.l.src); ctx.cfg.sel = ctx.cfg.sel.map(x => Object.assign({}, x, { l: GV.liveLayer(x.l) })); if (GV.qcLast && GV.qcLast.cfg) GV.qcLast.cfg.sel = ctx.cfg.sel; }
      if (ctx.cad) {
        backup = ctx.src.layers.map(l => ({ l, feats: l.features.map(f => Object.assign({}, f, { geometry: clone(f.geometry), properties: Object.assign({}, f.properties) })) }));
        const uf = opts.unit ? unitFix() : null; if (uf) { await GV.cadApplyFix(ctx.src, uf, true); ctx.cfg.sel = cadSel(ctx.src); }
      }
      const r = run(false);
      if (ctx.cad && opts.unit && backup) { const uf2 = backup && null; }
      GV.fixUndo = backup || r.W.map(w => ({ l: w.l, feats: w.l.features }));
      r.W.forEach(w => {
        w.l.features = w.feats.map(f => { const o = Object.assign({}, f.orig || {}); delete o.wgs; delete o._lbl; o.type = 'Feature'; o.properties = f.properties; o.geometry = f.geometry; return o; });
        refresh(w.l);
      });
      GV.fixLog = r.log;
      GV.renderLayers(); GV.refreshLabels(); if (GV.onDirty) GV.onDirty();
      $('#busy').classList.remove('show');
      if (ctx.cad) { cadDone(r); return; }
      GV.toast(r.log.length.toLocaleString('en') + ' تعديل اتعمل · بعيد الفحص…', 3500);
      if (GV.editSample && r.log.length) { const NM = GV.FIX_NAMES || {}; setTimeout(() => GV.editSample('الحل التلقائي', r.log.map(e => ({ l: { name: e.layer }, f: null, note: (NM[e.op] || e.op) + (e.detail ? ' — ' + e.detail : ''), ll: e.ll })), GV.fixUndoFn ? () => GV.fixUndoFn() : null), 1500); }
      GV.fixBefore = before;
      await GV.runQC();
    } catch (e) { GV.showMsg('حصلت مشكلة: ' + (e.message || e)); console.error(e); }
    finally { $('#busy').classList.remove('show'); }
  }
  function cadDone(r) { if (ctx && ctx.src) ctx.src._fixed = true;
    const box = $('#fixBody'); box.textContent = '';
    const by = {}; r.log.forEach(e => by[e.op] = (by[e.op] || 0) + 1);
    box.appendChild(el('div', 'ok-note', '✓ اتعمل ' + r.log.length.toLocaleString('en') + ' تعديل على ' + ctx.src.name));
    Object.keys(by).forEach(k => { const row = el('div', 'qc-type'); const d = el('span', 'qc-dot'); d.style.background = '#2f9e44'; row.append(d, el('span', 'qc-t', NAMES[k] || k), el('small'), el('b', null, by[k].toLocaleString('en'))); box.appendChild(row); });
    const acts = el('div', 'fc-acts'); acts.style.marginTop = '12px';
    const dl = el('button', 'open-btn sm', 'نزّل الكاد بعد التصليح (DXF)'); dl.onclick = () => GV.exportCadDxf(ctx.src);
    const u = el('button', 'chip', '↶ تراجع'); u.onclick = undo;
    const lg = el('button', 'chip', 'سجل التعديلات'); lg.onclick = exportLog;
    const ck = el('button', 'chip', 'افحص الكاد تاني'); ck.onclick = () => GV.onCadLoaded(ctx.src, true);
    acts.append(dl, u, lg, ck); box.appendChild(acts);
    box.appendChild(el('p', 'muted small', 'الـ DXF بيطلع بنفس أسماء اللايرات والألوان والنصوص والبلوكات. افتحه في الأوتوكاد واعمل Save As DWG.'));
  }
  async function exportCadDxf(src) {
    const hasZ = src.layers.some(l => l.features.some(f => { const c = f.geometry && GV.firstCoord(f.geometry); return c && c.length > 2 && c[2]; }));
    const out = src.layers.map(l => ({ name: l.name, color: l.color, fields: [], features: l.features.map(f => ({ properties: f.properties, geometry: f.geometry, color: f._color, ins: f._ins, sym: f._sym })) }));
    const r12 = Writers.dxf(out, { cad: true, blocks: (src.cadInfo && src.cadInfo.blocks) || {}, mode: 'layer', colorMode: 'feature', points: 'point', textH: 1, z3d: hasZ, labelField: null }); let data = r12; try { if (window.DxfModern) data = window.DxfModern(r12); } catch (e) { console.error('DxfModern', e); }
    await GV.saveFile((src.orgOut ? (/\|bg$/.test(src.orgOut) ? 'BACKGROUND_' : 'NETWORK_') + src.orgOut.split('|')[0] : src.name).replace(/\.(dwg|dxf)$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() + (src.orgOut && !src._fixed ? '.dxf' : '_fixed.dxf'), data);
  }
  function refresh(l) { l.saveKey = null; if (l.leaf) GV.map.removeLayer(l.leaf); GV.applyCRS(l, GV.resolveCRS(l.crsDef)); if (l.visible !== false) l.leaf.addTo(GV.map); }
  function undo() {
    if (!GV.fixUndo) return;
    GV.fixUndo.forEach(({ l, feats }) => { l.features = feats; refresh(l); });
    GV.fixUndo = null; GV.fixLog = null;
    GV.renderLayers(); GV.refreshLabels(); if (GV.onDirty) GV.onDirty(); GV.closeSheets(); GV.toast('رجعت الداتا زي ما كانت قبل الحل التلقائي');
  }
  async function exportLog() {
    if (!GV.fixLog || !GV.fixLog.length) return GV.toast('مفيش تعديلات');
    const rows = [['التعديل', 'الطبقة', 'التفاصيل', 'Longitude', 'Latitude']].concat(GV.fixLog.map(e => [NAMES[e.op] || e.op, e.layer, e.detail, e.ll ? +e.ll[0].toFixed(7) : '', e.ll ? +e.ll[1].toFixed(7) : '']));
    await GV.saveFile('سجل_التعديلات.xlsx', await GV.xlsx([{ name: 'سجل التعديلات', rows }]));
  }
  $('#btnCadFix').addEventListener('click', () => {
    const cs = GV.sources.filter(s => s.isCad && !GV.superseded(s) && s.layers.some(l => l.features.length));
    if (!cs.length) return GV.showMsg('افتح ملف الكاد (DWG/DXF) الأول وحدد نظام الإحداثيات بتاعه.');
    if (cs.length === 1) return openFix({ cad: true, src: cs[0] });
    const box = $('#pickList'); box.textContent = ''; $('#pickTitle').textContent = 'اختار ملف الكاد';
    cs.forEach(s => { const b = el('button', 'crs-opt', s.name); b.onclick = () => openFix({ cad: true, src: s }); box.appendChild(b); });
    GV.openSheet('#pickSheet');
  });
  GV.openFix = openFix; GV.exportCadDxf = exportCadDxf; GV.fixUndoFn = undo; GV.fixExportLog = exportLog; GV.FIX_NAMES = NAMES;
})();
