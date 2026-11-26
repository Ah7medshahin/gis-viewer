// Platform modules: export/convert (FME-like), team field collection (Survey123-like), shared layers
(function () {
  'use strict';
  const GV = window.GV;
  const { $, el } = GV;
  const DL_OK = new Set('gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig'.split(' '));
  const capCache = {};
  function cap(name) {
    if (!(name in capCache)) capCache[name] = (async () => { try { if (!window.claude || !window.claude.use) return null; return await window.claude.use(name); } catch (e) { return null; } })();
    return capCache[name];
  }

  /* ================= saving files ================= */
  GV.saveFile = (a, b) => saveFile(a, b);
  async function saveFile(filename, data) {
    const ext = filename.split('.').pop().toLowerCase();
    const dl = await cap('downloads');
    if (dl) {
      if (!DL_OK.has(ext)) { const z = new JSZip(); z.file(filename, data); data = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); filename += '.zip'; }
      try { await dl.save({ filename, data }); GV.toast('اتحفظ: ' + filename); }
      catch (e) { if (e && e.code !== 'declined') GV.showMsg('مقدرتش أحفظ الملف: ' + ((e && (e.message || e.code)) || e)); }
      return;
    }
    const blob = new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    GV.toast('اتحفظ: ' + filename);
  }

  /* ================= export / convert ================= */
  const EXP_CRS = [['4326', 'WGS84 (درجات)'], ['32636', 'WGS84 / UTM 36N'], ['32637', 'WGS84 / UTM 37N'], ['32638', 'WGS84 / UTM 38N'], ['32639', 'WGS84 / UTM 39N'], ['32640', 'WGS84 / UTM 40N'], ['20437', 'Ain el Abd / UTM 37N'], ['20438', 'Ain el Abd / UTM 38N'], ['20439', 'Ain el Abd / UTM 39N'], ['32635', 'WGS84 / UTM 35N']];
  const FMTS = [['gdb', 'File Geodatabase (.gdb)', 'ArcGIS'], ['gpkg', 'GeoPackage', 'ArcGIS / QGIS'], ['shp', 'Shapefile', ''], ['dxf', 'كاد (DXF → DWG)', 'AutoCAD'], ['kml', 'KML', 'Google Earth'], ['kmz', 'KMZ', 'Google Earth'], ['geojson', 'GeoJSON', ''], ['csv', 'CSV / Excel', '']];
  const CAD_STD = [['*STD', '★ ستاندرد الكاد (NCS + ألوان المرافق العالمية + سُمك حسب القطر + أنوتيشن هندسي)'], ['', '— زي اسم طبقة GIS —'], ['C-WATR', 'مياه C-WATR'], ['C-SSWR', 'صرف صحي C-SSWR'], ['C-STRM', 'أمطار C-STRM'], ['E-POWR', 'كهرباء E-POWR'], ['E-LITE', 'إنارة E-LITE'], ['C-COMM', 'اتصالات C-COMM'], ['C-NGAS', 'غاز C-NGAS'], ['L-IRRG', 'ري L-IRRG'], ['C-ROAD', 'طرق C-ROAD'], ['C-TOPO', 'مساحة C-TOPO']];
  let expPre = null;
  function allLayers() { return GV.sources.flatMap(s => s.layers.filter(l => l.features.length || l.schemaFields).map(l => ({ l, s }))); }
  function selFmts() { return Array.from(document.querySelectorAll('#expFmts input')).filter(c => c.checked).map(c => c.value); }
  function openExport(pre) {
    expPre = pre || null;
    const box = $('#expLayers'); box.textContent = '';
    const ls = allLayers();
    if (!ls.length) { GV.showMsg('افتح ملف الأول علشان تحوّله.'); return; }
    const saveL = (l, on) => { if (!expPre) { let M = {}; try { M = JSON.parse(GV.store.get('gv_explayers') || '{}'); } catch (e) { } M[l.name] = on; GV.store.set('gv_explayers', JSON.stringify(M)); } };
    let SVL = {}; try { SVL = JSON.parse(GV.store.get('gv_explayers') || '{}'); } catch (e) { }
    const cbs = []; const grpCbs = [];
    const refreshG = () => grpCbs.forEach(({ cb, list }) => { const n = list.filter(x => x.checked).length; cb.checked = n === list.length && n > 0; cb.indeterminate = n > 0 && n < list.length; });
    const mkRow = ({ l, s }) => {
      const lab = el('label', 'ck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = pre ? pre.indexOf(l) >= 0 : (l.name in SVL ? !!SVL[l.name] : l.visible); cb._layer = l; cbs.push(cb);
      cb.addEventListener('change', () => { saveL(l, cb.checked); refreshG(); fillFields(); });
      lab.append(cb, el('span', null, l.name), el('small', 'muted', ' · ' + s.name + ' · ' + l.features.length.toLocaleString('en'))); return lab; };
    const setOnly = keep => { cbs.forEach(c => { c.checked = keep(c._layer); saveL(c._layer, c.checked); }); refreshG(); fillFields(); };
    // quick choices: all / none / one group
    const groups = GV.groupsList ? GV.groupsList() : [];
    const bar = el('div', 'qc-filt'); const chip = (t, fn) => { const b = el('button', 'chip', t); b.type = 'button'; b.onclick = fn; bar.appendChild(b); };
    chip('الكل', () => setOnly(() => true)); chip('ولا حاجة', () => setOnly(() => false));
    groups.forEach(g => chip('📁 ' + g.name + ' بس', () => { const set = new Set(g.layers); setOnly(l => set.has(l)); }));
    box.appendChild(bar);
    // groups as folders: tick the folder for all its layers, or open it and tick some
    const inG = new Set();
    groups.forEach(g => { const rows = ls.filter(x => g.layers.indexOf(x.l) >= 0); if (!rows.length) return; rows.forEach(x => inG.add(x.l));
      const d = el('details', 'exp-grp'); const sm = el('summary'); const gcb = el('input'); gcb.type = 'checkbox'; gcb.onclick = e => e.stopPropagation();
      sm.append(el('span', 'exp-arr', '◀'), gcb, el('b', null, ' 📁 ' + g.name), el('small', 'muted', ' · ' + rows.length + ' طبقة — دوس السهم عشان تختار طبقات منه')); d.appendChild(sm);
      const list = []; rows.forEach(x => { const r = mkRow(x); list.push(cbs[cbs.length - 1]); d.appendChild(r); });
      gcb.addEventListener('change', () => { list.forEach(c => { c.checked = gcb.checked; saveL(c._layer, c.checked); }); refreshG(); fillFields(); });
      grpCbs.push({ cb: gcb, list }); box.appendChild(d); });
    const rest = ls.filter(x => !inG.has(x.l));
    if (rest.length && inG.size) box.appendChild(el('div', 'muted small', 'طبقات مش في جروب'));
    rest.forEach(x => box.appendChild(mkRow(x)));
    refreshG();
    const fb = $('#expFmts');
    if (!fb.children.length) {
      const saved = (GV.store.get('gv_expfmts') || 'gpkg').split(',');
      FMTS.forEach(([v, t, sub]) => { const lab = el('label', 'fmt-ck'); const cb = el('input'); cb.type = 'checkbox'; cb.value = v; cb.checked = saved.indexOf(v) >= 0; cb.addEventListener('change', updFmtHints); lab.append(cb, el('b', null, t)); if (sub) lab.appendChild(el('small', null, sub)); fb.appendChild(lab); });
      const cs = $('#expCrs'); const o = el('option', null, 'زي ما هو (النظام الأصلي)'); o.value = 'orig'; cs.appendChild(o); EXP_CRS.forEach(([v, t]) => { const o2 = el('option', null, t); o2.value = v; cs.appendChild(o2); }); cs.value = GV.store.get('gv_expcrs') || 'orig';
      const sd = $('#cadStd'); CAD_STD.forEach(([v, t]) => { const o3 = el('option', null, t); o3.value = v; sd.appendChild(o3); }); sd.value = GV.store.get('gv_cadstd') != null ? GV.store.get('gv_cadstd') : '*STD'; $('#cadProj').value = GV.store.get('gv_cadproj') || ''; $('#cadDwgNo').value = GV.store.get('gv_caddwgno') || '';
    }
    $('#expFVal').value = '';
    fillFields(); updFmtHints();
    GV.openSheet('#expSheet');
  }
  function selLayers() { return Array.from(document.querySelectorAll('#expLayers input')).filter(c => c.checked && c._layer).map(c => c._layer); }
  function unionFields(layers) { const seen = new Set(), out = []; layers.forEach(l => GV.fieldsOf(l).forEach(k => { if (!seen.has(k)) { seen.add(k); out.push(k); } })); return out; }
  function fillFields() {
    const fields = unionFields(selLayers()); selLayers().forEach(l => (l.schemaFields || []).forEach(k => { if (fields.indexOf(k) < 0) fields.push(k); }));
    const box = $('#expFields'); const prev = new Map(Array.from(box.querySelectorAll('input[data-fl]')).map(c => [c.dataset.ln + '\u0001' + c.value, c.checked])); box.textContent = ''; box.classList.remove('two');
    let FOFF = {}; try { FOFF = JSON.parse(GV.store.get('gv_expfields_off') || '{}'); } catch (e) { }
    const saveF = () => { let M = {}; try { M = JSON.parse(GV.store.get('gv_expfields_off') || '{}'); } catch (e) { } const by = {}; box.querySelectorAll('input[data-fl]').forEach(c => { (by[c.dataset.ln] = by[c.dataset.ln] || []); if (!c.checked) by[c.dataset.ln].push(c.value); }); Object.assign(M, by); GV.store.set('gv_expfields_off', JSON.stringify(M)); };
    const LS = selLayers(); LS.forEach((l, li) => { const lf = GV.fieldsOf(l).slice(); (l.schemaFields || []).forEach(k => { if (lf.indexOf(k) < 0) lf.push(k); }); if (!lf.length) return;
      const det = el('details', 'fgrp'); if (LS.length <= 3) det.open = true; const sm = el('summary', null); const cnt = el('span', 'small muted'); const upd = () => { cnt.textContent = ' (' + det.querySelectorAll('input:checked').length + '/' + lf.length + ')'; };
      const ba = el('button', 'chip', 'الكل'), bn = el('button', 'chip', 'ولا حاجة'); ba.type = bn.type = 'button'; ba.onclick = e => { e.preventDefault(); det.querySelectorAll('input').forEach(c => c.checked = true); upd(); saveF(); }; bn.onclick = e => { e.preventDefault(); det.querySelectorAll('input').forEach(c => c.checked = false); upd(); saveF(); };
      sm.append(el('b', null, l.name), cnt, ' ', ba, ' ', bn); det.appendChild(sm); const g = el('div', 'cklist two');
      lf.forEach(k => { const lab = el('label', 'ck small'); const cb = el('input'); cb.type = 'checkbox'; cb.value = k; cb.dataset.fl = '1'; cb.dataset.ln = l.name; cb._layer = l; const pk = l.name + '\u0001' + k; cb.checked = prev.has(pk) ? prev.get(pk) : !(FOFF[l.name] || []).includes(k); cb.onchange = () => { upd(); saveF(); }; lab.append(cb, el('span', null, k)); g.appendChild(lab); });
      det.appendChild(g); box.appendChild(det); upd(); });
    fillLabTypes(LS);
    for (const id of ['#expFField', '#expLabel', '#cadField', '#cadColorField']) {
      const s = $(id); const v = s.value; s.textContent = '';
      const o0 = el('option', null, id === '#expFField' ? '— بدون فلتر —' : '— بدون —'); o0.value = ''; s.appendChild(o0);
      fields.forEach(k => { const o = el('option', null, k); o.value = k; s.appendChild(o); }); s.value = fields.indexOf(v) >= 0 ? v : '';
    }
    { const al = $('#cadAnnoList'); const prevA = new Map(Array.from(al.querySelectorAll('input')).map(c => [c.value, c.checked])); const saved = (GV.store.get('gv_cadanno') || '').split(',').filter(Boolean); al.textContent = '';
      const DEF = /^(diameter|dia|material|featuretype|mh_?id|manhole_anno|catchbasin_id|asset_?number_?|line_id|slope|pole_type|cross_sectional_area_?|panel_?number)$/i; let nDef = 0;
      fields.forEach(k => { const lab = el('label', 'ck small'); const cb = el('input'); cb.type = 'checkbox'; cb.value = k; cb.checked = prevA.has(k) ? prevA.get(k) : saved.length ? saved.indexOf(k) >= 0 : (DEF.test(k) && nDef++ < 4); lab.append(cb, el('span', null, k)); al.appendChild(lab); }); }
    $('#expCount').textContent = selLayers().length + ' طبقة · ' + fields.length + ' حقل';
    updPattern();
  }
  // label filter by type value (FEATURETYPE / TYPE …) per point layer — the symbol stays, only its label is dropped
  const TYPE_SPEC = 'FEATURETYPE|VALVETYPE|TYPE|SUBTYPE|MANHOLE_TYPE|FITTINGTYPE';
  const LBL_NONE = '(فاضي)';
  const labVal = (f, fld) => { if (!fld) return (GV.cadVal(f.properties || {}, TYPE_SPEC, null) || '').toUpperCase() || LBL_NONE; const v = (f.properties || {})[fld]; return v == null || String(v).trim() === '' ? LBL_NONE : String(v).trim().toUpperCase(); };
  const jget = (k, d) => { try { return JSON.parse(GV.store.get(k) || '') || d; } catch (e) { return d; } };
  // candidate classification fields of a layer: SUBTYPE/TYPE-like first, then any field with 2–60 distinct values
  function classFields(l, pts) { const fs = GV.fieldsOf(l); const out = [];
    fs.forEach(k => { if (/^(objectid|fid|globalid|shape.*|x|y|z|e|n|easting|northing|.*_?id|.*date.*|.*level.*|elev.*|gl|il|.*length.*|.*area.*|.*depth.*|remarks?|notes?|comments?)$/i.test(k)) return; const S = new Set(); for (const f of pts) { const v = (f.properties || {})[k]; if (v != null && String(v).trim() !== '') S.add(String(v).trim()); if (S.size > 60) break; } if (S.size >= 1 && S.size <= 60) out.push({ k, n: S.size }); });
    const pri = k => /^subtype(cd|code)?$|subtype/i.test(k) ? 0 : /^featuretype$|feature_?type/i.test(k) ? 1 : /type|class|kind|category|تصنيف|نوع/i.test(k) ? 2 : 3;
    return out.sort((a, b) => pri(a.k) - pri(b.k) || a.n - b.n); }
  function fillLabTypes(LS) {
    const box = $('#cadLabTypes'); if (!box) return; const off = new Set(jget('gv_labskip2', [])); const FLD = jget('gv_labfield', {});
    box.textContent = ''; let any = 0;
    LS.forEach(l => { const pts = l.features.filter(f => f.geometry && /Point/.test(f.geometry.type)); if (!pts.length) return; any++;
      const CF = classFields(l, pts); const det = el('details', 'fgrp'); const sm = el('summary', null); const info = el('span', 'small muted'); sm.append(el('b', null, l.name), info); det.appendChild(sm);
      const row = el('div', 'small'); row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0';
      const sel = el('select'); sel.style.cssText = 'max-width:220px'; const o0 = el('option', null, 'تلقائي (FEATURETYPE / TYPE)'); o0.value = ''; sel.appendChild(o0);
      CF.forEach(c => { const o = el('option', null, c.k + ' (' + c.n + ')'); o.value = c.k; sel.appendChild(o); });
      const want = FLD[l.name] != null ? FLD[l.name] : (CF.find(c => /subtype/i.test(c.k)) || {}).k || ''; sel.value = CF.some(c => c.k === want) ? want : '';
      const ba = el('button', 'chip', 'الكل'), bn = el('button', 'chip', 'ولا حاجة'); ba.type = bn.type = 'button';
      row.append(el('span', null, 'التصنيف حسب حقل:'), sel, ba, bn); det.appendChild(row); const g = el('div', 'cklist two'); det.appendChild(g);
      // natural label order: type/class → name/number → coordinates (E, N) → levels (G.L, IL) → anything else
      const RANK = k => /^(feature_?type|valve_?type|type|subtype|subtype_?(cd|code)|class|category)$|type$/i.test(k) ? 0 : /(id|no|num|number|anno|label|tag|code|name)$/i.test(k) && !/street|district|road/i.test(k) ? 1 : /^(x|e|easting|x_?coord(inate)?|coord_?x|point_?x)$/i.test(k) ? 2 : /^(y|n|northing|y_?coord(inate)?|coord_?y|point_?y)$/i.test(k) ? 3 : /^(ground_?elevation|ground_?level|gl|cover_?level|coverlevel|cl|z)$/i.test(k) ? 4 : /^(elevation|elev|invert_?level|invertlevel|il|us_?pipe_?il|pipe_?elevation)$/i.test(k) ? 5 : 6;
      const natSort = a => a.map((k, i) => [k, i]).sort((x, y) => RANK(x[0]) - RANK(y[0]) || x[1] - y[1]).map(x => x[0]);
      const EX = jget('gv_labextra', {}); const allF = GV.fieldsOf(l); let ord0 = (EX[l.name] || []).filter(k => allF.indexOf(k) >= 0);
      if (!jget('gv_labextra_v2', {})[l.name]) { ord0 = natSort(ord0); const V = jget('gv_labextra_v2', {}); V[l.name] = 1; GV.store.set('gv_labextra_v2', JSON.stringify(V)); }
      const ord = ord0;
      const exRow = el('div', 'fgrp'); exRow.style.cssText = 'margin:6px 0;padding:6px'; const exT = el('div', 'small'); exT.style.fontWeight = '600'; exRow.appendChild(exT);
      const ol = el('div'); exRow.appendChild(ol); const addSel = el('select'); addSel.style.cssText = 'max-width:240px;margin-top:4px'; exRow.appendChild(addSel);
      const exG = el('div'); exG.dataset.lx = '1'; exG._layer = l; exRow.appendChild(exG);
      const save = () => { exG._ord = ord.slice(); const F = jget('gv_labextra', {}); F[l.name] = ord.slice(); GV.store.set('gv_labextra', JSON.stringify(F)); };
      const draw = () => { ol.textContent = ''; exT.textContent = ord.length ? 'ترتيب الليبل (من فوق لتحت):' : 'ترتيب الليبل: الافتراضي (النوع، E، N، G.L، IL) — أضف حقول عشان تعمل ترتيبك';
        ord.forEach((k, i) => { const r = el('div', 'small'); r.style.cssText = 'display:flex;align-items:center;gap:4px;margin:2px 0';
          const up = el('button', 'chip', '▲'), dn = el('button', 'chip', '▼'), rm = el('button', 'chip', '✕'); [up, dn, rm].forEach(b2 => b2.type = 'button'); up.disabled = i === 0; dn.disabled = i === ord.length - 1;
          up.onclick = e => { e.preventDefault(); [ord[i - 1], ord[i]] = [ord[i], ord[i - 1]]; save(); draw(); }; dn.onclick = e => { e.preventDefault(); [ord[i + 1], ord[i]] = [ord[i], ord[i + 1]]; save(); draw(); }; rm.onclick = e => { e.preventDefault(); ord.splice(i, 1); save(); draw(); };
          r.append(el('b', null, (i + 1) + '.'), el('span', null, k), up, dn, rm); r.querySelector('span').style.flex = '1'; ol.appendChild(r); });
        addSel.textContent = ''; const o0 = el('option', null, '+ أضف حقل لليبل…'); o0.value = ''; addSel.appendChild(o0); allF.filter(k => ord.indexOf(k) < 0).forEach(k => { const o = el('option', null, k); o.value = k; addSel.appendChild(o); }); };
      addSel.onchange = () => { const k = addSel.value; if (!k) return; let at = ord.length; const r = RANK(k); for (let i = 0; i < ord.length; i++) if (RANK(ord[i]) > r) { at = i; break; } ord.splice(at, 0, k); save(); draw(); };
      const auto = el('button', 'chip', 'رتّب تلقائي (النوع ← الاسم ← الإحداثيات ← المناسيب)'); auto.type = 'button'; auto.style.marginInlineStart = '6px'; auto.onclick = e => { e.preventDefault(); const n = natSort(ord); ord.length = 0; ord.push(...n); save(); draw(); }; exRow.insertBefore(auto, exG);
      exG._ord = ord.slice(); draw(); det.appendChild(exRow);
      const upd = () => { const t = g.querySelectorAll('input').length, c = g.querySelectorAll('input:checked').length; info.textContent = ' — ' + (sel.value || 'تلقائي') + ' · ليبل لـ ' + c + ' من ' + t; };
      const build = () => { g.textContent = ''; const fld = sel.value; const C = new Map(); pts.forEach(f => { const v = labVal(f, fld); C.set(v, (C.get(v) || 0) + 1); });
        [...C.entries()].sort((a, b) => b[1] - a[1]).forEach(([v, n]) => { const lab = el('label', 'ck small'); const cb = el('input'); cb.type = 'checkbox'; cb.dataset.lt = l.name + '::' + fld + '::' + v; cb.checked = !off.has(cb.dataset.lt); cb.onchange = upd; lab.append(cb, el('span', null, v + ' (' + n + ')')); g.appendChild(lab); });
        det.open = det.open || C.size > 1 && LS.length <= 4; upd(); };
      sel.onchange = () => { const F = jget('gv_labfield', {}); F[l.name] = sel.value; GV.store.set('gv_labfield', JSON.stringify(F)); build(); };
      ba.onclick = e => { e.preventDefault(); g.querySelectorAll('input').forEach(c => c.checked = true); upd(); }; bn.onclick = e => { e.preventDefault(); g.querySelectorAll('input').forEach(c => c.checked = false); upd(); };
      sel._layer = l; sel.dataset.lf = '1'; build(); box.appendChild(det); });
    if (!any) box.appendChild(el('span', 'small muted', 'مفيش طبقات نقط مختارة.'));
  }
  // returns { fieldOf: Map(layer → field), skip: Set('layer::VALUE') }
  function labSkip() { const sk = new Set(); const fieldOf = new Map(); document.querySelectorAll('#cadLabTypes select[data-lf]').forEach(s2 => fieldOf.set(s2._layer, s2.value));
    const all = Array.from(document.querySelectorAll('#cadLabTypes input[data-lt]')); all.forEach(c => { if (!c.checked) { const [ln, , v] = c.dataset.lt.split('::'); sk.add(ln + '::' + v); } });
    try { const shown = new Set(all.map(c => c.dataset.lt)); const old = jget('gv_labskip2', []).filter(k => !shown.has(k)); GV.store.set('gv_labskip2', JSON.stringify(old.concat(all.filter(c => !c.checked).map(c => c.dataset.lt)))); } catch (e) { }
    const extraOf = new Map(); document.querySelectorAll('#cadLabTypes div[data-lx]').forEach(g2 => { const c = (g2._ord || []).slice(); if (c.length) extraOf.set(g2._layer, c); }); sk.extraOf = extraOf; sk.notes = [];
    sk.fieldOf = fieldOf; return sk; }
  function updPattern() {
    const std = $('#cadStd').value, f = $('#cadField').value, mode = $('#cadMode').value;
    const isStd = std === '*STD'; ['#cadSheetRow', '#cadSheetInfo', '#cadScaleRow', '#cadLabTypesRow'].forEach(id => { const n = $(id); if (n) n.style.display = isStd ? '' : 'none'; }); ['#cadMode', '#cadColor', '#cadColorField', '#cadAnnoList'].forEach(id => { const n = $(id); const box = n && (n.closest('label') || n.closest('.fld')); if (box) box.style.display = isStd ? 'none' : ''; });
    if (isStd) { $('#cadFieldRow').style.display = 'none'; $('#cadPatternRow').style.display = 'none'; const ls = selLayers(); $('#cadExample').textContent = 'اللايرات: ' + ls.slice(0, 6).map(l => { const ft = l.features.find(x => x.properties); const S = GV.cadStyle(l.name, ft && ft.properties); return S.name + (S.byDia ? '-0160' : ''); }).join(' · ') + (ls.length > 6 ? ' …' : '') + '\nالألوان: مياه أزرق · صرف أخضر · أمطار أخضر غامق · كهرباء/إنارة أحمر · غاز أصفر · اتصالات برتقالي · ري بنفسجي · القائم رمادي متقطع'; return; }
    const ex = mode === 'pattern' ? ($('#cadPattern').value || '') : (std ? std + '-' + (mode === 'field' && f ? '{' + f + '}' : '{LAYER}') : (mode === 'field' && f ? '{LAYER}-{' + f + '}' : '{LAYER}'));
    if (mode !== 'pattern') $('#cadPattern').value = ex;
    $('#cadPatternRow').style.display = mode === 'pattern' ? '' : 'none';
    $('#cadFieldRow').style.display = mode === 'field' ? '' : 'none';
    const l = selLayers()[0]; const ft = l && l.features.find(x => x.properties);
    $('#cadExample').textContent = 'مثال اسم لير: ' + (l ? Writers.cadLayerName(ex || '{LAYER}', l.name, ft ? ft.properties : {}, +$('#cadPad').value || 0) : '—');
  }
  function updFmtHints() {
    const fs = selFmts();
    const hints = { gdb: 'GDB: بيتعمل بـ GDAL ويفتح في ArcGIS Pro. الطبقة اللي فيها أنواع مختلفة بتتقسم نقط وخطوط ومضلعات. أول مرة بيحمّل GDAL (حوالي 40 MB).', shp: 'Shapefile: كل نوع في ملف، وأسماء الحقول بتتقصر لـ 10 حروف.', dxf: 'كاد: بيطلع DXF بيفتح في أوتوكاد على طول، واعمله Save As DWG. اختار نظام متري زي UTM.', kml: 'KML/KMZ بيتحول لـ WGS84 تلقائي.', kmz: 'KML/KMZ بيتحول لـ WGS84 تلقائي.', csv: 'CSV: النقط بعمودين X و Y، والخطوط والمضلعات بعمود WKT.' };
    $('#expHint').textContent = Array.from(new Set(fs.map(f => hints[f]).filter(Boolean))).join('\n');
    $('#cadStep').style.display = fs.indexOf('dxf') >= 0 ? '' : 'none';
    $('#kmlStep').style.display = fs.some(f => f === 'kml' || f === 'kmz') ? '' : 'none';
    $('#expGo').textContent = fs.length > 1 ? 'تحويل لـ ' + fs.length + ' صيغ وتنزيل' : 'تحويل وتنزيل';
    GV.store.set('gv_expfmts', fs.join(','));
  }
  function testFilter(props, field, op, val) {
    if (!field) return true;
    const v = props ? props[field] : null;
    const empty = v == null || v === '';
    if (op === 'empty') return empty; if (op === 'notempty') return !empty;
    if (empty) return false;
    const nv = parseFloat(v), nq = parseFloat(val), num = isFinite(nv) && isFinite(nq) && String(val).trim() !== '';
    const s = String(v).toLowerCase(), q = String(val).toLowerCase().trim();
    switch (op) {
      case 'eq': return num ? nv === nq : s.trim() === q;
      case 'ne': return num ? nv !== nq : s.trim() !== q;
      case 'gt': return num && nv > nq; case 'lt': return num && nv < nq;
      case 'has': return s.indexOf(q) >= 0;
    }
    return true;
  }
  function gBBox(g) { let a = [Infinity, Infinity, -Infinity, -Infinity]; const v = c => { if (typeof c[0] === 'number') { a[0] = Math.min(a[0], c[0]); a[1] = Math.min(a[1], c[1]); a[2] = Math.max(a[2], c[0]); a[3] = Math.max(a[3], c[1]); } else c.forEach(v); }; if (g.coordinates) v(g.coordinates); return a; }
  // build output layers for one target CRS ('orig' or code)
  function buildOut(layers, crs, fields, filt, mb) {
    let fwd = null, wkt = null, epsg = null;
    if (crs === 'orig') {
      const defs = new Set(layers.filter(l => l.kind !== 'table').map(l => String(l.crsDef == null ? '' : l.crsDef)));
      if (defs.size > 1) throw new Error('الطبقات اللي اخترتها كل واحدة على نظام إحداثيات مختلف.\nاختار نظام محدد من "نظام الإحداثيات".');
      const d = [...defs][0] || '';
      if (/^\d+$/.test(d)) { epsg = d; wkt = Writers.wktForEPSG(d); } else if (d) { wkt = d; const m = d.match(/AUTHORITY\["EPSG",\s*"?(\d+)"?\]\s*\]\s*$/); if (m) epsg = m[1]; }
    } else {
      epsg = crs; wkt = Writers.wktForEPSG(crs);
      if (crs !== '4326') { const p = proj4('WGS84', GV.epsgDef(crs)); fwd = c => p.forward([c[0], c[1]]); } else fwd = c => c;
    }
    const out = [];
    for (const l of layers) {
      const lfields = fields.perLayer && fields.perLayer.has(l) ? fields.perLayer.get(l) : fields; const feats = [];
      for (const f of l.features) {
        if (!testFilter(f.properties, filt.field, filt.op, filt.val)) continue;
        if (mb) { if (!f.wgs || !f.wgs.geometry) continue; const b = gBBox(f.wgs.geometry); if (b[2] < mb.getWest() || b[0] > mb.getEast() || b[3] < mb.getSouth() || b[1] > mb.getNorth()) continue; }
        let g = null;
        if (crs === 'orig') g = f.geometry || null;
        else if (f.wgs && f.wgs.geometry) g = GV.mapCoords(f.wgs.geometry, fwd);
        const props = {}; lfields.forEach(k => { if (f.properties && k in f.properties) props[k] = f.properties[k]; });
        const o = { properties: props, geometry: g }; if (fields.labSkip && fields.labSkip.size && f.geometry && /Point/.test(f.geometry.type) && fields.labSkip.has(l.name + '::' + labVal(f, fields.labSkip.fieldOf.get(l) || ''))) o.nolab = true; if (fields.labSkip && fields.labSkip.fieldOf && fields.labSkip.fieldOf.get(l)) { const tv = labVal(f, fields.labSkip.fieldOf.get(l)); if (tv !== LBL_NONE) o.labTitle = tv; } if (fields.labSkip && fields.labSkip.extraOf && fields.labSkip.extraOf.has(l) && f.geometry && /Point/.test(f.geometry.type) && !o.nolab) { const ex = []; fields.labSkip.extraOf.get(l).forEach(k => { const v = (f.properties || {})[k]; if (v == null || String(v).trim() === '' || /^null$/i.test(String(v))) { const c = g && g.coordinates || []; fields.labSkip.notes.push({ layer: l.name, field: k, type: o.labTitle || GV.cadVal(f.properties || {}, TYPE_SPEC, null) || '', x: c[0], y: c[1], oid: (f.properties || {}).OBJECTID != null ? f.properties.OBJECTID : (f.properties || {}).objectid }); } else ex.push([k, String(v).trim()]); }); o.labExtra = ex; } if (f._color) o.color = f._color; if (l.theme) o.color = l.theme.fn(f); feats.push(o);
      }
      if (!feats.length && !l.schemaFields) continue;
      out.push({ name: l.name, color: l.color, fields: (l.schemaFields || []).filter(k => lfields.indexOf(k) >= 0).concat(lfields.filter(k => (!l.schemaFields || l.schemaFields.indexOf(k) < 0) && l.features.slice(0, 500).some(f => f.properties && k in f.properties))), features: feats, kind: l.kind, types: l.schemaTypes });
    }
    return { out, epsg, wkt };
  }
  async function doExport() {
    const layers = selLayers();
    if (!layers.length) return GV.toast('اختار طبقة واحدة على الأقل');
    const fmts = selFmts(); if (!fmts.length) return GV.toast('اختار صيغة واحدة على الأقل');
    const crsSel = $('#expCrs').value; GV.store.set('gv_expcrs', crsSel);
    const FL = new Map(); document.querySelectorAll('#expFields input[data-fl]').forEach(c => { if (!FL.has(c._layer)) FL.set(c._layer, []); if (c.checked) FL.get(c._layer).push(c.value); }); const fields = Array.from(new Set([].concat(...FL.values()))); fields.perLayer = FL; const LSK = labSkip(); fields.labSkip = LSK;
    const filt = { field: $('#expFField').value, op: $('#expFOp').value, val: $('#expFVal').value };
    const mb = $('#expView').checked ? GV.map.getBounds() : null;
    const merge = $('#expMerge').checked, labelField = $('#expLabel').value;
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بحوّل…';
    await new Promise(r => setTimeout(r, 30));
    try {
      const cache = {};
      const get = crs => { if (!cache[crs]) { const r = buildOut(layers, crs, fields, filt, mb); let ol = r.out; if (merge && ol.length > 1) ol = [{ name: 'merged', color: ol[0].color, fields: Array.from(new Set(['layer'].concat(fields))), features: ol.flatMap(o => o.features.map(f => ({ properties: Object.assign({ layer: o.name }, f.properties), geometry: f.geometry, color: f.color }))) }]; cache[crs] = { out: ol, epsg: r.epsg, wkt: r.wkt }; } return cache[crs]; };
      const first = get(fmts.every(f => f === 'kml' || f === 'kmz') ? '4326' : crsSel);
      const total = first.out.reduce((a, l) => a + l.features.length, 0);
      if (!total) throw new Error('مفيش عناصر طلعت بعد الفلتر.');
      const base = first.out.length === 1 ? Writers.safeName(first.out[0].name) : Writers.safeName(((layers[0] && layers[0].src && layers[0].src.name) || 'export').replace(/^مخرجات:\s*/, '').replace(/\.(gdb|zip|dwg|dxf)$/i, '')) || 'export';
      const files = []; const multi = fmts.length > 1; const pre = f => multi ? f + '/' : '';
      for (const fmt of fmts) {
        $('#busyText').textContent = 'بحوّل لـ ' + (FMTS.find(x => x[0] === fmt) || [0, fmt])[1] + '…'; await new Promise(r => setTimeout(r, 20));
        const g0 = get(fmt === 'kml' || fmt === 'kmz' ? '4326' : crsSel); const { epsg, wkt } = g0; const out = (fmt === 'gdb' || fmt === 'gpkg') ? g0.out : g0.out.filter(l => l.features.length);
        if (fmt === 'geojson') out.forEach(l => files.push({ name: pre(fmt) + Writers.safeName(l.name) + '.geojson', data: Writers.geojson(l, epsg) }));
        if (fmt === 'csv') out.forEach(l => files.push({ name: pre(fmt) + Writers.safeName(l.name) + '.csv', data: Writers.csv(l) }));
        if (fmt === 'shp') out.forEach(l => Writers.shapefiles(l, wkt).forEach(f => files.push({ name: pre(fmt) + f.name, data: f.data })));
        if (fmt === 'kml' || fmt === 'kmz') {
          let one = $('#kmlOne').checked, sp = $('#kmlSplit').checked; if (!one && !sp) one = true;
          GV.store.set('gv_kmlmode', (one ? 'one' : '') + (sp ? ',split' : ''));
          const groups = []; if (one) groups.push({ ls: out, nm: base, dir: sp ? 'مجمع/' : '' }); if (sp) out.forEach(l => groups.push({ ls: [l], nm: Writers.safeName(l.name), dir: one ? 'طبقات منفصلة/' : '' }));
          for (const g of groups) {
            const k = Writers.kml(g.ls, labelField, { name: g.nm });
            if (fmt === 'kml') files.push({ name: pre(fmt) + g.dir + g.nm + '.kml', data: k });
            else { const z = new JSZip(); z.file('doc.kml', k); files.push({ name: pre(fmt) + g.dir + g.nm + '.kmz', data: await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) }); }
          }
        }
        if (fmt === 'dxf') {
          const annoF = Array.from(document.querySelectorAll('#cadAnnoList input')).filter(c => c.checked).map(c => c.value); GV.store.set('gv_cadanno', annoF.join(',')); const isStd = $('#cadStd').value === '*STD'; GV.store.set('gv_cadstd', $('#cadStd').value); const opts = { anno: annoF, annoH: +$('#cadAnnoH').value || 0.8, mode: $('#cadMode').value, pattern: $('#cadPattern').value || '{LAYER}', pad: +$('#cadPad').value || 0, colorMode: $('#cadColor').value, colorField: $('#cadColorField').value, labelField: $('#cadLabel').checked ? (labelField || null) : null, textH: +$('#cadTextH').value || (crsSel === '4326' ? 0.00002 : 1.5), textSuffix: $('#cadTextSuf').value || '', alignText: $('#cadAlign').checked, points: $('#cadPoints').value, symSize: +$('#cadSym').value || 1, attrs: $('#cadAttrs').checked, z3d: $('#cad3d').checked, geographic: crsSel === '4326' };
          if (isStd) { opts.styleFor = l => { const ft = l.features.find(x => x.properties); return GV.cadStyle(l.name, ft && ft.properties, GV.store.get('gv_orgnet')); }; opts.annoLines = GV.cadAnnoLines; opts.lwForDia = GV.cadLwForDia; opts.cadColor = GV.cadColor; opts.colorMode = 'layer'; opts.pointLabel = GV.cadPointLabel; opts.noOverlap = !$('#cadNoOverlap') || $('#cadNoOverlap').checked; opts.legendName = GV.cadLegendName; opts.cadVal = GV.cadVal; opts.typeName = GV.cadTypeName;
            if ($('#cadSheet').checked && crsSel !== '4326') { const discs = {}; out.forEach(l => { const S = opts.styleFor(l); discs[S.disc] = (discs[S.disc] || 0) + l.features.length; }); const top = Object.keys(discs).sort((a, b) => discs[b] - discs[a])[0];
              const TT = { water: 'AS-BUILT POTABLE WATER AND FIRE FIGHTING NETWORK PLAN', storm: 'AS-BUILT STORM WATER DRAINAGE NETWORK PLAN', sewer: 'AS-BUILT SANITARY SEWER NETWORK PLAN', lighting: 'AS-BUILT STREET LIGHTING NETWORK PLAN', irrigation: 'AS-BUILT IRRIGATION NETWORK PLAN', power: 'AS-BUILT POWER NETWORK PLAN', telecom: 'AS-BUILT TELECOM NETWORK PLAN', gas: 'AS-BUILT GAS NETWORK PLAN' };
              const ep = epsg; const CRSN = { 32637: 'WGS 1984 UTM Zone 37N', 32638: 'WGS 1984 UTM Zone 38N', 32639: 'WGS 1984 UTM Zone 39N', 32636: 'WGS 1984 UTM Zone 36N', 2318: 'Ain el Abd / Aramco Lambert', 20438: 'Ain el Abd / UTM Zone 38N', 20437: 'Ain el Abd / UTM Zone 37N', 20439: 'Ain el Abd / UTM Zone 39N' };
              opts.sheet = { scale: +$('#cadScale').value || 500, project: $('#cadProj').value || '', no: $('#cadDwgNo').value || '', title: TT[top] || 'AS-BUILT NETWORK PLAN', crsName: CRSN[+ep] || (ep ? 'EPSG:' + ep : ''), date: new Date().toISOString().slice(0, 10), crsText: ($('#cadCrsTxt') && $('#cadCrsTxt').value) || '' }; { const LG = GV.cadLogos || {}; const lg = {}, ld = {}; Object.keys(LG).forEach(k2 => { const L = LG[k2]; if (!L || !L.bytes) return; const fn = k2 + '.' + L.ext; lg[k2] = { file: fn, w: L.w, h: L.h }; ld[fn] = L.bytes; }); opts.sheet.logos = lg; opts.sheet.logoData = ld; }
              GV.store.set('gv_cadproj', $('#cadProj').value || ''); GV.store.set('gv_caddwgno', $('#cadDwgNo').value || ''); } }
          { const IM = rel => (Writers.dxf.lastImages || []).map(im => Object.assign({}, im, { path: rel + im.file })); const VPX = () => Writers.dxf.lastVP || null; const SST = { lab: 0, skip: 0, where: [] }; const ACC = i => { const st = Writers.dxf.lastStats || {}; SST.lab += st.pointLabels || 0; SST.skip += st.pointSkipped || 0; (st.skippedAt || []).forEach(w2 => SST.where.push('SHEET-' + String(i + 1).padStart(2, '0') + ': ' + w2)); return 0; }; const M = (t, ex) => { try { return window.DxfModern ? window.DxfModern(t, ex) : t; } catch (e) { console.error('DxfModern', e); return t; } };
            const r12 = Writers.dxf(out, opts); const plan = opts.sheet ? Writers.dxf.lastPlan : null; files.push({ name: pre(fmt) + base + '.dxf', data: M(r12, { images: IM('logos\\'), vp: VPX() }) }); { const st = Writers.dxf.lastStats || {}; if (st.pointSkipped || st.pointFiltered) setTimeout(() => GV.toast('الليبلات: ' + (st.pointLabels || 0) + ' اتحطت' + (st.pointFiltered ? ' · ' + st.pointFiltered + ' اتشالت بفلتر النوع' : '') + (st.pointSkipped ? ' · ' + st.pointSkipped + ' اتشالت لأن مالهاش مكان' : '')), 600); } if (opts.sheet && opts.sheet.logoData) Object.entries(opts.sheet.logoData).forEach(([fn, bytes]) => files.push({ name: pre(fmt) + 'logos/' + fn, data: bytes }));
            if (plan && plan.tiles.length) { for (let i = 0; i < plan.tiles.length; i++) { const T = plan.tiles[i]; $('#busyText').textContent = 'بطلّع اللوحة ' + (i + 1) + ' من ' + plan.tiles.length + '…'; await new Promise(r => setTimeout(r, 0)); const clipped = Writers.clipLayers(out, [T.x0, T.y0, T.x0 + T.w, T.y0 + T.h]); const o2 = Object.assign({}, opts, { sheet: Object.assign({}, opts.sheet, { tile: T, index: i, total: plan.tiles.length, rows: plan.rows, allTiles: plan.tiles }) }); files.push({ name: pre(fmt) + base + '_SHEETS/SHEET-' + String(i + 1).padStart(2, '0') + '.dxf', data: M(Writers.dxf(clipped, o2), { images: IM('..\\logos\\'), vp: VPX(), _s: ACC(i) }) }); } } { const NT2 = (fields.labSkip && fields.labSkip.notes) || []; const parts = [];
              if (NT2.length) { const csv = '\ufeffLAYER,FIELD,TYPE,OBJECTID,X,Y\n' + NT2.map(n => [n.layer, n.field, '"' + String(n.type || '').replace(/"/g, '""') + '"', n.oid == null ? '' : n.oid, n.x == null ? '' : (+n.x).toFixed(4), n.y == null ? '' : (+n.y).toFixed(4)].join(',')).join('\n'); files.push({ name: pre(fmt) + 'LABEL_NOTES.csv', data: csv });
                const byLF = new Map(); NT2.forEach(n => { const k = n.layer + ' ← ' + n.field; byLF.set(k, (byLF.get(k) || 0) + 1); });
                parts.push('حقول فاضية مااتكتبتش في الليبل (التفاصيل في LABEL_NOTES.csv جوه الـ zip):\n' + [...byLF.entries()].map(([k, n]) => '• ' + k + ': ' + n + ' نقطة').join('\n')); }
              if (SST.skip) { console.warn('labels skipped', SST.where); parts.push(SST.skip + ' نقطة مالقتش مكان فاضي لليبل جوه لوحتها (من ' + (SST.lab + SST.skip) + '):\n' + SST.where.slice(0, 30).join('\n') + '\nلو عايزهم يظهروا حتى لو ركبوا على غيرهم شيل علامة «لو الليبل مالوش مكان…».'); }
              if (parts.length) setTimeout(() => GV.showMsg ? GV.showMsg('ملاحظات الليبلات\n\n' + parts.join('\n\n')) : GV.toast(parts[0].split('\n')[0]), 900); } }
        }
        if (fmt === 'gpkg') { const SQL = await initSqlJs({}); files.push({ name: pre(fmt) + base + '.gpkg', data: await Writers.gpkg(out, epsg, wkt, SQL) }); }
        if (fmt === 'gdb') { $('#busyText').textContent = 'بحمّل محرك GDAL…'; const g = await toGDB(out, epsg, wkt, base, multi); g.forEach(f => files.push({ name: f.name, data: f.data, raw: f.raw })); }
      }
      $('#busy').classList.remove('show');
      if (files.length === 1) await saveFile(files[0].name.split('/').pop(), files[0].data);
      else { const z = new JSZip(); files.forEach(f => { if (f.raw) f.raw.forEach(r => z.file(r.name, r.data)); else z.file(f.name, f.data); }); await saveFile(base + '_' + (multi ? 'export' : fmts[0]) + '.zip', await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })); }
    } catch (e) { GV.showMsg('حصلت مشكلة في التحويل:\n' + (e.message || e)); }
    finally { $('#busy').classList.remove('show'); }
  }
  ['#cadStd', '#cadField', '#cadMode', '#cadPad'].forEach(id => $(id).addEventListener('change', updPattern));
  $('#cadPattern').addEventListener('input', updPattern);
  /* ---- GDAL (WebAssembly) for File Geodatabase ---- */
  let gdalP = null;
  function getGdal() {
    if (gdalP) return gdalP;
    gdalP = (async () => {
      const CDN = 'https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package/';
      async function grab(parts, cdnName) {
        try {
          const bufs = []; for (const u of parts) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); const t = (await r.text()).trim(); const bin = atob(t); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); bufs.push(a); }
          let n = 0; bufs.forEach(b => n += b.length); const o = new Uint8Array(n); let k = 0; bufs.forEach(b => { o.set(b, k); k += b.length; }); return o;
        } catch (e) { const r = await fetch(CDN + cdnName); if (!r.ok) throw new Error('net'); return new Uint8Array(await r.arrayBuffer()); }
      }
      const wasm = await grab(['gdal/gdal3.wasm.b64.0.txt', 'gdal/gdal3.wasm.b64.1.txt'], 'gdal3WebAssembly.wasm');
      $('#busyText').textContent = 'بحمّل بيانات GDAL…';
      const data = await grab(['gdal/gdal3.data.b64.txt'], 'gdal3WebAssembly.data');
      $('#busyText').textContent = 'بشغّل GDAL…';
      const of = window.fetch, OX = window.XMLHttpRequest;
      window.fetch = function (u) { if (String(u).indexOf('gdalmem/') >= 0) return Promise.resolve(new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } })); return of.apply(this, arguments); };
      window.XMLHttpRequest = function () {
        const x = { readyState: 0, status: 0, response: null, responseType: '', open(m, u) { this.u = u; this.real = String(u).indexOf('gdalmem/') < 0 ? new OX() : null; if (this.real) this.real.open(m, u); },
          send(b) { if (this.real) { const r = this.real; r.responseType = this.responseType; r.onload = () => { this.status = r.status; this.response = r.response; this.readyState = 4; this.onload && this.onload({}); }; r.onerror = e => this.onerror && this.onerror(e); r.send(b); return; }
            setTimeout(() => { this.status = 200; this.readyState = 4; this.response = data.buffer; this.onprogress && this.onprogress({ loaded: data.length, total: data.length }); this.onload && this.onload({}); }, 0); } };
        return x;
      };
      try {
        return await initGdalJs({ paths: { wasm: 'gdalmem/gdal3WebAssembly.wasm', data: 'gdalmem/gdal3WebAssembly.data', js: 'gdal3.js' }, useWorker: false, logHandler: () => { }, errorHandler: () => { } });
      } finally { window.fetch = of; window.XMLHttpRequest = OX; }
    })().catch(e => { gdalP = null; throw new Error('مقدرتش أشغّل GDAL (محتاج نت أول مرة): ' + (e.message || e)); });
    return gdalP;
  }
  async function toGDB(layers, epsg, wkt, base, multi) {
    if (!epsg && !wkt) throw new Error('اختار نظام إحداثيات للتصدير (الـ GDB لازم يكون ليه نظام).');
    // coded-value / range domains go into the GDB too (own GDB domains, a template GDB's, and the new classes added in QC)
    layers.forEach(l => { const D = GV.domInfoOf ? GV.domInfoOf(l) : null; l._dom = null; if (!D || !D.domains) return; const defs = D.domainDefs || {}; const m = {};
      Object.keys(D.domains).forEach(f => { const dd = defs[D.domains[f]]; if (dd) m[f] = dd; }); if (Object.keys(m).length) l._dom = m; });
    const P = Writers.prepGDB(layers);
    const SQL = await initSqlJs({});
    const gp = await Writers.gpkg(P, epsg, wkt, SQL);
    const Gdal = await getGdal();
    $('#busyText').textContent = 'بكتب الـ File Geodatabase…';
    const FS = Gdal.Module.FS; const id = 'x' + Date.now();
    FS.writeFile('/input/' + id + '.gpkg', gp);
    const ds = await Gdal.open('/input/' + id + '.gpkg');
    const gname = base.replace(/[^\p{L}\p{N}_]/gu, '_') || 'export';
    try { await Gdal.ogr2ogr(ds.datasets[0], ['-f', 'OpenFileGDB', '-mapFieldType', 'Integer64=Integer'], id); }
    catch (e) { throw new Error('GDAL: ' + (e.message || e)); }
    finally { try { Gdal.close(ds); } catch (e) { } try { FS.unlink('/input/' + id + '.gpkg'); } catch (e) { } }
    const dir = '/output/' + id + '.gdb'; const names = FS.readdir(dir).filter(n => n[0] !== '.');
    const z = new JSZip(); names.forEach(n => { z.file(gname + '.gdb/' + n, FS.readFile(dir + '/' + n)); try { FS.unlink(dir + '/' + n); } catch (e) { } });
    try { FS.rmdir(dir); } catch (e) { }
    GV.toast('اتعملت ' + P.length + ' طبقة في الـ GDB', 4000);
    if (multi) { const raw = []; z.forEach((path, f) => raw.push({ name: 'gdb/' + path, f })); for (const r of raw) r.data = await r.f.async('uint8array'); return [{ name: 'gdb', raw }]; }
    return [{ name: gname + '.gdb.zip', data: await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), zipped: true }];
  }
  GV.getGdal = getGdal; GV.toGDB = toGDB;

  $('#btnExport').addEventListener('click', () => openExport());
  $('#expGo').addEventListener('click', doExport);
  { const m = GV.store.get('gv_kmlmode'); if (m) { $('#kmlOne').checked = /one/.test(m); $('#kmlSplit').checked = /split/.test(m); } }
  $('#expAll').addEventListener('click', () => { document.querySelectorAll('#expFields input').forEach(c => c.checked = true); });
  $('#expNone').addEventListener('click', () => { document.querySelectorAll('#expFields input').forEach(c => c.checked = false); });
  GV.openExport = openExport;

  /* ================= team / field collection ================= */
  let db = null, user = null, assets = null, uid = null, isEditor = false;
  let forms = {}, records = [], shared = [];
  const names = {};
  const STATUS = { match: ['مطابق', '#2f9e44'], diff: ['فيه اختلاف', '#f08c00'], new: ['مش موجود في GIS', '#e03131'], none: ['بدون مقارنة', '#1c7ed6'] };
  const fieldSrc = { id: 'field', name: 'الشغل الميداني', type: 'Field', layers: [] };

  async function initTeam() {
    db = await cap('db');
    if (!db) { document.body.classList.add('no-team'); renderHub(); return; }
    user = await cap('user'); assets = await cap('assets');
    try { uid = user ? await user.id() : null; isEditor = user ? !!(await user.canEdit()) : false; } catch (e) { }
    document.body.classList.add('team');
    const tmo = setTimeout(() => { $('#hubState').textContent = 'البيانات المشتركة مش واصلة لسه… اتأكد من النت.'; }, 10000);
    db.collection('forms').onSnapshot(s => { clearTimeout(tmo); forms = {}; s.docs.forEach(d => forms[d.id] = Object.assign({ id: d.id }, d.data())); rebuildFieldLayers(); renderHub(); }, e => { clearTimeout(tmo); $('#hubState').textContent = 'مقدرتش أوصل للبيانات المشتركة (' + e.code + ')'; });
    db.collection('shared').onSnapshot(s => { shared = s.docs.map(d => Object.assign({ id: d.id }, d.data())); renderHub(); }, () => { });
    db.collection('records').orderBy('at', 'desc').limit(1000).onSnapshot(s => {
      const added = s.docChanges().filter(c => c.type === 'added' && (c.doc.data() || {}).by !== uid).length;
      const first = !records.length;
      records = s.docs.map(d => Object.assign({ id: d.id }, d.data()));
      rebuildFieldLayers(); renderHub();
      if (!first && added && !s.metadata.hasPendingWrites) GV.toast('وصل ' + added + ' تسجيل جديد من الفريق');
    }, () => { });
    renderHub();
  }
  async function resolveNames(ids) {
    const need = ids.filter(i => i && !(i in names));
    if (!need.length || !user || !user.profiles) return;
    try { const ps = await user.profiles(need); need.forEach(i => names[i] = (ps[i] && ps[i].name) || 'عضو في الفريق'); } catch (e) { }
  }

  function rebuildFieldLayers() {
    resolveNames(Array.from(new Set(records.map(r => r.by)))).then(() => {
      let src = GV.sources.find(s => s.id === 'field');
      const formIds = Object.keys(forms);
      if (!formIds.length && !records.length) return;
      if (!src) { src = fieldSrc; GV.sources.push(src); }
      const keep = new Set();
      formIds.forEach(fid => {
        const form = forms[fid];
        const recs = records.filter(r => r.formId === fid);
        let layer = src.layers.find(l => l.formId === fid);
        if (!layer) { layer = { id: 'f_' + fid, formId: fid, name: form.name, visible: true, color: form.color || '#1c7ed6', kind: form.geom === 'line' ? 'line' : form.geom === 'polygon' ? 'polygon' : 'point', src, crsDef: '4326', isField: true }; src.layers.push(layer); }
        layer.name = form.name;
        layer.features = recs.map(r => recordFeature(form, r));
        layer.theme = { field: 'الحالة', fn: f => (STATUS[f._status] || STATUS.none)[1], classes: Object.keys(STATUS).map(k => ({ label: STATUS[k][0], color: STATUS[k][1], count: recs.filter(r => (r.cmp && r.cmp.status || 'none') === k).length })).filter(c => c.count) };
        if (layer.leaf) GV.map.removeLayer(layer.leaf);
        GV.applyCRS(layer, GV.resolveCRS('4326'));
        if (layer.visible) layer.leaf.addTo(GV.map);
        keep.add(layer);
      });
      src.layers = src.layers.filter(l => { if (!keep.has(l)) { if (l.leaf) GV.map.removeLayer(l.leaf); return false; } return true; });
      GV.renderLayers(); GV.updateEmpty(); GV.refreshLabels();
    });
  }
  function recordFeature(form, r) {
    const p = {};
    (form.fields || []).forEach(fd => { if (fd.type !== 'photo') p[fd.key] = r.values ? r.values[fd.key] : null; });
    const st = (r.cmp && r.cmp.status) || 'none';
    p['الحالة'] = STATUS[st][0];
    if (r.cmp && r.cmp.dist != null) p['البعد عن GIS (م)'] = +(+r.cmp.dist).toFixed(2);
    if (r.cmp && r.cmp.diffs && r.cmp.diffs.length) p['الاختلافات'] = r.cmp.diffs.map(d => d.f + ': ' + d.v + ' ≠ ' + d.g).join(' | ');
    p['سجّلها'] = names[r.by] || '';
    p['الوقت'] = r.at ? new Date(r.at).toLocaleString('en-GB') : '';
    if (r.photos && r.photos.length) p['الصور'] = r.photos.length;
    const f = { type: 'Feature', properties: p, geometry: r.geometry || null, _status: st, _rec: r };
    f._extra = box => recordExtra(box, form, r);
    return f;
  }
  function recordExtra(box, form, r) {
    if (r.photos && r.photos.length) {
      const g = el('div', 'photos');
      r.photos.forEach(ph => { const a = el('a'); a.href = ph.url; a.target = '_blank'; a.rel = 'noopener'; const im = el('img'); im.src = ph.url; im.alt = 'صورة'; a.appendChild(im); g.appendChild(a); });
      box.appendChild(g);
    }
    if (r.cmp && r.cmp.status) {
      const st = STATUS[r.cmp.status];
      const c = el('div', 'cmp'); c.style.setProperty('--sc', st[1]);
      c.appendChild(el('b', null, st[0]));
      if (r.cmp.layer) c.appendChild(el('div', 'small', 'مقارنة مع طبقة ' + r.cmp.layer + (r.cmp.dist != null ? ' · أقرب عنصر على بعد ' + GV.fmtLen(r.cmp.dist) : '')));
      (r.cmp.diffs || []).forEach(d => c.appendChild(el('div', 'diff', d.f + ': في الموقع "' + d.v + '" · في GIS "' + d.g + '"')));
      box.appendChild(c);
    }
    if (db && (isEditor || r.by === uid)) {
      const del = el('button', 'chip danger', 'حذف التسجيل');
      del.onclick = async () => { if (del.dataset.c !== '1') { del.dataset.c = '1'; del.textContent = 'اضغط تاني للتأكيد'; return; } try { await db.doc('records/' + r.id).delete(); GV.closeSheets(); GV.toast('اتحذف'); } catch (e) { GV.toast('مقدرتش أحذف'); } };
      box.appendChild(del);
    }
  }

  /* ---- hub ---- */
  const GEOM_AR = { point: 'نقطة', line: 'خط', polygon: 'مضلع' };
  function renderHub() {
    const box = $('#hubBody'); if (!box) return; box.textContent = '';
    if (!db) {
      box.appendChild(el('div', 'note', 'الشغل الميداني والمشاركة مع الفريق شغالين في نسخة الرابط على Claude بس، لأنها محتاجة مكان مشترك تتخزن فيه البيانات. افتح الرابط من الموبايل أو اللابتوب.'));
      return;
    }
    const st = el('p', 'muted small'); st.id = 'hubState'; st.textContent = isEditor ? 'إنت مسؤول: تقدر تعمل نماذج وتشارك طبقات.' : 'تقدر تسجّل بيانات من الموقع في النماذج الموجودة.'; box.appendChild(st);
    // forms
    const h1 = el('div', 'hub-h'); h1.appendChild(el('h3', null, 'نماذج الرفع')); if (isEditor) { const b = el('button', 'chip', '＋ نموذج جديد'); b.onclick = () => openFormBuilder(); h1.appendChild(b); } box.appendChild(h1);
    const fl = Object.values(forms).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!fl.length) box.appendChild(el('p', 'muted small', isEditor ? 'لسه مفيش نماذج. اعمل نموذج (مثلاً "فحص المحابس") وحدد الطبقة اللي هتتقارن بيها.' : 'لسه مفيش نماذج. المسؤول لازم يعمل نموذج الأول.'));
    fl.forEach(form => {
      const recs = records.filter(r => r.formId === form.id);
      const card = el('div', 'fcard');
      const t = el('div', 'fc-top'); const sw = el('span', 'fc-dot'); sw.style.background = form.color || '#1c7ed6';
      const nm = el('div', 'fc-name'); nm.appendChild(el('b', null, form.name)); nm.appendChild(el('small', 'muted', (GEOM_AR[form.geom] || '') + ' · ' + (form.fields || []).length + ' حقل' + (form.refLayer ? ' · بيتقارن مع ' + form.refLayer : '')));
      t.append(sw, nm); card.appendChild(t);
      const stats = el('div', 'fc-stats'); stats.appendChild(el('span', 'chip0', recs.length + ' تسجيل'));
      Object.keys(STATUS).forEach(k => { const n = recs.filter(r => (r.cmp && r.cmp.status || 'none') === k).length; if (n) { const s = el('span', 'chip0', n + ' ' + STATUS[k][0]); s.style.color = STATUS[k][1]; stats.appendChild(s); } });
      card.appendChild(stats);
      const acts = el('div', 'fc-acts');
      const rec = el('button', 'open-btn sm', '＋ تسجيل من الموقع'); rec.onclick = () => startRecord(form);
      acts.appendChild(rec);
      const layer = () => (GV.sources.find(s => s.id === 'field') || { layers: [] }).layers.find(l => l.formId === form.id);
      const tb = el('button', 'chip', 'الجدول'); tb.onclick = () => { const l = layer(); if (l) GV.openTable(l); }; acts.appendChild(tb);
      const ex = el('button', 'chip', 'تصدير'); ex.onclick = () => { const l = layer(); if (l) openExport([l]); }; acts.appendChild(ex);
      if (isEditor) { const ed = el('button', 'chip', 'تعديل'); ed.onclick = () => openFormBuilder(form); acts.appendChild(ed); }
      card.appendChild(acts);
      box.appendChild(card);
    });
    // shared layers
    const h2 = el('div', 'hub-h'); h2.appendChild(el('h3', null, 'طبقات مشتركة مع الفريق')); if (isEditor && assets) { const b = el('button', 'chip', '＋ شارك طبقة'); b.onclick = shareLayerPicker; h2.appendChild(b); } box.appendChild(h2);
    if (!shared.length) box.appendChild(el('p', 'muted small', 'الطبقات المرجعية (زي شبكة المياه) اللي تشاركها هنا بتظهر لكل الفريق ويتقارن بيها في الموقع.'));
    shared.forEach(sh => {
      const row = el('div', 'lyr'); const sw = el('span', 'sw'); sw.style.setProperty('--c', sh.color || '#0e7c86'); sw.textContent = '⇪';
      const info = el('div', 'lyr-info'); info.appendChild(el('div', 'lyr-name', sh.name)); info.appendChild(el('div', 'lyr-meta', (sh.count || 0).toLocaleString('en') + ' عنصر · ' + (sh.at ? new Date(sh.at).toLocaleDateString('en-GB') : '')));
      const acts = el('div', 'lyr-acts');
      const loaded = GV.sources.some(s => s.sharedId === sh.id);
      const op = el('button', 'chip', loaded ? 'مفتوحة' : 'افتح'); op.disabled = loaded; op.onclick = () => loadShared(sh); acts.appendChild(op);
      if (isEditor) { const d = el('button', 'icon-btn small', '✕'); d.title = 'إلغاء المشاركة'; d.onclick = async () => { if (d.dataset.c !== '1') { d.dataset.c = '1'; d.textContent = '؟'; return; } try { await db.doc('shared/' + sh.id).delete(); if (assets && sh.assetId) assets.delete(sh.assetId).catch(() => { }); } catch (e) { GV.toast('مقدرتش أحذف'); } }; acts.appendChild(d); }
      row.append(sw, info, acts); box.appendChild(row);
    });
    box.appendChild(el('p', 'muted small tip', 'علشان فريقك يدخل ويسجّل: من زرار Share في Claude ادّي كل واحد صلاحية Contributor (أو Editor لو هيعمل نماذج).'));
  }
  $('#btnTeam').addEventListener('click', () => { renderHub(); GV.openSheet('#hubSheet'); });

  async function loadShared(sh) {
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بحمّل ' + sh.name + '…';
    try {
      const r = await fetch(sh.url || ('/_blob/' + sh.assetId)); if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      $('#busy').classList.remove('show');
      const before = GV.sources.length;
      await GV.addGroups([{ name: sh.name, type: 'طبقة مشتركة', layers: [{ name: sh.name, features: j.features || [], crs: '4326', color: sh.color }] }]);
      const s = GV.sources[GV.sources.length - 1]; if (GV.sources.length > before && s) s.sharedId = sh.id;
      renderHub();
    } catch (e) { GV.showMsg('مقدرتش أحمّل الطبقة المشتركة: ' + (e.message || e)); }
    finally { $('#busy').classList.remove('show'); }
  }
  function shareLayerPicker() {
    const ls = allLayers().filter(({ l }) => !l.isField && l.leaf);
    if (!ls.length) return GV.showMsg('افتح الطبقة الأول على الخريطة، وبعدين شاركها.');
    const box = $('#pickList'); box.textContent = '';
    $('#pickTitle').textContent = 'اختار الطبقة اللي هتشاركها';
    ls.forEach(({ l, s }) => { const b = el('button', 'crs-opt', l.name + ' · ' + s.name + ' (' + l.features.length.toLocaleString('en') + ')'); b.onclick = () => { GV.closeSheets(); shareLayer(l); }; box.appendChild(b); });
    GV.openSheet('#pickSheet');
  }
  async function shareLayer(l) {
    const feats = l.features.filter(f => f.wgs && f.wgs.geometry).map(f => ({ type: 'Feature', properties: f.properties, geometry: f.wgs.geometry }));
    const json = JSON.stringify({ type: 'FeatureCollection', features: feats });
    if (json.length > 19.5 * 1024 * 1024) return GV.showMsg('الطبقة كبيرة أوي للمشاركة (' + (json.length / 1048576).toFixed(1) + ' MB، الحد 20 MB). فلترها أو قسّمها من أداة التحويل الأول.');
    $('#busy').classList.add('show'); $('#busyText').textContent = 'برفع ' + l.name + '…';
    try {
      const a = await assets.upload(new Blob([json], { type: 'application/json' }));
      await db.collection('shared').add({ name: l.name, assetId: a.id, url: a.url, count: feats.length, color: l.color, kind: l.kind, by: uid, at: new Date().toISOString() });
      l.src.sharedId = null; GV.toast('اتشاركت مع الفريق');
    } catch (e) { GV.showMsg('مقدرتش أشارك الطبقة: ' + (e.message || e.code || e)); }
    finally { $('#busy').classList.remove('show'); }
  }

  /* ---- form builder ---- */
  const FTYPES = [['text', 'نص'], ['number', 'رقم'], ['choice', 'اختيار من قائمة'], ['yesno', 'نعم / لا'], ['date', 'تاريخ'], ['photo', 'صور']];
  let editing = null;
  function openFormBuilder(form) {
    editing = form ? JSON.parse(JSON.stringify(form)) : { name: '', geom: 'point', fields: [{ key: 'ملاحظات', type: 'text' }, { key: 'صور', type: 'photo' }], refLayer: '', tol: 5, color: GV.PALETTE[Object.keys(forms).length % GV.PALETTE.length] };
    $('#fbName').value = editing.name; $('#fbGeom').value = editing.geom || 'point'; $('#fbTol').value = editing.tol || 5;
    const rs = $('#fbRef'); rs.textContent = ''; const o0 = el('option', null, '— بدون مقارنة —'); o0.value = ''; rs.appendChild(o0);
    const names2 = new Set(allLayers().filter(({ l }) => !l.isField && l.leaf).map(({ l }) => l.name)); shared.forEach(s => names2.add(s.name)); if (editing.refLayer) names2.add(editing.refLayer);
    names2.forEach(n => { const o = el('option', null, n); o.value = n; rs.appendChild(o); }); rs.value = editing.refLayer || '';
    $('#fbDelete').style.display = form ? '' : 'none'; $('#fbDelete').textContent = 'حذف النموذج'; $('#fbDelete').dataset.c = '';
    renderFB(); GV.openSheet('#fbSheet');
  }
  function renderFB() {
    const box = $('#fbFields'); box.textContent = '';
    editing.fields.forEach((fd, i) => {
      const row = el('div', 'fb-row');
      const k = el('input'); k.value = fd.key; k.placeholder = 'اسم الحقل'; k.oninput = () => fd.key = k.value.trim();
      const t = el('select'); FTYPES.forEach(([v, x]) => { const o = el('option', null, x); o.value = v; t.appendChild(o); }); t.value = fd.type; t.onchange = () => { fd.type = t.value; renderFB(); };
      const rm = el('button', 'icon-btn small', '✕'); rm.onclick = () => { editing.fields.splice(i, 1); renderFB(); };
      row.append(k, t, rm);
      if (fd.type === 'choice') { const op = el('input', 'full'); op.placeholder = 'الاختيارات مفصولة بفاصلة: مفتوح, مقفول, تالف'; op.value = (fd.options || []).join(', '); op.oninput = () => fd.options = op.value.split(/[,،]/).map(s => s.trim()).filter(Boolean); row.appendChild(op); }
      const rq = el('label', 'ck small'); const c = el('input'); c.type = 'checkbox'; c.checked = !!fd.required; c.onchange = () => fd.required = c.checked; rq.append(c, el('span', null, 'إجباري')); row.appendChild(rq);
      box.appendChild(row);
    });
  }
  $('#fbAdd').addEventListener('click', () => { editing.fields.push({ key: '', type: 'text' }); renderFB(); });
  $('#fbImport').addEventListener('click', () => {
    const ref = findRef($('#fbRef').value);
    if (!ref) return GV.toast('اختار طبقة مرجعية مفتوحة على الخريطة الأول');
    const have = new Set(editing.fields.map(f => f.key.toLowerCase()));
    GV.fieldsOf(ref).filter(k => !/^(objectid|fid|shape|shape_length|shape_area|globalid|oid)$/i.test(k)).forEach(k => {
      if (have.has(k.toLowerCase())) return;
      const vals = ref.features.slice(0, 300).map(f => f.properties[k]).filter(v => v != null && v !== '');
      const uniq = Array.from(new Set(vals.map(String)));
      const num = vals.length && vals.every(v => typeof v === 'number');
      editing.fields.splice(Math.max(0, editing.fields.length - 2), 0, num ? { key: k, type: 'number' } : (uniq.length > 0 && uniq.length <= 12 ? { key: k, type: 'choice', options: uniq } : { key: k, type: 'text' }));
    });
    renderFB();
  });
  $('#fbSave').addEventListener('click', async () => {
    editing.name = $('#fbName').value.trim(); editing.geom = $('#fbGeom').value; editing.refLayer = $('#fbRef').value; editing.tol = +$('#fbTol').value || 5;
    editing.fields = editing.fields.filter(f => f.key);
    if (!editing.name) return GV.toast('اكتب اسم للنموذج');
    const keys = editing.fields.map(f => f.key); if (new Set(keys).size !== keys.length) return GV.toast('فيه حقلين بنفس الاسم');
    const id = editing.id || ('f' + Date.now().toString(36));
    const body = Object.assign({}, editing); delete body.id; body.updatedAt = new Date().toISOString(); if (!body.by) body.by = uid;
    try { await db.doc('forms/' + id).set(body); GV.closeSheets(); GV.toast('اتحفظ النموذج'); setTimeout(() => GV.openSheet('#hubSheet'), 250); }
    catch (e) { GV.showMsg('مقدرتش أحفظ النموذج: ' + (e.code || e.message || e)); }
  });
  $('#fbDelete').addEventListener('click', async () => {
    const b = $('#fbDelete'); if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = 'متأكد؟ التسجيلات هتفضل بس النموذج هيتشال'; return; }
    try { await db.doc('forms/' + editing.id).delete(); GV.closeSheets(); } catch (e) { GV.toast('مقدرتش أحذف'); }
  });

  /* ---- recording ---- */
  function findRef(name) {
    if (!name) return null;
    for (const s of GV.sources) for (const l of s.layers) if (!l.isField && l.name === name && l.leaf) return l;
    return null;
  }
  const M_LAT = 110540;
  function nearest(layer, ll) {
    const k = Math.cos(ll.lat * Math.PI / 180) * 111320;
    const P = c => [(c[0] - ll.lng) * k, (c[1] - ll.lat) * M_LAT];
    let best = null, bd = Infinity;
    const segD = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy; let t = L2 ? -(a[0] * dx + a[1] * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const x = a[0] + t * dx, y = a[1] + t * dy; return Math.hypot(x, y); };
    const inside = r => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (((a[1] > 0) !== (b[1] > 0)) && (0 < (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; };
    for (const f of layer.features) {
      const g = f.wgs && f.wgs.geometry; if (!g) continue;
      let d = Infinity;
      const t = g.type;
      if (t === 'Point') { const p = P(g.coordinates); d = Math.hypot(p[0], p[1]); }
      else if (t === 'MultiPoint') g.coordinates.forEach(c => { const p = P(c); d = Math.min(d, Math.hypot(p[0], p[1])); });
      else {
        const lines = t === 'LineString' ? [g.coordinates] : t === 'MultiLineString' ? g.coordinates : t === 'Polygon' ? g.coordinates : t === 'MultiPolygon' ? g.coordinates.flat() : [];
        for (const l of lines) { const pp = l.map(P); for (let i = 1; i < pp.length; i++) { const s = segD(pp[i - 1], pp[i]); if (s < d) d = s; } if (pp.length === 1) d = Math.min(d, Math.hypot(pp[0][0], pp[0][1])); }
        if (t === 'Polygon' && inside(g.coordinates[0].map(P))) d = 0;
        if (t === 'MultiPolygon' && g.coordinates.some(p => inside(p[0].map(P)))) d = 0;
      }
      if (d < bd) { bd = d; best = f; }
    }
    return best ? { f: best, d: bd } : null;
  }
  const norm = v => v == null ? '' : String(v).trim().toLowerCase();
  function sameVal(a, b) { if (norm(a) === norm(b)) return true; const x = parseFloat(a), y = parseFloat(b); return isFinite(x) && isFinite(y) && String(a).trim() !== '' && Math.abs(x - y) < 1e-6; }
  function refKey(feature, key) { if (!feature || !feature.properties) return undefined; if (key in feature.properties) return key; const lk = key.toLowerCase(); return Object.keys(feature.properties).find(k => k.toLowerCase() === lk); }

  let rec = null; // {form, pts:[], tmp, photos:[]}
  function startRecord(form) {
    GV.closeSheets(); GV.clearHL();
    rec = { form, pts: [], tmp: L.layerGroup().addTo(GV.map), photos: [], acc: null };
    document.body.classList.add('picking');
    $('#pickMsg').textContent = form.geom === 'point' ? 'اضغط على الخريطة مكان العنصر (بيلزق على العناصر القريبة)' : 'اضغط نقط ال' + (form.geom === 'line' ? 'خط' : 'مضلع') + ' على الخريطة، وبعدين "تم"';
    $('#pickDone').style.display = form.geom === 'point' ? 'none' : '';
    GV.pick = ll => addPick(ll);
  }
  function addPick(ll, acc) {
    if (!rec) return;
    rec.pts.push(L.latLng(ll.lat, ll.lng)); if (acc != null) rec.acc = acc;
    rec.tmp.clearLayers();
    if (rec.pts.length > 1) (rec.form.geom === 'polygon' ? L.polygon : L.polyline)(rec.pts, { color: '#e03131', weight: 3, dashArray: '5 5', interactive: false }).addTo(rec.tmp);
    rec.pts.forEach(p => L.circleMarker(p, { radius: 7, color: '#fff', weight: 2, fillColor: '#e03131', fillOpacity: 1, interactive: false }).addTo(rec.tmp));
    if (rec.form.geom === 'point') finishPick();
  }
  function stopPick() { GV.pick = null; document.body.classList.remove('picking'); }
  function cancelRecord() { stopPick(); if (rec) GV.map.removeLayer(rec.tmp); rec = null; }
  function finishPick() {
    const need = rec.form.geom === 'point' ? 1 : rec.form.geom === 'line' ? 2 : 3;
    if (rec.pts.length < need) return GV.toast('محتاج ' + need + ' نقط على الأقل');
    stopPick();
    const c = rec.pts.map(p => [+p.lng.toFixed(8), +p.lat.toFixed(8)]);
    rec.geometry = rec.form.geom === 'point' ? { type: 'Point', coordinates: c[0] } : rec.form.geom === 'line' ? { type: 'LineString', coordinates: c } : { type: 'Polygon', coordinates: [c.concat([c[0]])] };
    openRecForm();
  }
  $('#pickDone').addEventListener('click', finishPick);
  $('#pickCancel').addEventListener('click', cancelRecord);
  $('#pickGPS').addEventListener('click', () => {
    if (!navigator.geolocation) return GV.toast('الـ GPS مش متاح هنا');
    GV.toast('بحدد موقعك…');
    navigator.geolocation.getCurrentPosition(p => { const ll = L.latLng(p.coords.latitude, p.coords.longitude); GV.map.setView(ll, Math.max(GV.map.getZoom(), 18)); addPick(ll, p.coords.accuracy); },
      () => GV.toast('الـ GPS مش متاح جوه Claude. حدد المكان بالضغط على الخريطة، أو استخدم "من صورة".', 5000), { enableHighAccuracy: true, timeout: 15000 });
  });
  $('#pickPhotoIn').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const gps = await exifGPS(file);
    rec.photos.push(file);
    if (gps) { const ll = L.latLng(gps[0], gps[1]); GV.map.setView(ll, Math.max(GV.map.getZoom(), 18)); GV.toast('أخدت الموقع من الصورة'); addPick(ll); }
    else GV.toast('الصورة مفيهاش موقع GPS. حدد المكان على الخريطة، والصورة هتتضاف للتسجيل.', 5000);
  });

  function cmpNow() {
    const form = rec.form; const ref = findRef(form.refLayer);
    if (!form.refLayer) return { status: 'none' };
    if (!ref) return { status: 'none', missing: true, layer: form.refLayer };
    const g = rec.geometry; const c = g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[Math.floor(g.coordinates.length / 2)] : g.coordinates[0][0];
    const n = nearest(ref, L.latLng(c[1], c[0]));
    if (!n || n.d > (form.tol || 5)) return { status: 'new', layer: ref.name, dist: n ? n.d : null, near: n };
    return { status: 'match', layer: ref.name, dist: n.d, near: n };
  }
  function openRecForm() {
    const form = rec.form; rec.cmp = cmpNow();
    $('#recTitle').textContent = form.name;
    const cb = $('#recCmp'); cb.textContent = ''; cb.className = 'cmp';
    const nf = rec.cmp.near && rec.cmp.status === 'match' ? rec.cmp.near.f : null;
    if (rec.cmp.missing) cb.appendChild(el('div', 'small', 'الطبقة المرجعية "' + rec.cmp.layer + '" مش مفتوحة، فمفيش مقارنة. افتحها من "طبقات مشتركة" علشان تقارن.'));
    else if (rec.cmp.status === 'none') cb.appendChild(el('div', 'small', 'النموذج ده من غير مقارنة.'));
    else if (rec.cmp.status === 'new') { cb.style.setProperty('--sc', STATUS.new[1]); cb.appendChild(el('b', null, 'مفيش عنصر في ' + rec.cmp.layer + ' في حدود ' + (form.tol || 5) + ' م')); cb.appendChild(el('div', 'small', rec.cmp.dist != null ? 'أقرب عنصر على بعد ' + GV.fmtLen(rec.cmp.dist) + '. هيتسجل كعنصر مش موجود في GIS.' : 'هيتسجل كعنصر مش موجود في GIS.')); }
    else {
      cb.style.setProperty('--sc', STATUS.match[1]);
      cb.appendChild(el('b', null, 'لقيت العنصر في ' + rec.cmp.layer + ' (على بعد ' + GV.fmtLen(rec.cmp.dist) + ')'));
      const cp = el('button', 'chip', 'انسخ قيم GIS في النموذج'); cp.onclick = () => { form.fields.forEach(fd => { const k = refKey(nf, fd.key); const inp = document.querySelector('#recFields [data-key="' + CSS.escape(fd.key) + '"]'); if (k && inp && fd.type !== 'photo') { inp.value = nf.properties[k] == null ? '' : nf.properties[k]; inp.dispatchEvent(new Event('input')); } }); };
      cb.appendChild(cp);
    }
    const box = $('#recFields'); box.textContent = '';
    form.fields.forEach(fd => {
      const wrap = el('label', 'fld'); wrap.appendChild(el('span', null, fd.key + (fd.required ? ' *' : '')));
      let inp;
      if (fd.type === 'choice' || fd.type === 'yesno') { inp = el('select'); const opts = fd.type === 'yesno' ? ['نعم', 'لا'] : (fd.options || []); [''].concat(opts).forEach(o => { const op = el('option', null, o || '—'); op.value = o; inp.appendChild(op); }); }
      else if (fd.type === 'photo') {
        inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true; const pb = el('span', 'chip', '📷 صوّر أو اختار صور');
        const list = el('div', 'photos sm'); rec.photos.forEach(p => addThumb(list, p));
        inp.onchange = () => { Array.from(inp.files).forEach(f => { rec.photos.push(f); addThumb(list, f); }); inp.value = ''; };
        wrap.append(pb, inp, list); box.appendChild(wrap); return;
      }
      else { inp = el('input'); inp.type = fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'; if (fd.type === 'number') inp.step = 'any'; }
      inp.dataset.key = fd.key; wrap.appendChild(inp);
      if (nf) {
        const k = refKey(nf, fd.key);
        if (k) {
          const gv = nf.properties[k]; const hint = el('small', 'gis', 'في GIS: ' + (gv == null || gv === '' ? '—' : gv)); wrap.appendChild(hint);
          const chk = () => { const v = inp.value; hint.classList.toggle('bad', v !== '' && !sameVal(v, gv)); hint.classList.toggle('ok', v !== '' && sameVal(v, gv)); };
          inp.addEventListener('input', chk); inp.addEventListener('change', chk);
        }
      }
      box.appendChild(wrap);
    });
    $('#recInfo').textContent = rec.acc ? 'دقة الـ GPS: ±' + Math.round(rec.acc) + ' م' : '';
    GV.openSheet('#recSheet');
  }
  function addThumb(list, file) { const im = el('img'); im.src = URL.createObjectURL(file); list.appendChild(im); }
  $('#recCancel').addEventListener('click', () => { GV.closeSheets(); cancelRecord(); });
  $('#recSave').addEventListener('click', async () => {
    const form = rec.form; const values = {};
    for (const fd of form.fields) {
      if (fd.type === 'photo') continue;
      const inp = document.querySelector('#recFields [data-key="' + CSS.escape(fd.key) + '"]'); let v = inp ? inp.value : '';
      if (fd.type === 'number' && v !== '') v = Number(v);
      if (fd.required && (v === '' || v == null)) return GV.toast('الحقل "' + fd.key + '" إجباري');
      values[fd.key] = v === '' ? null : v;
    }
    if (form.fields.some(f => f.type === 'photo' && f.required) && !rec.photos.length) return GV.toast('لازم تضيف صورة');
    const cmp = { status: rec.cmp.status };
    if (rec.cmp.layer) cmp.layer = rec.cmp.layer;
    if (rec.cmp.dist != null) cmp.dist = +rec.cmp.dist.toFixed(3);
    if (rec.cmp.status === 'match') {
      const nf = rec.cmp.near.f; const diffs = [];
      form.fields.forEach(fd => { if (fd.type === 'photo') return; const k = refKey(nf, fd.key); const v = values[fd.key]; if (k && v != null && v !== '' && !sameVal(v, nf.properties[k])) diffs.push({ f: fd.key, v: String(v), g: nf.properties[k] == null ? '' : String(nf.properties[k]) }); });
      cmp.diffs = diffs; if (diffs.length) cmp.status = 'diff';
      const idk = ['OBJECTID', 'FID', 'fid', 'id', 'ID'].find(k => nf.properties && nf.properties[k] != null); if (idk) cmp.ref = idk + '=' + nf.properties[idk];
    }
    $('#busy').classList.add('show'); $('#busyText').textContent = rec.photos.length ? 'برفع ' + rec.photos.length + ' صورة…' : 'بحفظ…';
    try {
      const photos = [];
      for (const p of rec.photos) {
        if (!assets) break;
        const blob = await shrink(p);
        const a = await assets.upload(blob); photos.push({ id: a.id, url: a.url });
      }
      const body = { formId: form.id, geometry: rec.geometry, values, photos, cmp, by: uid, at: new Date().toISOString() };
      if (rec.acc != null) body.acc = Math.round(rec.acc * 10) / 10;
      await db.collection('records').add(body);
      GV.closeSheets(); GV.map.removeLayer(rec.tmp); rec = null;
      GV.toast(cmp.status === 'diff' ? 'اتسجل · فيه ' + cmp.diffs.length + ' اختلاف مع GIS' : cmp.status === 'new' ? 'اتسجل · عنصر مش موجود في GIS' : 'اتسجل ✓');
    } catch (e) {
      GV.showMsg(e && e.code === 'invalid_argument' ? 'مش مسموح لك تسجّل. اطلب من المسؤول يديك صلاحية Contributor من زرار Share.' : 'مقدرتش أحفظ التسجيل: ' + ((e && (e.message || e.code)) || e));
    } finally { $('#busy').classList.remove('show'); }
  });
  async function shrink(file) {
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.82));
    } catch (e) { return file; }
  }
  async function exifGPS(file) {
    try {
      const b = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
      if (b[0] !== 0xff || b[1] !== 0xd8) return null;
      let p = 2;
      while (p < b.length - 4) {
        if (b[p] !== 0xff) return null;
        const mk = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
        if (mk === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
          const t = p + 10; const dv = new DataView(b.buffer, t); const le = dv.getUint16(0) === 0x4949;
          const ifd = (off, cb) => { const n = dv.getUint16(off, le); for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; cb(dv.getUint16(e, le), dv.getUint16(e + 2, le), dv.getUint32(e + 4, le), e + 8); } };
          let gpsOff = null; ifd(dv.getUint32(4, le), (tag, ty, cnt, vo) => { if (tag === 0x8825) gpsOff = dv.getUint32(vo, le); });
          if (gpsOff == null) return null;
          const g = {}; ifd(gpsOff, (tag, ty, cnt, vo) => {
            if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(dv.getUint8(vo));
            if ((tag === 2 || tag === 4) && ty === 5) { const o = dv.getUint32(vo, le); const r = k => dv.getUint32(o + k * 8, le) / (dv.getUint32(o + k * 8 + 4, le) || 1); g[tag] = r(0) + r(1) / 60 + r(2) / 3600; }
          });
          if (g[2] == null || g[4] == null) return null;
          return [g[1] === 'S' ? -g[2] : g[2], g[3] === 'W' ? -g[4] : g[4]];
        }
        p += 2 + len;
      }
    } catch (e) { }
    return null;
  }

  initTeam();
})();

