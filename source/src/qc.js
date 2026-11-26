// Data QC: coordinates, elevations, geometry, network topology, attributes, Utility Network readiness
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const SEV = { err: ['خطأ', '#e03131'], warn: ['تحذير', '#f08c00'], info: ['ملاحظة', '#1c7ed6'] };
  const CATS = { coord: 'الإحداثيات', z: 'المناسيب', geom: 'الهندسة', topo: 'الطوبولوجي والاتصال', attr: 'البيانات الوصفية', un: 'جاهزية Utility Network', net: 'قواعد الشبكة' };
  const ROLE_AR = { auto: 'تلقائي', line: 'خطوط الشبكة', point: 'نقط (أجهزة/وصلات)', poly: 'مضلعات', skip: 'تجاهل' };
  const roles = new Map();

  function qcLayers() { return GV.sources.filter(s => s.id !== 'qc' && s.id !== 'field').flatMap(s => s.layers.filter(l => l.features.length && l.leaf).map(l => ({ l, s }))); }
  function autoRole(l) { return l.kind === 'line' ? 'line' : l.kind === 'point' ? 'point' : l.kind === 'polygon' ? 'poly' : 'skip'; }
  function openQC(pre) {
    if ($('#qcNet')) $('#qcNet').value = GV.store.get('gv_orgnet') || 'water';
    const ls = qcLayers();
    if (!ls.length) return GV.showMsg('افتح الداتا الأول على الخريطة (لازم يكون ليها نظام إحداثيات).');
    const box = $('#qcLayers'); box.textContent = '';
    ls.forEach(({ l, s }) => {
      const row = el('div', 'qc-row');
      const annoOnly = s.isCad && l.features.every(f => (f.properties && f.properties.Text != null) || (f.geometry && f.geometry.type === 'LineString' && f.geometry.coordinates.length === 2 && /table|جدول|text|anno|iden|dim/i.test(l.name)));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = pre ? pre.indexOf(l) >= 0 : (l.visible && !annoOnly && !/^(table|text|anno|dim|defpoints)/i.test(l.name)); cb._layer = l;
      const nm = el('span', 'qc-nm'); nm.append(el('b', null, l.name), el('small', 'muted', ' ' + s.name + ' · ' + l.features.length.toLocaleString('en')));
      const sel = el('select'); ['auto', 'line', 'point', 'poly', 'skip'].forEach(k => { const o = el('option', null, ROLE_AR[k] + (k === 'auto' ? ' (' + ROLE_AR[autoRole(l)] + ')' : '')); o.value = k; sel.appendChild(o); });
      sel.value = roles.get(l) || 'auto'; sel.onchange = () => roles.set(l, sel.value);
      row.append(cb, nm, sel); box.appendChild(row);
    });
    renderRules();
    GV.openSheet('#qcSheet');
  }

  /* ---------- geometry helpers (local metric) ---------- */
  function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const x = ax + t * dx, y = ay + t * dy; return [Math.hypot(px - x, py - y), t, x, y]; }
  function segX(a, b, c, d) { // proper intersection point or null
    const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]; const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return [a[0] + t * r[0], a[1] + t * r[1]]; return null;
  }
  class Grid { constructor(c) { this.c = c; this.m = new Map(); } key(i, j) { return i + ',' + j; }
    add(x0, y0, x1, y1, v) { const c = this.c; for (let i = Math.floor(Math.min(x0, x1) / c); i <= Math.floor(Math.max(x0, x1) / c); i++) for (let j = Math.floor(Math.min(y0, y1) / c); j <= Math.floor(Math.max(y0, y1) / c); j++) { const k = this.key(i, j); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(v); } }
    near(x, y, r) { const c = this.c, out = new Set(); for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++) { const a = this.m.get(this.key(i, j)); if (a) a.forEach(v => out.add(v)); } return out; } }
  const median = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const isProj = l => { const d = String(l.crsDef || ''); return /^(326|327|204)\d\d$/.test(d) || /^PROJ/i.test(d); };

  async function run() {
    const sel = Array.from(document.querySelectorAll('#qcLayers .qc-row')).filter(r => r.querySelector('input').checked).map(r => { const l = GV.liveLayer(r.querySelector('input')._layer); const v = r.querySelector('select').value; return { l, role: v === 'auto' ? autoRole(l) : v }; }).filter(x => x.role !== 'skip');
    if (!sel.length) return GV.toast('اختار طبقة واحدة على الأقل');
    const snap = +$('#qcSnap').value || 0.01, near = +$('#qcNear').value || 1, zmin = +$('#qcZmin').value, zmax = +$('#qcZmax').value;
    const on = k => $('#qc_' + k).checked;
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بفحص الداتا…'; await new Promise(r => setTimeout(r, 30));
    const issues = []; const capC = {};
    const add = (sev, cat, type, l, fi, ll, detail, meta) => { const k = cat + type; capC[k] = (capC[k] || 0) + 1; if (capC[k] > 3000) return; issues.push({ sev, cat, type, layer: l ? l.name : '', lref: l, fi, ll, detail: detail || '', meta: meta || null }); };
    try {
      // local metric frame
      const all = []; sel.forEach(({ l }) => l.features.forEach(f => { const c = f.wgs && f.wgs.geometry && GV.firstCoord(f.wgs.geometry); if (c && isFinite(c[0]) && isFinite(c[1])) all.push(c); }));
      const lon0 = median(all.map(c => c[0])), lat0 = median(all.map(c => c[1]));
      const KX = Math.cos(lat0 * Math.PI / 180) * 111320, KY = 110540;
      const M = c => [(c[0] - lon0) * KX, (c[1] - lat0) * KY];
      const W = m => [m[0] / KX + lon0, m[1] / KY + lat0];
      const flat = g => { const out = []; if (!g) return out; const t = g.type; if (t === 'GeometryCollection') { g.geometries.forEach(x => out.push(...flat(x))); return out; } const c = g.coordinates; if (t === 'Point') out.push({ t: 'P', c: [c] }); else if (t === 'MultiPoint') c.forEach(p => out.push({ t: 'P', c: [p] })); else if (t === 'LineString') out.push({ t: 'L', c }); else if (t === 'MultiLineString') c.forEach(p => out.push({ t: 'L', c: p })); else if (t === 'Polygon') c.forEach(r => out.push({ t: 'R', c: r })); else if (t === 'MultiPolygon') c.forEach(p => p.forEach(r => out.push({ t: 'R', c: r }))); return out; };

      const lines = [], points = [];
      const dists = all.map(c => Math.hypot(...M(c))); const md = median(dists) || 1; const farLim = Math.max(md * 20, 5000);
      for (const { l, role } of sel) {
        const proj = isProj(l);
        l.features.forEach((f, fi) => {
          if (f._sym || (l.cad && f.properties && f.properties.Text != null)) return;
          const g = f.geometry, wg = f.wgs && f.wgs.geometry;
          const anchor = wg ? GV.firstCoord(wg) : null;
          /* --- coordinates --- */
          if (!g || !wg) { if (on('geom')) add('warn', 'geom', 'عنصر من غير شكل (Null geometry)', l, fi, null); return; }
          const parts = flat(wg), nparts = flat(g);
          let bad = false; parts.forEach(p => p.c.forEach(c => { if (!isFinite(c[0]) || !isFinite(c[1]) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) bad = true; }));
          if (bad) { if (on('coord')) add('err', 'coord', 'إحداثيات غير صالحة (NaN أو برّه العالم)', l, fi, null); return; }
          if (on('coord')) {
            nparts.forEach(p => p.c.forEach(c => { if (Math.abs(c[0]) < 1e-6 && Math.abs(c[1]) < 1e-6) bad = true; }));
            if (bad) add('err', 'coord', 'نقطة عند (0,0)', l, fi, anchor);
            const d = Math.hypot(...M(anchor)); if (d > farLim) add('warn', 'coord', 'عنصر بعيد جدًا عن باقي الداتا', l, fi, anchor, 'على بعد ' + (d / 1000).toFixed(1) + ' كم من مركز الداتا');
            if (g.type === 'Point') {
              const p = f.properties || {}; const nc = g.coordinates;
              const fx = Object.keys(p).find(k => /^(x|east(ing)?|x_?coord|point_x|e)$/i.test(k)), fy = Object.keys(p).find(k => /^(y|north(ing)?|y_?coord|point_y|n)$/i.test(k));
              if (fx && fy && proj && p[fx] != null && p[fy] != null && isFinite(+p[fx]) && isFinite(+p[fy])) { const dd = Math.hypot(+p[fx] - nc[0], +p[fy] - nc[1]); if (dd > 0.05) add('warn', 'coord', 'حقول الإحداثيات مختلفة عن مكان النقطة', l, fi, anchor, fx + '/' + fy + ' بعيدين ' + dd.toFixed(2) + ' م عن الشكل'); }
              const flat_ = Object.keys(p).find(k => /^(lat|latitude)$/i.test(k)), flon = Object.keys(p).find(k => /^(lon|long|longitude|lng)$/i.test(k));
              if (flat_ && flon && p[flat_] != null && p[flon] != null) { const dd = Math.hypot((+p[flon] - wg.coordinates[0]) * KX, (+p[flat_] - wg.coordinates[1]) * KY); if (dd > 0.5) add('warn', 'coord', 'حقول Lat/Long مختلفة عن مكان النقطة', l, fi, anchor, 'الفرق ' + dd.toFixed(2) + ' م'); }
            }
          }
          /* --- Z --- */
          if (on('z')) {
            const zs = []; nparts.forEach(p => p.c.forEach(c => zs.push(c.length > 2 ? c[2] : undefined)));
            const has = zs.filter(z => z !== undefined && z !== null);
            if (has.length && has.length < zs.length) add('warn', 'z', 'بعض الرؤوس ليها Z وبعضها لأ', l, fi, anchor);
            if (has.some(z => !isFinite(z))) add('err', 'z', 'منسوب Z غير صالح (NaN)', l, fi, anchor);
            const out = has.filter(z => isFinite(z) && (z < zmin || z > zmax)); if (out.length) add('err', 'z', 'منسوب Z برّه النطاق المنطقي', l, fi, anchor, 'Z = ' + out[0] + ' (النطاق ' + zmin + ' إلى ' + zmax + ')');
            nparts.forEach(p => { if (p.t !== 'L') return; for (let i = 1; i < p.c.length; i++) { const a = p.c[i - 1], b = p.c[i]; if (a.length > 2 && b.length > 2 && isFinite(a[2]) && isFinite(b[2])) { const h = proj ? Math.hypot(b[0] - a[0], b[1] - a[1]) : null; const dz = Math.abs(b[2] - a[2]); if (dz > 20 && (h == null || dz > h)) { add('warn', 'z', 'قفزة مفاجئة في المنسوب على الخط', l, fi, anchor, 'فرق ' + dz.toFixed(2) + ' م بين رأسين'); break; } } } });
            const p = f.properties || {};
            const eF = Object.keys(p).filter(k => /(elev|level|^z$|ground|^gl$|^ngl$|invert|^il$|_il$|^us_?il|^ds_?il|cover|rim|منسوب)/i.test(k) && !/(material|shape|type|size|diam|width|length|cond|status|class|date|name|desc|remark|note|owner|by$|_?id$)/i.test(k));
            eF.forEach(k => { const v = p[k]; if (v == null || String(v).trim() === '') return; const n = +String(v).trim(); if (!isFinite(n)) { if (/\d/.test(String(v)) && !/[a-z\u0600-\u06ff]{3,}/i.test(String(v))) add('warn', 'z', 'قيمة منسوب مكتوبة بشكل مش مفهوم', l, fi, anchor, k + ' = ' + v); } else if (n < zmin || n > zmax) add('err', 'z', 'منسوب غير منطقي في حقل', l, fi, anchor, k + ' = ' + n); });
            const gK = Object.keys(p).find(k => /^(ground|gl|ngl|cover|rim|ground_?level|cover_?level|rim_?elev)/i.test(k)), iK = Object.keys(p).find(k => /^(invert|il|inv|invert_?level|inv_?elev)/i.test(k));
            if (gK && iK && p[gK] != null && p[iK] != null && isFinite(+p[gK]) && isFinite(+p[iK])) { const dd = +p[gK] - +p[iK]; if (dd < 0) add('err', 'z', 'منسوب القاع أعلى من منسوب الأرض/الغطا', l, fi, anchor, gK + ' = ' + p[gK] + ' و ' + iK + ' = ' + p[iK]); else if (dd > 12) add('warn', 'z', 'عمق كبير جدًا', l, fi, anchor, 'العمق ' + dd.toFixed(2) + ' م'); }
            const dK = Object.keys(p).find(k => /^(depth|عمق)/i.test(k)); if (dK && p[dK] != null && isFinite(+p[dK]) && (+p[dK] < 0 || +p[dK] > 12)) add('warn', 'z', 'عمق غير منطقي', l, fi, anchor, dK + ' = ' + p[dK]);
            const uK = Object.keys(p).find(k => /^(us_?il|up_?inv|upstream_?inv|start_?inv|inv_?up|from_?inv)/i.test(k)), dsK = Object.keys(p).find(k => /^(ds_?il|down_?inv|downstream_?inv|end_?inv|inv_?down|to_?inv)/i.test(k));
            if (uK && dsK && p[uK] != null && p[dsK] != null && +p[dsK] > +p[uK]) add('warn', 'z', 'ميل عكسي (القاع تحت أعلى من فوق)', l, fi, anchor, uK + ' = ' + p[uK] + '، ' + dsK + ' = ' + p[dsK]);
          }
          /* --- geometry --- */
          const mp = parts.map(p => ({ t: p.t, c: p.c.map(M) }));
          if (on('geom') || on('un')) {
            if ((g.type.indexOf('Multi') === 0) && flat(g).length > 1) add(on('un') ? 'err' : 'warn', on('un') ? 'un' : 'geom', 'عنصر متعدد الأجزاء (Multipart)', l, fi, anchor, flat(g).length + ' أجزاء. الـ Utility Network مش بيقبل ده.');
            mp.forEach(p => {
              if (p.t === 'L') {
                if (p.c.length < 2) { add('err', 'geom', 'خط فيه نقطة واحدة', l, fi, anchor); return; }
                let len = 0, dup = 0, shortS = 0, spike = 0;
                for (let i = 1; i < p.c.length; i++) { const s = Math.hypot(p.c[i][0] - p.c[i - 1][0], p.c[i][1] - p.c[i - 1][1]); len += s; if (s < 1e-4) dup++; else if (s < snap) shortS++; }
                for (let i = 1; i < p.c.length - 1; i++) { const a = p.c[i - 1], b = p.c[i], c = p.c[i + 1]; const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]]; const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2); if (n1 > 1e-4 && n2 > 1e-4) { const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2); if (cos > 0.9998) spike++; } }
                if (len < 0.001) add('err', 'geom', 'خط طوله صفر', l, fi, anchor);
                else if (len < 0.05 && (on('un') || on('geom'))) add('err', 'geom', 'خط قصير جدًا (أقل من 5 سم)', l, fi, anchor, 'الطول ' + (len * 100).toFixed(1) + ' سم');
                if (dup) add('warn', 'geom', 'رؤوس مكررة ورا بعض', l, fi, anchor, dup + ' رأس');
                if (shortS) add('info', 'geom', 'أجزاء قصيرة جدًا جوه الخط', l, fi, anchor, shortS + ' جزء أقل من ' + snap + ' م');
                if (spike) add('warn', 'geom', 'سبايك (الخط بيرجع على نفسه)', l, fi, anchor);
                if (p.c.length <= 400) { let x = null; for (let i = 1; i < p.c.length && !x; i++) for (let j = i + 2; j < p.c.length && !x; j++) { if (i === 1 && j === p.c.length - 1 && Math.hypot(p.c[0][0] - p.c[p.c.length - 1][0], p.c[0][1] - p.c[p.c.length - 1][1]) < 1e-6) continue; x = segX(p.c[i - 1], p.c[i], p.c[j - 1], p.c[j]); } if (x) add(on('un') ? 'err' : 'warn', on('un') ? 'un' : 'geom', 'الخط بيقطع نفسه', l, fi, W(x)); }
              }
              if (p.t === 'R') {
                let a = 0; for (let i = 0; i < p.c.length - 1; i++) a += p.c[i][0] * p.c[i + 1][1] - p.c[i + 1][0] * p.c[i][1]; a = Math.abs(a / 2);
                if (p.c.length < 4 || a < 0.01) add('err', 'geom', 'مضلع مساحته صفر أو تقريبًا', l, fi, anchor);
                if (p.c.length <= 400) { let x = null; for (let i = 1; i < p.c.length && !x; i++) for (let j = i + 2; j < p.c.length && !x; j++) { if (i === 1 && j === p.c.length - 1) continue; x = segX(p.c[i - 1], p.c[i], p.c[j - 1], p.c[j]); } if (x) add('err', 'geom', 'المضلع بيقطع نفسه', l, fi, W(x)); }
              }
            });
          }
          if (role === 'line') mp.filter(p => p.t === 'L' && p.c.length >= 2).forEach(p => lines.push({ l, fi, c: p.c, z: (flat(g).find(x => x.t === 'L') || { c: [] }).c }));
          if (role === 'point') mp.filter(p => p.t === 'P').forEach(p => points.push({ l, fi, c: p.c[0] }));
        });
        /* --- duplicates within layer --- */
        if (on('geom')) { const seen = new Map(); l.features.forEach((f, fi) => { if (!f.wgs || !f.wgs.geometry) return; const k = JSON.stringify(f.wgs.geometry.coordinates, (kk, v) => typeof v === 'number' ? Math.round(v * 1e7) : v); if (seen.has(k)) add('err', 'geom', 'عنصر متكرر (نفس الشكل بالظبط)', l, fi, GV.firstCoord(f.wgs.geometry), 'مكرر مع عنصر #' + (seen.get(k) + 1), { p: pmeta(l, fi), dupOf: seen.get(k) }); else seen.set(k, fi); }); }
        /* --- attributes --- */
        if (on('attr')) { attrChecks(l, add, proj, KX, KY); ruleAttrChecks(l, add); }
        if (on('un')) unFields(l, role, add);
      }
      $('#busyText').textContent = 'بفحص الاتصال والطوبولوجي…'; await new Promise(r => setTimeout(r, 20));
      if ((on('topo') || on('un')) && (lines.length || points.length)) topology(lines, points, { snap, near, un: on('un'), topo: on('topo') }, add, W);
      if ((on('net') || on('netattr')) && GV.netQC) { $('#busyText').textContent = 'بفحص قواعد ' + (GV.NET_NAMES[$('#qcNet').value] || '') + '…'; await new Promise(r => setTimeout(r, 20)); try { GV.netQC({ sel, lines: on('net') ? lines : [], points: on('net') ? points : [], add, snap, near, net: $('#qcNet').value, attr: on('netattr') }); } catch (e) { console.error(e); GV.toast('قواعد الشبكة: ' + e.message); } }
      GV.store.set('gv_orgnet', $('#qcNet').value);
      const kept = issues.filter(i => !dropByRules(i)); GV.qcDropped = issues.length - kept.length;
      showResults(kept, sel);
    } catch (e) { GV.showMsg('حصلت مشكلة أثناء الفحص: ' + (e.message || e)); console.error(e); }
    finally { $('#busy').classList.remove('show'); }
  }

  /* ---------- rules (user-defined + answers to questions) ---------- */
  const RK = { midspan_ok: 'مسموح يكون في نص الخط (من غير vertex)', close_ok: 'مسموح النقط تكون قريبة من بعض', end_ok: 'الخط ممكن يخلص عنده (نهاية طبيعية)', dangle_ok: 'أطراف الخطوط الحرة طبيعية', cross_ok: 'التقاطع من غير نود مسموح', optional_field: 'الحقل اختياري', value_ok: 'القيمة صحيحة', length_ok: 'فرق الطول مقصود', isolated_ok: 'الأجزاء المنفصلة مقصودة', required: 'حقل إجباري', range: 'مدى القيم المسموح', domain: 'القيم المسموحة', ignore: 'تجاهل نوع مشكلة' };
  const TYPE_FIELDS = ['Block', 'FITTINGTYPE', 'VALVETYPE', 'JUNCTIONTYPE', 'DEVICETYPE', 'FITTING_TYPE', 'VALVE_TYPE', 'TYPE', 'ASSETTYPE', 'SUBTYPE', 'SUBTYPECODE', 'DESCRIPTION', 'DESC'];
  function pmeta(l, fi) { const pr = (l.features[fi] && l.features[fi].properties) || {}; const tf = TYPE_FIELDS.find(k => pr[k] != null && pr[k] !== ''); return { layer: l.name, props: pr, tf: tf || null, tv: tf ? String(pr[tf]) : null }; }
  let RULES = []; try { RULES = JSON.parse(GV.store.get('gv_qcrules') || '[]'); } catch (e) { RULES = []; }
  const saveRules = () => GV.store.set('gv_qcrules', JSON.stringify(RULES));
  function ruleHit(r, layerName, props) {
    if (r.off) return false;
    if (r.layer && r.layer !== '*' && r.layer !== layerName) return false;
    if (!r.value) return true;
    const v = String(r.value).toLowerCase();
    if (r.field && r.field !== '*') { const x = props ? props[r.field] : null; if (x == null) return false; return r.mode === 'contains' ? String(x).toLowerCase().indexOf(v) >= 0 : String(x).toLowerCase() === v; }
    const hay = [layerName].concat(Object.values(props || {}).filter(x => typeof x === 'string')).join(' ').toLowerCase();
    return v.split('|').some(t => t && hay.indexOf(t.trim()) >= 0);
  }
  function ruleMatch(kind, layerName, props) { return RULES.some(r => r.kind === kind && ruleHit(r, layerName, props)); }
  function dropByRules(i) {
    const m = i.meta || {}; const t = i.type;
    if (t === 'الجهاز في نص الخط مش على vertex' && m.p && ruleMatch('midspan_ok', m.p.layer, m.p.props)) return true;
    if ((t === 'نقطتين فوق بعض (تكرار)' || t === 'نقطتين من طبقات مختلفة فوق بعض') && m.p && m.q && ruleMatch('close_ok', m.p.layer, m.p.props) && ruleMatch('close_ok', m.q.layer, m.q.props)) return true;
    if (t === 'عنصر متكرر (نفس الشكل بالظبط)' && m.p && i.lref && i.lref.kind === 'point' && ruleMatch('close_ok', m.p.layer, m.p.props)) { const o = i.lref.features[m.dupOf]; if (o && JSON.stringify(o.properties) !== JSON.stringify(m.p.props)) return true; }
    if (t === 'طرف خط عند نقطة بس (نهاية شبكة)' && m.p && ruleMatch('end_ok', m.p.layer, m.p.props)) return true;
    const lp = i.lref && i.fi != null && i.lref.features[i.fi] ? i.lref.features[i.fi].properties : {};
    if (t === 'طرف حر (Dangle)' && ruleMatch('dangle_ok', i.layer, lp)) return true;
    if (t === 'خطين بيتقاطعوا من غير نقطة اتصال' && RULES.some(r => r.kind === 'cross_ok' && !r.off && ((r.layer === i.layer || r.layer === '*') && (!r.layer2 || r.layer2 === '*' || r.layer2 === m.l2) || (r.layer === m.l2 && (r.layer2 === i.layer || r.layer2 === '*'))))) return true;
    if (t === 'قيمة ناقصة' && RULES.some(r => r.kind === 'optional_field' && !r.off && (r.layer === '*' || r.layer === i.layer) && r.field === m.field)) return true;
    if (t === 'قيمة نادرة (ممكن تكون غلط)' && RULES.some(r => r.kind === 'value_ok' && !r.off && (r.layer === '*' || r.layer === i.layer) && r.field === m.field && String(r.value) === String(m.value))) return true;
    if (t === 'حقل الطول مختلف عن طول الخط' && ruleMatch('length_ok', i.layer, lp)) return true;
    if (t === 'جزء من الشبكة معزول عن الباقي' && ruleMatch('isolated_ok', i.layer, lp)) return true;
    if (RULES.some(r => r.kind === 'ignore' && !r.off && (r.layer === '*' || r.layer === i.layer) && r.issue === t)) return true;
    return false;
  }
  function ruleAttrChecks(l, add) {
    RULES.filter(r => !r.off && (r.layer === '*' || r.layer === l.name) && (r.kind === 'required' || r.kind === 'range' || r.kind === 'domain')).forEach(r => {
      const has = l.features.some(f => f.properties && r.field in f.properties); if (!has) { if (r.kind === 'required' && r.layer === l.name) add('err', 'attr', 'حقل إجباري مش موجود', l, null, null, 'الحقل ' + r.field + ' مش موجود في الطبقة'); return; }
      const allowed = r.kind === 'domain' ? String(r.value || '').split(/[,،]/).map(x => x.trim().toLowerCase()).filter(Boolean) : null;
      l.features.forEach((f, fi) => {
        const v = f.properties[r.field]; const a = f.wgs && f.wgs.geometry ? GV.firstCoord(f.wgs.geometry) : null;
        if (r.kind === 'required' && (v == null || String(v).trim() === '')) add('err', 'attr', 'حقل إجباري فاضي', l, fi, a, r.field, { field: r.field });
        if (r.kind === 'range' && v != null && v !== '') { const n = +v; if (!isFinite(n) || (r.min !== '' && r.min != null && n < +r.min) || (r.max !== '' && r.max != null && n > +r.max)) add('err', 'attr', 'قيمة برّه المدى المسموح', l, fi, a, r.field + ' = ' + v + ' (المسموح ' + (r.min ?? '') + ' – ' + (r.max ?? '') + ')', { field: r.field }); }
        if (r.kind === 'domain' && v != null && v !== '' && allowed.length && allowed.indexOf(String(v).trim().toLowerCase()) < 0) add('err', 'attr', 'قيمة مش من القيم المسموحة', l, fi, a, r.field + ' = "' + v + '"', { field: r.field, value: v });
      });
    });
  }
  GV.qcRuleMatch = ruleMatch;

  // ---- coded-value domains & subtypes (from the layer's own GDB, or from an opened template GDB with the same layer name) ----
  const normD = v => String(v == null ? '' : v).toLowerCase().replace(/[\s_\-.\/\\()]+/g, '');
  function domInfo(l) { if (l.domains || l.subtypes) return l; const t = GV.sources.flatMap(s => s.layers).find(x => x !== l && x.name.toLowerCase() === l.name.toLowerCase() && (x.domains || x.subtypes)); return t || null; }
  function domMatch(list, v) { // → {ok} | {code} | null
    const sv = String(v).trim(); if (list.some(c => String(c.code) === sv || (typeof c.code === 'number' && sv !== '' && +sv === c.code))) return { ok: true };
    const n = normD(sv); let h = list.find(c => normD(c.name) === n) || list.find(c => normD(c.code) === n); if (h) return { code: h.code, name: h.name };
    const dg = (sv.match(/\d+(?:\.\d+)?/) || [])[0]; if (dg && /^\D*\d+(\.\d+)?\s*(mm|مم|m)?\s*\D*$/i.test(sv)) { h = list.find(c => String(c.code) === String(+dg) || normD(c.name) === String(+dg)); if (h) return { code: h.code, name: h.name }; }
    return null; }
  function domainIssues(l, add, anchor) {
    const D = domInfo(l); if (!D) return; const defs = D.domainDefs || {}; const jobs = [];
    if (D.subtypes) jobs.push({ field: D.subtypes.field, list: D.subtypes.list.map(x => ({ code: x.code, name: x.name })), dn: 'Subtype' });
    Object.keys(D.domains || {}).forEach(f => { const dd = defs[D.domains[f]]; if (dd && dd.codes && dd.codes.length) jobs.push({ field: f, list: dd.codes, dn: dd.name }); });
    jobs.forEach(j => { const fk = Object.keys((l.features[0] || {}).properties || {}).find(k => k.toLowerCase() === j.field.toLowerCase()) || j.field; let c1 = 0, c2 = 0;
      l.features.forEach((f, fi) => { const v = (f.properties || {})[fk]; if (v == null || String(v).trim() === '') return; const m = domMatch(j.list, v); if (m && m.ok) return;
        if (m) { if (c1++ < 300) add('warn', 'attr', j.dn === 'Subtype' ? 'قيمة مكتوبة كنص بدل كود الـ Subtype' : 'قيمة مكتوبة كنص بدل كود الدومين', l, fi, anchor(fi), fk + ' = "' + v + '" ← الكود ' + m.code + ' (' + m.name + ')', { field: fk, value: v }); }
        else if (c2++ < 300) add('err', 'attr', j.dn === 'Subtype' ? 'قيمة مش من الـ Subtypes' : 'قيمة مش موجودة في الدومين', l, fi, anchor(fi), fk + ' = "' + v + '" — المسموح (' + j.dn + '): ' + j.list.slice(0, 12).map(x => x.code + '=' + x.name).join('، ') + (j.list.length > 12 ? '…' : ''), { field: fk, value: v }); }); });
  }
  // convert every value that is written as text but matches a domain / subtype entry into its code (undo kept)
  GV.domainConvert = layers => { let n = 0; const undo = []; (layers || GV.sources.flatMap(s => s.layers)).forEach(l => { const D = domInfo(l); if (!D) return; const defs = D.domainDefs || {}; const jobs = []; if (D.subtypes) jobs.push({ field: D.subtypes.field, list: D.subtypes.list }); Object.keys(D.domains || {}).forEach(f => { const dd = defs[D.domains[f]]; if (dd && dd.codes) jobs.push({ field: f, list: dd.codes }); });
      jobs.forEach(j => l.features.forEach(f => { const pr = f.properties || {}; const fk = Object.keys(pr).find(k => k.toLowerCase() === j.field.toLowerCase()); if (!fk) return; const v = pr[fk]; if (v == null || String(v).trim() === '') return; const m = domMatch(j.list, v); if (m && !m.ok) { undo.push({ l, f, pr, fk, v }); pr[fk] = m.code; n++; } })); });
    GV.domainUndo = undo; if (GV.onDirty) GV.onDirty(); return n; };
  // values that match nothing in the domain (a district name, a hand-typed diameter…) become NEW entries of that domain,
  // and the features get the new code. New entries are logged (GV.domainAdded) so they can be added to the delivery GDB.
  GV.domainAddNew = layers => { let n = 0; const undo = []; const added = GV.domainAdded = GV.domainAdded || [];
    (layers || GV.sources.flatMap(s => s.layers)).forEach(l => { const D = domInfo(l); if (!D) return; const defs = D.domainDefs || {}; const jobs = [];
      if (D.subtypes) jobs.push({ field: D.subtypes.field, list: D.subtypes.list, dn: 'Subtype' });
      Object.keys(D.domains || {}).forEach(f => { const dd = defs[D.domains[f]]; if (dd && dd.codes) jobs.push({ field: f, list: dd.codes, dn: dd.name }); });
      jobs.forEach(j => {
        const numCodes = j.list.length && j.list.every(c => typeof c.code === 'number' || /^-?\d+$/.test(String(c.code)));
        const sameAsName = numCodes && j.list.filter(c => String(+c.code) === String(parseFloat(c.name))).length >= j.list.length / 2; // diameter-like: code = value
        l.features.forEach(f => { const pr = f.properties || {}; const fk = Object.keys(pr).find(k => k.toLowerCase() === j.field.toLowerCase()); if (!fk) return; const v = pr[fk]; if (v == null || String(v).trim() === '') return;
          let m = domMatch(j.list, v); if (m && m.ok) return;
          if (!m) { const txt = String(v).trim(); let code;
            if (sameAsName && (txt.match(/\d+(?:\.\d+)?/) || [])[0]) code = +(txt.match(/\d+(?:\.\d+)?/) || [])[0];
            else if (numCodes) code = Math.max(0, ...j.list.map(c => +c.code)) + 1; else code = txt;
            const name = sameAsName ? String(code) : txt; j.list.push({ code, name }); added.push({ layer: l.name, field: fk, domain: j.dn, code, name }); m = { code }; }
          undo.push({ l, f, pr, fk, v }); pr[fk] = m.code; n++; }); }); });
    GV.domainUndo = undo; if (GV.onDirty) GV.onDirty(); return n; };
  GV.domInfoOf = domInfo;
  GV.domainSample = title => GV.editSample && GV.editSample(title, (GV.domainUndo || []).map(u => ({ l: u.l, f: u.f, before: { [u.fk]: u.v }, after: { [u.fk]: u.pr[u.fk] } })), () => GV.domainUndoFn());
  GV.domainUndoFn = () => { (GV.domainUndo || []).forEach(u => { u.pr[u.fk] = u.v; }); const n = (GV.domainUndo || []).length; GV.domainUndo = null; return n; };
  function attrChecks(l, add, proj, KX, KY) {
    const fields = GV.fieldsOf(l).filter(k => !/^(objectid|fid|oid|shape|shape_length|shape_area|globalid|Text|Rotation|Height|Entity|Color|Layer|Block)$/i.test(k));
    const n = l.features.length; if (!n) return;
    const anchor = fi => { const f = l.features[fi]; return f.wgs && f.wgs.geometry ? GV.firstCoord(f.wgs.geometry) : null; };
    try { domainIssues(l, add, anchor); } catch (e) { console.error('domains', e); }
    fields.forEach(k => {
      const vals = l.features.map(f => f.properties ? f.properties[k] : null);
      const filled = vals.filter(v => v != null && String(v).trim() !== '');
      if (!filled.length) { add('info', 'attr', 'حقل فاضي بالكامل', l, null, null, 'الحقل ' + k + ' مفيهوش ولا قيمة'); return; }
      const rate = filled.length / n;
      if (rate >= 0.7 && rate < 1) { let c = 0; vals.forEach((v, fi) => { if ((v == null || String(v).trim() === '') && c++ < 300) add('warn', 'attr', 'قيمة ناقصة', l, fi, anchor(fi), 'الحقل ' + k + ' فاضي (' + Math.round(rate * 100) + '% من العناصر متعبية)', { field: k }); }); }
      // duplicate IDs
      if (/(^|_)(id|no|num|number|serial|serialnumber|asset_?id|facility_?id|code|tag)$/i.test(k) || /^(serialnumber|facilityid|assetid)$/i.test(k)) {
        const cnt = new Map(); filled.forEach(v => { const s = String(v).trim(); cnt.set(s, (cnt.get(s) || 0) + 1); });
        if (cnt.size / filled.length > 0.9) vals.forEach((v, fi) => { if (v != null && cnt.get(String(v).trim()) > 1) add('err', 'attr', 'رقم/كود متكرر', l, fi, anchor(fi), k + ' = ' + v + ' متكرر ' + cnt.get(String(v).trim()) + ' مرات'); });
      }
      // numeric outliers
      const nums = filled.filter(v => typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v).trim())).map(Number);
      if (nums.length >= 20 && nums.length / filled.length > 0.9 && !/(id|no|num|serial|code|x|y|east|north|lat|lon)/i.test(k)) {
        const m = median(nums), mad = median(nums.map(v => Math.abs(v - m))) || 0;
        if (mad > 0) vals.forEach((v, fi) => { if (v == null || v === '') return; const x = +v; if (isFinite(x) && Math.abs(x - m) > 10 * mad && Math.abs(x - m) > Math.abs(m) * 0.5) add('warn', 'attr', 'قيمة شاذة', l, fi, anchor(fi), k + ' = ' + v + ' (المعتاد حوالين ' + m + ')'); });
        if (/(dia|قطر|size)/i.test(k)) vals.forEach((v, fi) => { if (v != null && v !== '' && +v <= 0) add('err', 'attr', 'قطر صفر أو سالب', l, fi, anchor(fi), k + ' = ' + v); });
      }
      // text variants (case / spaces)
      const strs = filled.filter(v => typeof v === 'string');
      if (strs.length > 5) {
        const byNorm = new Map(); strs.forEach(s => { const nk = s.trim().toLowerCase().replace(/\s+/g, ' '); if (!byNorm.has(nk)) byNorm.set(nk, new Set()); byNorm.get(nk).add(s); });
        const bad = new Set(); byNorm.forEach(set => { if (set.size > 1) { const arr = Array.from(set); const main = arr.sort((a, b) => strs.filter(x => x === b).length - strs.filter(x => x === a).length)[0]; arr.forEach(x => { if (x !== main) bad.add(x); }); } });
        let c = 0; vals.forEach((v, fi) => { if (typeof v === 'string' && (bad.has(v) || (v !== v.trim())) && c++ < 300) add('warn', 'attr', 'نفس القيمة مكتوبة بأشكال مختلفة', l, fi, anchor(fi), k + ' = "' + v + '"'); });
        const uniq = new Map(); strs.forEach(s => uniq.set(s, (uniq.get(s) || 0) + 1));
        if (uniq.size >= 3 && uniq.size <= 15 && strs.length >= 50) vals.forEach((v, fi) => { if (typeof v === 'string' && uniq.get(v) === 1) add('info', 'attr', 'قيمة نادرة (ممكن تكون غلط)', l, fi, anchor(fi), k + ' = "' + v + '" ظهرت مرة واحدة بس', { field: k, value: v }); });
      }
      // length fields vs geometry
      if (/^(length|len|actual_?length|shape_?len|pipe_?length|طول)/i.test(k) && l.kind === 'line') {
        l.features.forEach((f, fi) => {
          const v = f.properties[k]; if (v == null || v === '' || !f.geometry) return;
          let geo;
          if (proj) { geo = 0; const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []; ls.forEach(c => { for (let i = 1; i < c.length; i++) geo += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); }); }
          else if (f.wgs) geo = GV.lineLen(f.wgs.geometry);
          if (geo != null && Math.abs(+v - geo) > 0.05) add('warn', 'attr', 'حقل الطول مختلف عن طول الخط', l, fi, anchor(fi), k + ' = ' + (+v).toFixed(2) + ' والطول الحقيقي ' + geo.toFixed(2) + ' (فرق ' + Math.abs(+v - geo).toFixed(2) + ' م)');
        });
      }
    });
  }
  function unFields(l, role, add) {
    if (role === 'skip' || role === 'poly') return;
    const f = GV.fieldsOf(l).map(k => k.toLowerCase());
    const ag = f.find(k => /^(assetgroup|asset_group|subtype|subtypecode)$/.test(k)), at = f.find(k => /^(assettype|asset_type)$/.test(k));
    if (!ag) add('warn', 'un', 'مفيش حقل ASSETGROUP', l, null, null, 'الـ Utility Network محتاج Asset Group لكل عنصر (ممكن يتعمله Mapping وقت التحميل).');
    if (!at) add('warn', 'un', 'مفيش حقل ASSETTYPE', l, null, null, 'الـ Utility Network محتاج Asset Type لكل عنصر.');
    const realAG = GV.fieldsOf(l).find(k => k.toLowerCase() === ag), realAT = GV.fieldsOf(l).find(k => k.toLowerCase() === at);
    [realAG, realAT].filter(Boolean).forEach(k => { let c = 0; l.features.forEach((ft, fi) => { const v = ft.properties[k]; if ((v == null || v === '') && c++ < 300) add('err', 'un', 'قيمة ' + k + ' فاضية', l, fi, ft.wgs && ft.wgs.geometry ? GV.firstCoord(ft.wgs.geometry) : null); }); });
    const hasZ = l.features.slice(0, 200).some(ft => { const c = ft.geometry && GV.firstCoord(ft.geometry); return c && c.length > 2; });
    if (!hasZ) add('info', 'un', 'الطبقة 2D (مفيش Z)', l, null, null, 'الـ Utility Network غالبًا Z-enabled. هتحتاج تضيف Z (حتى لو صفر) قبل التحميل.');
  }

  function topology(lines, points, o, add, W) {
    const cell = Math.max(o.near * 2, 2);
    const segG = new Grid(cell), segs = [];
    lines.forEach((ln, li) => { for (let i = 1; i < ln.c.length; i++) { const a = ln.c[i - 1], b = ln.c[i]; segs.push({ li, i, a, b }); segG.add(a[0] - o.near, a[1] - o.near, b[0] + o.near, b[1] + o.near, segs.length - 1); segG.add(b[0] - o.near, b[1] - o.near, a[0] + o.near, a[1] + o.near, segs.length - 1); } });
    const ptG = new Grid(cell); points.forEach((p, pi) => ptG.add(p.c[0], p.c[1], p.c[0], p.c[1], pi));
    const epG = new Grid(cell); const eps = [];
    lines.forEach((ln, li) => { [0, ln.c.length - 1].forEach(k => { eps.push({ li, k, c: ln.c[k] }); epG.add(ln.c[k][0], ln.c[k][1], ln.c[k][0], ln.c[k][1], eps.length - 1); }); });
    // union-find
    const par = lines.map((_, i) => i); const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }; const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const ptLine = new Map(); // point -> line idx
    const lineLabel = ln => ln.l.name + ' #' + (ln.fi + 1);
    // endpoints
    eps.forEach((e, ei) => {
      const ln = lines[e.li]; let connected = false, atPoint = false, midspan = null, nearD = Infinity;
      epG.near(e.c[0], e.c[1], o.near).forEach(oj => { const f = eps[oj]; if (f.li === e.li && f.k === e.k) return; const d = Math.hypot(f.c[0] - e.c[0], f.c[1] - e.c[1]); if (f.li === e.li) { if (d <= o.snap && lines[e.li].c.length > 2) connected = connected; return; } if (d <= o.snap) { connected = true; uni(e.li, f.li); } else if (d < nearD) nearD = d; });
      let atP = null; ptG.near(e.c[0], e.c[1], o.snap).forEach(pi => { const p = points[pi]; if (Math.hypot(p.c[0] - e.c[0], p.c[1] - e.c[1]) <= o.snap) { atPoint = true; atP = p; } });
      segG.near(e.c[0], e.c[1], o.near).forEach(si => { const s = segs[si]; if (s.li === e.li) return; const [d, t] = segDist(e.c[0], e.c[1], s.a[0], s.a[1], s.b[0], s.b[1]); if (d <= o.snap) { if (t > 1e-6 && t < 1 - 1e-6 && !(s.i === 1 && t < 1e-6) && !(s.i === lines[s.li].c.length - 1 && t > 1 - 1e-6)) midspan = midspan || s; connected = true; uni(e.li, s.li); } else if (d < nearD) nearD = d; });
      e.free = !connected && !atPoint;
      // a branch (lateral / service) meets the main only through a connection point (junction / saddle / tee / IC)
      { const isLat = l2 => /(lateral|later|serv|\bhc\b|house|conn|توصيل|وصل)/i.test(l2.name); if (connected && !atPoint && isLat(ln.l)) { let toMain = null; segG.near(e.c[0], e.c[1], o.snap).forEach(si => { const s2 = segs[si]; if (s2.li !== e.li && !isLat(lines[s2.li].l) && segDist(e.c[0], e.c[1], s2.a[0], s2.a[1], s2.b[0], s2.b[1])[0] <= o.snap) toMain = lines[s2.li]; }); if (toMain) add('err', 'topo', 'الوصلة متوصلة بالخط الرئيسي من غير نقطة اتصال', ln.l, ln.fi, W(e.c), 'على ' + lineLabel(toMain) + ' — لازم Junction/Saddle/Tee في نقطة الاتصال'); } }
      if (midspan) add('warn', 'topo', 'طرف خط متوصل في نص خط تاني من غير vertex', ln.l, ln.fi, W(e.c), 'متوصل بـ ' + lineLabel(lines[midspan.li]) + '. الـ Utility Network محتاج vertex في نقطة الاتصال.');
      if (!connected && o.topo) {
        if (atPoint) add('info', 'topo', 'طرف خط عند نقطة بس (نهاية شبكة)', ln.l, ln.fi, W(e.c), 'مقبول لو النقطة Cap أو نهاية. غير كده اتأكد.', { p: pmeta(atP.l, atP.fi) });
        else if (nearD < o.near) add('err', 'topo', 'طرف خط مش متوصل وقريب من خط تاني', ln.l, ln.fi, W(e.c), 'بعيد ' + (nearD * 100).toFixed(1) + ' سم (Undershoot/Overshoot)');
        else { // sewer only: the house connection leaves the IC / house clean-out and runs toward the plot — its far end is free by design
          const oc = e.k === 0 ? ln.c[ln.c.length - 1] : ln.c[0]; const sewerNet = (($('#qcNet') || {}).value === 'sewer') || /^(ww|ss|sew|sswr)[_-]/i.test(ln.l.name) || /C-SSWR/i.test(ln.l.name); const lat = sewerNet && /(lateral|later|serv|\bhc\b|house|conn|توصيل|وصل)/i.test(ln.l.name);
          const atStruct = lat && Array.from(ptG.near(oc[0], oc[1], Math.max(o.snap, 0.05))).some(pi => Math.hypot(points[pi].c[0] - oc[0], points[pi].c[1] - oc[1]) <= Math.max(o.snap, 0.05));
          const nearHouse = lat && Array.from(ptG.near(e.c[0], e.c[1], Math.max(o.snap, 0.05))).length;
          if (!atStruct && !nearHouse) add('warn', 'topo', 'طرف حر (Dangle)', ln.l, ln.fi, W(e.c)); }
      }
    });
    // points on lines
    points.forEach((p, pi) => {
      let best = Infinity, bs = null, bt = 0;
      segG.near(p.c[0], p.c[1], o.near).forEach(si => { const s = segs[si]; const [d, t] = segDist(p.c[0], p.c[1], s.a[0], s.a[1], s.b[0], s.b[1]); if (d < best) { best = d; bs = s; bt = t; } });
      if (best <= o.snap) {
        uni(bs.li, bs.li); ptLine.set(pi, bs.li);
        { const ln = lines[bs.li]; const nearV = ln.c.some(c => Math.hypot(c[0] - p.c[0], c[1] - p.c[1]) <= o.snap); if (!nearV) add('warn', 'topo', 'الجهاز في نص الخط مش على vertex', p.l, p.fi, W(p.c), 'على ' + lineLabel(ln) + '. الـ Utility Network محتاج الجهاز على رأس (vertex) أو طرف.', { p: pmeta(p.l, p.fi) }); }
      } else if (o.topo) {
        if (best < o.near) add('err', 'topo', 'نقطة قريبة من الخط بس مش عليه', p.l, p.fi, W(p.c), 'بعيدة ' + (best * 100).toFixed(1) + ' سم');
        else if (lines.length) add('warn', 'topo', 'نقطة معزولة عن الشبكة', p.l, p.fi, W(p.c));
      }
      if (o.topo) ptG.near(p.c[0], p.c[1], o.snap).forEach(pj => { if (pj > pi) { const q = points[pj]; if (Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]) <= o.snap) add(q.l === p.l ? 'err' : 'info', 'topo', q.l === p.l ? 'نقطتين فوق بعض (تكرار)' : 'نقطتين من طبقات مختلفة فوق بعض', p.l, p.fi, W(p.c), 'مع ' + q.l.name + ' #' + (q.fi + 1), { p: pmeta(p.l, p.fi), q: pmeta(q.l, q.fi) }); } });
    });
    // overlaps & crossings
    if (o.topo || o.un) {
      const segKey = s => { const r = v => Math.round(v * 1000); const a = r(s.a[0]) + ',' + r(s.a[1]), b = r(s.b[0]) + ',' + r(s.b[1]); return a < b ? a + '|' + b : b + '|' + a; };
      const seen = new Map(); const reported = new Set();
      segs.forEach(s => { const k = segKey(s); if (seen.has(k) && seen.get(k).li !== s.li) { const pr = [seen.get(k).li, s.li].sort().join('-'); if (!reported.has(pr)) { reported.add(pr); const ln = lines[s.li]; add('err', o.un ? 'un' : 'topo', 'خطين فوق بعض (Overlap)', ln.l, ln.fi, W([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]), 'مع ' + lineLabel(lines[seen.get(k).li])); } } else seen.set(k, s); });
      let xc = 0; const done = new Set();
      segs.forEach((s, si) => { if (xc > 3000) return; segG.near((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 2 + 0.01).forEach(sj => { if (sj <= si) return; const t = segs[sj]; if (t.li === s.li) return; const pr = s.li < t.li ? s.li + '-' + t.li : t.li + '-' + s.li; if (done.has(pr)) return; const x = segX(s.a, s.b, t.a, t.b); if (x) { done.add(pr); xc++; const ln = lines[s.li]; add('warn', 'topo', 'خطين بيتقاطعوا من غير نقطة اتصال', ln.l, ln.fi, W(x), 'مع ' + lineLabel(lines[t.li]) + '. لو المفروض يتوصلوا لازم نود، لو عدّايين فوق بعض (أعماق مختلفة) سيبهم.', { l2: lines[t.li].l.name }); } }); });
    }
    // a line touching nothing at either end is floating on its own
    if (o.topo) { const fr = new Map(); eps.forEach(e => { if (e.free) fr.set(e.li, (fr.get(e.li) || 0) + 1); }); fr.forEach((n, li) => { if (n >= 2) { const ln = lines[li]; add('err', 'topo', 'خط مش متوصل بأي حاجة (الطرفين سايبين)', ln.l, ln.fi, W(ln.c[0])); } }); }
    // components
    if (lines.length && (o.topo || o.un)) {
      const comp = new Map(); lines.forEach((ln, i) => { const r = find(i); let len = 0; for (let k = 1; k < ln.c.length; k++) len += Math.hypot(ln.c[k][0] - ln.c[k - 1][0], ln.c[k][1] - ln.c[k - 1][1]); const c = comp.get(r) || { len: 0, n: 0, first: i }; c.len += len; c.n++; comp.set(r, c); });
      const arr = Array.from(comp.entries()).sort((a, b) => b[1].len - a[1].len);
      const mainLen = arr.length ? arr[0][1].len : 0;
      GV.qcComponents = arr.length;
      arr.slice(1).forEach(([r, c]) => { if (c.len < mainLen * 0.05) { const ln = lines[c.first]; add('warn', 'topo', 'جزء من الشبكة معزول عن الباقي', ln.l, ln.fi, W(ln.c[0]), c.n + ' خط بطول ' + c.len.toFixed(1) + ' م مش متوصلين بالشبكة الرئيسية'); } });
      if (o.un) {
        const srcRe = /(tank|reservoir|pump|station|source|plant|substation|feeder|خزان|محطة|طلمبة|مصدر)/i;
        const compHasSrc = new Set(); points.forEach((p, pi) => { if (!ptLine.has(pi)) return; const props = p.l.features[p.fi].properties || {}; if (srcRe.test(p.l.name) || Object.values(props).some(v => typeof v === 'string' && srcRe.test(v))) compHasSrc.add(find(ptLine.get(pi))); });
        if (!compHasSrc.size) add('info', 'un', 'مفيش مصدر (Subnetwork Controller) في الشبكة', null, null, null, 'الـ Utility Network محتاج مصدر لكل Subnetwork (خزان، محطة، طلمبة…). لو المصدر في طبقة تانية ضيفها للفحص.');
        else arr.forEach(([r, c]) => { if (!compHasSrc.has(r) && c.len > mainLen * 0.05) { const ln = lines[c.first]; add('warn', 'un', 'جزء من الشبكة من غير مصدر', ln.l, ln.fi, W(ln.c[0]), c.n + ' خط'); } });
      }
    }
  }

  /* ---------- results ---------- */
  function showResults(issues, sel) {
    let src = GV.sources.find(s => s.id === 'qc'); if (src) GV.removeSource(src);
    const feats = issues.map((is, i) => {
      const fo = is.lref && is.fi != null ? (is.lref.features[is.fi] || {}).properties || {} : {}; const oid = fo.OBJECTID != null ? fo.OBJECTID : fo.objectid != null ? fo.objectid : fo.FID; const f = { type: 'Feature', properties: { 'ID': i + 1, 'الخطورة': SEV[is.sev][0], 'الفئة': CATS[is.cat], 'المشكلة': is.type, 'الطبقة': is.layer, 'العنصر': is.fi != null ? is.fi + 1 : '', 'OBJECTID': oid != null ? oid : '', 'التفاصيل': is.detail, 'الحالة': 'جديد', 'X': is.ll ? +is.ll[0].toFixed(7) : '', 'Y': is.ll ? +is.ll[1].toFixed(7) : '' }, geometry: is.ll ? { type: 'Point', coordinates: is.ll } : null, _sev: is.sev, _is: is };
      f._extra = box => { if (is.lref && is.fi != null) { const b = el('button', 'chip', 'روح للعنصر الأصلي'); b.onclick = () => { GV.closeSheets(); const ft = is.lref.features[is.fi]; if (ft && ft.wgs) { const bb = L.geoJSON(ft.wgs).getBounds(); GV.map.fitBounds(bb, { maxZoom: 20, padding: [80, 80] }); GV.showFeature(is.lref, is.fi); } }; box.appendChild(b); } };
      return f;
    });
    GV.qcLast = { issues, at: new Date(), layers: sel.map(x => x.l.name), cfg: { sel, snap: +$('#qcSnap').value || 0.01, near: +$('#qcNear').value || 1, un: $('#qc_un').checked } };
    if (feats.some(f => f.geometry)) {
      GV.addGroups([{ name: 'نتائج الفحص', type: 'QC', layers: [{ name: 'مشاكل الداتا', features: feats, crs: '4326', color: '#e03131' }] }], { quiet: true }).then(added => {
        const s = added[0]; if (!s) return; s.id = 'qc'; const l = s.layers[0];
        l.theme = { field: 'الخطورة', fn: f => SEV[f._sev][1], classes: Object.keys(SEV).map(k => ({ label: SEV[k][0], color: SEV[k][1], count: issues.filter(i => i.sev === k).length })).filter(c => c.count) };
        if (l.leaf) { GV.map.removeLayer(l.leaf); l.leaf = GV.buildLeaf(l); l.leaf.addTo(GV.map); }
        GV.qcLayer = l; GV.renderLayers();
      });
    }
    renderSummary(issues);
    GV.openSheet('#qcResSheet');
  }
  /* ---------- smart summary: questions + root-cause problems ---------- */
  let NO = new Set(); try { NO = new Set(JSON.parse(GV.store.get('gv_qcno') || '[]')); } catch (e) { }
  const lbl = m => m && m.tv ? (m.tf === 'Block' ? 'البلوك ' : m.tf + ' = ') + m.tv : (m ? 'عناصر ' + m.layer : '');
  function questions(issues) {
    const Q = new Map();
    const put = (key, q, i) => { if (NO.has(key)) return; if (!Q.has(key)) Q.set(key, Object.assign({ key, items: [] }, q)); Q.get(key).items.push(i); };
    issues.forEach(i => {
      const m = i.meta || {};
      switch (i.type) {
        case 'الجهاز في نص الخط مش على vertex': if (m.p) put('mid|' + m.p.layer + '|' + m.p.tv, { rule: { kind: 'midspan_ok', layer: m.p.layer, field: m.p.tf || '*', value: m.p.tv || '', mode: 'equals' }, text: n => 'لقيت ' + n + ' من ' + lbl(m.p) + ' في نص الماسورة من غير ما الماسورة تتقسم عندها. ده طبيعي للنوع ده (زي السادل)؟' }, i); break;
        case 'نقطتين فوق بعض (تكرار)': case 'نقطتين من طبقات مختلفة فوق بعض': if (m.p) put('close|' + m.p.layer + '|' + m.p.tv, { rule: { kind: 'close_ok', layer: m.p.layer, field: m.p.tf || '*', value: m.p.tv || '', mode: 'equals' }, text: n => n + ' حالة فيها نقطتين من ' + lbl(m.p) + ' قريبين جدًا من بعض. ده طبيعي (زي سادلين جنب بعض) ومش تكرار؟' }, i); break;
        case 'طرف خط عند نقطة بس (نهاية شبكة)': if (m.p) put('end|' + m.p.layer + '|' + m.p.tv, { rule: { kind: 'end_ok', layer: m.p.layer, field: m.p.tf || '*', value: m.p.tv || '', mode: 'equals' }, text: n => n + ' خط بيخلص عند ' + lbl(m.p) + '. ده نهاية طبيعية للشبكة (زي Cap أو End)؟' }, i); break;
        case 'طرف حر (Dangle)': put('dang|' + i.layer, { min: 3, rule: { kind: 'dangle_ok', layer: i.layer }, text: n => 'في ' + i.layer + ' فيه ' + n + ' طرف حر مش متوصل بحاجة. أطراف الطبقة دي بتخلص كده عادي (زي وصلات المنازل)؟' }, i); break;
        case 'خطين بيتقاطعوا من غير نقطة اتصال': { const pr = [i.layer, m.l2 || ''].sort(); put('cross|' + pr.join('|'), { rule: { kind: 'cross_ok', layer: pr[0], layer2: pr[1] }, text: n => n + ' تقاطع بين ' + pr[0] + (pr[1] !== pr[0] ? ' و ' + pr[1] : '') + ' من غير نود. دول خطوط عدّاية فوق بعض ومش المفروض يتوصلوا؟' }, i); break; }
        case 'قيمة ناقصة': if (m.field) put('opt|' + i.layer + '|' + m.field, { min: 5, rule: { kind: 'optional_field', layer: i.layer, field: m.field }, text: n => 'الحقل ' + m.field + ' فاضي في ' + n + ' عنصر بس من ' + (i.lref ? i.lref.features.length.toLocaleString('en') : '') + ' في ' + i.layer + ' (الباقي متعبي — دوس "الجدول" تشوف الفاضيين بس). الحقل ده اختياري؟' }, i); break;
        case 'قيمة نادرة (ممكن تكون غلط)': if (m.field) put('val|' + i.layer + '|' + m.field + '|' + m.value, { rule: { kind: 'value_ok', layer: i.layer, field: m.field, value: String(m.value) }, text: () => 'القيمة "' + m.value + '" في الحقل ' + m.field + ' (' + i.layer + ') ظهرت مرة واحدة بس. القيمة دي صح؟' }, i); break;
        case 'حقل الطول مختلف عن طول الخط': put('len|' + i.layer, { min: 3, rule: { kind: 'length_ok', layer: i.layer }, text: n => 'حقل الطول مختلف عن طول الخط في ' + n + ' عنصر من ' + i.layer + '. ده مقصود (الطول المسلّم مش من الرسم)؟' }, i); break;
        case 'جزء من الشبكة معزول عن الباقي': put('iso|' + i.layer, { rule: { kind: 'isolated_ok', layer: i.layer }, text: n => n + ' جزء من ' + i.layer + ' منفصل عن الشبكة الرئيسية. دي شبكات منفصلة مقصودة؟' }, i); break;
      }
    });
    return Array.from(Q.values()).filter(q => q.items.length >= (q.min || 1)).sort((a, b) => b.items.length - a.items.length).slice(0, 15);
  }
  const ROOT = ['طرف خط مش متوصل وقريب من خط تاني', 'نقطة قريبة من الخط بس مش عليه', 'خطين فوق بعض (Overlap)', 'عنصر متكرر (نفس الشكل بالظبط)', 'خط طوله صفر', 'طرف خط متوصل في نص خط تاني من غير vertex', 'الجهاز في نص الخط مش على vertex', 'خطين بيتقاطعوا من غير نقطة اتصال', 'نقطتين فوق بعض (تكرار)', 'طرف حر (Dangle)', 'جزء من الشبكة معزول عن الباقي'];
  const HINT = {
    'طرف حر (Dangle)': 'لما أغلب أطراف الطبقة حرة، غالبًا الطبقة نفسها مش مرسومة كشبكة متوصلة، أو دورها في الفحص غلط (نقط بدل خطوط)، أو اترسمت بنظام إحداثيات مختلف عن باقي الشبكة.',
    'قيمة ناقصة': 'الحقل مش متعبّي بشكل منهجي. غالبًا البيانات دي متجمعتش أو الحقل اختياري.',
    'حقل الطول مختلف عن طول الخط': 'الفرق موجود في أغلب العناصر، فغالبًا الطول محسوب بطريقة تانية (3D، أو نظام إحداثيات تاني، أو من الطبيعة).',
    'حقول الإحداثيات مختلفة عن مكان النقطة': 'غالبًا حقول X/Y اتحسبت بنظام إحداثيات تاني أو قبل تحريك الداتا.',
    'الجهاز في نص الخط مش على vertex': 'ده نمط ثابت للنوع ده، فممكن يكون طبيعي (زي السادل). جاوب على السؤال فوق.',
    'نقطة معزولة عن الشبكة': 'أغلب نقط الطبقة مش على الخطوط، فغالبًا الطبقة مش جزء من الشبكة (أو دورها في الفحص غلط).',
    'منسوب Z برّه النطاق المنطقي': 'غالبًا Z متسجل بوحدة تانية أو فيه قيمة افتراضية زي -9999.'
  };
  function problems(issues) {
    const locCats = new Set(['topo', 'un', 'geom', 'coord']);
    const cell = 2; const grid = new Map(); const cl = [];
    const lat0 = issues.find(i => i.ll) ? issues.find(i => i.ll).ll[1] : 0; const KX = Math.cos(lat0 * Math.PI / 180) * 111320, KY = 110540;
    issues.forEach(i => {
      if (!i.ll || !locCats.has(i.cat)) { cl.push({ items: [i] }); return; }
      const x = i.ll[0] * KX, y = i.ll[1] * KY; const ci = Math.floor(x / cell), cj = Math.floor(y / cell); let hit = null;
      for (let a = ci - 1; a <= ci + 1 && !hit; a++) for (let b = cj - 1; b <= cj + 1 && !hit; b++) (grid.get(a + ',' + b) || []).forEach(c => { if (!hit && Math.hypot(c.x - x, c.y - y) <= cell) hit = c; });
      if (hit) hit.items.push(i); else { const c = { x, y, items: [i] }; cl.push(c); const k = ci + ',' + cj; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
    });
    const P = new Map();
    cl.forEach(c => {
      const root = c.items.slice().sort((a, b) => { const ra = ROOT.indexOf(a.type), rb = ROOT.indexOf(b.type); return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || ({ err: 0, warn: 1, info: 2 }[a.sev] - { err: 0, warn: 1, info: 2 }[b.sev]); })[0];
      const fld = root.meta && root.meta.field ? '|' + root.meta.field : '';
      const key = root.type + '|' + root.layer + fld;
      if (!P.has(key)) P.set(key, { key, title: root.type + (fld ? ' (' + root.meta.field + ')' : ''), type: root.type, sev: root.sev, cat: root.cat, layer: root.layer, lref: root.lref, n: 0, items: [], related: new Map() });
      const p = P.get(key); p.n++; p.items.push(root); if (root.sev === 'err') p.sev = 'err';
      c.items.forEach(i => { if (i !== root && i.type !== root.type) p.related.set(i.type, (p.related.get(i.type) || 0) + 1); });
    });
    const out = Array.from(P.values());
    out.forEach(p => { const tot = p.lref ? p.lref.features.length : 0; p.share = tot ? p.n / tot : 0; p.systematic = p.n >= 20 && p.share >= 0.5; if (p.systematic) p.hint = HINT[p.type] || 'المشكلة دي في أغلب عناصر الطبقة، فغالبًا سببها واحد في الطبقة كلها مش في كل عنصر لوحده.'; });
    const sw = { err: 0, warn: 1, info: 2 };
    return out.sort((a, b) => (b.systematic - a.systematic) || sw[a.sev] - sw[b.sev] || b.n - a.n);
  }
  function answer(q, yes) {
    if (yes) { RULES.push(Object.assign({ id: Date.now().toString(36), at: new Date().toISOString(), from: 'سؤال' }, q.rule)); saveRules(); }
    else { NO.add(q.key); GV.store.set('gv_qcno', JSON.stringify(Array.from(NO))); q.items.forEach(i => { i.sev = 'err'; i.confirmed = true; }); }
    const sc = $('#qcResBody'); const st0 = sc ? sc.scrollTop : 0; const kept = GV.qcLast.issues.filter(i => !dropByRules(i) && !(yes === false && q.drop && q.drop(i)));
    GV.qcDropped = (GV.qcDropped || 0) + (GV.qcLast.issues.length - kept.length);
    showResults(kept, GV.qcLast.cfg.sel); if (sc) requestAnimationFrame(() => { sc.scrollTop = st0; });
    GV.toast(yes ? 'تمام، اتسجلت كقاعدة واتشالت ' + q.items.length + ' ملاحظة' : 'تمام، اتعلّمت كأخطاء مؤكدة');
  }
  const SYSF = /^(objectid|fid|oid|globalid|shape(_length|_area|\.len|\.area)?|shape_leng|st_length\(shape\)|st_area\(shape\)|created_user|created_date|last_edited_user|last_edited_date)$/i;
  const isEmpty = v => v == null || (typeof v === 'string' && (v.trim() === '' || /^(<null>|null|none)$/i.test(v.trim())));
  const idOf = (f, i) => { const p = f.properties || {}; for (const k of ['OBJECTID', 'objectid', 'FID', 'fid', 'OID']) if (p[k] != null) return p[k]; return i + 1; };
  function attrStats() {
    const sel = (GV.qcLast && GV.qcLast.cfg && GV.qcLast.cfg.sel) || []; const out = [];
    sel.map(x => x.l).filter(l => l && l.features && l.features.length).forEach(l => {
      const keys = new Set(); l.features.forEach(f => Object.keys(f.properties || {}).forEach(k => keys.add(k)));
      const fields = [...keys].filter(k => !SYSF.test(k)).map(k => { let n = 0; l.features.forEach(f => { if (isEmpty((f.properties || {})[k])) n++; }); return { k, n, empty: n > 0, all: n === l.features.length }; });
      out.push({ l, fields });
    });
    return out;
  }
  async function attrXlsx(notes) {
    if (!GV.xlsx) return GV.toast('مولّد Excel مش جاهز');
    const st = attrStats(); const sheets = [];
    const sum = [['الطبقة', 'الحقل', 'عدد الفاضي', 'إجمالي العناصر', 'نسبة الفاضي %', 'الحالة']];
    st.forEach(x => x.fields.filter(f => f.empty).sort((a, b) => b.n - a.n).forEach(f => sum.push([x.l.name, f.k, f.n, x.l.features.length, +(f.n * 100 / x.l.features.length).toFixed(1), f.all ? 'فاضي بالكامل' : f.n / x.l.features.length >= 0.5 ? 'أغلبه فاضي' : 'فاضي جزئي'])));
    sheets.push({ name: 'الحقول الفاضية - ملخص', rows: sum });
    st.forEach(x => {
      const part = x.fields.filter(f => f.empty && !f.all); if (!part.length) return;
      const rows = [['OBJECTID'].concat(part.map(f => f.k)).concat(['عدد الفاضي', 'Longitude', 'Latitude'])];
      x.l.features.forEach((f, i) => { const p = f.properties || {}; const e = part.filter(fl => isEmpty(p[fl.k])); if (!e.length) return; let ll = ['', '']; try { const c = L.geoJSON(f.wgs).getBounds().getCenter(); ll = [+c.lng.toFixed(7), +c.lat.toFixed(7)]; } catch (er) { } rows.push([idOf(f, i)].concat(part.map(fl => isEmpty(p[fl.k]) ? '⬜ فاضي' : '')).concat([e.length]).concat(ll)); });
      if (rows.length > 1) sheets.push({ name: ('فاضي ' + x.l.name).slice(0, 31), rows });
    });
    const rev = [['الطبقة', 'OBJECTID', 'الحقل', 'القيمة', 'الملاحظة', 'التفاصيل', 'Longitude', 'Latitude']];
    notes.filter(i => !/فاضي|ناقصة/.test(i.type)).forEach(i => { const f = i.lref && i.fi != null ? i.lref.features[i.fi] : null; const m = i.meta || {}; const fld = m.field || ''; const v = f && fld ? (f.properties || {})[fld] : (m.value != null ? m.value : ''); rev.push([i.layer || '', f ? idOf(f, i.fi) : '', fld, v == null ? '' : v, i.type, i.detail || '', i.ll ? +i.ll[0].toFixed(7) : '', i.ll ? +i.ll[1].toFixed(7) : '']); });
    sheets.push({ name: 'داتا محتاجة مراجعة', rows: rev });
    if (GV.domainAdded && GV.domainAdded.length) sheets.push({ name: 'تصنيفات دومين جديدة', rows: [['الطبقة', 'الحقل', 'الدومين', 'الكود الجديد', 'الوصف']].concat(GV.domainAdded.map(a => [a.layer, a.field, a.domain, a.code, a.name])) });
    const data = await GV.xlsx(sheets);
    await GV.saveFile('Attribute_Notes_' + new Date().toISOString().slice(0, 10) + '.xlsx', data);
  }
  const QF = { focus: false, layer: null };
  // sample reviewer: up to 8 cases spread over the whole set, then one decision for the type
  function review(p, fixAll, acceptAll, canFix) {
    const its = p.items.filter(i => i.ll); if (!its.length) return GV.toast('المشكلة دي مالهاش مكان على الخريطة');
    const n = Math.min(8, its.length); const smp = []; for (let k = 0; k < n; k++) smp.push(its[Math.floor(k * its.length / n)]);
    let k = 0; let w = document.getElementById('qcRev'); if (w) w.remove(); w = el('div', 'qc-rev'); w.id = 'qcRev';
    const head = el('div', 'qc-rev-h'); const ttl = el('b', null, p.title); const cnt = el('span', 'muted small'); const x = el('button', 'icon-btn', '✕'); x.onclick = () => w.remove(); head.append(ttl, cnt, x);
    const det = el('div', 'small'); const nav = el('div', 'fc-acts');
    const show = () => { const it = smp[k]; cnt.textContent = 'مثال ' + (k + 1) + ' من ' + n + ' (من ' + p.n.toLocaleString('en') + ')'; det.textContent = (it.layer || '') + (it.detail ? ' — ' + it.detail : ''); GV.map.setView([it.ll[1], it.ll[0]], 20); GV.markSel && GV.markSel(it.ll[1], it.ll[0]); };
    const pv = el('button', 'chip', '◀ اللي قبله'); pv.onclick = () => { k = (k + n - 1) % n; show(); };
    const nx = el('button', 'chip', 'اللي بعده ▶'); nx.onclick = () => { k = (k + 1) % n; show(); };
    const op = el('button', 'chip', 'افتح العنصر'); op.onclick = () => { const it = smp[k]; if (it.lref && it.fi != null) GV.showFeature(it.lref, it.fi, L.latLng(it.ll[1], it.ll[0])); };
    nav.append(pv, nx, op);
    const dec = el('div', 'fc-acts'); dec.appendChild(el('span', 'muted small', 'القرار للنوع كله:'));
    const ok = el('button', 'chip ok', '✓ مش أخطاء — عدّي الكل'); ok.onclick = () => { w.remove(); acceptAll(); };
    dec.appendChild(ok);
    if (canFix) { const fx = el('button', 'chip ok', '🛠 صلّح الكل'); fx.onclick = () => { w.remove(); fixAll(); }; dec.appendChild(fx); }
    const keep = el('button', 'chip danger', '✗ أخطاء فعلًا — سيبها'); keep.onclick = () => { w.remove(); p.items.forEach(i => { i.confirmed = true; }); GV.toast('اتعلّموا كأخطاء مؤكدة — هتلاقيهم في طبقة المشاكل'); };
    dec.appendChild(keep);
    w.append(head, det, nav, dec); document.body.appendChild(w); show();
    if (window.innerWidth < 760) { const sh = $('#qcResSheet'); if (sh) sh.classList.add('min'); }
  }
  function renderSummary(issues) {
    const box = $('#qcResBody'); box.textContent = '';
    // descriptive-data notes (empty fields, odd values) leave the problem list and go to an Excel workbook instead
    const isNote = i => i.cat === 'attr' && !/(دومين|Subtype|إجباري)/.test(i.type);
    const notes = issues.filter(isNote); const all0 = issues; issues = issues.filter(i => !isNote(i));
    const probs = problems(issues); const qs = questions(issues);
    const real = probs.filter(p => p.sev !== 'info');
    const top = el('div', 'kpis');
    [[real.filter(p => p.sev === 'err').length, 'مشكلة لازم تتحل', '#e03131'], [real.filter(p => p.sev === 'warn').length, 'تحذير', '#f08c00'], [qs.length, 'سؤال محتاج إجابتك', '#1c7ed6']].forEach(([v, t, c]) => { const d = el('div', 'kpi'); d.style.setProperty('--kc', c); d.append(el('b', null, v.toLocaleString('en')), el('span', null, t)); top.appendChild(d); });
    box.appendChild(top);
    box.appendChild(el('p', 'muted small', 'اتجمعت ' + issues.length.toLocaleString('en') + ' ملاحظة في ' + probs.length + ' مشكلة حسب سببها ومكانها' + (GV.qcDropped ? '، واتشال ' + GV.qcDropped + ' ملاحظة بسبب قواعدك' : '') + '.'));
    if (notes.length || (GV.qcLast && GV.qcLast.cfg && GV.qcLast.cfg.sel && GV.qcLast.cfg.sel.length)) {
      const st = attrStats(); const emp = st.reduce((a, x) => a + x.fields.filter(f => f.empty).length, 0);
      const c = el('div', 'cmp'); c.style.setProperty('--sc', '#1c7ed6');
      c.appendChild(el('b', null, '📋 ملاحظات الداتا الوصفية — في ملف Excel مش في القايمة'));
      c.appendChild(el('div', 'small', emp + ' حقل فيه قيم فاضية في ' + st.filter(x => x.fields.some(f => f.empty)).length + ' طبقة · ' + notes.filter(i => !/فاضي|ناقصة/.test(i.type)).length.toLocaleString('en') + ' قيمة محتاجة تبص عليها'));
      const b = el('button', 'chip ok', '⬇ نزّل ملف Excel للداتا الوصفية'); b.onclick = () => attrXlsx(notes); c.appendChild(b); box.appendChild(c);
    }
    { // working on big volumes: focus on what blocks delivery, filter by layer
      const tb = el('div', 'qc-filt');
      const fc = el('button', 'chip' + (QF.focus ? ' on' : ''), (QF.focus ? '✓ ' : '') + '🎯 اللي بيعطّل التسليم بس'); fc.title = 'اخفي التحذيرات والملاحظات واعرض الأخطاء بس'; fc.onclick = () => { QF.focus = !QF.focus; renderSummary(all0); };
      tb.appendChild(fc);
      const infos = probs.filter(p => p.sev === 'info'); if (infos.length) { const ai = el('button', 'chip', '✓ عدّي كل الملاحظات (' + infos.reduce((a, p) => a + p.n, 0) + ')'); ai.title = 'الملاحظات (info) مش بتعطّل التسليم: تتشال مرة واحدة وتتحفظ كقاعدة'; ai.onclick = () => { infos.forEach(p => RULES.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'ignore', layer: p.layer || '*', issue: p.type, from: 'تجاهل الملاحظات' })); saveRules(); answer({ items: [], rule: null, key: '' }, false); }; tb.appendChild(ai); }
      const lc = new Map(); probs.forEach(p => { if (p.layer) lc.set(p.layer, (lc.get(p.layer) || 0) + p.n); });
      if (lc.size > 1) { const all = el('button', 'chip' + (!QF.layer ? ' on' : ''), 'كل الطبقات'); all.onclick = () => { QF.layer = null; renderSummary(all0); }; tb.appendChild(all);
        [...lc.entries()].sort((a, b) => b[1] - a[1]).forEach(([ln, n]) => { const c = el('button', 'chip' + (QF.layer === ln ? ' on' : ''), ln + ' (' + n.toLocaleString('en') + ')'); c.onclick = () => { QF.layer = QF.layer === ln ? null : ln; renderSummary(all0); }; tb.appendChild(c); }); }
      box.appendChild(tb);
    }
    const unErr = issues.filter(i => (i.cat === 'un' || i.cat === 'topo') && i.sev === 'err').length;
    if ($('#qc_un').checked) { const r = el('div', 'cmp'); r.style.setProperty('--sc', unErr ? '#e03131' : '#2f9e44'); r.appendChild(el('b', null, unErr ? 'مش جاهزة للـ Utility Network: ' + unErr + ' مكان لازم يتصلح' : 'جاهزة للـ Utility Network من ناحية الاتصال والهندسة ✓')); if (GV.qcComponents != null) r.appendChild(el('div', 'small', 'الشبكة متقسمة لـ ' + GV.qcComponents + ' جزء منفصل')); box.appendChild(r); }
    if (GV.fixBefore) { const cmp = el('div', 'cmp'); const b = GV.fixBefore, aE = issues.filter(i => i.sev === 'err').length, aW = issues.filter(i => i.sev === 'warn').length; cmp.style.setProperty('--sc', '#2f9e44'); cmp.appendChild(el('b', null, 'بعد الحل التلقائي: الأخطاء ' + b.err + ' ← ' + aE + ' · التحذيرات ' + b.warn + ' ← ' + aW)); box.appendChild(cmp); GV.fixBefore = null; }
    if (qs.length) {
      const sec = el('div', 'step qsec'); sec.appendChild(el('b', null, '❓ محتاج أعرف منك (' + qs.length + ')'));
      sec.appendChild(el('p', 'muted small', 'لو قلت "أيوه طبيعي" مش هتتحسب أخطاء تاني، وهتتحفظ كقاعدة للمرات الجاية.'));
      qs.forEach(q => {
        const c = el('div', 'qcard'); c.appendChild(el('div', 'qtext', q.text(q.items.length)));
        const a = el('div', 'fc-acts');
        const y = el('button', 'chip ok', 'أيوه طبيعي'); y.onclick = () => { c.classList.add('gone'); setTimeout(() => answer(q, true), 180); };
        const n = el('button', 'chip danger', 'لأ ده غلط'); n.onclick = () => { c.classList.add('gone'); setTimeout(() => answer(q, false), 180); };
        const s = el('button', 'chip', 'وريني'); let k = 0; s.onclick = () => { const it = q.items[k++ % q.items.length]; if (it.ll) { GV.map.setView([it.ll[1], it.ll[0]], 20); GV.markSel && GV.markSel(it.ll[1], it.ll[0]); if (window.innerWidth < 760) $('#qcResSheet').classList.add('min'); GV.toast('مثال ' + k + ' من ' + q.items.length + (it.detail ? ' · ' + it.layer + ' #' + (it.fi + 1) + ' ' + it.detail + (/فوق بعض/.test(it.type) ? ' (النقطتين في نفس المكان بالظبط، فبتشوف واحدة بس — افتح العنصر وشوف التانية في الجدول)' : '') : '') + ' · اضغط "وريني" تاني للي بعده', 6000); if (it.lref && it.fi != null) GV.showFeature(it.lref, it.fi); } };
        const tq = el('button', 'chip', 'الجدول'); tq.title = 'افتح جدول الطبقة على العناصر دي بس'; tq.onclick = () => { const it0 = q.items.find(x => x.lref); if (!it0) return; const L2 = it0.lref; const ix = [...new Set(q.items.filter(x => x.lref === L2 && x.fi != null).map(x => x.fi))]; GV.openTable(L2, false, ix, ix.length + ' عنصر من الملاحظة دي'); };
        let fl = null; if (q.rule && q.rule.kind === 'optional_field' && /(elevation|level|_?il$|invert|slope|depth|ground|us_?mh|ds_?mh|coord)/i.test(q.rule.field || '') && GV.openFix) { fl = el('button', 'chip ok', '🛠 املاها من الشبكة'); fl.title = 'بيحسب القيم من المناهل/النقط اللي على أطراف الخط ومن الخط الرئيسي اللي متوصل بيه'; fl.onclick = () => { c.classList.add('gone'); GV.openFix({ only: ['derive'] }); }; }
        a.append(y, n, s, tq); if (fl) a.appendChild(fl); c.appendChild(a); sec.appendChild(c);
      });
      box.appendChild(sec);
    }
    if (!issues.length) { box.appendChild(el('p', 'ok-note', '✓ مفيش مشاكل في الفحوصات اللي اخترتها.')); }
    const SEVN = { err: 'خطأ', warn: 'تحذير', info: 'ملاحظة' };
    [['err', 'المشاكل اللي لازم تتحل'], ['warn', 'تحذيرات تراجعها'], ['info', 'ملاحظات']].forEach(([sv, title]) => {
      if (QF.focus && sv !== 'err') return; const ps = probs.filter(p => p.sev === sv && (!QF.layer || p.layer === QF.layer)); if (!ps.length) return;
      const sec = el('div', 'step'); sec.appendChild(el('b', null, title + ' (' + ps.length + ')'));
      ps.forEach(p => {
        const r = el('div', 'prob');
        const head = el('button', 'qc-type'); const d = el('span', 'qc-dot'); d.style.background = SEV[p.sev][1];
        head.append(d, el('span', 'qc-t', (p.systematic ? '⚑ ' : '') + p.title), el('small', 'muted', p.layer || ''), el('b', null, p.n.toLocaleString('en') + (p.n > 1 ? ' مكان' : '')));
        r.appendChild(head);
        const det = el('div', 'prob-d');
        if (p.hint) det.appendChild(el('div', 'small hint', p.hint));
        if (p.related.size) det.appendChild(el('div', 'small muted', 'بيسبب كمان: ' + Array.from(p.related.entries()).map(([t, n]) => t + ' (' + n + ')').join('، ')));
        const acts = el('div', 'fc-acts'); let k = 0;
        const go = el('button', 'chip', 'روح للمكان ' + (p.n > 1 ? '(واحد ورا التاني)' : '')); go.onclick = () => { const it = p.items[k++ % p.items.length]; if (it.ll) { GV.map.setView([it.ll[1], it.ll[0]], 20); GV.markSel && GV.markSel(it.ll[1], it.ll[0]); if (window.innerWidth < 760) $('#qcResSheet').classList.add('min'); GV.toast((p.n > 1 ? k + ' من ' + p.n + ' · ' : '') + (it.detail || p.title)); } else GV.showMsg(p.title + '\n' + (it.detail || '')); };
        const tb = el('button', 'chip', 'الجدول'); tb.onclick = () => { if (GV.qcLayer) { GV.openTable(GV.qcLayer); setTimeout(() => { $('#tblSearch').value = p.type; $('#tblSearch').dispatchEvent(new Event('input')); }, 50); } };
        const FIXMAP = [[/متكرر/, 'dup'], [/طوله صفر|طول صفر/, 'zero'], [/سبايك|رؤوس مكررة|vertex مكرر/, 'vtx'], [/Multipart/i, 'multi'], [/فجوة|طرف خط (مش|مو) متوصل|معلق|undershoot|overshoot|dangl/i, 'snapEnd'], [/قريبة من الخط|مش عليه|بعيدة عن الخط/, 'snapPt'], [/من غير vertex|مش على vertex/, 'vertex'], [/مش مقسوم|مش متقسم|من غير تقسيم|الخط عدّى على/, 'splitDev'], [/تقاطع/, 'split'], [/مسافات زيادة|كتابة مختلفة|توحيد/, 'attr'], [/US_MH|DS_MH|SLOPE|DEPTH|فاضي.*محسوب|ACTUALLENGTH/, 'derive']];
        const fk = (FIXMAP.find(m => m[0].test(p.type + ' ' + p.title)) || [])[1];
        if (/مش موجودة في الدومين|مش من الـ Subtypes/.test(p.type)) { const nb = el('button', 'chip ok', '➕ ضيف القيم دي للدومين كتصنيفات جديدة وحوّلها لأكواد'); nb.title = 'كل قيمة مكتوبة ومش موجودة (زي اسم حي أو قطر) بتتضاف للدومين بكود جديد، وتقدر تتراجع'; nb.onclick = () => { const before = (GV.domainAdded || []).length; const n = GV.domainAddNew(); const nw = (GV.domainAdded || []).slice(before); r.classList.add('gone'); GV.toast('اتضاف ' + nw.length + ' تصنيف جديد واتحولت ' + n + ' قيمة لكود — هتلاقي القايمة في ملف Excel الداتا الوصفية', 5000); GV.domainSample('تصنيفات دومين جديدة'); }; acts.appendChild(nb); }
        if (/ميل عكسي|اتجاه السريان|سريان من اتجاهين|مش بيوصل لمخرج/.test(p.type) && GV.flipByLevels) { const fb = el('button', 'chip ok', '🔁 اقلب اتجاه الخطوط اللي مناسيبها بتقول إنها معكوسة'); fb.title = 'كل ماسورة جاذبية منسوب أولها أوطى من آخرها بتتقلب (الرسم + حقول البداية والنهاية)، وتقدر تتراجع'; fb.onclick = () => { const n = GV.flipByLevels(); r.classList.add('gone'); GV.toast(n ? 'اتقلب ' + n + ' خط — اعمل فحص تاني عشان تتأكد إن الشبكة ماشية في اتجاه واحد' : 'مفيش خطوط مناسيبها بتقول إنها معكوسة — الخطوط دي محتاجة تتراجع بالعين', 5000); if (n && GV.editSample) GV.editSample('قلب اتجاه السريان', GV.flipUndo.map(u => ({ l: u.l, f: u.f, before: u.p, note: 'اتقلب اتجاه الرسم' })), () => GV.flipUndoFn()); }; acts.appendChild(fb); }
        if (/بدل كود/.test(p.type)) { const cb = el('button', 'chip ok', '🛠 حوّل كل النصوص لأكواد (الدومين / Subtype)'); cb.onclick = () => { const n = GV.domainConvert(); r.classList.add('gone'); GV.toast('اتحولت ' + n + ' قيمة لكود — اعمل فحص تاني عشان تتأكد', 5000); GV.domainSample('تحويل النصوص لأكواد'); }; acts.appendChild(cb); }
        if (fk && GV.openFix) { const fxb = el('button', 'chip ok', '🛠 صلّح النوع ده كله (' + p.n + ')'); fxb.title = 'نفس الحل بيتطبق على كل الأماكن اللي من النوع ده، وتقدر تتراجع'; fxb.onclick = () => { r.classList.add('gone'); GV.openFix({ only: [fk] }); }; acts.appendChild(fxb); }
        const ig = el('button', 'chip', '✓ تمام — عدّي النوع ده كله'); ig.onclick = () => { r.classList.add('gone'); if (GV.qcLayer) GV.qcLayer.features.forEach(f => { if (f.properties['المشكلة'] === p.type && (!p.layer || f.properties['الطبقة'] === p.layer)) f.properties['الحالة'] = 'مقبول'; }); RULES.push({ id: Date.now().toString(36), kind: 'ignore', layer: p.layer || '*', issue: p.type, from: 'تجاهل' }); saveRules(); answer({ items: [] , rule: null, key: '' }, false); };
        if (p.n > 1) { const rv = el('button', 'chip', '👁 راجع عينة (' + Math.min(8, p.n) + ')'); rv.title = 'شوف أمثلة متفرقة واحد ورا التاني، وبعدها خد قرار واحد للنوع كله'; rv.onclick = () => review(p, () => { const fb = [...acts.querySelectorAll('button')].find(b => /صلّح النوع/.test(b.textContent)); if (fb) fb.click(); }, () => ig.onclick(), !!fk); acts.appendChild(rv); }
        acts.append(go, tb, ig); det.appendChild(acts);
        r.appendChild(det); head.onclick = () => r.classList.toggle('open');
        sec.appendChild(r);
      });
      box.appendChild(sec);
    });
    const acts = el('div', 'fc-acts');
    if (issues.length && GV.openFix) { const fx = el('button', 'open-btn sm', '🛠 حل المشاكل أوتوماتيك'); fx.onclick = () => GV.openFix(); acts.appendChild(fx); }
    if (GV.fixUndo) { const u = el('button', 'chip', '↶ تراجع عن الحل التلقائي'); u.onclick = () => GV.fixUndoFn(); acts.appendChild(u); const lg = el('button', 'chip', 'سجل التعديلات (' + (GV.fixLog || []).length + ')'); lg.onclick = () => GV.fixExportLog(); acts.appendChild(lg); }
    const ex = el('button', 'chip', 'صدّر المشاكل'); ex.onclick = () => GV.qcLayer && GV.openExport([GV.qcLayer]);
    const rp = el('button', 'chip', 'تقرير Excel'); rp.onclick = () => GV.reportXlsx && GV.reportXlsx();
    acts.append(ex, rp); box.appendChild(acts);
  }

  /* ---------- rules editor (in the QC sheet) ---------- */
  const PRESETS = [
    ['السادل مسموح في نص الماسورة', { kind: 'midspan_ok', layer: '*', value: 'saddle|سادل|tap' }],
    ['السادلات ممكن تكون قريبة من بعض', { kind: 'close_ok', layer: '*', value: 'saddle|سادل|tap' }],
    ['الخط ممكن يخلص عند Cap / End / Plug', { kind: 'end_ok', layer: '*', value: 'cap|end|plug|طبة' }],
    ['أطراف الوصلات المنزلية طبيعية', { kind: 'dangle_ok', layer: '*', value: 'lat|serv|hc|house|وصلة' }]
  ];
  function ruleText(r) { const t = RK[r.kind] || r.kind; const tgt = (r.layer && r.layer !== '*' ? r.layer : 'كل الطبقات') + (r.layer2 ? ' ↔ ' + r.layer2 : '') + (r.field && r.field !== '*' ? ' · ' + r.field : '') + (r.value ? ' · "' + r.value + '"' : '') + (r.kind === 'range' ? ' · ' + (r.min ?? '') + ' – ' + (r.max ?? '') : '') + (r.issue ? ' · ' + r.issue : ''); return t + ' — ' + tgt; }
  function renderRules() {
    const box = $('#qcRules'); if (!box) return; box.textContent = '';
    if (!RULES.length) box.appendChild(el('p', 'muted small', 'لسه مفيش قواعد. القواعد بتتعمل من إجاباتك على الأسئلة بعد الفحص، أو من الجاهز هنا، أو تضيفها بنفسك.'));
    RULES.forEach((r, i) => { const row = el('div', 'rule' + (r.off ? ' off' : '')); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !r.off; cb.onchange = () => { r.off = !cb.checked; saveRules(); renderRules(); }; const del = el('button', 'icon-btn small', '✕'); del.onclick = () => { RULES.splice(i, 1); saveRules(); renderRules(); }; row.append(cb, el('span', null, ruleText(r)), del); box.appendChild(row); });
    const pre = el('div', 'fc-acts'); PRESETS.forEach(([t, r]) => { if (RULES.some(x => x.kind === r.kind && x.value === r.value)) return; const b = el('button', 'chip', '＋ ' + t); b.onclick = () => { RULES.push(Object.assign({ id: Date.now().toString(36), mode: 'contains' }, r)); saveRules(); renderRules(); }; pre.appendChild(b); }); box.appendChild(pre);
    const add = el('button', 'chip', '＋ قاعدة جديدة'); add.onclick = () => ruleForm(); box.appendChild(add);
  }
  function ruleForm() {
    const box = $('#qcRules'); const f = el('div', 'fcard rule-form');
    const kind = el('select'); Object.keys(RK).forEach(k => { const o = el('option', null, RK[k]); o.value = k; kind.appendChild(o); });
    const ls = qcLayers().map(x => x.l); const lay = el('select'); [['*', 'كل الطبقات']].concat(ls.map(l => [l.name, l.name])).forEach(([v, t]) => { const o = el('option', null, t); o.value = v; lay.appendChild(o); });
    const lay2 = el('select'); [['*', 'أي طبقة']].concat(ls.map(l => [l.name, l.name])).forEach(([v, t]) => { const o = el('option', null, t); o.value = v; lay2.appendChild(o); });
    const fld = el('select'); const fillF = () => { fld.textContent = ''; const L0 = ls.find(l => l.name === lay.value); const fs = L0 ? GV.fieldsOf(L0) : Array.from(new Set(ls.flatMap(l => GV.fieldsOf(l)))); [['*', 'أي حقل / اسم البلوك أو اللير']].concat(fs.map(k => [k, k])).forEach(([v, t]) => { const o = el('option', null, t); o.value = v; fld.appendChild(o); }); }; fillF(); lay.onchange = fillF;
    const val = el('input'); val.placeholder = 'القيمة (أو أكتر من كلمة بينهم |)';
    const mn = el('input'); mn.type = 'number'; mn.placeholder = 'أقل قيمة'; const mx = el('input'); mx.type = 'number'; mx.placeholder = 'أعلى قيمة';
    const iss = el('select'); Array.from(new Set((GV.qcLast ? GV.qcLast.issues : []).map(i => i.type).concat(ROOT))).forEach(t => { const o = el('option', null, t); o.value = t; iss.appendChild(o); });
    const rows = { lay2: lbl2('مع طبقة', lay2), fld: lbl2('الحقل', fld), val: lbl2('القيمة', val), range: el('div', 'row2'), iss: lbl2('نوع المشكلة', iss) };
    rows.range.append(mn, mx);
    const upd = () => { const k = kind.value; rows.lay2.style.display = k === 'cross_ok' ? '' : 'none'; rows.fld.style.display = /^(cross_ok|dangle_ok|length_ok|isolated_ok|ignore)$/.test(k) ? 'none' : ''; rows.val.style.display = /^(optional_field|required|range|ignore)$/.test(k) ? 'none' : ''; rows.range.style.display = k === 'range' ? '' : 'none'; rows.iss.style.display = k === 'ignore' ? '' : 'none'; val.placeholder = k === 'domain' ? 'القيم المسموحة مفصولة بفاصلة: DI, HDPE, PVC' : 'القيمة (أو أكتر من كلمة بينهم |)'; };
    kind.onchange = upd;
    const ok = el('button', 'open-btn sm', 'أضف القاعدة'); ok.onclick = () => { const r = { id: Date.now().toString(36), kind: kind.value, layer: lay.value, mode: 'contains' }; if (rows.lay2.style.display !== 'none') r.layer2 = lay2.value; if (rows.fld.style.display !== 'none') r.field = fld.value; if (rows.val.style.display !== 'none') r.value = val.value.trim(); if (r.kind === 'range') { r.min = mn.value; r.max = mx.value; } if (r.kind === 'ignore') r.issue = iss.value; if (/^(required|range|domain|optional_field|value_ok)$/.test(r.kind) && (!r.field || r.field === '*')) return GV.toast('اختار الحقل'); RULES.push(r); saveRules(); renderRules(); };
    f.append(lbl2('نوع القاعدة', kind), lbl2('الطبقة', lay), rows.lay2, rows.fld, rows.val, rows.range, rows.iss, ok);
    box.appendChild(f); upd();
  }
  function lbl2(t, inp) { const l = el('label', 'fld'); l.append(el('span', null, t), inp); return l; }
  GV.renderQcRules = renderRules;
  GV.qcAddRule = r => { if (RULES.some(x => x.kind === r.kind && (x.layer || '*') === (r.layer || '*') && (x.field || '*') === (r.field || '*') && String(x.value || '') === String(r.value || ''))) return false; RULES.push(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), from: 'Claude', mode: 'contains' }, r)); saveRules(); return true; };
  GV.qcRuleList = () => RULES.slice();
  GV.qcSmart = () => GV.qcLast ? { problems: problems(GV.qcLast.issues), questions: questions(GV.qcLast.issues), rules: RULES.slice(), ruleText } : null;

  $('#btnQC').addEventListener('click', () => openQC());
  $('#qcRun').addEventListener('click', run);
  GV.openQC = openQC; GV.runQC = run;
})();
