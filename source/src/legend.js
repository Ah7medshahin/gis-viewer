// CAD legend reader: find the LEGEND box, pair every symbol (block / line style / hatch) with its description,
// and turn it into classification + attributes (element type, diameter, material, valve type) for the organizer and GIS
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const TITLE = /(legend|legends|symbols?\s*(list|key)?|مفتاح\s*(الرموز|اللوحة)?|دليل\s*الرموز|الرموز|المفتاح|ليجند)/i;
  const MATS = [['DI', /\b(d\.?i\.?|ductile)\b/i], ['uPVC', /\bu\.?pvc\b/i], ['PVC', /\bpvc\b/i], ['HDPE', /\bhdpe\b/i], ['PE', /\bpe\s?(80|100)?\b/i], ['GRP', /\bgrp\b/i], ['Steel', /\b(steel|m\.?s\.?|c\.?s\.?)\b/i], ['AC', /\b(a\.?c\.?|asbestos)\b/i], ['CI', /\b(c\.?i\.?|cast iron)\b/i], ['RC', /\b(r\.?c\.?c?|concrete)\b/i], ['VC', /\b(v\.?c\.?|vitrified|clay)\b/i], ['PP', /\bpp\b/i]];
  const DIA = /(?:Ø|ø|DN\s*|D\s*=\s*|DIA\.?\s*)(\d{2,4})|(\d{2,4})\s*(?:mm|MM|مم|ملم)/;
  const VT = [['GATE', /(gate|\bgv\b|sluice|بوابة)/i], ['AIR', /(air|\bav\b|\barv\b|هواء)/i], ['WASH', /(wash|scour|\bwo\b|غسيل)/i], ['BUTF', /(butter|\bbv\b|فراشة)/i], ['CHCK', /(check|nrv|non.?return)/i], ['PRV', /(prv|pressure\s*reduc)/i]];
  let L = null; // current legend {src, entries:[], bbox}

  const cadSrcs = () => GV.sources.filter(s => s.isCad && !s.orgOut && !GV.superseded(s) && s.layers.some(l => l.features.length));
  const isText = f => f.properties && f.properties.Text != null && String(f.properties.Text).trim() !== '';
  const med = a => { a = a.filter(x => x > 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 1; };
  function info(desc) {
    const net = GV.store.get('gv_orgnet') || 'water'; let code = GV.netElemOf ? GV.netElemOf(desc) : null;
    if (net === 'water' && code === 'MHOL') code = 'CHMB'; if (/(sewer|storm)/.test(net) && code === 'SERV') code = 'LATR';
    const dm = DIA.exec(desc); const dia = dm ? +(dm[1] || dm[2]) : null; const mt = MATS.find(m => m[1].test(desc)); const vt = VT.find(v => v[1].test(desc));
    return { code, dia, mat: mt ? mt[0] : null, vtype: code === 'VALV' && vt ? vt[0] : null };
  }
  function collect(src) {
    const T = [], S = [];
    src.layers.forEach(l => l.features.forEach((f, fi) => { const g = f.geometry; if (!g || f._sym) return; const p = f.properties || {};
      if (isText(f)) T.push({ x: g.coordinates[0], y: g.coordinates[1], t: String(p.Text).trim(), h: +p.Height || 0, l });
      else if (g.type === 'Point' && p.Block) S.push({ kind: 'block', x: g.coordinates[0], y: g.coordinates[1], block: p.Block, l, f });
      else if (g.type === 'LineString' || g.type === 'Polygon') { const cs = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; cs.forEach(c => { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }); S.push({ kind: g.type === 'Polygon' || p.Entity === 'HATCH' ? 'area' : 'line', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, hh: y1 - y0, b: [x0, y0, x1, y1], l, f, color: f._color || l.color, block: null }); }
    }));
    return { T, S };
  }
  // pair symbols with descriptions inside a box
  function pair(T, S, box) {
    const inB = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
    const ts = T.filter(t => inB(t.x, t.y) && !TITLE.test(t.t)); if (!ts.length) return [];
    const h = med(ts.map(t => t.h)); const W = box[2] - box[0];
    const ss = S.filter(s => inB(s.x, s.y) && !(s.kind !== 'block' && (s.w > W * 0.6 || s.hh > W * 0.6)) && !(s.kind === 'line' && s.w < h * 0.3 && s.hh < h * 0.3));
    // rows of text
    const rows = []; ts.slice().sort((a, b) => b.y - a.y).forEach(t => { const r = rows.find(r => Math.abs(r.y - t.y) <= h * 0.8); if (r) { r.ts.push(t); r.y = (r.y * (r.ts.length - 1) + t.y) / r.ts.length; } else rows.push({ y: t.y, ts: [t] }); });
    const out = []; const used = new Set();
    ss.forEach(s => {
      const cy = s.kind === 'block' ? s.y : s.y; let best = null, bd = Infinity;
      rows.forEach(r => { const dy = Math.abs(r.y + h * 0.4 - cy); if (dy > h * 1.6) return; const dx = Math.min(...r.ts.map(t => Math.max(0, t.x > s.x ? t.x - (s.b ? s.b[2] : s.x) : (s.b ? s.b[0] : s.x) - t.x))); const d = dy * 3 + dx; if (dx < h * 30 && d < bd) { bd = d; best = r; } });
      if (!best) return;
      const side = best.ts.filter(t => (t.x > s.x) === (best.ts[0].x > s.x)); const desc = side.sort((a, b) => a.x - b.x).map(t => t.t).join(' ').replace(/\s+/g, ' ').trim();
      const k = (s.block || s.l.name + '|' + s.color) + '|' + desc; if (used.has(k)) return; used.add(k);
      out.push(Object.assign({ kind: s.kind, block: s.block, layer: s.l.name, color: s.color, desc, x: s.x, y: s.y }, info(desc)));
    });
    return out.sort((a, b) => b.y - a.y);
  }
  function find(src) {
    const { T, S } = collect(src); const titles = T.filter(t => TITLE.test(t.t) && t.t.length < 40).sort((a, b) => b.h - a.h);
    for (const ti of titles) {
      const H = ti.h || med(T.map(t => t.h)); const box0 = [ti.x - H * 30, ti.y - H * 250, ti.x + H * 120, ti.y + H * 2];
      // rows below the title until a big gap
      const cand = T.filter(t => t !== ti && t.x >= box0[0] && t.x <= box0[2] && t.y <= ti.y + H && t.y >= box0[1]).sort((a, b) => b.y - a.y);
      const hh = med(cand.map(t => t.h)) || H; let lastY = ti.y; const keep = [];
      for (const t of cand) { if (lastY - t.y > hh * 8) break; keep.push(t); lastY = Math.min(lastY, t.y); }
      if (keep.length < 2) continue;
      const box = [Math.min(ti.x, ...keep.map(t => t.x)) - hh * 25, Math.min(...keep.map(t => t.y)) - hh * 2, Math.max(ti.x, ...keep.map(t => t.x + t.t.length * (t.h || hh) * 0.8)) + hh * 25, ti.y + H * 1.5];
      const entries = pair(T, S, box);
      if (entries.length >= 2) return { src, box, title: ti.t, entries };
    }
    return null;
  }
  function fromBox(src, box) { const { T, S } = collect(src); return { src, box, title: 'تحديد يدوي', entries: pair(T, S, box) }; }

  /* ---------- apply to organizer / attributes ---------- */
  function use(leg) {
    const byLayer = {}, byBlock = {};
    leg.entries.forEach(e => { if (!e.code && !e.dia && !e.mat) return; const v = { code: e.code, dia: e.dia, mat: e.mat, vtype: e.vtype, desc: e.desc }; if (e.kind === 'block' && e.block) byBlock[e.block] = v; else if (e.layer && !byLayer[e.layer]) byLayer[e.layer] = v; });
    GV.legend = { byLayer, byBlock, n: leg.entries.length, box: leg.box, src: leg.src };
    Object.keys(byLayer).forEach(l => { const c = byLayer[l].code; if (c) GV.orgOverrides[l] = 'net:' + c; });
    GV.sources.forEach(s => s.layers.forEach(l => { l._cat = null; }));
    return GV.legend;
  }

  /* ---------- UI ---------- */
  function open() {
    const cs = cadSrcs(); if (!cs.length) return GV.showMsg('افتح ملف الكاد الأول.');
    if (!L || cs.indexOf(L.src) < 0) { L = null; for (const s of cs) { L = find(s); if (L) break; } if (!L) L = { src: cs[0], entries: [], box: null }; }
    render(); GV.openSheet('#legSheet');
  }
  function render() {
    const box = $('#legBody'); box.textContent = '';
    if (!L.entries.length) {
      box.appendChild(el('p', 'small', L.box ? 'ملقتش رموز في المنطقة دي.' : 'ملقتش ليجند في الرسمة (بدوّر على كلمة LEGEND / مفتاح الرموز).'));
      box.appendChild(GV_acts(btn('▭ حدد الليجند بإيدك', pick, true))); return;
    }
    box.appendChild(el('p', 'small muted', '🔑 ' + (L.title || '') + ' — ' + L.entries.length + ' رمز. كل رمز جنبه وصفه، وأنا طلّعت منه نوع العنصر والقطر والمادة. صحّح أي حاجة، وبعدين "استخدمه".'));
    const net = GV.store.get('gv_orgnet') || 'water'; const opts = (GV.orgCategories ? GV.orgCategories().options : []).filter(o => /^net:/.test(o)).map(o => o.split(' = '));
    L.entries.forEach(e => {
      const r = el('div', 'leg-row'); const sw = el('span', 'leg-sw ' + e.kind); if (e.kind !== 'block') sw.style.background = e.kind === 'area' ? e.color : 'none', sw.style.borderColor = e.color; else sw.textContent = '◆';
      const nm = el('div', 'leg-d'); nm.append(el('b', null, e.desc || '—'), el('small', 'muted mono', e.kind === 'block' ? 'بلوك: ' + e.block : 'لير: ' + e.layer));
      const sel = el('select'); const o0 = el('option', null, '— مش عنصر شبكة —'); o0.value = ''; sel.appendChild(o0); opts.forEach(([v, t]) => { const o = el('option', null, t.replace(/^شبكة: /, '')); o.value = v.replace(/^net:/, ''); sel.appendChild(o); }); sel.value = e.code || ''; sel.onchange = () => { e.code = sel.value || null; };
      const d = el('input'); d.placeholder = 'قطر'; d.value = e.dia || ''; d.className = 'leg-n'; d.onchange = () => { e.dia = +d.value || null; };
      const m = el('input'); m.placeholder = 'مادة'; m.value = e.mat || ''; m.className = 'leg-n'; m.onchange = () => { e.mat = m.value.trim() || null; };
      r.append(sw, nm, sel, d, m); box.appendChild(r);
    });
    box.appendChild(GV_acts(btn('✓ استخدمه في التصنيف والبيانات', () => { const g = use(L); GV.toast('اتسجل: ' + Object.keys(g.byLayer).length + ' لير و ' + Object.keys(g.byBlock).length + ' بلوك — هيتطبق في التنظيم والتحويل'); }, true), btn('⤓ Excel', saveX), btn('▭ حدد الليجند بإيدك', pick), btn('📍 وريني مكانه', showBox)));
  }
  const btn = (t, fn, main) => { const b = el('button', main ? 'open-btn sm' : 'chip', t); b.onclick = fn; return b; };
  const GV_acts = (...bs) => { const a = el('div', 'fc-acts'); bs.forEach(b => b && a.appendChild(b)); return a; };
  async function saveX() { const rows = [['الرمز', 'نوع', 'لير', 'الوصف', 'العنصر', 'القطر', 'المادة', 'نوع المحبس']].concat(L.entries.map(e => [e.block || '', e.kind, e.layer, e.desc, e.code || '', e.dia || '', e.mat || '', e.vtype || ''])); await GV.saveFile('legend.xlsx', await GV.xlsx([{ name: 'الليجند', rows }])); }
  function crsOf(src) { const l = src.layers.find(x => x.crsDef); return l ? GV.resolveCRS(String(l.crsDef)) : null; }
  function showBox() { const c = crsOf(L.src); if (!c || !L.box) return; const a = c.fn([L.box[0], L.box[1]]), b = c.fn([L.box[2], L.box[3]]); GV.closeSheets(); GV.map.fitBounds([[a[1], a[0]], [b[1], b[0]]], { padding: [30, 30] }); const r = L_rect([[a[1], a[0]], [b[1], b[0]]]); setTimeout(() => GV.map.removeLayer(r), 6000); }
  const L_rect = b => window.L.rectangle(b, { color: '#e03131', weight: 2, dashArray: '6 4', fillOpacity: 0.05, interactive: false }).addTo(GV.map);
  function pick() {
    const src = L.src, c = crsOf(src); if (!c || !c.inv) return GV.toast('حدد نظام إحداثيات الكاد الأول');
    GV.closeSheets(); const map = GV.map, cont = map.getContainer(); document.body.classList.add('picking'); $('#pickMsg').textContent = 'اسحب مستطيل حوالين الليجند';
    ['#pickDone', '#pickGPS'].forEach(q => $(q).style.display = 'none'); $('#pickPhotoIn').parentElement.style.display = 'none';
    let d0 = null, tmp = null; const wd = map.dragging.enabled(); map.dragging.disable(); const ta = cont.style.touchAction; cont.style.touchAction = 'none';
    const end = () => { cont.removeEventListener('pointerdown', pd, true); window.removeEventListener('pointermove', pm, true); window.removeEventListener('pointerup', pu, true); $('#pickCancel').removeEventListener('click', cancel); if (tmp) map.removeLayer(tmp); if (wd) map.dragging.enable(); cont.style.touchAction = ta; document.body.classList.remove('picking'); $('#pickGPS').style.display = ''; $('#pickPhotoIn').parentElement.style.display = ''; };
    const cancel = () => { end(); GV.openSheet('#legSheet'); };
    const pd = e => { if (e.target.closest && e.target.closest('#pickBar,.leaflet-control')) return; e.preventDefault(); e.stopPropagation(); d0 = map.mouseEventToLatLng(e); };
    const pm = e => { if (!d0) return; const p = map.mouseEventToLatLng(e); if (tmp) map.removeLayer(tmp); tmp = L_rect(window.L.latLngBounds(d0, p)); };
    const pu = e => { if (!d0) return; const p = map.mouseEventToLatLng(e); const a = c.inv([d0.lng, d0.lat]), b = c.inv([p.lng, p.lat]); d0 = null; end(); L = fromBox(src, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]); render(); GV.openSheet('#legSheet'); };
    cont.addEventListener('pointerdown', pd, true); window.addEventListener('pointermove', pm, true); window.addEventListener('pointerup', pu, true); $('#pickCancel').addEventListener('click', cancel);
  }
  $('#btnLeg').addEventListener('click', open);
  GV.openLegend = open;
  GV.legendAuto = src => { const lg = find(src); if (lg) { L = lg; use(lg); } return lg; };
  GV.legendSave = () => L && L.entries.length ? saveX() : null;
})();
