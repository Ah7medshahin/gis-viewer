// Dashboard + reports (Excel .xlsx and printable HTML)
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const DP = { mode: 'all' }; // dashboard data scope (shared picker from boq.js)
  const dataLayers = () => { const all = GV.sources.filter(s => s.id !== 'qc').flatMap(s => s.layers.filter(l => l.features.length).map(l => ({ l, s }))); if (DP.mode === 'all' || !GV.pickedLayers) return all; const keep = new Set(GV.pickedLayers(DP)); return all.filter(x => keep.has(x.l)); };
  function lenOf(l, f) { if (!f.wgs || !f.wgs.geometry) return 0; const t = f.wgs.geometry.type; return t.indexOf('LineString') >= 0 ? GV.lineLen(f.wgs.geometry) : 0; }
  function layerStats(l) { let len = 0, area = 0; const n = l.features.filter(f => !f._sym).length; if (l.kind === 'line' || l.kind === 'mixed') l.features.forEach(f => { if (!f._sym) len += lenOf(l, f); }); if (l.kind === 'polygon') l.features.forEach(f => { if (f.wgs && f.wgs.geometry && f.wgs.geometry.type.indexOf('Polygon') >= 0) area += GV.polyArea(f.wgs.geometry); }); return { n, len, area }; }
  function groupBy(l, field) {
    const m = new Map(); const isLine = l.kind === 'line';
    l.features.forEach(f => { let v = f.properties ? f.properties[field] : null; v = v == null || v === '' ? '(فاضي)' : String(v); const o = m.get(v) || { n: 0, len: 0 }; o.n++; if (isLine) o.len += lenOf(l, f); m.set(v, o); });
    return Array.from(m.entries()).map(([k, o]) => ({ k, n: o.n, len: o.len })).sort((a, b) => (isLine ? b.len - a.len : b.n - a.n));
  }
  const fmtN = n => n.toLocaleString('en');
  const km = m => m >= 1000 ? (m / 1000).toFixed(2) + ' كم' : m.toFixed(1) + ' م';
  function bars(rows, valKey, fmt, color) {
    const box = el('div', 'bars'); const max = Math.max(...rows.map(r => r[valKey]), 1);
    rows.forEach(r => { const row = el('div', 'bar-row'); const lab = el('span', 'bar-l', r.label); const tr = el('div', 'bar-t'); const b = el('div', 'bar-b'); b.style.width = Math.max(1, r[valKey] / max * 100) + '%'; b.style.background = r.color || color || 'var(--accent)'; tr.appendChild(b); row.append(lab, tr, el('span', 'bar-v', fmt ? fmt(r[valKey]) : fmtN(r[valKey]))); box.appendChild(row); });
    return box;
  }
  function card(title, body, wide) { const c = el('div', 'dcard' + (wide ? ' wide' : '')); c.appendChild(el('h3', null, title)); if (body) c.appendChild(body); return c; }
  function pickField(l) { const fs = GV.fieldsOf(l); return fs.find(k => /(dia|قطر|size)/i.test(k)) || fs.find(k => /(mat|مادة)/i.test(k)) || fs.find(k => /(type|نوع|status|layer)/i.test(k)) || fs[0]; }

  let dLayer = null, dField = null;
  function render() {
    const box = $('#dashBody'); box.textContent = '';
    if (GV.dataPicker) box.appendChild(GV.dataPicker(DP, render));
    const ls = dataLayers();
    if (!ls.length) { box.appendChild(el('p', 'muted', 'افتح داتا الأول علشان الداشبورد يتملي.')); return; }
    const st = ls.map(({ l, s }) => ({ l, s, ...layerStats(l) }));
    const totalN = st.reduce((a, x) => a + x.n, 0), totalLen = st.reduce((a, x) => a + x.len, 0), pts = st.filter(x => x.l.kind === 'point').reduce((a, x) => a + x.n, 0);
    const qc = GV.qcLast; const recs = (GV.sources.find(s => s.id === 'field') || { layers: [] }).layers.reduce((a, l) => a + l.features.length, 0);
    const k = el('div', 'kpis');
    [[fmtN(ls.length), 'طبقة'], [fmtN(totalN), 'عنصر'], [km(totalLen), 'أطوال الخطوط'], [fmtN(pts), 'نقطة']].concat(qc ? [[fmtN(qc.issues.filter(i => i.sev === 'err').length), 'خطأ في الفحص', '#e03131']] : []).concat(recs ? [[fmtN(recs), 'تسجيل ميداني', '#1c7ed6']] : []).forEach(([v, t, c]) => { const d = el('div', 'kpi'); if (c) d.style.setProperty('--kc', c); d.append(el('b', null, v), el('span', null, t)); k.appendChild(d); });
    box.appendChild(k);
    const grid = el('div', 'dgrid'); box.appendChild(grid);
    grid.appendChild(card('عدد العناصر في كل طبقة', bars(st.slice().sort((a, b) => b.n - a.n).slice(0, 15).map(x => ({ label: x.l.name, v: x.n, color: x.l.color })), 'v')));
    const lineSt = st.filter(x => x.len > 0).sort((a, b) => b.len - a.len);
    if (lineSt.length) grid.appendChild(card('أطوال الخطوط', bars(lineSt.slice(0, 15).map(x => ({ label: x.l.name, v: x.len, color: x.l.color })), 'v', km)));
    // by field
    if (!dLayer || ls.every(x => x.l !== dLayer)) { const cand = st.find(x => x.l.kind === 'line' && GV.fieldsOf(x.l).length) || st.find(x => GV.fieldsOf(x.l).length); dLayer = cand ? cand.l : ls[0].l; dField = pickField(dLayer); }
    const bf = el('div'); const ctl = el('div', 'row2');
    const sl = el('select'); ls.forEach(({ l }) => { const o = el('option', null, l.name); o.value = ls.findIndex(x => x.l === l); sl.appendChild(o); }); sl.value = ls.findIndex(x => x.l === dLayer);
    const sf = el('select'); GV.fieldsOf(dLayer).forEach(f => { const o = el('option', null, f); o.value = f; sf.appendChild(o); }); sf.value = dField || '';
    sl.onchange = () => { dLayer = ls[+sl.value].l; dField = pickField(dLayer); render(); }; sf.onchange = () => { dField = sf.value; render(); };
    ctl.append(sl, sf); bf.appendChild(ctl);
    if (dField) {
      const g = groupBy(dLayer, dField); const isLine = dLayer.kind === 'line';
      bf.appendChild(bars(g.slice(0, 20).map((r, i) => ({ label: r.k, v: isLine ? r.len : r.n, color: GV.PALETTE[i % GV.PALETTE.length] })), 'v', isLine ? km : null));
      if (g.length > 20) bf.appendChild(el('p', 'muted small', 'و ' + (g.length - 20) + ' قيمة تانية'));
      bf.appendChild(el('p', 'muted small', isLine ? 'الطول حسب ' + dField + ' (ينفع كحصر كميات)' : 'العدد حسب ' + dField));
    }
    grid.appendChild(card('تحليل حسب حقل', bf, true));
    if (qc) {
      const cats = new Map(); qc.issues.forEach(i => { const c = cats.get(i.cat) || 0; cats.set(i.cat, c + 1); });
      const CAT = { coord: 'الإحداثيات', z: 'المناسيب', geom: 'الهندسة', topo: 'الطوبولوجي', attr: 'البيانات الوصفية', un: 'Utility Network' };
      const body = bars(Array.from(cats.entries()).map(([c, n]) => ({ label: CAT[c] || c, v: n })), 'v', null, '#e8590c');
      body.appendChild(el('p', 'muted small', 'آخر فحص: ' + qc.at.toLocaleString('en-GB')));
      grid.appendChild(card('نتائج الفحص', body));
      const types = new Map(); qc.issues.forEach(i => types.set(i.type, (types.get(i.type) || 0) + 1));
      grid.appendChild(card('أكتر المشاكل تكرارًا', bars(Array.from(types.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => ({ label: t, v: n })), 'v', null, '#c92a2a')));
    }
    const fl = (GV.sources.find(s => s.id === 'field') || { layers: [] }).layers;
    if (fl.length && recs) {
      const stat = new Map(); const byUser = new Map(); const byDay = new Map();
      fl.forEach(l => l.features.forEach(f => { const s = f.properties['الحالة']; stat.set(s, (stat.get(s) || 0) + 1); const u = f.properties['سجّلها'] || '—'; byUser.set(u, (byUser.get(u) || 0) + 1); const d = f._rec && f._rec.at ? f._rec.at.slice(0, 10) : '—'; byDay.set(d, (byDay.get(d) || 0) + 1); }));
      const col = { 'مطابق': '#2f9e44', 'فيه اختلاف': '#f08c00', 'مش موجود في GIS': '#e03131', 'بدون مقارنة': '#1c7ed6' };
      grid.appendChild(card('الشغل الميداني حسب الحالة', bars(Array.from(stat.entries()).map(([k2, n]) => ({ label: k2, v: n, color: col[k2] })), 'v')));
      grid.appendChild(card('التسجيلات حسب الشخص', bars(Array.from(byUser.entries()).sort((a, b) => b[1] - a[1]).map(([k2, n]) => ({ label: k2, v: n })), 'v', null, '#1c7ed6')));
      grid.appendChild(card('التسجيلات حسب اليوم', bars(Array.from(byDay.entries()).sort().slice(-14).map(([k2, n]) => ({ label: k2, v: n })), 'v', null, '#5f3dc4')));
    }
    const tb = el('table', 'dtable'); const hr = el('tr'); ['الطبقة', 'المصدر', 'النوع', 'العدد', 'الطول/المساحة', 'نظام الإحداثيات'].forEach(h => hr.appendChild(el('th', null, h))); tb.appendChild(hr);
    st.forEach(x => { const tr = el('tr'); [x.l.name, x.s.name, ({ point: 'نقاط', line: 'خطوط', polygon: 'مضلعات', table: 'جدول', mixed: 'مختلط' })[x.l.kind] || '', fmtN(x.n), x.len ? km(x.len) : x.area ? (x.area / 1e4).toFixed(2) + ' هكتار' : '—', x.l.crsLabel || '—'].forEach(v => tr.appendChild(el('td', null, v))); tb.appendChild(tr); });
    grid.appendChild(card('ملخص الطبقات', tb, true));
  }
  $('#btnDash').addEventListener('click', () => { render(); GV.openSheet('#dashSheet'); });
  $('#dashXlsx').addEventListener('click', () => reportXlsx());
  $('#dashHtml').addEventListener('click', () => reportHtml());

  /* ---------- report data ---------- */
  const FIXOP = { 'طرف خط مش متوصل وقريب من خط تاني': 'قفل الفجوات', 'نقطة قريبة من الخط بس مش عليه': 'لزق النقط على الخط', 'خطين فوق بعض (Overlap)': 'مسح المتكرر', 'عنصر متكرر (نفس الشكل بالظبط)': 'مسح المتكرر', 'خط طوله صفر': 'مسح الطول الصفر', 'رؤوس مكررة ورا بعض': 'تنضيف الرؤوس', 'سبايك (الخط بيرجع على نفسه)': 'تنضيف الرؤوس', 'الجهاز في نص الخط مش على vertex': 'إضافة vertex', 'طرف خط متوصل في نص خط تاني من غير vertex': 'إضافة vertex', 'عنصر متعدد الأجزاء (Multipart)': 'فك الـ Multipart', 'نفس القيمة مكتوبة بأشكال مختلفة': 'تنضيف القيم', 'خطين بيتقاطعوا من غير نقطة اتصال': 'التقسيم عند التقاطع (اختياري)', 'حقول الإحداثيات مختلفة عن مكان النقطة': 'تحديث X/Y (اختياري)', 'حقل الطول مختلف عن طول الخط': 'تحديث الطول (اختياري)', 'الطبقة 2D (مفيش Z)': 'إضافة Z = 0 (اختياري)' };
  const typeField = l => { const fs = GV.fieldsOf(l); return ['Block', 'FITTINGTYPE', 'VALVETYPE', 'JUNCTIONTYPE', 'DEVICETYPE', 'TYPE', 'ASSETTYPE', 'SUBTYPE'].find(k => fs.indexOf(k) >= 0) || fs.find(k => /(type|نوع)/i.test(k)); };
  const diaField = l => GV.fieldsOf(l).find(k => /^(diameter|dia|size|nominal_?dia|قطر)/i.test(k));
  const matField = l => GV.fieldsOf(l).find(k => /^(material|mat|مادة)/i.test(k));

  /* ---------- Unified GIS Audit (same columns as the team's ArcGIS Pro audit tables) ---------- */
  const SYS = /^(objectid|fid|shape|shape_length|shape_area|shape_leng|globalid|geometry|_.*|text|layer|entity|color|linetype|block|handle)$/i;
  function unifiedAudit(ls) {
    const ctxLayers = ls.map(x => x.l);
    const rows = [['LayerName', 'FeatureType', 'Category_Diameter', 'FeatureCount', 'Geometry_Length_m', 'ActualLength_m', 'Layer_Gaps_Count', 'Gaps_Length_m', 'Total_With_Gaps_m', 'Total_With_Gaps_Formatted', 'Data_Health_Score', 'AuditNotes', 'Error_Fix_Query']];
    const fmt = m => { const mm = Math.floor(m); const cm = Math.round((m - mm) * 100); return mm + ' متر و ' + cm + ' سنتيمتر'; };
    ls.forEach(({ l }) => {
      const feats = l.features.filter(f => !f._sym && !(f.properties && f.properties.Text != null) && f.wgs && f.wgs.geometry);
      const gt = feats.length ? feats[0].wgs.geometry.type : (l.kind || ''); const kind = /Line/.test(gt) ? 'Polyline' : /Polygon/.test(gt) ? 'Polygon' : 'Point';
      const fields = new Set(); feats.slice(0, 2000).forEach(f => Object.keys(f.properties || {}).forEach(k => { if (!SYS.test(k)) fields.add(k); }));
      if (!feats.length) (GV.fieldsOf ? GV.fieldsOf(l) : []).forEach(k => { if (!SYS.test(k)) fields.add(k); });
      const dk = Array.from(fields).find(k => /^(diameter|dia|diam|nominal_?dia|القطر|قطر)$/i.test(k)) || Array.from(fields).find(k => /diam/i.test(k));
      const ak = Array.from(fields).find(k => /^actual_?length$/i.test(k)) || Array.from(fields).find(k => /actual.?len/i.test(k));
      // layer-wide notes (like the team's script: notes are per layer, repeated on each diameter row)
      const notes = []; const nulls = [];
      let lat0 = 0; feats.slice(0, 50).forEach(f => { const c = GV.firstCoord(f.wgs.geometry); lat0 += c ? c[1] : 0; }); lat0 /= Math.max(1, Math.min(50, feats.length)); const KX = Math.cos(lat0 * Math.PI / 180) * 111320, KY = 110540;
      const M = c => [c[0] * KX, c[1] * KY];
      let gaps = 0, gapLen = 0;
      if (kind === 'Point') {
        const seen = new Map(); let dup = 0; feats.forEach(f => { const c = M(f.wgs.geometry.coordinates); const k = Math.round(c[0] * 100) + ',' + Math.round(c[1] * 100); if (seen.has(k)) dup++; else seen.set(k, 1); });
        if (dup) notes.push('يوجد حوالي (' + dup + ') نقطة مكررة الإحداثيات');
      }
      if (kind === 'Polyline' && feats.length) {
        const parts = []; const own = []; const addF = (f, mine) => { const g = f.wgs.geometry; if (!/Line/.test(g.type)) return; (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(c => { if (c.length > 1) { parts.push(c.map(M)); own.push(mine); } }); };
        feats.forEach(f => addF(f, 1)); (ctxLayers || []).forEach(o => { if (o !== l) o.features.forEach(f => { if (f.wgs && f.wgs.geometry && !f._sym) addF(f, 0); }); });
        const PT = new Set(); (ctxLayers || [l]).forEach(o => o.features.forEach(f => { const g = f.wgs && f.wgs.geometry; if (g && g.type === 'Point') { const c = M(g.coordinates); PT.add(Math.round(c[0] * 100) + ',' + Math.round(c[1] * 100)); } }));
        const cell = 12; const G = new Map(); const put = (x, y, v) => { const k = Math.floor(x / cell) + ',' + Math.floor(y / cell); if (!G.has(k)) G.set(k, []); G.get(k).push(v); };
        parts.forEach((p, pi) => p.forEach((c, ci) => { if (ci) { const a = p[ci - 1]; const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / cell) + 1; for (let t = 0; t <= n; t++) put(a[0] + (c[0] - a[0]) * t / n, a[1] + (c[1] - a[1]) * t / n, [pi, ci]); } }));
        const segD = (q, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy); };
        parts.forEach((p, pi) => own[pi] && [p[0], p[p.length - 1]].forEach(q => {
          if (PT.has(Math.round(q[0] * 100) + ',' + Math.round(q[1] * 100))) return; let bd = Infinity; const gx = Math.floor(q[0] / cell), gy = Math.floor(q[1] / cell);
          for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) (G.get(i + ',' + j) || []).forEach(([pj, cj]) => { if (pj === pi) return; const d = segD(q, parts[pj][cj - 1], parts[pj][cj]); if (d < bd) bd = d; });
          if (bd > 0.001 && bd <= 10) { gaps++; gapLen += bd; }
        }));
        if (gaps) notes.push('يوجد (' + gaps + ') فجوة بين الخطوط بإجمالي (' + gapLen.toFixed(2) + 'm)');
        if (!ak) notes.push('⚠️ حقل Actual Length غير موجود بالطبقة');
      }
      fields.forEach(k => { const n = feats.filter(f => { const v = (f.properties || {})[k]; return v == null || String(v).trim() === '' || /^null$/i.test(String(v).trim()); }).length; if (n) { notes.push('حقل [' + k + ']: بها (' + n + ') فارغ'); nulls.push(k); } });
      if (ak && kind === 'Polyline') { let bad = 0; feats.forEach(f => { const a = parseFloat((f.properties || {})[ak]); const g = lenOf(l, f); if (isFinite(a) && g > 0 && Math.abs(a - g) / g > 0.01) bad++; }); if (bad) notes.push('(' + bad + ') خط طوله الحقيقي مختلف عن [' + ak + '] بأكتر من 1%'); }
      const minor = notes.length && notes.every(n => /فجوة/.test(n) && gapLen < 1 || /Actual Length غير موجود/.test(n));
      const score = !notes.length ? '🟢 ممتازة (100%)' : minor ? '🟡 أخطاء طفيفة' : '🔴 تحتاج مراجعة';
      const q = nulls.length ? nulls.slice(0, 8).map(k => k + ' IS NULL').join(' OR ') : 'N/A';
      const note = notes.length ? notes.join(' | ') : 'البيانات سليمة ومكتملة تماماً.';
      const groups = new Map();
      if (dk && kind !== 'Polygon') feats.forEach(f => { const v = (f.properties || {})[dk]; const k = v == null || String(v).trim() === '' || +v === 0 ? '⚠️ غير محدد' : String(+v || v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
      else groups.set('الكل', feats);
      Array.from(groups.entries()).sort((a, b) => (parseFloat(a[0]) || 1e9) - (parseFloat(b[0]) || 1e9)).forEach(([k, fs]) => {
        const gl = kind === 'Polyline' ? fs.reduce((a, f) => a + lenOf(l, f), 0) : 0; const al = ak ? fs.reduce((a, f) => a + (parseFloat((f.properties || {})[ak]) || 0), 0) : 0;
        const tot = gl + (kind === 'Polyline' ? gapLen : 0);
        rows.push([l.name, kind, k, fs.length, +gl.toFixed(2), +al.toFixed(2), gaps, +gapLen.toFixed(3), +tot.toFixed(2), kind === 'Polyline' ? fmt(tot) : 'N/A', score, note, q]);
      });
    });
    return rows;
  }
  GV.unifiedAudit = layers => unifiedAudit(layers.map(l => ({ l })));
  function reportData() {
    const ls = dataLayers().filter(({ s }) => s.id !== 'field' && s.id !== 'qc' && !GV.superseded(s) && !(s.orgOut && /\|bg$/.test(s.orgOut)) && !(s.isCad && !s.orgOut && GV.sources.some(o => o.orgOut === s.name + '|net')));
    const st = ls.map(({ l, s }) => ({ l, s, ...layerStats(l) }));
    const sheets = [];
    const totalLen = st.reduce((a, x) => a + x.len, 0);
    const smart = GV.qcSmart ? GV.qcSmart() : null;
    const probs = smart ? smart.problems : [];
    const sev = { err: 'خطأ', warn: 'تحذير', info: 'ملاحظة' };
    const errP = probs.filter(p => p.sev === 'err'), warnP = probs.filter(p => p.sev === 'warn');
    const autoN = probs.filter(p => p.sev !== 'info' && FIXOP[p.type] && !/اختياري/.test(FIXOP[p.type])).reduce((a, p) => a + p.n, 0);
    const manN = probs.filter(p => p.sev !== 'info' && !(FIXOP[p.type] && !/اختياري/.test(FIXOP[p.type]))).reduce((a, p) => a + p.n, 0);
    sheets.push({ name: 'ملخص', rows: [['البند', 'القيمة'], ['تاريخ التقرير', new Date().toLocaleString('en-GB')], ['عدد الطبقات', ls.length], ['عدد العناصر', st.reduce((a, x) => a + x.n, 0)], ['إجمالي أطوال الخطوط (م)', +totalLen.toFixed(2)], ['عدد النقط', st.filter(x => x.l.kind === 'point').reduce((a, x) => a + x.n, 0)]]
      .concat(GV.qcLast ? [['', ''], ['آخر فحص', GV.qcLast.at.toLocaleString('en-GB')], ['مشاكل لازم تتحل (أخطاء)', errP.length + ' مشكلة في ' + errP.reduce((a, p) => a + p.n, 0) + ' مكان'], ['تحذيرات للمراجعة', warnP.length + ' مشكلة في ' + warnP.reduce((a, p) => a + p.n, 0) + ' مكان'], ['أماكن بتتحل تلقائي (🛠)', autoN], ['أماكن محتاجة مراجعتك بنفسك', manN], ['أسئلة مستنية إجابتك', smart.questions.length], ['ملاحظات اتشالت بسبب قواعدك', GV.qcDropped || 0]] : [['', ''], ['الفحص', 'لسه متعملش فحص — افتح "فحص الداتا"']]) });
    try { const ua = unifiedAudit(ls); if (ua.length > 1) sheets.push({ name: 'Unified_GIS_Audit_Report', rows: ua }); } catch (e) { console.error(e); }
    if (GV.qcLast) {
      const pri = p => p.sev === 'err' ? (p.systematic ? '1 - عاجل (الطبقة كلها)' : '1 - عالية') : p.sev === 'warn' ? '2 - متوسطة' : '3 - منخفضة';
      sheets.push({ name: 'المطلوب منك', rows: [['الأولوية', 'المشكلة', 'الطبقة', 'عدد الأماكن', 'طريقة الحل', 'السبب المحتمل / ملاحظات', 'أول مكان (Lon)', 'أول مكان (Lat)']].concat(probs.filter(p => p.sev !== 'info').map(p => { const it = p.items.find(i => i.ll); const fx = FIXOP[p.type]; return [pri(p), p.title, p.layer || '—', p.n, fx ? (/اختياري/.test(fx) ? 'تلقائي بعد موافقتك: ' + fx : 'بيتحل تلقائي: ' + fx) : 'مراجعة يدوية', (p.hint || '') + (p.related.size ? (p.hint ? ' | ' : '') + 'بيسبب كمان: ' + Array.from(p.related.keys()).join('، ') : ''), it ? +it.ll[0].toFixed(7) : '', it ? +it.ll[1].toFixed(7) : '']; })) });
    }
    // quantities
    const q = [['الطبقة', 'النوع', 'القطر', 'المادة', 'العدد', 'الطول (م)']];
    st.forEach(x => {
      const l = x.l;
      if (l.kind === 'line' || l.kind === 'mixed') {
        const df = diaField(l), mf = matField(l); const lnum = /^X-/.test(l.name) ? null : (l.name.match(/(\d{2,4})\s*$/) || [])[1];
        const m = new Map(); l.features.forEach(f => { if (f._sym || (f.properties && f.properties.Text != null)) return; const len = lenOf(l, f); if (!len) return; const dv = df ? f.properties[df] : lnum; const mv = mf ? f.properties[mf] : ''; const k = (dv == null || dv === '' ? '—' : dv) + '|' + (mv == null || mv === '' ? '—' : mv); const o = m.get(k) || { n: 0, len: 0 }; o.n++; o.len += len; m.set(k, o); });
        Array.from(m.entries()).sort((a, b) => (parseFloat(a[0]) || 0) - (parseFloat(b[0]) || 0)).forEach(([k, o]) => { const [dv, mv] = k.split('|'); q.push([l.name, 'خطوط', isFinite(+dv) ? +dv : dv, mv, o.n, +o.len.toFixed(2)]); });
        if (m.size > 1) q.push([l.name, 'الإجمالي', '', '', Array.from(m.values()).reduce((a, o) => a + o.n, 0), +Array.from(m.values()).reduce((a, o) => a + o.len, 0).toFixed(2)]);
      } else if (l.kind === 'point') {
        const tf = typeField(l), df = diaField(l);
        const m = new Map(); l.features.forEach(f => { if (f._sym || (f.properties && f.properties.Text != null)) return; const tv = tf ? f.properties[tf] : l.name; const dv = df ? f.properties[df] : ''; const k = (tv == null || tv === '' ? '—' : tv) + '|' + (dv == null || dv === '' ? '—' : dv); m.set(k, (m.get(k) || 0) + 1); });
        Array.from(m.entries()).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => { const [tv, dv] = k.split('|'); q.push([l.name, tv, isFinite(+dv) ? +dv : dv, '', n, '']); });
      } else if (l.kind === 'polygon') q.push([l.name, 'مضلعات', '', '', x.n, '']);
    });
    if (q.length > 1) sheets.push({ name: 'حصر الكميات', rows: q });
    sheets.push({ name: 'الطبقات', rows: [['الطبقة', 'المصدر', 'النوع', 'العدد', 'الطول (م)', 'المساحة (م2)', 'نظام الإحداثيات']].concat(st.map(x => [x.l.name, x.s.name, x.l.kind, x.n, +x.len.toFixed(2), +x.area.toFixed(2), x.l.crsLabel || ''])) });
    if (smart && smart.questions.length) sheets.push({ name: 'أسئلة مفتوحة', rows: [['السؤال', 'عدد الأماكن', 'أول مكان (Lon)', 'أول مكان (Lat)']].concat(smart.questions.map(qq => { const it = qq.items.find(i => i.ll); return [qq.text(qq.items.length), qq.items.length, it ? +it.ll[0].toFixed(7) : '', it ? +it.ll[1].toFixed(7) : '']; })) });
    if (GV.qcLast) sheets.push({ name: 'كل الأماكن', rows: [['الخطورة', 'الفئة', 'المشكلة', 'الطبقة', 'رقم العنصر', 'التفاصيل', 'Longitude', 'Latitude']].concat(GV.qcLast.issues.map(i => [sev[i.sev], ({ coord: 'الإحداثيات', z: 'المناسيب', geom: 'الهندسة', topo: 'الطوبولوجي', attr: 'البيانات الوصفية', un: 'Utility Network' })[i.cat], i.type, i.layer, i.fi != null ? i.fi + 1 : '', i.detail, i.ll ? +i.ll[0].toFixed(7) : '', i.ll ? +i.ll[1].toFixed(7) : ''])) });
    if (smart && smart.rules.length) sheets.push({ name: 'القواعد المطبقة', rows: [['القاعدة', 'المصدر', 'مفعّلة']].concat(smart.rules.map(r => [smart.ruleText(r), r.from || 'يدوي', r.off ? 'لأ' : 'أيوه'])) });
    if (GV.fixLog && GV.fixLog.length) sheets.push({ name: 'التعديلات التلقائية', rows: [['التعديل', 'الطبقة', 'التفاصيل', 'Longitude', 'Latitude']].concat(GV.fixLog.map(e => [(GV.FIX_NAMES || {})[e.op] || e.op, e.layer, e.detail, e.ll ? +e.ll[0].toFixed(7) : '', e.ll ? +e.ll[1].toFixed(7) : ''])) });
    const fl = (GV.sources.find(s => s.id === 'field') || { layers: [] }).layers;
    fl.forEach(l => { if (!l.features.length) return; const fs = GV.fieldsOf(l); sheets.push({ name: ('ميداني ' + l.name).slice(0, 31), rows: [fs.concat(['Longitude', 'Latitude'])].concat(l.features.map(f => fs.map(k => f.properties[k] == null ? '' : f.properties[k]).concat(f.geometry && f.geometry.type === 'Point' ? [f.geometry.coordinates[0], f.geometry.coordinates[1]] : ['', '']))) }); });
    return sheets;
  }

  /* ---------- minimal XLSX writer ---------- */
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const colN = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  async function xlsx(sheets) {
    const z = new JSZip(); const used = new Set();
    sheets.forEach(s => { let n = s.name.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Sheet'; let b = n, k = 2; while (used.has(n)) n = b.slice(0, 28) + ' ' + k++; used.add(n); s.safe = n; });
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + xe(s.safe) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3D45"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    sheets.forEach((s, i) => {
      const widths = []; s.rows.forEach(r => r.forEach((v, c) => { const l = Math.min(60, String(v == null ? '' : v).length + 2); widths[c] = Math.max(widths[c] || 8, l); }));
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + widths.map((w, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>';
      s.rows.forEach((r, ri) => { x += '<row r="' + (ri + 1) + '">' + r.map((v, c) => { const ref = colN(c) + (ri + 1); const st = ri === 0 ? ' s="1"' : ''; if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>'; return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xe(v == null ? '' : v) + '</t></is></c>'; }).join('') + '</row>'; });
      x += '</sheetData>' + (s.rows.length > 1 ? '<autoFilter ref="A1:' + colN(s.rows[0].length - 1) + s.rows.length + '"/>' : '') + '</worksheet>';
      z.file('xl/worksheets/sheet' + (i + 1) + '.xml', x);
    });
    return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  async function reportXlsx() {
    const sh = reportData(); if (!sh.length) return GV.toast('مفيش داتا للتقرير');
    const data = await xlsx(sh);
    await GV.saveFile('GIS_Report_' + new Date().toISOString().slice(0, 10) + '.xlsx', data);
  }
  async function reportHtml() {
    render();
    const sh = reportData();
    const css = 'body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;direction:rtl;margin:24px;color:#10292e}h1{color:#0b3d45}h2{margin-top:28px;border-bottom:2px solid #0e7c86;padding-bottom:4px}table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}th{background:#0b3d45;color:#fff;text-align:right;padding:6px}td{border-bottom:1px solid #dbe5e6;padding:5px 6px}.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpi{border:1px solid #dbe5e6;border-radius:10px;padding:10px 14px;min-width:120px}.kpi b{display:block;font-size:22px}.bars .bar-row{display:grid;grid-template-columns:160px 1fr 90px;gap:8px;align-items:center;margin:4px 0;font-size:13px}.bar-t{background:#eef5f5;height:14px;border-radius:4px}.bar-b{height:14px;border-radius:4px}.dgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.dcard{border:1px solid #dbe5e6;border-radius:12px;padding:12px}.dcard.wide{grid-column:1/-1}select,.row2{display:none}@media print{.dcard{break-inside:avoid}}';
    const dash = $('#dashBody').cloneNode(true); dash.querySelectorAll('select').forEach(s => s.remove());
    const sm = sh[0]; let html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير GIS</title><style>' + css + '.sum td:first-child{font-weight:600;width:45%}</style></head><body><h1>تقرير بيانات GIS</h1><p>' + xe(new Date().toLocaleString('en-GB')) + '</p><table class="sum">' + sm.rows.slice(1).map(r => '<tr><td>' + xe(r[0]) + '</td><td>' + xe(r[1]) + '</td></tr>').join('') + '</table>' + dash.innerHTML;
    sh.filter(s => s.name !== 'ملخص').forEach(s => { html += '<h2>' + xe(s.name) + '</h2><table>' + s.rows.slice(0, 2000).map((r, i) => '<tr>' + r.map(v => (i ? '<td>' : '<th>') + xe(v == null ? '' : v) + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</table>' + (s.rows.length > 2001 ? '<p>… و ' + (s.rows.length - 2001) + ' صف تاني (في تقرير Excel)</p>' : ''); });
    html += '</body></html>';
    await GV.saveFile('GIS_Report_' + new Date().toISOString().slice(0, 10) + '.html', html);
  }
  GV.reportXlsx = reportXlsx; GV.renderDash = render; GV.xlsx = xlsx;
})();
