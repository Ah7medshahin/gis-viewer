// Attributes from files: Excel / CSV / PDF / screenshots → match to features (by ID or by coordinates) → fill fields on a working copy
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  let S = null; // {layer, table:{head,rows}, files:[], key, mode, cols}
  const num = v => { const t = String(v == null ? '' : v).replace(/,/g, '').trim(); return /^[-+]?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null; };
  const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/^0+(?=\d)/, '');
  const targetLayers = () => GV.sources.filter(s => !s.isCad && s.id !== 'qc' && s.id !== 'field' && !s.isSchema && !GV.superseded(s)).flatMap(s => s.layers.filter(l => l.features.length && l.kind !== 'table').map(l => ({ l, s })));

  /* ---------- readers ---------- */
  function parseCSV(t) { const rows = []; let r = [], c = '', q = false; t = t.replace(/^﻿/, ''); const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : (t.split('\n')[0].indexOf('\t') >= 0 ? '\t' : ','); for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === sep) { r.push(c); c = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); rows.push(r); r = []; c = ''; } else c += ch; } if (c || r.length) { r.push(c); rows.push(r); } return rows.filter(x => x.some(v => String(v).trim() !== '')); }
  async function readXlsx(buf) {
    const z = await JSZip.loadAsync(buf); const ss = [];
    const sx = z.file('xl/sharedStrings.xml'); if (sx) { const d = new DOMParser().parseFromString(await sx.async('string'), 'application/xml'); Array.from(d.getElementsByTagName('si')).forEach(si => ss.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''))); }
    const wb = new DOMParser().parseFromString(await z.file('xl/workbook.xml').async('string'), 'application/xml'); const names = Array.from(wb.getElementsByTagName('sheet')).map(s => s.getAttribute('name'));
    const rel = z.file('xl/_rels/workbook.xml.rels') ? new DOMParser().parseFromString(await z.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml') : null;
    const sheets = Array.from(wb.getElementsByTagName('sheet')).map((s, i) => { const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); let tg = null; if (rel) { const r = Array.from(rel.getElementsByTagName('Relationship')).find(x => x.getAttribute('Id') === rid); if (r) tg = 'xl/' + r.getAttribute('Target').replace(/^\/?xl\//, ''); } return { name: names[i], path: tg || 'xl/worksheets/sheet' + (i + 1) + '.xml' }; });
    const out = [];
    for (const sh of sheets) {
      const f = z.file(sh.path); if (!f) continue; const d = new DOMParser().parseFromString(await f.async('string'), 'application/xml'); const rows = [];
      Array.from(d.getElementsByTagName('row')).forEach(r => { const arr = []; Array.from(r.getElementsByTagName('c')).forEach(c => { const ref = c.getAttribute('r') || ''; const col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; const t = c.getAttribute('t'); let v = ''; const vv = c.getElementsByTagName('v')[0]; if (t === 's') v = vv ? ss[+vv.textContent] : ''; else if (t === 'inlineStr') v = Array.from(c.getElementsByTagName('t')).map(x => x.textContent).join(''); else v = vv ? vv.textContent : ''; arr[col >= 0 ? col : arr.length] = v; }); for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = ''; if (arr.some(v => String(v).trim() !== '')) rows.push(arr); });
      if (rows.length) out.push({ name: sh.name, rows });
    }
    return out;
  }
  let pdfP = null;
  function loadPdfJs() {
    if (pdfP) return pdfP;
    pdfP = (async () => {
      const get = async (local, cdn) => { try { const r = await fetch(local); if (!r.ok) throw 0; return await r.text(); } catch (e) { const r = await fetch(cdn); if (!r.ok) throw new Error('مقدرتش أحمّل قارئ الـ PDF'); return await r.text(); } };
      const C = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
      const lib = await get('pdf/pdf.min.js.txt', C + 'pdf.min.js'); const wk = await get('pdf/pdf.worker.min.js.txt', C + 'pdf.worker.min.js');
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = URL.createObjectURL(new Blob([lib], { type: 'text/javascript' })); s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const pj = window.pdfjsLib || window['pdfjs-dist/build/pdf']; pj.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([wk], { type: 'text/javascript' }));
      return pj;
    })(); pdfP.catch(() => { pdfP = null; });
    return pdfP;
  }
  async function readPdf(buf, onImg) {
    const pj = await loadPdfJs(); const doc = await pj.getDocument({ data: new Uint8Array(buf) }).promise; const tables = [];
    for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
      const page = await doc.getPage(p); const tc = await page.getTextContent();
      const T = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ x: it.transform[4], y: it.transform[5], t: it.str.trim(), h: Math.abs(it.transform[3]) || it.height || 8 }));
      if (T.length >= 6) { try { const g = GV.ctGrid(T, []); if (g.rows.length) tables.push({ name: 'صفحة ' + p, head: g.head, rows: g.rows }); } catch (e) { } }
      else if (onImg) { const vp = page.getViewport({ scale: 2 }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; const b = await new Promise(r => cv.toBlob(r, 'image/png')); const t = await onImg(b, 'صفحة ' + p); if (t) tables.push(...t); }
    }
    return tables;
  }
  async function readImage(blob, label) {
    let sample = null; try { sample = window.claude && window.claude.use ? await window.claude.use('sample') : null; } catch (e) { }
    if (!sample) throw new Error('قراية الصور والـ PDF المصوّر بتتعمل بـ Claude، ودي شغالة من لينك Claude بس. على اللابتوب: استخدم Excel أو PDF فيه نص.');
    const prompt = 'Extract every table you can see in this image exactly as written. Return ONLY JSON: {"tables":[{"head":["col1",...],"rows":[["v1",...],...]}]}. Keep numbers exactly as printed (do not round or reformat), keep Arabic/English text as-is, one array per table row, empty string for empty cells. If the same columns repeat side by side, keep them as they appear. Do not invent values.';
    const r = await sample(prompt, { images: [blob], modelTier: 'default', cache: false });
    const m = (r.text || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('Claude مقدرش يطلّع جدول من ' + label);
    const j = JSON.parse(m[0]); return (j.tables || []).map((t, i) => ({ name: label + (j.tables.length > 1 ? ' · ' + (i + 1) : ''), head: t.head || [], rows: t.rows || [] }));
  }
  // first row with mostly text = header; unstack repeated column groups
  function shape(rows) {
    if (!rows.length) return { head: [], rows: [] };
    const n = Math.max(...rows.map(r => r.length)); rows = rows.map(r => { const x = r.map(v => v == null ? '' : String(v)); while (x.length < n) x.push(''); return x; });
    let hi = 0, best = -1; rows.slice(0, 6).forEach((r, i) => { const k = r.filter(c => c.trim() && num(c) == null).length; if (k > best) { best = k; hi = i; } });
    const texts = []; rows.forEach((r, ri) => r.forEach((c, ci) => { if (c.trim()) texts.push({ x: ci * 10, y: -ri * 3, t: c.trim(), h: 1 }); }));
    // reuse the CAD table logic (header/title/unstack/sort) when available
    try { const vl = Array.from({ length: n + 1 }, (_, i) => i * 10 - 1); const g = GV.ctGrid(texts, vl); if (g && g.head.length && g.rows.length) return g; } catch (e) { }
    return { head: rows[hi].map((h, i) => h || 'عمود ' + (i + 1)), rows: rows.slice(hi + 1) };
  }

  /* ---------- UI ---------- */
  function open(pre) {
    const tl = targetLayers();
    if (!tl.length) return GV.showMsg('افتح طبقة GIS الأول (GDB/SHP/GeoJSON…) أو حوّل الكاد لـ GIS، وبعدين هات ملفات البيانات.');
    S = { layer: pre || (S && tl.some(x => x.l === S.layer) ? S.layer : tl[0].l), table: null, files: [], over: false };
    render(); GV.openSheet('#asrcSheet');
  }
  function render() {
    const box = $('#asrcBody'); box.textContent = '';
    box.appendChild(el('p', 'small muted', 'هات Excel أو CSV أو PDF أو صور/سكرينات فيها جداول (أرقام النقط، الأقطار، المواد، المناسيب…) وأنا أطلّع منها البيانات وأحطها في الطبقة. الأصل مش بيتعدل.'));
    // 1 layer
    const s1 = el('div', 'step'); s1.appendChild(el('b', null, '1 · الطبقة اللي هتتملي'));
    const ls = el('select'); targetLayers().forEach(({ l, s }) => { const o = el('option', null, l.name + ' — ' + s.name + ' (' + l.features.length + ')'); o.value = l.id; ls.appendChild(o); }); ls.value = S.layer.id; ls.onchange = () => { S.layer = targetLayers().find(x => String(x.l.id) === ls.value).l; S.key = null; render(); }; s1.appendChild(ls); box.appendChild(s1);
    // 2 files
    const s2 = el('div', 'step'); s2.appendChild(el('b', null, '2 · ملفات البيانات'));
    const fi = el('input'); fi.type = 'file'; fi.multiple = true; fi.accept = '.xlsx,.xlsm,.csv,.txt,.pdf,.png,.jpg,.jpeg,.webp'; fi.hidden = true; fi.onchange = () => readFiles(Array.from(fi.files));
    const pick = el('button', 'open-btn sm', S.table ? '＋ زوّد ملفات' : '📎 اختار الملفات'); pick.onclick = () => fi.click();
    s2.append(fi, el('div', 'fc-acts')); s2.lastChild.append(pick, el('small', 'muted', 'Excel · CSV · PDF · صور'));
    if (S.files.length) s2.appendChild(el('p', 'small', S.files.map(f => '• ' + f).join('  ')));
    if (S.table) s2.appendChild(el('p', 'small ok-note', S.table.rows.length.toLocaleString('en') + ' صف · ' + S.table.head.length + ' عمود: ' + S.table.head.slice(0, 8).join(' | ')));
    box.appendChild(s2);
    if (!S.table) return;
    // preview
    const pv = el('div', 'tbl-wrap'); pv.style.maxHeight = '180px'; const tb = el('table', 'dtable'); const hr = el('tr'); S.table.head.forEach(h => hr.appendChild(el('th', null, h))); tb.appendChild(hr); S.table.rows.slice(0, 8).forEach(r => { const tr = el('tr'); r.forEach(c => tr.appendChild(el('td', null, c))); tb.appendChild(tr); }); pv.appendChild(tb); box.appendChild(pv);
    // 3 matching
    const L = S.layer; const flds = GV.fieldsOf(L);
    if (!S.key) S.key = guessKey(L);
    const s3 = el('div', 'step'); s3.appendChild(el('b', null, '3 · أربط الصفوف بالعناصر إزاي؟'));
    const md = el('select'); [['id', 'برقم/كود (حقل = عمود)'], ['xy', 'بالإحداثيات (أقرب عنصر)']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; md.appendChild(o); }); md.value = S.key.mode; md.onchange = () => { S.key.mode = md.value; render(); };
    s3.appendChild(md);
    if (S.key.mode === 'id') {
      const r = el('div', 'row2'); const f1 = el('select'); flds.forEach(f => { const o = el('option', null, f); o.value = f; f1.appendChild(o); }); f1.value = S.key.field || ''; f1.onchange = () => { S.key.field = f1.value; render(); };
      const c1 = el('select'); S.table.head.forEach((h, i) => { const o = el('option', null, h); o.value = i; c1.appendChild(o); }); c1.value = S.key.col; c1.onchange = () => { S.key.col = +c1.value; render(); };
      const a = el('label', 'fld'); a.append(el('span', null, 'حقل في الطبقة'), f1); const b = el('label', 'fld'); b.append(el('span', null, 'يساوي عمود'), c1); r.append(a, b); s3.appendChild(r);
    } else {
      const r = el('div', 'row2'); const ce = el('select'), cn = el('select'); S.table.head.forEach((h, i) => { [ce, cn].forEach(s => { const o = el('option', null, h); o.value = i; s.appendChild(o); }); }); ce.value = S.key.e; cn.value = S.key.n; ce.onchange = () => { S.key.e = +ce.value; render(); }; cn.onchange = () => { S.key.n = +cn.value; render(); };
      const a = el('label', 'fld'); a.append(el('span', null, 'عمود E / X'), ce); const b = el('label', 'fld'); b.append(el('span', null, 'عمود N / Y'), cn); r.append(a, b); s3.appendChild(r);
      const r2 = el('div', 'row2'); const tol = el('input'); tol.type = 'number'; tol.step = '0.1'; tol.value = S.key.tol; tol.onchange = () => { S.key.tol = +tol.value || 1; render(); };
      const crs = el('select'); GV.CRS_CHOICES.forEach(c => { if (!c[0] || c[0] === '4326') return; const o = el('option', null, c[1]); o.value = c[0]; crs.appendChild(o); }); crs.value = S.key.crs; crs.onchange = () => { S.key.crs = crs.value; render(); };
      const a2 = el('label', 'fld'); a2.append(el('span', null, 'أقصى مسافة (م)'), tol); const b2 = el('label', 'fld'); b2.append(el('span', null, 'نظام إحداثيات الجدول'), crs); r2.append(a2, b2); s3.appendChild(r2);
    }
    const m = match(); s3.appendChild(el('p', 'small ' + (m.hit ? 'ok-note' : 'err'), m.hit + ' صف من ' + S.table.rows.length + ' لقيتله عنصر · ' + m.feats + ' عنصر من ' + L.features.length + ' هيتملي' + (m.dup ? ' · ⚠ ' + m.dup + ' عنصر ليه أكتر من صف (هاخد أول واحد)' : '')));
    box.appendChild(s3);
    // 4 columns
    const s4 = el('div', 'step'); s4.appendChild(el('b', null, '4 · الأعمدة اللي هتتنقل'));
    if (!S.cols || S.cols.length !== S.table.head.length) S.cols = S.table.head.map((h, i) => ({ on: !isKeyCol(i), to: suggestField(h, flds) }));
    S.table.head.forEach((h, i) => { const c = S.cols[i]; const r = el('div', 'map-row'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = c.on; ck.onchange = () => { c.on = ck.checked; }; const inp = el('input'); inp.value = c.to; inp.setAttribute('list', 'asrcFlds'); inp.onchange = () => { c.to = inp.value.trim(); }; r.append(ck, el('span', 'mono', h), el('span', 'muted', '←'), inp); s4.appendChild(r); });
    const dl = el('datalist'); dl.id = 'asrcFlds'; flds.forEach(f => { const o = el('option'); o.value = f; dl.appendChild(o); }); s4.appendChild(dl);
    const ov = el('label', 'ck small'); const oc = el('input'); oc.type = 'checkbox'; oc.checked = S.over; oc.onchange = () => S.over = oc.checked; ov.append(oc, el('span', null, 'اكتب فوق القيم الموجودة (من غيرها بيملى الفاضي بس)')); s4.appendChild(ov);
    box.appendChild(s4);
    const go = el('button', 'open-btn', 'املى البيانات'); go.style.width = '100%'; go.style.justifyContent = 'center'; go.onclick = apply; box.appendChild(go);
  }
  async function readFiles(files) {
    if (!files.length) return;
    $('#busy').classList.add('show'); const all = [];
    try {
      for (const f of files) {
        $('#busyText').textContent = 'بقرا ' + f.name + '…'; const ext = f.name.split('.').pop().toLowerCase();
        if (ext === 'csv' || ext === 'txt') all.push({ name: f.name, ...shape(parseCSV(await f.text())) });
        else if (ext === 'xlsx' || ext === 'xlsm') (await readXlsx(await f.arrayBuffer())).forEach(sh => all.push({ name: f.name + ' · ' + sh.name, ...shape(sh.rows) }));
        else if (ext === 'pdf') { const t = await readPdf(await f.arrayBuffer(), async (b, lab) => { $('#busyText').textContent = 'Claude بيقرا ' + f.name + ' ' + lab + '…'; return (await readImage(b, f.name + ' ' + lab)).map(x => ({ name: x.name, ...shape([x.head].concat(x.rows)) })); }); t.forEach(x => all.push(x.head && x.rows ? x : { name: x.name, ...shape([x.head].concat(x.rows)) })); }
        else if (/^(png|jpe?g|webp)$/.test(ext)) { $('#busyText').textContent = 'Claude بيقرا الصورة ' + f.name + '…'; (await readImage(f, f.name)).forEach(x => all.push({ name: x.name, ...shape([x.head].concat(x.rows)) })); }
        else GV.toast('الصيغة دي مش مدعومة: ' + f.name);
        S.files.push(f.name);
      }
    } catch (e) { GV.showMsg('حصلت مشكلة في قراية الملف:\n' + (e.message || e)); }
    finally { $('#busy').classList.remove('show'); }
    const tabs = all.filter(t => t.head && t.head.length && t.rows && t.rows.length);
    if (!tabs.length) { render(); return GV.toast('ملقتش جداول في الملفات دي'); }
    // merge tables with the same columns, otherwise keep the biggest compatible set
    // merge by column names (same column in different files lands in the same place; new columns are added)
    const base = S.table || { head: tabs[0].head.slice(), rows: [] }; const nk = h => String(h).trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
    tabs.forEach(t => { const idx = t.head.map(h => { let i = base.head.findIndex(x => nk(x) === nk(h)); if (i < 0 && !/^عمود \d+$/.test(h)) { base.head.push(h); base.rows.forEach(r => r.push('')); i = base.head.length - 1; } return i; });
      t.rows.forEach(r => { const row = base.head.map(() => ''); idx.forEach((bi, ti) => { if (bi >= 0) row[bi] = r[ti] == null ? '' : r[ti]; }); base.rows.push(row); }); });
    const seen = new Set(); base.rows = base.rows.filter(r => { const k = r.join('|'); if (seen.has(k)) return false; seen.add(k); return r.some(c => String(c).trim()); });
    S.table = base; S.key = null; S.cols = null; render();
  }
  function isKeyCol(i) { return S.key && ((S.key.mode === 'id' && S.key.col === i) || (S.key.mode === 'xy' && (S.key.e === i || S.key.n === i))); }
  function suggestField(h, flds) { const n = String(h).trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ''); const f = flds.find(x => x.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '') === n); if (f) return f; const A = [[/^(dia|diameter|size|قطر)/i, /(diam|dia|size|قطر)/i], [/(material|mat|مادة)/i, /(mat|مادة)/i], [/(desc|description|type|وصف|نوع)/i, /(desc|type|نوع|وصف)/i], [/(elev|level|z|منسوب)/i, /(elev|level|^z$|منسوب)/i], [/(depth|عمق)/i, /(depth|عمق)/i]]; for (const [a, b] of A) if (a.test(h)) { const g = flds.find(x => b.test(x)); if (g) return g; } return String(h).trim().replace(/[^A-Za-z0-9_؀-ۿ]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'FIELD'; }
  function guessKey(L) {
    const T = S.table; const flds = GV.fieldsOf(L); let best = { score: 0 };
    const colVals = T.head.map((_, i) => new Set(T.rows.map(r => norm(r[i])).filter(Boolean)));
    flds.forEach(f => { const fv = new Set(L.features.map(x => norm((x.properties || {})[f])).filter(Boolean)); if (!fv.size) return; colVals.forEach((cv, i) => { let k = 0; cv.forEach(v => { if (fv.has(v)) k++; }); if (k > best.score) best = { score: k, field: f, col: i }; }); });
    const ei = T.head.findIndex((h, i) => /(east|^e$|^x$|easting)/i.test(h) || T.rows.slice(0, 20).every(r => { const v = num(r[i]); return v != null && v > 100000 && v < 1000000; }));
    const ni = T.head.findIndex((h, i) => /(north|^n$|^y$|northing)/i.test(h) || T.rows.slice(0, 20).every(r => { const v = num(r[i]); return v != null && v > 1000000 && v < 10000000; }));
    const crs = String((L.crsDef && /^(326|327|204)\d\d$/.test(String(L.crsDef))) ? L.crsDef : (GV.store.get('gv_tblcrs') || '32638'));
    const mode = best.score >= Math.min(3, T.rows.length) ? 'id' : (ei >= 0 && ni >= 0 ? 'xy' : 'id');
    return { mode, field: best.field || flds[0], col: best.col != null ? best.col : 0, e: ei >= 0 ? ei : 1, n: ni >= 0 ? ni : 2, tol: 1, crs };
  }
  function match() {
    const L = S.layer, T = S.table, k = S.key; const map = new Map(); let hit = 0, dup = 0;
    if (k.mode === 'id') {
      const idx = new Map(); L.features.forEach((f, fi) => { const v = norm((f.properties || {})[k.field]); if (!v) return; if (!idx.has(v)) idx.set(v, []); idx.get(v).push(fi); });
      T.rows.forEach((r, ri) => { const fs = idx.get(norm(r[k.col])); if (fs) { hit++; fs.forEach(fi => { if (map.has(fi)) dup++; else map.set(fi, ri); }); } });
    } else {
      const crs = GV.resolveCRS(String(k.crs)); if (!crs) return { hit: 0, feats: 0, map };
      const pts = L.features.map((f, fi) => ({ fi, c: f.wgs && f.wgs.geometry ? GV.firstCoord(f.wgs.geometry) : null })).filter(x => x.c);
      if (!pts.length) return { hit: 0, feats: 0, map };
      const lat0 = pts[0].c[1], KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110540, cell = Math.max(k.tol * 2, 1); const G = new Map();
      pts.forEach(p => { const kk = Math.floor(p.c[0] * KX / cell) + ',' + Math.floor(p.c[1] * KY / cell); if (!G.has(kk)) G.set(kk, []); G.get(kk).push(p); });
      T.rows.forEach((r, ri) => { const x = num(r[k.e]), y = num(r[k.n]); if (x == null || y == null) return; let w; try { w = crs.fn([x, y]); } catch (e) { return; } const cx = Math.floor(w[0] * KX / cell), cy = Math.floor(w[1] * KY / cell); let best = null, bd = Infinity; for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) (G.get(a + ',' + b) || []).forEach(p => { const d = Math.hypot((p.c[0] - w[0]) * KX, (p.c[1] - w[1]) * KY); if (d < bd) { bd = d; best = p; } }); if (best && bd <= k.tol) { hit++; if (map.has(best.fi)) dup++; else map.set(best.fi, ri); } });
    }
    return { hit, feats: map.size, dup, map };
  }
  async function apply() {
    const m = match(); if (!m.feats) return GV.toast('مفيش ولا صف اترابط بعنصر — راجع طريقة الربط');
    const cols = S.cols.map((c, i) => Object.assign({ i }, c)).filter(c => c.on && c.to && !isKeyCol(c.i));
    if (!cols.length) return GV.toast('اختار عمود واحد على الأقل');
    if (S.key.mode === 'xy') GV.store.set('gv_tblcrs', String(S.key.crs));
    const cp = await GV.workCopy(S.layer.src); const L = GV.liveLayer(S.layer); let filled = 0, skipped = 0;
    const types = L.schemaTypes || {};
    m.map.forEach((ri, fi) => { const f = L.features[fi]; if (!f) return; f.properties = f.properties || {}; const r = S.table.rows[ri]; cols.forEach(c => { let v = r[c.i]; if (v == null || String(v).trim() === '') return; const cur = f.properties[c.to]; if (!S.over && cur != null && String(cur).trim() !== '') { skipped++; return; } const t = types[c.to]; const n = num(v); if (t && /int|real|double|float|num/i.test(t) && n != null) v = n; else if (!t && n != null && String(v).length < 16 && !/^0\d/.test(String(v).trim())) v = n; f.properties[c.to] = v; filled++; }); });
    L.saveKey = null; if (GV.onDirty) GV.onDirty(); GV.renderLayers();
    const unmatched = S.table.rows.filter((_, ri) => !Array.from(m.map.values()).includes(ri));
    const box = $('#asrcBody'); box.textContent = '';
    box.appendChild(el('div', 'ok-note', '✓ اتملت ' + filled.toLocaleString('en') + ' قيمة في ' + m.feats + ' عنصر' + (skipped ? ' · ' + skipped + ' قيمة كانت موجودة وسيبتها' : '') + (cp !== S.layer.src ? ' — على "نسخة شغل"' : '')));
    if (unmatched.length) box.appendChild(el('p', 'small hint', '⚠ ' + unmatched.length + ' صف في الجدول ملقتلوش عنصر في الطبقة.'));
    const miss = L.features.length - m.feats; if (miss > 0) box.appendChild(el('p', 'small hint', '⚠ ' + miss + ' عنصر في الطبقة ملهوش صف في الجدول.'));
    const a = el('div', 'fc-acts');
    const t = el('button', 'open-btn sm', '☰ افتح جدول الطبقة'); t.onclick = () => GV.openTable(L, true);
    const u = el('button', 'chip', '⤓ الصفوف اللي ماترابطتش (Excel)'); u.onclick = async () => GV.saveFile('unmatched_rows.xlsx', await GV.xlsx([{ name: 'مش مربوط', rows: [S.table.head].concat(unmatched) }])); if (!unmatched.length) u.disabled = true;
    const q = el('button', 'chip', '✔ افحص البيانات تاني'); q.onclick = () => GV.openQC([L]);
    const bk = el('button', 'chip', '→ ارجع للربط'); bk.onclick = render;
    a.append(t, u, q, bk); box.appendChild(a);
  }
  $('#btnAttrSrc').addEventListener('click', () => open());
  GV.openAttrSrc = open; GV.readXlsxRows = readXlsx; GV.readImageTables = readImage; GV.shapeTable = rows => shape(rows);
})();
