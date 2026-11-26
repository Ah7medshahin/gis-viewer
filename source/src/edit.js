/* Editing toolbar: select (click / box), move, vertex edit, snap, delete, undo — like a GIS editor.
   Edits are allowed only on working copies; originals stay read-only ("مبنلعبش في أصل الشغل"). */
(function () {
  const GV = window.GV; const { $, el, map } = GV;
  let tool = null, on = false, snap = true; let sel = []; // [{l, i}]
  const undoSt = []; let hlG = null, boxR = null, vtxG = null;
  const SNAP_PX = 12;

  // ---------- toolbar ----------
  const bar = el('div', 'edbar'); bar.id = 'edBar'; bar.hidden = true;
  const B = (id, ico, tip) => { const b = el('button', 'edb', ico); b.dataset.t = id; b.title = tip; bar.appendChild(b); return b; };
  const grip = el('span', 'edgrip', '⋮⋮'); grip.title = 'اسحب لتحريك الشريط'; bar.appendChild(grip);
  const bSel = B('select', '👆', 'تحديد: دوس على العنصر (Shift + دوس عشان تضيف/تشيل)');
  const bBox = B('box', '⬚', 'تحديد بمربع: اسحب مربع على الخريطة (Shift يضيف للتحديد)');
  const bMove = B('move', '✥', 'تحريك العناصر المحددة: اسحب من أي مكان على الخريطة');
  const bVtx = B('vertex', '⌁', 'تعديل الرؤوس: اسحب أي رأس للعنصر المحدد (دبل كليك على رأس يمسحه)');
  const bSnap = B('snap', '🧲', 'السناب على رؤوس ونقط الطبقات الظاهرة'); bSnap.classList.add('on');
  const bDel = B('del', '🗑', 'مسح المحدد'); const bUndo = B('undo', '↶', 'تراجع (Ctrl+Z)'); const bTbl = B('tbl', '📋', 'أتربيوت المحدد');
  const info = el('span', 'edinfo', 'مفيش تحديد'); bar.appendChild(info);
  const bOff = B('off', '✕', 'اقفل شريط التحرير');
  document.body.appendChild(bar);
  const fab = el('button', 'round'); fab.id = 'btnEdit'; fab.title = 'شريط التحرير (تحديد · تحريك · سناب)'; fab.textContent = '✏️';
  const col = document.querySelector('.fab-col'); if (col) col.appendChild(fab);
  fab.onclick = () => setOn(!on);
  // drag the toolbar by its grip
  grip.addEventListener('pointerdown', e => { e.preventDefault(); const r0 = bar.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY; grip.setPointerCapture(e.pointerId);
    const mv = ev => { bar.style.left = Math.max(0, r0.left + ev.clientX - x0) + 'px'; bar.style.top = Math.max(0, r0.top + ev.clientY - y0) + 'px'; bar.style.transform = 'none'; };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); GV.store.set('gv_edbar', JSON.stringify([bar.style.left, bar.style.top])); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); });
  try { const p = JSON.parse(GV.store.get('gv_edbar') || 'null'); if (p) { bar.style.left = p[0]; bar.style.top = p[1]; bar.style.transform = 'none'; } } catch (e) { }

  function setOn(v) { on = v; bar.hidden = !v; fab.classList.toggle('on', v); if (v) setTool('select'); else { setTool(null); clearSel(); } }
  function setTool(t) {
    tool = t; bar.querySelectorAll('.edb[data-t]').forEach(b => { if (/^(select|box|move|vertex)$/.test(b.dataset.t)) b.classList.toggle('on', b.dataset.t === t); });
    map.getContainer().classList.toggle('ed-cross', t === 'box' || t === 'move'); if (t === 'box' || t === 'move') map.dragging.disable(); else map.dragging.enable();
    drawVtx();
  }
  bar.addEventListener('click', e => { const b = e.target.closest('.edb'); if (!b) return; const t = b.dataset.t;
    if (/^(select|box|move|vertex)$/.test(t)) { if (t === 'vertex' && sel.length !== 1) return GV.toast('اختار عنصر واحد الأول عشان تعدّل رؤوسه'); if (t === 'move' && !sel.length) return GV.toast('حدد العناصر الأول'); setTool(t); }
    else if (t === 'snap') { snap = !snap; bSnap.classList.toggle('on', snap); GV.toast(snap ? 'السناب شغال' : 'السناب مقفول'); }
    else if (t === 'del') delSel(); else if (t === 'undo') undo(); else if (t === 'tbl') showTbl(); else if (t === 'off') setOn(false); });
  document.addEventListener('keydown', e => { if (!on) return; if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } else if (e.key === 'Delete') delSel(); else if (e.key === 'Escape') { clearSel(); setTool('select'); } });

  // ---------- helpers ----------
  const editable = l => { const src = GV.sources.find(s => s.layers.indexOf(l) >= 0); return !(src && GV.superseded && GV.superseded(src)) && !l._readonly; };
  const crsOf = l => { const c = l.crsDef && GV.resolveCRS(String(l.crsDef)); return c || { fn: x => x, inv: x => x }; };
  const clone = o => o ? JSON.parse(JSON.stringify(o)) : o;
  const eachC = (g, fn) => { if (!g) return; const t = g.type, c = g.coordinates; if (t === 'Point') fn(c); else if (t === 'LineString' || t === 'MultiPoint') c.forEach(fn); else if (t === 'Polygon' || t === 'MultiLineString') c.forEach(r => r.forEach(fn)); else if (t === 'MultiPolygon') c.forEach(p => p.forEach(r => r.forEach(fn))); };
  const visLayers = () => GV.sources.flatMap(s => s.layers).filter(l => l.visible && l.leaf && !l.noSelect && l.features.length && !/^(نتائج الفحص|مشاكل الداتا)$/.test(l.name));
  function updInfo() { info.textContent = sel.length ? sel.length + ' محدد' + (sel.some(s => !editable(s.l)) ? ' (فيه أصل للقراية بس)' : '') : 'مفيش تحديد'; }
  function drawHL() { if (hlG) map.removeLayer(hlG); hlG = L.layerGroup(sel.map(s => { const f = s.l.features[s.i]; return f && f.wgs ? L.geoJSON(f.wgs, { pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 9, color: '#00e5ff', weight: 3, fill: false }), style: { color: '#00e5ff', weight: 6, opacity: 0.85 }, interactive: false }) : null; }).filter(Boolean)).addTo(map); updInfo(); }
  function clearSel() { sel = []; drawHL(); drawVtx(); }
  function toggle(l, i, add) { const k = sel.findIndex(s => s.l === l && s.i === i); if (!add) { sel = k >= 0 && sel.length === 1 ? [] : [{ l, i }]; } else if (k >= 0) sel.splice(k, 1); else sel.push({ l, i }); drawHL(); drawVtx(); }
  function refresh(ls) { new Set(ls).forEach(l => { GV.rebuild(l); }); if (GV.onDirty) GV.onDirty(); drawHL(); drawVtx(); }
  // nearest vertex / point of visible layers within SNAP_PX (skipping the vertices being moved)
  function snapLL(ll, skip) {
    if (!snap) return ll; const p0 = map.latLngToContainerPoint(ll); let best = null; const bb = map.getBounds().pad(0.1);
    visLayers().forEach(l => l.features.forEach((f, i) => { if (!f.wgs || f._sym || (skip && skip(l, i))) return; eachC(f.wgs.geometry, c => { if (!bb.contains([c[1], c[0]])) return; const p = map.latLngToContainerPoint([c[1], c[0]]); const d = p0.distanceTo(p); if (d <= SNAP_PX && (!best || d < best.d)) best = { d, ll: L.latLng(c[1], c[0]) }; }); }));
    return best ? best.ll : ll;
  }
  function setGeomFromWgs(l, f, wgsGeom) { const crs = crsOf(l); f.wgs = { type: 'Feature', properties: {}, geometry: wgsGeom }; f.geometry = GV.mapCoords(wgsGeom, c => crs.inv(c));
    // keep the coordinate fields in step with the geometry (GIS ↔ CAD must match)
    const pr = f.properties || {}; const g = f.geometry; const st = g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : null, en = g.type === 'LineString' ? g.coordinates[g.coordinates.length - 1] : null;
    Object.keys(pr).forEach(k => { const K = k.toUpperCase(); if (st && /^(X|XCOORDINATE|X_COORDINATES?|EASTING|POINT_X|STARTXCOORDINATE|START_X_COORDINATES_?)$/.test(K)) pr[k] = +st[0].toFixed(4); else if (st && /^(Y|YCOORDINATE|Y_COORDINATES?|NORTHING|POINT_Y|STARTYCOORDINATE|START_Y_COORDINATES_?)$/.test(K)) pr[k] = +st[1].toFixed(4); else if (en && /^(ENDXCOORDINATE|END_X_COORDINATES_?)$/.test(K)) pr[k] = +en[0].toFixed(4); else if (en && /^(ENDYCOORDINATE|END_Y_COORDINATES_?)$/.test(K)) pr[k] = +en[1].toFixed(4); });
    // length, levels from the end structures, depth and slope follow the new geometry (and the pipes on a moved manhole)
    if (GV.recalcDerived) { try { const r = GV.recalcDerived(l, f, { quiet: true }); r.touched.forEach(t => { if (t !== l) GV.rebuild(t); }); if (r.n) { clearTimeout(setGeomFromWgs.t); setGeomFromWgs.t = setTimeout(() => GV.toast('الحقول المحسوبة اتحدّثت تلقائي (الإحداثيات، الطول، المناسيب، العمق، الميل)', 2500), 300); } } catch (e) { console.error(e); } } }

  // ---------- clicks ----------
  GV.editClick = (l, i, ev) => { if (on && (tool === 'box' || tool === 'move')) { L.DomEvent.stopPropagation(ev); return true; } if (!on || tool !== 'select' && tool !== 'vertex') return false; L.DomEvent.stopPropagation(ev); toggle(l, i, ev.originalEvent && ev.originalEvent.shiftKey); if (tool === 'select' && sel.length === 1) GV.showFeature(l, i, ev.latlng); else if (tool === 'select' && sel.length > 1) showTbl(true); return true; };
  map.on('click', () => { if (on && tool === 'select' && sel.length) clearSel(); });

  // ---------- box select & move (drag on the map) ----------
  let drag = null;
  map.on('mousedown', e => {
    if (!on) return;
    if (tool === 'box') { drag = { a: e.latlng, add: e.originalEvent.shiftKey }; boxR = L.rectangle([e.latlng, e.latlng], { color: '#00b4d8', weight: 2, dashArray: '5 4', fillOpacity: 0.08, interactive: false }).addTo(map); }
    else if (tool === 'move' && sel.length) { if (sel.some(s => !editable(s.l))) return GV.toast('فيه عنصر من ملف أصلي (للقراية بس) — اشتغل على نسخة الشغل'); const a = snapLL(e.latlng, (l, i) => sel.some(s => s.l === l && s.i === i)); drag = { a, before: sel.map(s => ({ l: s.l, i: s.i, g: clone(s.l.features[s.i].geometry), w: clone(s.l.features[s.i].wgs), p: clone(s.l.features[s.i].properties) })) }; }
  });
  map.on('mousemove', e => {
    if (!drag) return;
    if (tool === 'box') boxR.setBounds(L.latLngBounds(drag.a, e.latlng));
    else if (tool === 'move') { const b = snapLL(e.latlng, (l, i) => sel.some(s => s.l === l && s.i === i)); const dx = b.lng - drag.a.lng, dy = b.lat - drag.a.lat; if (hlG) map.removeLayer(hlG); hlG = L.layerGroup(drag.before.map(o => o.w ? L.geoJSON(GV.mapCoords(o.w.geometry, c => [c[0] + dx, c[1] + dy]), { pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 9, color: '#00e5ff', weight: 3, fill: false }), style: { color: '#00e5ff', weight: 5, dashArray: '6 4' }, interactive: false }) : null).filter(Boolean)).addTo(map); drag.d = [dx, dy]; }
  });
  map.on('mouseup', e => {
    if (!drag) return; const d = drag; drag = null;
    if (tool === 'box') { const bb = boxR.getBounds(); map.removeLayer(boxR); boxR = null; if (!d.add) sel = [];
      visLayers().forEach(l => l.features.forEach((f, i) => { if (!f.wgs || f._sym) return; let hit = false; eachC(f.wgs.geometry, c => { if (!hit && bb.contains([c[1], c[0]])) hit = true; }); if (hit && !sel.some(s => s.l === l && s.i === i)) sel.push({ l, i }); }));
      drawHL(); GV.toast(sel.length + ' عنصر اتحدد'); if (sel.length) showTbl(true); }
    else if (tool === 'move' && d.d) { const [dx, dy] = d.d; d.before.forEach(o => { const f = o.l.features[o.i]; if (f.wgs) setGeomFromWgs(o.l, f, GV.mapCoords(f.wgs.geometry, c => [c[0] + dx, c[1] + dy])); }); undoSt.push({ kind: 'geom', items: d.before }); refresh(d.before.map(o => o.l)); GV.toast('اتحرك ' + d.before.length + ' عنصر' + (snap ? ' (بالسناب)' : '')); }
  });

  // ---------- vertex editing ----------
  function drawVtx() {
    if (vtxG) { map.removeLayer(vtxG); vtxG = null; } if (!on || tool !== 'vertex' || sel.length !== 1) return;
    const { l, i } = sel[0]; const f = l.features[i]; if (!f || !f.wgs) return; if (!editable(l)) { GV.toast('ده ملف أصلي للقراية بس — اشتغل على نسخة الشغل'); return; }
    vtxG = L.layerGroup().addTo(map); const g = f.wgs.geometry; const refs = []; const walk = (arr, path) => arr.forEach((c, k) => { if (typeof c[0] === 'number') refs.push({ c, path: path.concat(k) }); else walk(c, path.concat(k)); });
    if (g.type === 'Point') refs.push({ c: g.coordinates, path: [] }); else walk(g.coordinates, []);
    refs.forEach(r => { const m = L.marker([r.c[1], r.c[0]], { draggable: true, icon: L.divIcon({ className: 'vtx-h', iconSize: [12, 12] }) }); m.addTo(vtxG);
      m.on('drag', ev => { const s = snapLL(ev.latlng, (L2, I2) => L2 === l && I2 === i); if (s !== ev.latlng) m.setLatLng(s); });
      m.on('dragend', () => { const ll = m.getLatLng(); const before = [{ l, i, g: clone(f.geometry), w: clone(f.wgs), p: clone(f.properties) }]; const ng = clone(f.wgs.geometry); if (!r.path.length) ng.coordinates = [ll.lng, ll.lat].concat(ng.coordinates.slice(2)); else { let a = ng.coordinates; for (let k = 0; k < r.path.length - 1; k++) a = a[r.path[k]]; const last = r.path[r.path.length - 1]; a[last] = [ll.lng, ll.lat].concat(a[last].slice(2)); if (ng.type === 'Polygon' && (last === 0 || last === a.length - 1)) { a[0] = a[last].slice(); a[a.length - 1] = a[last].slice(); } } setGeomFromWgs(l, f, ng); undoSt.push({ kind: 'geom', items: before }); refresh([l]); });
      m.on('dblclick', ev => { L.DomEvent.stop(ev); if (g.type !== 'LineString' || g.coordinates.length <= 2) return GV.toast('مينفعش تمسح الرأس ده'); const before = [{ l, i, g: clone(f.geometry), w: clone(f.wgs), p: clone(f.properties) }]; const ng = clone(f.wgs.geometry); ng.coordinates.splice(r.path[0], 1); setGeomFromWgs(l, f, ng); undoSt.push({ kind: 'geom', items: before }); refresh([l]); });
    });
  }

  // ---------- delete / undo / table ----------
  function delSel() { if (!sel.length) return GV.toast('مفيش تحديد'); if (sel.some(s => !editable(s.l))) return GV.toast('فيه عنصر من ملف أصلي (للقراية بس) — اشتغل على نسخة الشغل');
    const by = new Map(); sel.forEach(s => { if (!by.has(s.l)) by.set(s.l, []); by.get(s.l).push(s.i); }); const rec = [];
    by.forEach((ix, l) => { ix.sort((a, b) => b - a).forEach(i => { rec.push({ l, i, f: l.features[i] }); l.features.splice(i, 1); }); });
    undoSt.push({ kind: 'del', items: rec }); sel = []; refresh([...by.keys()]); GV.renderLayers && GV.renderLayers(); GV.toast('اتمسح ' + rec.length + ' عنصر — لو غلط دوس ↶ أو Ctrl+Z'); }
  function undo() { const u = undoSt.pop(); if (!u) return GV.toast('مفيش حاجة أتراجع عنها');
    if (u.kind === 'geom') u.items.forEach(o => { const f = o.l.features[o.i]; if (f) { f.geometry = o.g; f.wgs = o.w; if (o.p) f.properties = o.p; } });
    else u.items.slice().reverse().forEach(o => o.l.features.splice(o.i, 0, o.f));
    refresh(u.items.map(o => o.l)); GV.renderLayers && GV.renderLayers(); GV.toast('اتراجعت'); }
  // attributes of the current selection: one item → the feature panel; several → the table filtered to the selection,
  // with a tab per layer when the selection spans several layers
  function showTbl(quiet) {
    if (!sel.length) { if (!quiet) GV.toast('مفيش تحديد'); return; }
    if (sel.length === 1) { const { l, i } = sel[0]; const f = l.features[i]; let ll = null; try { ll = L.geoJSON(f.wgs).getBounds().getCenter(); } catch (e) { } GV.showFeature(l, i, ll); return; }
    const by = new Map(); sel.forEach(x => { if (!by.has(x.l)) by.set(x.l, []); by.get(x.l).push(x.i); });
    const open = l => {
      GV._keepSelTabs = true; GV.openTable(l, false, by.get(l), 'المحدد'); GV._keepSelTabs = false;
      let tb = document.getElementById('tblSelTabs'); if (tb) tb.remove();
      if (by.size > 1) { tb = el('div', 'sel-tabs'); tb.id = 'tblSelTabs'; by.forEach((ix, l2) => { const c = el('button', 'chip' + (l2 === l ? ' on' : ''), l2.name + ' (' + ix.length + ')'); c.onclick = () => open(l2); tb.appendChild(c); }); const cnt = $('#tblCount'); if (cnt) cnt.parentNode.insertBefore(tb, cnt); }
    };
    open(sel[0].l);
  }

  GV.editSel = () => sel.slice();
})();
