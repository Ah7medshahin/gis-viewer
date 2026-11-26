/* 📊 Bill of quantities: pick the data (a file from outside, a layer group, or layers), and get quantities per layer —
   pipes by diameter (length + count), valves / fittings / structures by their internal classification (count).
   For every layer you can choose what to group by (and an optional second field); the choice is remembered (gv_boq). */
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const KEY = 'gv_boq'; let CFG = {}; try { CFG = JSON.parse(GV.store.get(KEY) || '{}'); } catch (e) { }
  const save = () => GV.store.set(KEY, JSON.stringify(CFG));
  const SYS = /^(objectid|fid|oid|globalid|shape|shape_length|shape_area|shape_leng|created_|last_edited|xcoord|ycoord|x$|y$|start.*coord|end.*coord|elevation|groundelevation|.*elevation$|comments?|remarks?|notes?)/i;
  const fields = l => GV.fieldsOf(l).filter(k => !SYS.test(k));
  const isLine = l => l.kind === 'line' || l.features.some(f => f.wgs && /LineString/.test(f.wgs.geometry.type));
  function autoField(l) {
    const fs = GV.fieldsOf(l); const has = k => fs.find(x => x.toLowerCase() === k.toLowerCase());
    if (isLine(l)) return fs.find(k => /^(diameter|dia|nominal_?dia(meter)?|size|pipe_?size|قطر)$/i.test(k)) || fs.find(k => /(diam|قطر)/i.test(k)) || (l.subtypes && has(l.subtypes.field)) || '';
    const D = GV.domInfoOf ? GV.domInfoOf(l) : null; if (D && D.subtypes && has(D.subtypes.field)) return has(D.subtypes.field);
    return ['FEATURETYPE', 'VALVETYPE', 'FITTINGTYPE', 'JUNCTIONTYPE', 'DEVICETYPE', 'ASSETTYPE', 'SUBTYPE', 'TYPE', 'Block'].map(has).find(Boolean) || fs.find(k => /(type|نوع|class|تصنيف)/i.test(k)) || '';
  }
  const autoSecond = l => isLine(l) ? (GV.fieldsOf(l).find(k => /^(material|mat|pipe_?material|مادة)$/i.test(k)) || '') : (GV.fieldsOf(l).find(k => /^(diameter|dia|size|قطر)$/i.test(k)) || '');
  const autoLenF = l => isLine(l) ? (GV.fieldsOf(l).find(k => /^actual_?length$/i.test(k)) || GV.fieldsOf(l).find(k => /^(measured_?length|pipe_?length|length)$/i.test(k)) || '') : '';
  const cfgOf = l => { const c = CFG[l.name] || {}; return { by: c.by != null ? c.by : autoField(l), by2: c.by2 != null ? c.by2 : autoSecond(l), lf: c.lf != null ? c.lf : autoLenF(l), on: c.on !== false }; };
  // domain / subtype code → its description
  function labeler(l, field) {
    const D = GV.domInfoOf ? GV.domInfoOf(l) : null; if (!D || !field) return v => v;
    if (D.subtypes && D.subtypes.field.toLowerCase() === field.toLowerCase()) { const m = new Map(D.subtypes.list.map(x => [String(x.code), x.name])); return v => m.has(String(v)) ? m.get(String(v)) : v; }
    const dn = D.domains && Object.keys(D.domains).find(k => k.toLowerCase() === field.toLowerCase()); const dd = dn && D.domainDefs ? D.domainDefs[D.domains[dn]] : null;
    if (dd && dd.codes) { const m = new Map(dd.codes.map(x => [String(x.code), x.name])); return v => m.has(String(v)) ? m.get(String(v)) : v; }
    return v => v;
  }
  function compute(ls) {
    const rows = [];
    ls.forEach(l => { const c = cfgOf(l); if (!c.on || !l.features.length) return; const line = isLine(l); const lab = labeler(l, c.by), lab2 = labeler(l, c.by2); const m = new Map();
      l.features.forEach(f => { if (f._sym) return; const p = f.properties || {}; const v1 = c.by ? p[c.by] : '', v2 = c.by2 ? p[c.by2] : '';
        const k = (v1 == null || v1 === '' ? '—' : lab(v1)) + '\u0001' + (v2 == null || v2 === '' ? (c.by2 ? '—' : '') : lab2(v2)); const o = m.get(k) || { n: 0, len: 0, fl: 0, fln: 0 }; o.n++; if (line && c.lf) { const fv = parseFloat(p[c.lf]); if (isFinite(fv)) { o.fl += fv; o.fln++; } }
        if (line && f.wgs) o.len += GV.lineLen(f.wgs.geometry) || 0; m.set(k, o); });
      const arr = [...m.entries()].map(([k, o]) => { const [a, b] = k.split('\u0001'); return { l, a, b, n: o.n, len: o.len, fl: c.lf ? o.fl : null, fln: o.fln, line }; });
      arr.sort((x, y) => (parseFloat(x.a) || 0) - (parseFloat(y.a) || 0) || String(x.a).localeCompare(String(y.a)) || String(x.b).localeCompare(String(y.b)));
      rows.push(...arr);
      if (arr.length > 1) rows.push({ l, a: 'الإجمالي', b: '', n: arr.reduce((s, r) => s + r.n, 0), len: arr.reduce((s, r) => s + r.len, 0), fl: c.lf ? arr.reduce((s, r) => s + (r.fl || 0), 0) : null, line, total: true });
    });
    return rows;
  }
  // ---------- sheet ----------
  const sh = el('div', 'sheet panel right'); sh.id = 'boqSheet';
  sh.innerHTML = '<div class="grab"></div><div class="sh-head"><h2>📊 جدول الكميات</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="boqBody"></div>';
  document.body.appendChild(sh); sh.querySelector('[data-close]').onclick = () => sh.classList.remove('open');
  let pick = { mode: 'all', group: null, layers: null };
  // ---- shared data picker (BOQ + dashboard): outside file · all · a group · chosen layers (inside the data or the group) ----
  const allL0 = () => GV.sources.filter(s => s.id !== 'qc' && s.id !== 'field').flatMap(s => s.layers).filter(l => l.features && l.features.length && !(GV.superseded && GV.superseded(GV.sources.find(s => s.layers.indexOf(l) >= 0))));
  GV.pickedLayers = st => st.mode === 'group' ? ((GV.groupsList().find(g => g.id === st.group) || {}).layers || []).filter(l => l.features.length) : st.mode === 'layers' ? (st.layers || []).filter(l => allL0().indexOf(l) >= 0) : allL0();
  GV.dataPicker = (st, redraw) => {
    const wrap = el('div'); const bar = el('div', 'qc-filt');
    const ch = (t, on, fn) => { const b = el('button', 'chip' + (on ? ' on' : ''), t); b.onclick = fn; bar.appendChild(b); };
    ch('📂 ملف من برا', false, () => { GV._pickPending = added => { const ls = (added || []).flatMap(s => s.layers || []).filter(l => l.features && l.features.length); if (ls.length) { st.mode = 'layers'; st.layers = ls; st.group = null; } redraw(); }; GV.pickData(); });
    ch('كل الطبقات المفتوحة', st.mode === 'all', () => { st.mode = 'all'; redraw(); });
    GV.groupsList().forEach(g => ch('📁 ' + g.name + ' (' + g.layers.length + ')', st.mode === 'group' && st.group === g.id, () => { st.mode = 'group'; st.group = g.id; redraw(); }));
    const base = st.mode === 'group' ? GV.pickedLayers(st) : allL0();
    ch('☑ أختار طبقات' + (st.mode === 'group' ? ' من الجروب' : ''), st.mode === 'layers', () => { const fromG = st.mode === 'group'; st.layers = (fromG ? GV.pickedLayers(st) : allL0()).slice(); st._pool = fromG ? st.layers.slice() : null; st.mode = 'layers'; redraw(); });
    wrap.appendChild(bar);
    if (st.mode === 'layers') { const lst = el('div', 'boq-pick'); const pool = st._pool && st._pool.length ? st._pool : allL0(); st._pool = pool;
      const srcName = l => (GV.sources.find(s => s.layers.indexOf(l) >= 0) || {}).name || '';
      pool.forEach(l => { const lb = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = st.layers.indexOf(l) >= 0; cb.onchange = () => { if (cb.checked) st.layers.push(l); else st.layers = st.layers.filter(x => x !== l); redraw(); }; lb.append(cb, document.createTextNode(' ' + l.name), el('span', 'muted small', '  ' + srcName(l))); lst.appendChild(lb); });
      const all = el('button', 'chip', 'الكل'), none = el('button', 'chip', 'ولا حاجة'); all.onclick = () => { st.layers = pool.slice(); redraw(); }; none.onclick = () => { st.layers = []; redraw(); };
      const r = el('div', 'fc-acts'); r.append(all, none); wrap.append(r, lst); }
    return wrap;
  };
  const chosen = () => GV.pickedLayers(pick);
  function render() {
    const box = $('#boqBody'); box.textContent = '';
    // 1) which data
    const s1 = el('div', 'step'); s1.appendChild(el('b', null, '1. الداتا'));
    s1.appendChild(GV.dataPicker(pick, render));
    box.appendChild(s1);
    const ls = chosen();
    if (!ls.length) { box.appendChild(el('p', 'muted', 'مفيش طبقات — افتح ملف أو اختار جروب.')); GV.openSheet('#boqSheet'); return; }
    // 2) per-layer: count by what
    const s2 = el('details', 'step'); s2.appendChild(el('summary', null, '2. الحصر لكل لير طبقًا لإيه (اضغط عشان تعدّل)'));
    ls.forEach(l => { const c = cfgOf(l); const row = el('div', 'boq-cfg');
      const on = el('input'); on.type = 'checkbox'; on.checked = c.on; on.title = 'تدخل في الحصر'; on.onchange = () => { CFG[l.name] = Object.assign({}, CFG[l.name], { on: on.checked }); save(); render(); };
      const mk = (val, key, first) => { const se = el('select'); const o0 = el('option', null, first); o0.value = ''; se.appendChild(o0); fields(l).forEach(k => { const o = el('option', null, k); o.value = k; se.appendChild(o); }); se.value = val || ''; se.onchange = () => { CFG[l.name] = Object.assign({}, CFG[l.name], { [key]: se.value }); save(); render(); }; return se; };
      row.append(on, el('b', null, l.name), el('span', 'muted small', isLine(l) ? 'خطوط · طول' : 'عدد'), mk(c.by, 'by', '— بدون تقسيم —'), mk(c.by2, 'by2', '— بدون تقسيم تاني —'));
      if (isLine(l)) { const lf = mk(c.lf, 'lf', '— من غير طول من حقل —'); lf.title = 'حقل الطول اللي يتجمع جنب طول الرسم (زي ACTUALLENGTH)'; row.appendChild(lf); }
      s2.appendChild(row); });
    const rs = el('button', 'chip', '↺ رجّع التقسيم التلقائي'); rs.onclick = () => { ls.forEach(l => { delete CFG[l.name]; }); save(); render(); }; s2.appendChild(rs);
    box.appendChild(s2);
    // 3) the table
    const rows = compute(ls);
    const s3 = el('div', 'step'); s3.appendChild(el('b', null, '3. الكميات'));
    const t = el('table', 'smp-t boq-t'); const hr = el('tr'); const anyF = rows.some(r => r.fl != null); const lfName = [...new Set(ls.map(l => cfgOf(l).lf).filter(Boolean))].join(' / '); ['الطبقة', 'التصنيف', 'تقسيم تاني', 'العدد', 'الطول من الرسم (م)'].concat(anyF ? ['الطول من الحقل' + (lfName ? ' (' + lfName + ')' : ''), 'الفرق'] : []).forEach(h => hr.appendChild(el('th', null, h))); t.appendChild(hr);
    rows.forEach(r => { const tr = el('tr', r.total ? 'tot' : ''); tr.append(el('td', null, r.total ? '' : r.l.name), el('td', null, String(r.a)), el('td', null, String(r.b || '')), el('td', 'num', r.n.toLocaleString('en')), el('td', 'num', r.line ? r.len.toLocaleString('en', { maximumFractionDigits: 2 }) : '')); if (anyF) { tr.append(el('td', 'num', r.fl != null ? r.fl.toLocaleString('en', { maximumFractionDigits: 2 }) + (r.fln != null && r.fln < r.n && !r.total ? ' (' + (r.n - r.fln) + ' فاضي)' : '') : ''), el('td', 'num', r.fl != null && r.line ? (r.fl - r.len).toLocaleString('en', { maximumFractionDigits: 2 }) : '')); } t.appendChild(tr); });
    const wrap = el('div', 'scroll'); wrap.appendChild(t); s3.appendChild(wrap);
    const acts = el('div', 'fc-acts');
    const xl = el('button', 'chip ok', '⬇ Excel'); xl.onclick = async () => { const H = ['الطبقة', 'التصنيف', 'تقسيم تاني', 'العدد', 'الطول من الرسم (م)', 'الطول من الحقل', 'الفرق']; const FL = r => r.fl != null ? +r.fl.toFixed(2) : ''; const DF = r => r.fl != null && r.line ? +(r.fl - r.len).toFixed(2) : ''; const data = [H].concat(rows.map(r => [r.total ? r.l.name + ' — الإجمالي' : r.l.name, String(r.a), String(r.b || ''), r.n, r.line ? +r.len.toFixed(2) : '', FL(r), DF(r)]));
      const per = ls.filter(l => cfgOf(l).on).map(l => ({ name: ('كميات ' + l.name).slice(0, 31), rows: [H.slice(1)].concat(rows.filter(r => r.l === l).map(r => [String(r.a), String(r.b || ''), r.n, r.line ? +r.len.toFixed(2) : '', FL(r), DF(r)])) }));
      const cf = [['الطبقة', 'التقسيم الأول', 'التقسيم التاني', 'حقل الطول']].concat(ls.map(l => { const c = cfgOf(l); return [l.name, c.by || '—', c.by2 || '—', c.lf || '—']; }));
      const bin = await GV.xlsx([{ name: 'جدول الكميات', rows: data }].concat(per).concat([{ name: 'طريقة الحصر', rows: cf }])); await GV.saveFile('BOQ_' + new Date().toISOString().slice(0, 10) + '.xlsx', bin); };
    const cp = el('button', 'chip', 'نسخ'); cp.onclick = () => { const txt = rows.map(r => [r.total ? 'الإجمالي' : r.l.name, r.a, r.b || '', r.n, r.line ? r.len.toFixed(2) : '', r.fl != null ? r.fl.toFixed(2) : ''].join('\t')).join('\n'); navigator.clipboard.writeText(txt).then(() => GV.toast('اتنسخ — الصقه في Excel')).catch(() => GV.toast('النسخ مش متاح هنا — نزّل Excel')); };
    acts.append(xl, cp); s3.appendChild(acts); box.appendChild(s3);
    GV.openSheet('#boqSheet');
  }
  GV.openBOQ = render;
  // a file opened from the BOQ screen → its layers become the selection
  const prevAfter = GV.afterOpen; GV.afterOpen = added => { if (GV._pickPending) { const cb = GV._pickPending; GV._pickPending = null; setTimeout(() => cb(added), 300); return; } if (prevAfter) prevAfter(added); };
  { const tools = document.querySelector('#toolsSheet .tools'); if (tools) { const b = el('button', 'tool'); b.innerHTML = '<span>📊</span><b>جدول الكميات</b><small>مواسير بالقطر، محابس وقطع بالتصنيف — من ملف أو جروب</small>'; b.onclick = () => render(); tools.insertBefore(b, tools.firstChild); } }
  const st = document.createElement('style'); st.textContent = '.boq-cfg{display:grid;grid-template-columns:auto 1fr auto;gap:6px 8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.boq-cfg select{grid-column:span 3;width:100%}.boq-pick{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto;margin-top:6px}.boq-t td.num{text-align:end;font-variant-numeric:tabular-nums}.boq-t tr.tot td{font-weight:700;border-top:2px solid var(--line)}';
  document.head.appendChild(st);
})();
