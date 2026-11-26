/* 📂 Map layers from files you already have (survey deliverables): orthophotos and other rasters (GeoTIFF, JPG/PNG/TIF
   with a world file, JP2, IMG, ASC… through GDAL), tile packages (TPKX / TPK, compact cache v1 & v2), MBTiles, and KML/KMZ
   ground overlays. Rasters are reprojected properly onto the web map (not just stretched), kept on this device. */
(function () {
  'use strict';
  const GV = window.GV; const { el } = GV;
  const RL = []; // {id,name,leaf,kind}
  GV.localRasters = RL;
  /* ---- tiny IndexedDB store so picture layers come back after a restart (this device only) ---- */
  const db = () => new Promise((res, rej) => { const r = indexedDB.open('gv-rasters', 1); r.onupgradeneeded = () => r.result.createObjectStore('r'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = async (k, v) => { try { const d = await db(); await new Promise(r => { const t = d.transaction('r', 'readwrite'); t.objectStore('r').put(v, k); t.oncomplete = r; t.onerror = r; }); } catch (e) { } };
  const all = async () => { try { const d = await db(); return await new Promise(r => { const out = []; const q = d.transaction('r').objectStore('r').openCursor(); q.onsuccess = () => { const c = q.result; if (c) { out.push([c.key, c.value]); c.continue(); } else r(out); }; q.onerror = () => r(out); }); } catch (e) { return []; } };
  const del = async k => { try { const d = await db(); d.transaction('r', 'readwrite').objectStore('r').delete(k); } catch (e) { } };
  const rid = () => 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function addLeaf(rec, leaf) { leaf.addTo(GV.map); RL.push({ id: rec.id, name: rec.name, leaf, kind: rec.kind }); if (GV.onRasters) GV.onRasters(); }
  GV.removeRaster = id => { const i = RL.findIndex(r => r.id === id); if (i < 0) return; GV.map.removeLayer(RL[i].leaf); RL.splice(i, 1); del(id); if (GV.onRasters) GV.onRasters(); };

  /* ---- image raster → canvas in Web Mercator ---- */
  async function rasterFromTiff(buf, name, crsCode) {
    const tiff = await window.GeoTIFF.fromArrayBuffer(buf); const img = await tiff.getImage();
    const W = img.getWidth(), H = img.getHeight(); const keys = img.getGeoKeys() || {};
    const epsg = keys.ProjectedCSTypeGeoKey && keys.ProjectedCSTypeGeoKey !== 32767 ? keys.ProjectedCSTypeGeoKey : keys.GeographicTypeGeoKey && keys.GeographicTypeGeoKey !== 32767 ? keys.GeographicTypeGeoKey : null;
    const crs = GV.resolveCRS(epsg && GV.epsgDef(epsg) ? String(epsg) : crsCode); if (!crs) throw new Error('مش عارف نظام إحداثيات الصورة — اختاره من القايمة');
    const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution();
    const k = Math.min(1, 4096 / Math.max(W, H)); const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const spp = img.getSamplesPerPixel(); const bands = Math.min(spp, 4);
    const data = await img.readRasters({ width: w, height: h, interleave: false, samples: [...Array(bands).keys()], resampleMethod: 'bilinear' });
    const nd = img.getGDALNoData();
    // single band: elevation or grey — stretch to 0..255 (and offer as a surface)
    let mn = Infinity, mx = -Infinity; if (bands < 3) { const a = data[0]; for (let i = 0; i < a.length; i += 7) { const v = a[i]; if (v !== nd && isFinite(v) && v > -1e30) { if (v < mn) mn = v; if (v > mx) mx = v; } } }
    const isByte = data[0] instanceof Uint8Array;
    const px = (i, j) => { const o = j * w + i; if (bands >= 3) { const a = bands === 4 ? data[3][o] : 255; return [data[0][o], data[1][o], data[2][o], (data[0][o] === 0 && data[1][o] === 0 && data[2][o] === 0) ? 0 : a]; }
      const v = data[0][o]; if (v === nd || !isFinite(v) || v < -1e30) return [0, 0, 0, 0]; const g = isByte && mx <= 255 ? v : Math.round((v - mn) / ((mx - mn) || 1) * 255); return [g, g, g, 255]; };
    // footprint in WGS84 → target box in Web Mercator
    const sx = rx / k, sy = ry / k; const corners = [[0, 0], [w, 0], [0, h], [w, h], [w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]].map(([i, j]) => crs.fn([ox + i * sx, oy + j * sy]));
    const M = L.CRS.EPSG3857; const pm = corners.map(c => M.project(L.latLng(c[1], c[0])));
    const X0 = Math.min(...pm.map(p => p.x)), X1 = Math.max(...pm.map(p => p.x)), Y0 = Math.min(...pm.map(p => p.y)), Y1 = Math.max(...pm.map(p => p.y));
    const ow = w, oh = Math.max(1, Math.round(w * (Y1 - Y0) / (X1 - X0)));
    const cv = document.createElement('canvas'); cv.width = ow; cv.height = oh; const cx = cv.getContext('2d'); const out = cx.createImageData(ow, oh);
    // control grid every 16 px: target pixel → source pixel, bilinear in between
    const G = 16, gw = Math.ceil(ow / G) + 1, gh = Math.ceil(oh / G) + 1; const gi = new Float64Array(gw * gh * 2);
    for (let b = 0; b < gh; b++) for (let a = 0; a < gw; a++) { const X = X0 + (a * G) / ow * (X1 - X0), Y = Y1 - (b * G) / oh * (Y1 - Y0); const ll = M.unproject(L.point(X, Y)); const s = crs.inv([ll.lng, ll.lat]); gi[(b * gw + a) * 2] = (s[0] - ox) / sx; gi[(b * gw + a) * 2 + 1] = (s[1] - oy) / sy; }
    for (let y = 0; y < oh; y++) { const b = Math.floor(y / G), fy = (y % G) / G; for (let x = 0; x < ow; x++) { const a = Math.floor(x / G), fx = (x % G) / G;
      const q = (aa, bb, c) => gi[(Math.min(gh - 1, bb) * gw + Math.min(gw - 1, aa)) * 2 + c];
      const si = (q(a, b, 0) * (1 - fx) + q(a + 1, b, 0) * fx) * (1 - fy) + (q(a, b + 1, 0) * (1 - fx) + q(a + 1, b + 1, 0) * fx) * fy;
      const sj = (q(a, b, 1) * (1 - fx) + q(a + 1, b, 1) * fx) * (1 - fy) + (q(a, b + 1, 1) * (1 - fx) + q(a + 1, b + 1, 1) * fx) * fy;
      const i = Math.floor(si), j = Math.floor(sj); if (i < 0 || j < 0 || i >= w || j >= h) continue; const c = px(i, j); const o = (y * ow + x) * 4; out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = c[3]; } }
    cx.putImageData(out, 0, 0);
    const sw = M.unproject(L.point(X0, Y0)), ne = M.unproject(L.point(X1, Y1));
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    return { blob, bounds: [[sw.lat, sw.lng], [ne.lat, ne.lng]], single: bands < 3 && !isByte, buf, crsCode: epsg ? String(epsg) : crsCode };
  }
  function showImage(rec) { const url = URL.createObjectURL(rec.blob); addLeaf(rec, L.imageOverlay(url, rec.bounds, { opacity: rec.opacity || 1, zIndex: 250, interactive: false })); }

  /* ---- other rasters through GDAL → GeoTIFF ---- */
  async function viaGdal(files) {
    const Gdal = await GV.getGdal(); const FS = Gdal.Module.FS; const dir = '/input/r' + Date.now(); FS.mkdir(dir);
    for (const f of files) FS.writeFile(dir + '/' + f.name, new Uint8Array(await f.arrayBuffer()));
    const main = files.find(f => !/\.(jgw|pgw|tfw|wld|j2w|bpw|prj|aux\.xml|ovr|xml)$/i.test(f.name)) || files[0];
    const ds = await Gdal.open(dir + '/' + main.name); if (!ds.datasets || !ds.datasets.length) throw new Error('GDAL مش عارف يقرا ' + main.name + (/\.ecw$/i.test(main.name) ? ' (صيغة ECW محتاجة رخصة — صدّرها GeoTIFF من ArcGIS أو Global Mapper)' : ''));
    const outName = 'r' + Date.now();
    const out = await Gdal.gdal_translate(ds.datasets[0], ['-of', 'GTiff', '-co', 'COMPRESS=DEFLATE'], outName);
    const bytes = FS.readFile(out.local || out.real || ('/output/' + outName + '.tif'));
    try { Gdal.close(ds); } catch (e) { } return bytes.buffer;
  }

  /* ---- MBTiles ---- */
  async function openMBTiles(file) {
    const SQL = await initSqlJs({}); const d = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    const meta = {}; try { d.exec('select name,value from metadata')[0].values.forEach(([k, v]) => { meta[k] = v; }); } catch (e) { }
    const fmt = (meta.format || 'png').toLowerCase(); if (/pbf|mvt/.test(fmt)) throw new Error('الـ MBTiles ده Vector Tiles — محتاج صورة (png/jpg)');
    const st = d.prepare('select tile_data from tiles where zoom_level=? and tile_column=? and tile_row=?');
    const zr = d.exec('select min(zoom_level),max(zoom_level) from tiles')[0].values[0];
    const Lyr = L.GridLayer.extend({ createTile(c, done) { const t = document.createElement('img'); const row = Math.pow(2, c.z) - 1 - c.y; let data = null; try { st.bind([c.z, c.x, row]); if (st.step()) data = st.get()[0]; st.reset(); } catch (e) { }
      if (data) { t.src = URL.createObjectURL(new Blob([data], { type: 'image/' + (fmt === 'jpg' ? 'jpeg' : fmt) })); t.onload = () => done(null, t); t.onerror = () => done(null, t); } else setTimeout(() => done(null, t)); return t; } });
    const leaf = new Lyr({ minZoom: 0, maxZoom: 22, maxNativeZoom: zr[1], zIndex: 250 });
    let bounds = null; if (meta.bounds) { const b = meta.bounds.split(',').map(Number); bounds = [[b[1], b[0]], [b[3], b[2]]]; }
    return { leaf, bounds };
  }

  /* ---- ArcGIS tile packages (TPKX = compact v2 · TPK = compact v1 or v2) ---- */
  async function openTPK(file) {
    const z = await JSZip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(z.files); const bundles = names.filter(n => /\.bundle$/i.test(n));
    if (!bundles.length) throw new Error('مفيش Tiles جوه الباكدج (يمكن Vector Tile Package — صدّره كـ Raster TPKX)');
    // LOD → web zoom from resolution
    let lods = null, wkid = null;
    const rj = names.find(n => /(^|\/)root\.json$/i.test(n)); const cx = names.find(n => /conf\.xml$/i.test(n));
    if (rj) { const j = JSON.parse(await z.file(rj).async('string')); lods = (j.tileInfo && j.tileInfo.lods) || null; wkid = j.tileInfo && j.tileInfo.spatialReference && (j.tileInfo.spatialReference.latestWkid || j.tileInfo.spatialReference.wkid); }
    else if (cx) { const doc = new DOMParser().parseFromString(await z.file(cx).async('string'), 'text/xml'); lods = [...doc.querySelectorAll('LODInfo')].map(n => ({ level: +n.querySelector('LevelID').textContent, resolution: +n.querySelector('Resolution').textContent })); const w = doc.querySelector('WKID'); wkid = w ? +w.textContent : null; }
    if (wkid && wkid !== 3857 && wkid !== 102100) throw new Error('الباكدج معمول بنظام ' + wkid + ' — لازم يتصدّر بـ Web Mercator (3857) عشان يتعرض على الخريطة');
    const zoomOf = lv => { const L0 = lods && lods.find(x => x.level === lv); return L0 ? Math.round(Math.log2(156543.03392804097 / L0.resolution)) : lv; };
    const byKey = new Map(); bundles.forEach(n => { const m = n.match(/L(\d+)\/R([0-9a-f]+)C([0-9a-f]+)\.bundle$/i); if (m) byKey.set(zoomOf(+m[1]) + '/' + parseInt(m[2], 16) + '/' + parseInt(m[3], 16), n); });
    const cache = new Map(); let maxZ = 0; byKey.forEach((v, k) => { maxZ = Math.max(maxZ, +k.split('/')[0]); });
    const getBundle = async n => { if (cache.has(n)) return cache.get(n); const p = (async () => { const b = await z.file(n).async('uint8array'); const bx = names.find(x => x.toLowerCase() === n.toLowerCase().replace(/\.bundle$/, '.bundlx')); return { b, bx: bx ? await z.file(bx).async('uint8array') : null }; })(); cache.set(n, p); if (cache.size > 24) cache.delete(cache.keys().next().value); return p; };
    const tileData = async (zz, x, y) => {
      const R = Math.floor(y / 128) * 128, C = Math.floor(x / 128) * 128; const n = byKey.get(zz + '/' + R + '/' + C); if (!n) return null;
      const { b, bx } = await getBundle(n); const r = y - R, c = x - C;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      if (bx) { const i = 16 + (c * 128 + r) * 5; const off = bx[i] + bx[i + 1] * 256 + bx[i + 2] * 65536 + bx[i + 3] * 16777216 + bx[i + 4] * 4294967296; if (off + 4 > b.length) return null; const sz = dv.getUint32(off, true); return sz ? b.subarray(off + 4, off + 4 + sz) : null; }
      const i = 64 + (r * 128 + c) * 8; const lo = dv.getUint32(i, true), hi = dv.getUint32(i + 4, true); const off = lo + (hi & 0xff) * 4294967296; const sz = hi >>> 8; return sz ? b.subarray(off, off + sz) : null;
    };
    const Lyr = L.GridLayer.extend({ createTile(c, done) { const t = document.createElement('img'); tileData(c.z, c.x, c.y).then(d => { if (d) { const jpg = d[0] === 0xff; t.src = URL.createObjectURL(new Blob([d], { type: jpg ? 'image/jpeg' : 'image/png' })); t.onload = () => done(null, t); t.onerror = () => done(null, t); } else done(null, t); }, () => done(null, t)); return t; } });
    return { leaf: new Lyr({ maxZoom: 22, maxNativeZoom: maxZ, zIndex: 250 }) };
  }

  /* ---- KML / KMZ ground overlays ---- */
  async function openKMZ(file) {
    let kml, zip = null; if (/\.kmz$/i.test(file.name)) { zip = await JSZip.loadAsync(await file.arrayBuffer()); const k = Object.keys(zip.files).find(n => /\.kml$/i.test(n)); kml = await zip.file(k).async('string'); } else kml = await file.text();
    const doc = new DOMParser().parseFromString(kml, 'text/xml'); const out = [];
    for (const g of doc.querySelectorAll('GroundOverlay')) { const href = (g.querySelector('Icon href') || {}).textContent; const box = g.querySelector('LatLonBox'); if (!href || !box) continue; const v = t => +((box.querySelector(t) || {}).textContent);
      let url = href; if (zip && zip.file(href)) url = URL.createObjectURL(await zip.file(href).async('blob')); out.push(L.imageOverlay(url, [[v('south'), v('west')], [v('north'), v('east')]], { zIndex: 250 })); }
    if (!out.length) return null; return { leaf: L.layerGroup(out) };
  }

  /* ---- entry: files from the services screen ---- */
  GV.openLocalRaster = async (files, crsCode) => {
    files = [...files]; if (!files.length) return; const main = files.find(f => !/\.(jgw|pgw|tfw|wld|j2w|prj|aux\.xml|ovr)$/i.test(f.name)) || files[0]; const n = main.name.toLowerCase();
    const $b = document.getElementById('busy'), $t = document.getElementById('busyText'); $b.classList.add('show'); $t.textContent = 'بفتح ' + main.name + '…';
    try {
      const rec = { id: rid(), name: main.name, kind: '' };
      if (/\.mbtiles$/.test(n)) { const r = await openMBTiles(main); addLeaf(rec, r.leaf); if (r.bounds) GV.map.fitBounds(r.bounds); GV.toast('اتفتح: ' + main.name + ' (بيتعرض لحد ما تقفل البرنامج — الملف كبير على الحفظ)', 5000); return; }
      if (/\.(tpkx?|zip)$/.test(n)) { const r = await openTPK(main); addLeaf(rec, r.leaf); GV.toast('اتفتح: ' + main.name + ' — قرّب على منطقة الشغل', 5000); return; }
      if (/\.km[lz]$/.test(n)) { const r = await openKMZ(main); if (!r) return GV.handleFiles ? GV.handleFiles([main]) : null; addLeaf(rec, r.leaf); return; }
      let buf;
      if (/\.tiff?$/.test(n) && files.length === 1) buf = await main.arrayBuffer();
      else { $t.textContent = 'بحمّل محرك GDAL…'; buf = await viaGdal(files); }
      $t.textContent = 'بحط الصورة على الخريطة…';
      let r; try { r = await rasterFromTiff(buf, main.name, crsCode); } catch (e) { if (/\.tiff?$/.test(n) && files.length === 1 && !/إحداثيات/.test(e.message)) { buf = await viaGdal(files); r = await rasterFromTiff(buf, main.name, crsCode); } else throw e; }
      Object.assign(rec, { blob: r.blob, bounds: r.bounds, kind: 'img' }); showImage(rec); GV.map.fitBounds(r.bounds); put(rec.id, { name: rec.name, blob: r.blob, bounds: r.bounds, kind: 'img' });
      if (r.single && GV.addDemBuffer) { try { await GV.addDemBuffer(buf, main.name, r.crsCode); GV.toast('اتعرضت: ' + main.name + ' — ودخلت كمان كسطح مناسيب (DEM) تقدر تاخد منه منسوب الأرض', 6000); } catch (e) { GV.toast('اتعرضت: ' + main.name, 4000); } }
      else GV.toast('اتعرضت: ' + main.name, 4000);
    } catch (e) { GV.showMsg('مقدرتش أفتح ' + main.name + ':\n' + (e.message || e)); }
    finally { $b.classList.remove('show'); }
  };
  setTimeout(async () => { for (const [k, v] of await all()) if (v && v.blob) showImage({ id: k, name: v.name, blob: v.blob, bounds: v.bounds, kind: v.kind }); }, 1200);
})();
