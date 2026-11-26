/* 🌐 Online services as layers: ArcGIS REST (FeatureServer / MapServer → real feature layers you can check, edit and
   export, or a picture of the map), WMS, XYZ / tile URLs and GeoJSON links. Picture layers are kept in gv_services and
   travel with the synced workspace. */
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const KEY = 'gv_services';
  let SV = []; try { SV = JSON.parse(GV.store.get(KEY) || '[]'); } catch (e) { }
  const live = new Map(); // id → leaflet layer
  const save = () => { GV.store.set(KEY, JSON.stringify(SV)); if (GV.onDirty) GV.onDirty(); };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clean = u => String(u || '').trim().replace(/\?.*$/, '').replace(/\/+$/, '');
  const qs = o => Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k])).join('&');
  async function getJSON(url, token) {
    const u = url + (url.includes('?') ? '&' : '?') + 'f=json' + (token ? '&token=' + encodeURIComponent(token) : '');
    let r; try { r = await fetch(u); } catch (e) { throw new Error('السيرفر مش بيرد أو مش سامح بالفتح من المتصفح (CORS)'); }
    if (!r.ok) throw new Error('السيرفر رد بخطأ ' + r.status);
    const j = await r.json(); if (j.error) throw new Error((j.error.message || 'خطأ') + (j.error.code === 499 || j.error.code === 498 ? ' — السيرفيس محتاج توكن' : '')); return j;
  }

  /* ---------- picture layers (tiles / WMS / ArcGIS export) ---------- */
  const EsriDyn = L.TileLayer.extend({
    getTileUrl(c) {
      const s = this.getTileSize(), nw = this._map.unproject([c.x * s.x, c.y * s.y], c.z), se = this._map.unproject([(c.x + 1) * s.x, (c.y + 1) * s.y], c.z);
      const a = L.CRS.EPSG3857.project(nw), b = L.CRS.EPSG3857.project(se);
      return this._url + '/export?' + qs(Object.assign({ bbox: [a.x, b.y, b.x, a.y].join(','), bboxSR: 3857, imageSR: 3857, size: s.x + ',' + s.y, format: 'png32', transparent: true, f: 'image' }, this.options.layersParam ? { layers: this.options.layersParam } : {}, this.options.token ? { token: this.options.token } : {}));
    }
  });
  function makeLeaf(s) {
    const o = { opacity: s.opacity == null ? 1 : s.opacity, maxZoom: 22, zIndex: 300 };
    if (s.type === 'xyz') return L.tileLayer(s.url, Object.assign(o, { maxNativeZoom: 19 }));
    if (s.type === 'wms') return L.tileLayer.wms(s.url, Object.assign(o, { layers: s.layers, format: 'image/png', transparent: true, version: s.version || '1.3.0' }));
    if (s.type === 'esritile') return L.tileLayer(s.url + '/tile/{z}/{y}/{x}' + (s.token ? '?token=' + s.token : ''), Object.assign(o, { maxNativeZoom: s.maxZ || 19 }));
    if (s.type === 'esridyn') return new EsriDyn(s.url, Object.assign(o, { layersParam: s.layers ? 'show:' + s.layers : '', token: s.token }));
    return null;
  }
  function show(s) { const old = live.get(s.id); if (old) GV.map.removeLayer(old); live.delete(s.id); if (!s.on) return; const lf = makeLeaf(s); if (lf) { lf.addTo(GV.map); live.set(s.id, lf); } }
  function addPic(s) { s.id = s.id || rid(); s.on = s.on !== false; SV.push(s); save(); show(s); GV.toast('اتضاف: ' + s.name); render(); }
  GV.svcState = () => SV.map(s => Object.assign({}, s));
  GV.svcApply = list => { if (!Array.isArray(list)) return; live.forEach(lf => GV.map.removeLayer(lf)); live.clear(); SV = list.map(s => Object.assign({}, s)); GV.store.set(KEY, JSON.stringify(SV)); SV.forEach(show); if ($('#svcSheet') && $('#svcSheet').classList.contains('open')) render(); };
  setTimeout(() => SV.forEach(show), 800);

  /* ---------- features from ArcGIS / GeoJSON ---------- */
  function esriToGeo(g) {
    if (!g) return null;
    if (g.x != null) return { type: 'Point', coordinates: [g.x, g.y].concat(g.z != null ? [g.z] : []) };
    if (g.points) return { type: 'MultiPoint', coordinates: g.points };
    if (g.paths) return g.paths.length === 1 ? { type: 'LineString', coordinates: g.paths[0] } : { type: 'MultiLineString', coordinates: g.paths };
    if (g.rings) { // outer rings are clockwise in Esri JSON
      const area = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a; };
      const polys = []; g.rings.forEach(r => { if (area(r) >= 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r); });
      return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
    }
    return null;
  }
  async function fetchLayer(url, info, opts, prog) {
    const max = info.maxRecordCount || 1000; const feats = []; let off = 0, useGeo = true;
    const base = { where: opts.where || '1=1', outFields: '*', outSR: 4326, returnGeometry: true };
    if (opts.extent) { const b = GV.map.getBounds(); Object.assign(base, { geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects' }); }
    const pageable = info.advancedQueryCapabilities ? info.advancedQueryCapabilities.supportsPagination !== false : true;
    for (let guard = 0; guard < 200; guard++) {
      const p = Object.assign({}, base, pageable ? { resultOffset: off, resultRecordCount: max } : {}, { f: useGeo ? 'geojson' : 'json' }, opts.token ? { token: opts.token } : {});
      let j; try { const r = await fetch(url + '/query?' + qs(p)); j = await r.json(); } catch (e) { if (useGeo) { useGeo = false; guard--; continue; } throw new Error('مقدرتش أجيب الداتا من السيرفر'); }
      if (j.error) { if (useGeo) { useGeo = false; guard--; continue; } throw new Error(j.error.message || 'خطأ من السيرفر'); }
      const got = useGeo ? (j.features || []).map(f => ({ type: 'Feature', properties: f.properties || {}, geometry: f.geometry })) : (j.features || []).map(f => ({ type: 'Feature', properties: f.attributes || {}, geometry: esriToGeo(f.geometry) }));
      got.forEach(f => feats.push(f)); off += got.length; if (prog) prog(feats.length);
      const more = useGeo ? (j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit)) : j.exceededTransferLimit;
      if (!got.length || !pageable || !(more || got.length >= max)) break;
      if (feats.length >= 100000) { GV.toast('وقفت عند 100,000 عنصر — استخدم "الظاهر في الشاشة بس" أو فلتر', 6000); break; }
    }
    return feats;
  }
  // coded-value domains of the service travel with the layer (so QC / BOQ show the descriptions)
  function domOf(info) {
    const domains = {}, defs = {}; (info.fields || []).forEach(f => { if (f.domain && f.domain.type === 'codedValue') { const n = f.domain.name || ('D_' + f.name); domains[f.name] = n; defs[n] = { codes: f.domain.codedValues.map(c => ({ code: c.code, name: c.name })) }; } });
    return Object.keys(domains).length ? { domains, domainDefs: defs } : null;
  }
  async function addFeatures(svcUrl, picks, opts) {
    $('#busy').classList.add('show');
    try {
      const layers = [];
      for (const pk of picks) {
        const u = svcUrl + '/' + pk.id; $('#busyText').textContent = 'بجيب ' + pk.name + '…';
        const info = await getJSON(u, opts.token);
        const feats = await fetchLayer(u, info, opts, n => { $('#busyText').textContent = 'بجيب ' + pk.name + '… ' + n.toLocaleString('en') + ' عنصر'; });
        layers.push({ name: pk.name, features: feats, crs: '4326', _dom: domOf(info) });
      }
      const name = decodeURIComponent(svcUrl.split('/services/')[1] || svcUrl).replace(/\/(FeatureServer|MapServer)$/i, '');
      const added = await GV.addGroups([{ name: '🌐 ' + name, type: 'ArcGIS Service', layers }], { noAsk: true });
      const src = added && added[0]; if (src) src.layers.forEach((l, i) => { const d = layers[i] && layers[i]._dom; if (d) { l.domInfo = d; l.svcDom = d; } });
      GV.renderLayers(); GV.updateEmpty(); if (src && src.layers[0] && GV.zoomLayer) GV.zoomLayer(src.layers.find(l => l.features.length) || src.layers[0]);
      GV.toast('اتضافت ' + layers.length + ' طبقة (' + layers.reduce((a, l) => a + l.features.length, 0).toLocaleString('en') + ' عنصر) — تقدر تملا بيها حقولك من "📥 بيانات من سيرفيس"', 6000);
      if (GV.onDirty) GV.onDirty();
    } catch (e) { GV.showMsg('مقدرتش أضيف السيرفيس:\n' + (e.message || e)); }
    finally { $('#busy').classList.remove('show'); }
  }
  async function addGeoJSONUrl(url) {
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بجيب الملف…';
    try { const r = await fetch(url); const j = await r.json(); const fs = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [];
      await GV.addGroups([{ name: '🌐 ' + (url.split('/').pop() || 'GeoJSON'), type: 'GeoJSON link', layers: [{ name: url.split('/').pop().replace(/\.(geo)?json$/i, '') || 'layer', features: fs, crs: '4326' }] }], { noAsk: true }); GV.renderLayers(); GV.updateEmpty(); }
    catch (e) { GV.showMsg('مقدرتش أفتح اللينك: ' + (e.message || e)); } finally { $('#busy').classList.remove('show'); }
  }

  /* ---------- UI ---------- */
  const sh = el('div', 'sheet panel right'); sh.id = 'svcSheet';
  sh.innerHTML = '<div class="grab"></div><div class="sh-head"><h2>🌐 إضافة سيرفيس</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="svcBody"></div>';
  document.body.appendChild(sh); sh.querySelector('[data-close]').onclick = () => sh.classList.remove('open');
  let found = null; // last inspected service
  function render() {
    const b = $('#svcBody'); b.innerHTML = '';
    b.appendChild(el('p', 'muted small', 'الصق لينك سيرفيس: ArcGIS Server (FeatureServer / MapServer)، WMS، خريطة Tiles فيها {z}/{x}/{y}، أو لينك GeoJSON.'));
    const u = el('input'); u.placeholder = 'https://…/arcgis/rest/services/…/FeatureServer'; u.style.cssText = 'width:100%;direction:ltr'; u.value = GV.store.get('gv_svclast') || '';
    const tk = el('input'); tk.placeholder = 'توكن (لو السيرفيس محمي — اختياري)'; tk.style.cssText = 'width:100%;direction:ltr;margin-top:6px';
    const go = el('button', 'chip done', '🔍 افتح السيرفيس'); go.style.marginTop = '6px';
    const out = el('div'); out.style.marginTop = '8px';
    go.onclick = () => inspect(u.value.trim(), tk.value.trim(), out);
    u.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    b.append(u, tk, go, out);
    b.appendChild(el('div', 'tsec', '📂 من ملف عندك (رفع مساحي)'));
    b.appendChild(el('p', 'muted small', 'صورة جوية/أورثو (TIF، JPG أو PNG مع ملف الـ world، JP2، IMG…)، DEM، باكدج Tiles (TPKX / TPK / MBTiles) أو KMZ. لو الصورة معاها ملفات (.jgw .tfw .prj) اختارهم كلهم مع بعض.'));
    const cs = el('select'); GV.CRS_CHOICES.forEach(([c, l]) => { const o = el('option', '', l); o.value = c; cs.appendChild(o); }); cs.value = GV.store.get('gv_crs') || '32638'; cs.onchange = () => GV.store.set('gv_crs', cs.value);
    const fi = el('input'); fi.type = 'file'; fi.multiple = true; fi.accept = '.tif,.tiff,.jpg,.jpeg,.png,.jp2,.img,.asc,.ecw,.sid,.jgw,.pgw,.tfw,.wld,.j2w,.prj,.xml,.ovr,.tpk,.tpkx,.mbtiles,.kmz,.kml,.vrt,.bil,.dem,.hgt'; fi.style.display = 'none';
    const fb = el('button', 'chip done', '📂 اختار الملف'); fb.onclick = () => fi.click(); fi.onchange = async () => { await GV.openLocalRaster(fi.files, cs.value); fi.value = ''; render(); };
    const rr = el('div', 'mp-btns'); rr.append(fb, el('span', 'small', 'نظامه لو مش جواه:'), cs, fi); b.appendChild(rr);
    (GV.localRasters || []).forEach(r => { const row = el('div', 'svc-row'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = GV.map.hasLayer(r.leaf); ck.onchange = () => { if (ck.checked) r.leaf.addTo(GV.map); else GV.map.removeLayer(r.leaf); };
      const op = el('input'); op.type = 'range'; op.min = 0.1; op.max = 1; op.step = 0.1; op.value = 1; op.oninput = () => { if (r.leaf.setOpacity) r.leaf.setOpacity(+op.value); else if (r.leaf.eachLayer) r.leaf.eachLayer(x => x.setOpacity && x.setOpacity(+op.value)); };
      const x = el('button', 'icon-btn small', '✕'); x.onclick = () => { GV.removeRaster(r.id); render(); }; row.append(ck, el('span', '', '📂 ' + r.name), op, x); b.appendChild(row); });
    const jb = el('button', 'chip', '📥 خلّي الداتا بيز بتاعتي تاخد بيانات من سيرفيس أو طبقة'); jb.style.marginTop = '10px'; jb.onclick = () => GV.openJoin && GV.openJoin(); b.appendChild(jb);
    if (SV.length) {
      b.appendChild(el('div', 'tsec', 'السيرفيسات المعروضة كصورة'));
      SV.forEach(s => {
        const r = el('div', 'svc-row'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = s.on !== false; ck.onchange = () => { s.on = ck.checked; save(); show(s); };
        const op = el('input'); op.type = 'range'; op.min = 0.1; op.max = 1; op.step = 0.1; op.value = s.opacity == null ? 1 : s.opacity; op.title = 'الشفافية'; op.oninput = () => { s.opacity = +op.value; const lf = live.get(s.id); if (lf) lf.setOpacity(s.opacity); }; op.onchange = save;
        const x = el('button', 'icon-btn small', '✕'); x.title = 'شيل'; x.onclick = () => { SV = SV.filter(y => y !== s); const lf = live.get(s.id); if (lf) GV.map.removeLayer(lf); live.delete(s.id); save(); render(); };
        r.append(ck, el('span', '', s.name), op, x); b.appendChild(r);
      });
    }
  }
  async function inspect(url, token, out) {
    out.innerHTML = ''; if (!url) return; GV.store.set('gv_svclast', url);
    try {
      if (/\{z\}/i.test(url)) { addPic({ type: 'xyz', url, name: 'Tiles — ' + (url.split('/')[2] || '') }); return; }
      if (/\.(geo)?json(\?|$)/i.test(url) && !/\/rest\/services\//i.test(url)) { await addGeoJSONUrl(url); return; }
      if (/wms/i.test(url) && !/\/rest\/services\//i.test(url)) return await inspectWMS(url, out);
      const base = clean(url).replace(/\/\d+$/, m => { out._one = +m.slice(1); return ''; });
      if (!/\/(FeatureServer|MapServer)$/i.test(base)) throw new Error('اللينك لازم يخلص بـ FeatureServer أو MapServer (أو رقم طبقة بعدهم)');
      out.appendChild(el('div', 'muted small', '⏳ بقرا السيرفيس…'));
      const j = await getJSON(base, token); out.innerHTML = '';
      const isMap = /MapServer$/i.test(base);
      const ls = (j.layers || []).filter(x => !x.subLayerIds || !x.subLayerIds.length).concat((j.tables || []).map(t => Object.assign({ table: true }, t)));
      found = { base, token, ls };
      out.appendChild(el('b', '', (j.documentInfo && j.documentInfo.Title) || j.serviceDescription || decodeURIComponent(base.split('/services/')[1] || base)));
      const list = el('div', 'cklist'); list.style.maxHeight = '260px';
      ls.forEach(x => { const lb = el('label', 'ck'); const c = el('input'); c.type = 'checkbox'; c.checked = out._one != null ? x.id === out._one : true; c._x = x; lb.append(c, el('span', '', (x.table ? '▦ ' : '') + x.name + ' (' + x.id + ')')); list.appendChild(lb); });
      out.appendChild(list);
      const ext = el('label', 'ck'); const ec = el('input'); ec.type = 'checkbox'; ext.append(ec, el('span', '', 'هات الظاهر في الشاشة بس (أسرع للسيرفيسات الكبيرة)'));
      const wh = el('input'); wh.placeholder = 'فلتر اختياري (مثال: DIAMETER >= 300)'; wh.style.cssText = 'width:100%;direction:ltr';
      const picked = () => [...list.querySelectorAll('input')].filter(c => c.checked).map(c => c._x);
      const a1 = el('button', 'chip done', '⬇️ هات الداتا كطبقات (فحص · تعديل · تصدير)'); a1.onclick = () => { const p = picked(); if (!p.length) return GV.toast('اختار طبقة'); addFeatures(base, p, { token, extent: ec.checked, where: wh.value.trim() }); };
      const a2 = el('button', 'chip', '🖼 اعرضه كصورة على الخريطة'); a2.onclick = () => { const p = picked().filter(x => !x.table); if (isMap && j.singleFusedMapCache && p.length === ls.length) addPic({ type: 'esritile', url: base, token, name: base.split('/').slice(-2, -1)[0], maxZ: j.maxLOD || 19 }); else if (isMap) addPic({ type: 'esridyn', url: base, token, layers: p.map(x => x.id).join(','), name: base.split('/').slice(-2, -1)[0] }); else GV.toast('العرض كصورة للـ MapServer بس — للـ FeatureServer هات الداتا كطبقات'); };
      const row = el('div', 'mp-btns'); row.append(a1, a2);
      out.append(ext, wh, row);
    } catch (e) { out.innerHTML = ''; out.appendChild(el('div', 'small', '❌ ' + (e.message || e))); }
  }
  async function inspectWMS(url, out) {
    const base = url.split('?')[0];
    out.appendChild(el('div', 'muted small', '⏳ بقرا الـ WMS…'));
    let txt; try { txt = await (await fetch(base + '?service=WMS&request=GetCapabilities')).text(); } catch (e) { throw new Error('السيرفر مش بيرد أو مش سامح بالفتح من المتصفح (CORS)'); }
    const doc = new DOMParser().parseFromString(txt, 'text/xml'); out.innerHTML = '';
    const ver = (doc.documentElement.getAttribute('version') || '1.3.0');
    const names = [...doc.querySelectorAll('Layer > Name')].map(n => ({ name: n.textContent, title: ((n.parentNode.querySelector(':scope > Title') || {}).textContent) || n.textContent }));
    if (!names.length) throw new Error('مالقيتش طبقات في الـ WMS');
    const list = el('div', 'cklist'); list.style.maxHeight = '260px';
    names.forEach((x, i) => { const lb = el('label', 'ck'); const c = el('input'); c.type = 'checkbox'; c.checked = i === 0; c._x = x; lb.append(c, el('span', '', x.title)); list.appendChild(lb); });
    const a = el('button', 'chip done', '🖼 اعرض على الخريطة'); a.onclick = () => { const p = [...list.querySelectorAll('input')].filter(c => c.checked).map(c => c._x); if (!p.length) return GV.toast('اختار طبقة'); addPic({ type: 'wms', url: base, layers: p.map(x => x.name).join(','), version: ver, name: 'WMS — ' + p.map(x => x.title).join('، ') }); };
    out.append(list, a);
  }
  GV.openServices = () => { render(); GV.openSheet('#svcSheet'); };
  const st = document.createElement('style'); st.textContent = '.svc-row{display:grid;grid-template-columns:auto 1fr 90px auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}';
  document.head.appendChild(st);
})();