// logos for the A1 sheet (client / consultant / contractor): kept on this device, written beside the DXF as logos/*.png|jpg
(function () {
  const GV = window.GV; GV.cadLogos = {};
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const un64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const mark = () => document.querySelectorAll('input[data-logo]').forEach(inp => { const L = GV.cadLogos[inp.dataset.logo]; const lab = inp.parentElement; if (lab) lab.style.color = L ? 'var(--ok, #2a8)' : ''; inp.title = L ? 'محفوظ: ' + L.name : ''; });
  try { const st = JSON.parse((GV.store && GV.store.get('gv_cad_logos')) || 'null'); if (st) Object.keys(st).forEach(k0 => { const L = st[k0]; const k = k0 === 'client' ? 'owner' : k0; if (L && L.b64) GV.cadLogos[k] = { name: L.name, ext: L.ext, w: L.w, h: L.h, bytes: un64(L.b64) }; }); } catch (e) { }
  const save = () => { try { const o = {}; Object.keys(GV.cadLogos).forEach(k => { const L = GV.cadLogos[k]; o[k] = { name: L.name, ext: L.ext, w: L.w, h: L.h, b64: b64(L.bytes) }; }); GV.store.set('gv_cad_logos', JSON.stringify(o)); } catch (e) { } };
  document.addEventListener('change', async e => {
    const inp = e.target; if (!inp.matches || !inp.matches('input[data-logo]') || !inp.files || !inp.files[0]) return;
    const f = inp.files[0]; const bytes = new Uint8Array(await f.arrayBuffer()); let w = 0, h = 0;
    try { const bm = await createImageBitmap(new Blob([bytes], { type: f.type })); w = bm.width; h = bm.height; } catch (er) { }
    if (!w) { GV.toast('الصورة مش مقروءة — جرّب PNG أو JPG'); return; }
    GV.cadLogos[inp.dataset.logo] = { name: f.name, ext: /png$/i.test(f.type) ? 'png' : 'jpg', w, h, bytes }; save(); mark();
  });
  document.addEventListener('DOMContentLoaded', mark); setTimeout(mark, 1500);
})();
