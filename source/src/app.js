(function () {
  'use strict';
  const GV = window.GV = window.GV || {};
  const $ = s => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  /* ---------------- CRS ---------------- */
  const CRS_CHOICES = [
    ['4326', 'WGS84 — خطوط طول وعرض (درجات)'],
    ['32636', 'WGS84 / UTM 36N'], ['32637', 'WGS84 / UTM 37N'], ['32638', 'WGS84 / UTM 38N'], ['32639', 'WGS84 / UTM 39N'], ['32640', 'WGS84 / UTM 40N'],
    ['20437', 'Ain el Abd / UTM 37N'], ['20438', 'Ain el Abd / UTM 38N'], ['20439', 'Ain el Abd / UTM 39N'],
    ['32635', 'WGS84 / UTM 35N (مصر غرب)'], ['32636e', 'WGS84 / UTM 36N (مصر شرق)'], ['3857', 'Web Mercator (3857)']
  ];
  const AEA = '+ellps=intl +towgs84=-143,-236,7,0,0,0,0';
  function epsgDef(code) {
    code = String(code).replace(/e$/, '');
    const n = +code;
    if (n === 4326 || n === 4979) return 'WGS84';
    if (n === 3857 || n === 102100 || n === 900913) return 'EPSG:3857';
    if (n >= 32601 && n <= 32660) return '+proj=utm +zone=' + (n - 32600) + ' +datum=WGS84 +units=m +no_defs';
    if (n >= 32701 && n <= 32760) return '+proj=utm +zone=' + (n - 32700) + ' +south +datum=WGS84 +units=m +no_defs';
    if (n >= 20436 && n <= 20440) return '+proj=utm +zone=' + (n - 20400) + ' ' + AEA + ' +units=m +no_defs';
    if (n === 4204) return '+proj=longlat ' + AEA + ' +no_defs';
    if (n === 4322 || n === 4269 || n === 4258) return 'WGS84';
    return null;
  }
  // Returns {fn:[x,y]->[lon,lat], label} or null when unknown
  function resolveCRS(def) {
    if (def == null || def === '') return null;
    let s = String(def).trim();
    let projDef = null, label = s;
    if (/^\d+e?$/.test(s)) { projDef = epsgDef(s); label = 'EPSG:' + s.replace(/e$/, ''); }
    else if (/^EPSG:\d+$/i.test(s)) { projDef = epsgDef(s.split(':')[1]); label = s.toUpperCase(); }
    else if (/^\+proj/.test(s)) projDef = s;
    else {
      // WKT
      const nameM = s.match(/^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS)\s*\[\s*"([^"]*)"/i);
      label = nameM ? nameM[2] : 'WKT';
      const auth = s.match(/AUTHORITY\["EPSG",\s*"?(\d+)"?\]\s*\]\s*$/i) || s.match(/ID\["EPSG",\s*(\d+)\]\s*\]\s*$/i);
      if (auth && epsgDef(auth[1])) projDef = epsgDef(auth[1]);
      const isAEA = /Ain[_ ]el[_ ]Abd/i.test(s);
      const utm = label.match(/UTM[_ ]Zone[_ ](\d+)([NS]?)/i) || s.match(/UTM[_ ]Zone[_ ](\d+)([NS]?)/i);
      if (!projDef && utm && /^PROJ/i.test(s)) {
        const z = +utm[1], south = /S/i.test(utm[2] || '');
        projDef = '+proj=utm +zone=' + z + (south ? ' +south' : '') + ' ' + (isAEA ? AEA : '+datum=WGS84') + ' +units=m +no_defs';
      }
      if (!projDef && /^GEOG/i.test(s)) projDef = isAEA ? '+proj=longlat ' + AEA + ' +no_defs' : 'WGS84';
      if (!projDef) projDef = s;
    }
    if (!projDef) return null;
    if (projDef === 'WGS84') return { fn: c => c, inv: c => c, label, geographic: true };
    try {
      const p = proj4(projDef, 'WGS84');
      p.forward([500000, 2700000]);
      return { fn: c => p.forward([c[0], c[1]]), inv: c => p.inverse([c[0], c[1]]), label };
    } catch (e) { return null; }
  }

  /* ---------------- geometry helpers ---------------- */
  function mapCoords(g, fn) {
    if (!g) return null;
    const t = g.type, c = g.coordinates;
    const P = p => { const r = fn(p); return p.length > 2 ? [r[0], r[1], p[2]] : [r[0], r[1]]; };
    switch (t) {
      case 'Point': return { type: t, coordinates: P(c) };
      case 'MultiPoint': case 'LineString': return { type: t, coordinates: c.map(P) };
      case 'MultiLineString': case 'Polygon': return { type: t, coordinates: c.map(r => r.map(P)) };
      case 'MultiPolygon': return { type: t, coordinates: c.map(p => p.map(r => r.map(P))) };
      case 'GeometryCollection': return { type: t, geometries: g.geometries.map(x => mapCoords(x, fn)) };
    }
    return null;
  }
  function firstCoord(g) {
    if (!g) return null;
    if (g.type === 'GeometryCollection') { for (const x of g.geometries) { const c = firstCoord(x); if (c) return c; } return null; }
    let c = g.coordinates; while (c && Array.isArray(c[0])) c = c[0];
    return c && c.length >= 2 ? c : null;
  }
  function looksGeographic(features) {
    let n = 0;
    for (const f of features) { const c = firstCoord(f.geometry); if (!c) continue; if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return false; if (++n > 50) break; }
    return n > 0;
  }
  function geomKind(features) {
    for (const f of features) { if (f.geometry && !(f.properties && f.properties.Text != null && features.some(x => x.geometry && !(x.properties && x.properties.Text != null)))) { const t = f.geometry.type.replace('Multi', ''); return t === 'Polygon' ? 'polygon' : t === 'LineString' ? 'line' : t === 'Point' ? 'point' : 'mixed'; } }
    return 'table';
  }

  // WKB (ISO / EWKB)
  function parseWKB(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let p = 0;
    function geom() {
      const le = dv.getUint8(p) === 1; p++;
      let t = dv.getUint32(p, le); p += 4;
      let dims = 2;
      if (t & 0x20000000) { p += 4; }
      if (t & 0x80000000) dims++; if (t & 0x40000000) dims++;
      t &= 0x0fffffff;
      if (t >= 3000) { dims = 4; t -= 3000; } else if (t >= 2000) { dims = 3; t -= 2000; } else if (t >= 1000) { dims = 3; t -= 1000; }
      const pt = () => { const x = dv.getFloat64(p, le), y = dv.getFloat64(p + 8, le); const z = dims >= 3 ? dv.getFloat64(p + 16, le) : null; p += 8 * dims; return z != null && isFinite(z) && dims === 3 ? [x, y, z] : [x, y]; };
      const n = () => { const v = dv.getUint32(p, le); p += 4; return v; };
      const pts = () => { const k = n(); const a = []; for (let i = 0; i < k; i++) a.push(pt()); return a; };
      switch (t) {
        case 1: { const c = pt(); return isNaN(c[0]) ? null : { type: 'Point', coordinates: c }; }
        case 2: return { type: 'LineString', coordinates: pts() };
        case 3: { const k = n(); const r = []; for (let i = 0; i < k; i++) r.push(pts()); return { type: 'Polygon', coordinates: r }; }
        case 4: case 5: case 6: case 7: {
          const k = n(); const parts = []; for (let i = 0; i < k; i++) parts.push(geom());
          if (t === 7) return { type: 'GeometryCollection', geometries: parts.filter(Boolean) };
          const ok = parts.filter(Boolean);
          return { type: ['', '', '', '', 'MultiPoint', 'MultiLineString', 'MultiPolygon'][t], coordinates: ok.map(g => g.coordinates) };
        }
        default: throw new Error('WKB type ' + t);
      }
    }
    return geom();
  }

  /* ---------------- loaders ---------------- */
  const ext = n => (n.match(/\.([^.\/]+)$/) || ['', ''])[1].toLowerCase();
  const base = n => n.split('/').pop();
  const stem = n => base(n).replace(/\.[^.]+$/, '');

  // each loader returns array of raw layers: {name, features, crs (def string|null), color?, group}
  async function loadGeoJSON(name, text) {
    const j = JSON.parse(text);
    let feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', properties: {}, geometry: j }];
    let crs = null;
    if (j.crs && j.crs.properties && j.crs.properties.name) { const m = String(j.crs.properties.name).match(/EPSG:*:?(\d+)/i); if (m) crs = m[1]; if (/CRS84/i.test(j.crs.properties.name)) crs = '4326'; }
    return [{ name: stem(name), features: feats, crs }];
  }
  async function loadKML(name, text) {
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const fc = toGeoJSON.kml(dom);
    const feats = fc.features.filter(f => f.geometry);
    feats.forEach(f => { if (f.properties && typeof f.properties.description === 'object') f.properties.description = f.properties.description.value; if (f.properties && typeof f.properties.description === 'string') f.properties.description = stripHTML(f.properties.description); });
    return [{ name: stem(name), features: feats, crs: '4326', kml: true }];
  }
  function stripHTML(s) { const d = new DOMParser().parseFromString(s, 'text/html'); return (d.body.textContent || '').replace(/\s+\n/g, '\n').trim(); }
  async function loadGPX(name, text) {
    const fc = toGeoJSON.gpx(new DOMParser().parseFromString(text, 'text/xml'));
    return [{ name: stem(name), features: fc.features, crs: '4326' }];
  }
  async function loadKMZ(name, buf) {
    const z = await JSZip.loadAsync(buf);
    const out = [];
    for (const f of Object.values(z.files)) if (!f.dir && ext(f.name) === 'kml') out.push(...await loadKML(stem(name) + (Object.keys(z.files).length > 1 ? ' / ' + stem(f.name) : ''), await f.async('string')));
    return out;
  }
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : (text.split('\n')[0].indexOf('\t') >= 0 && text.split('\n')[0].indexOf(',') < 0 ? '\t' : ',');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === delim) { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.length > 1 || r[0]);
  }
  async function loadCSV(name, text) {
    text = text.replace(/^﻿/, '');
    const rows = parseCSV(text); const head = rows.shift() || [];
    const find = re => head.findIndex(h => re.test(h.trim()));
    let ix = find(/^(lon|long|longitude|lng|x|easting|east|e)$/i), iy = find(/^(lat|latitude|y|northing|north|n)$/i);
    const feats = rows.map(r => { const p = {}; head.forEach((h, i) => p[h || ('col' + i)] = r[i]); let g = null; if (ix >= 0 && iy >= 0) { const x = parseFloat(r[ix]), y = parseFloat(r[iy]); if (isFinite(x) && isFinite(y)) g = { type: 'Point', coordinates: [x, y] }; } return { type: 'Feature', properties: p, geometry: g }; });
    return [{ name: stem(name), features: feats, crs: null }];
  }
  function shpFromParts(name, shp, dbf, prj, cpg) {
    let geoms = [];
    if (shp) { geoms = window.shp.parseShp(shp); }
    let props = [];
    if (dbf) props = window.shp.parseDbf(dbf, cpg ? new TextDecoder().decode(cpg) : 'UTF-8');
    const n = Math.max(geoms.length, props.length);
    const feats = []; for (let i = 0; i < n; i++) feats.push({ type: 'Feature', properties: props[i] || {}, geometry: geoms[i] || null });
    return { name, features: feats, crs: prj ? new TextDecoder().decode(prj) : null };
  }
  async function loadGPKG(name, buf) {
    const SQL = await getSQL();
    const db = new SQL.Database(new Uint8Array(buf));
    const q = (sql) => { try { const r = db.exec(sql); return r[0] ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []; } catch (e) { return null; } };
    const out = [];
    const contents = q("SELECT table_name, data_type, srs_id FROM gpkg_contents");
    if (contents) {
      const gcols = Object.fromEntries((q('SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns') || []).map(r => [r.table_name, r]));
      const srs = Object.fromEntries((q('SELECT srs_id, organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys') || []).map(r => [r.srs_id, r]));
      for (const c of contents) {
        if (c.data_type !== 'features' && c.data_type !== 'attributes') continue;
        const gc = gcols[c.table_name];
        const rows = q('SELECT * FROM "' + c.table_name.replace(/"/g, '""') + '"') || [];
        const feats = rows.map(r => {
          let g = null;
          if (gc && r[gc.column_name]) {
            const b = r[gc.column_name];
            try {
              if (b[0] === 0x47 && b[1] === 0x50) { const flags = b[3]; const env = [0, 32, 48, 48, 64][(flags >> 1) & 7] || 0; if (!(flags & 0x10)) g = parseWKB(b.subarray(8 + env)); }
              else g = parseWKB(b);
            } catch (e) { }
            delete r[gc.column_name];
          }
          for (const k in r) if (r[k] instanceof Uint8Array) r[k] = '[binary]';
          return { type: 'Feature', properties: r, geometry: g };
        });
        let crs = null;
        if (gc) { const s = srs[gc.srs_id]; if (s) crs = (String(s.organization).toUpperCase() === 'EPSG' && epsgDef(s.organization_coordsys_id)) ? String(s.organization_coordsys_id) : s.definition; }
        out.push({ name: c.table_name, features: feats, crs });
      }
    } else {
      const tabs = q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") || [];
      for (const t of tabs) {
        const rows = q('SELECT * FROM "' + t.name + '" LIMIT 20000') || [];
        rows.forEach(r => { for (const k in r) if (r[k] instanceof Uint8Array) r[k] = '[binary]'; });
        out.push({ name: t.name, features: rows.map(r => ({ type: 'Feature', properties: r, geometry: null })), crs: null });
      }
    }
    db.close();
    return out;
  }
  let sqlP = null;
  function getSQL() { if (!sqlP) sqlP = initSqlJs({}); return sqlP; }

  function arcPts(cx, cy, r, a0, a1, n) { const pts = []; if (a1 < a0) a1 += Math.PI * 2; const k = Math.max(8, Math.ceil(n * (a1 - a0) / (Math.PI * 2))); for (let i = 0; i <= k; i++) { const a = a0 + (a1 - a0) * i / k; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return pts; }
  function bulgeSeg(p1, p2, b) {
    const th = 4 * Math.atan(b), dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy); if (!d) return [];
    const h = (d / 2) / Math.tan(th / 2); const cx = (p1[0] + p2[0]) / 2 - dy / d * h, cy = (p1[1] + p2[1]) / 2 + dx / d * h;
    const R = Math.hypot(p1[0] - cx, p1[1] - cy), a0 = Math.atan2(p1[1] - cy, p1[0] - cx), n = 12, pts = [];
    for (let i = 1; i < n; i++) { const a = a0 + th * i / n; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    return pts;
  }
  function dxfColor(c) { return c == null ? null : '#' + (c & 0xffffff).toString(16).padStart(6, '0'); }
  async function loadDXF(name, text) {
    const P = window.DxfParser.default || window.DxfParser;
    const parser = new P();
    try { const ad = parser._entityHandlers && parser._entityHandlers.ATTDEF; if (ad && !parser._entityHandlers.ATTRIB) parser._entityHandlers.ATTRIB = { ForEntityName: 'ATTRIB', parseEntity: (sc, cur) => { const r = ad.parseEntity(sc, cur); r.type = 'ATTRIB'; return r; } }; } catch (e) { }
    try { if (parser._entityHandlers && !parser._entityHandlers.ACAD_TABLE) parser._entityHandlers.ACAD_TABLE = { ForEntityName: 'ACAD_TABLE', parseEntity: (sc, cur) => { const e = { type: 'ACAD_TABLE', position: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0 } }; cur = sc.next(); while (cur !== 'EOF' && cur.code !== 0) { const c = cur.code, v = cur.value; if (c === 8) e.layer = v; else if (c === 2 && !e.name) e.name = v; else if (c === 10) e.position.x = v; else if (c === 20) e.position.y = v; else if (c === 11) e.dir.x = v; else if (c === 21) e.dir.y = v; else if (c === 62) e.colorIndex = v; cur = sc.next(); } e.rotation = Math.atan2(e.dir.y, e.dir.x) * 180 / Math.PI; return e; } }; } catch (e) { }
    const dxf = parser.parseSync(text);
    return cadToLayers(dxf);
  }
  const ACI_RGB = { 1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff, 6: 0xff00ff, 7: 0x333333, 8: 0x808080, 9: 0xc0c0c0, 30: 0xff7f00, 40: 0xffbf00, 140: 0x007fff, 200: 0x7f00ff };
  let dwgLibP = null;
  function getDwgLib() {
    if (!dwgLibP) dwgLibP = (async () => {
      let bin = null;
      for (const u of ['libredwg-web.wasm', 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.8.9/wasm/libredwg-web.wasm']) {
        try { const r = await fetch(u); if (r.ok) { bin = new Uint8Array(await r.arrayBuffer()); break; } } catch (e) { }
      }
      if (!bin) throw new Error('NOWASM');
      const m = await LibreDwgWeb.createModule({ wasmBinary: bin, locateFile: () => 'libredwg-web.wasm' });
      return LibreDwgWeb.LibreDwg.createByWasmInstance(m);
    })().catch(e => { dwgLibP = null; throw e; });
    return dwgLibP;
  }
  async function loadDWG(name, buf) {
    $('#busyText').textContent = 'بحمّل قارئ DWG (أول مرة بس)…';
    let lib;
    try { lib = await getDwgLib(); } catch (e) { throw new Error('مقدرتش أحمّل قارئ DWG. محتاج نت أول مرة تفتح فيها ملف DWG.'); }
    $('#busyText').textContent = 'جاري قراءة ' + name + '…';
    await new Promise(r => setTimeout(r, 20));
    const dwg = lib.dwg_read_data(new Uint8Array(buf), LibreDwgWeb.Dwg_File_Type.DWG);
    if (!dwg) throw new Error('الملف ده مش DWG سليم أو إصداره مش مدعوم');
    let db; try { db = lib.convert(dwg); } finally { try { lib.dwg_free(dwg); } catch (e) { } } if (window.__keepDwg) window.__lastDwgDb = db;
    const P = p => p ? { x: p.x, y: p.y, z: p.z || 0 } : null;
    const colorOf = e => e.colorIndex > 0 && e.colorIndex < 256 && ACI_RGB[e.colorIndex] != null ? ACI_RGB[e.colorIndex] : (e.color != null && e.colorIndex !== 256 && e.colorIndex !== 0 && e.color !== 16777215 ? e.color : undefined);
    const skippedDWG = {};
    function adapt(e) {
      const o = { type: e.type, layer: e.layer, color: colorOf(e) };
      switch (e.type) {
        case 'LINE': o.vertices = [P(e.startPoint), P(e.endPoint)]; break;
        case 'LWPOLYLINE': o.vertices = (e.vertices || []).map(v => ({ x: v.x, y: v.y, bulge: v.bulge })); o.shape = !!((e.flag & 1) || (e.flag & 512)); o.elevation = e.elevation; break;
        case 'POLYLINE2D': case 'POLYLINE3D': case 'POLYLINE': o.type = 'POLYLINE'; o.vertices = (e.vertices || []).filter(v => !(v.flag & 16)).map(v => ({ x: v.x, y: v.y, z: v.z, bulge: v.bulge })); o.shape = !!(e.flag & 1); break;
        case 'CIRCLE': o.center = P(e.center); o.radius = e.radius; break;
        case 'ARC': o.center = P(e.center); o.radius = e.radius; o.startAngle = e.startAngle; o.endAngle = e.endAngle; break;
        case 'ELLIPSE': o.center = P(e.center); o.majorAxisEndPoint = P(e.majorAxisEndPoint); o.axisRatio = e.axisRatio; o.startAngle = e.startAngle; o.endAngle = e.endAngle; break;
        case 'SPLINE': o.fitPoints = (e.fitPoints || []).map(P); o.controlPoints = (e.controlPoints || []).map(P); break;
        case 'POINT': o.position = P(e.position); break;
        case 'TEXT': o.startPoint = P((e.halign || e.valign) && e.endPoint && (e.endPoint.x || e.endPoint.y) ? e.endPoint : e.startPoint); o.halign = e.halign || 0; o.text = e.text; o.rotation = (e.rotation || 0) * 180 / Math.PI; o.textHeight = e.textHeight; break;
        case 'MTEXT': o.position = P(e.insertionPoint); o.text = e.text; o.textHeight = e.textHeight; o.attachmentPoint = e.attachmentPoint != null ? e.attachmentPoint : e.attachment; o.rotation = e.rotation != null ? e.rotation * 180 / Math.PI : (e.xAxisDirection ? Math.atan2(e.xAxisDirection.y, e.xAxisDirection.x) * 180 / Math.PI : 0); o.mtext = true; break;
        case 'INSERT': o.name = e.name; o.position = P(e.insertionPoint); o.xScale = e.xScale; o.yScale = e.yScale; o.rotation = (e.rotation || 0) * 180 / Math.PI; o.attribs = (e.attribs || []).map(a => { const tt = a.text && typeof a.text === 'object' ? a.text : { text: a.text }; const al = (tt.halign || 0) !== 0 || (tt.valign || 0) !== 0; const ps = al && tt.endPoint && (tt.endPoint.x || tt.endPoint.y) ? tt.endPoint : tt.startPoint; return { tag: a.tag, text: tt.text, layer: a.layer, color: colorOf(a), position: ps && isFinite(ps.x) ? P(ps) : null, height: tt.textHeight, rotation: (tt.rotation || 0) * 180 / Math.PI, halign: tt.halign || 0, invisible: !!((a.flags || 0) & 1) }; }); break;
        case 'TABLE': case 'ACAD_TABLE': o.type = 'ACAD_TABLE'; o.name = e.name || e.blockName || (e.block && e.block.name) || null; const ip = e.insertionPoint || e.position || e.startPoint; o.position = ip && isFinite(ip.x) && isFinite(ip.y) ? P(ip) : null; o.bh = e.blockRecordHandle || null; if (e.directionVector) o.rotation = Math.atan2(e.directionVector.y || 0, e.directionVector.x || 1) * 180 / Math.PI; o.tw = (e.columnWidthArr || []).reduce((a, b) => a + (+b || 0), 0); o.th = (e.rowHeightArr || []).reduce((a, b) => a + (+b || 0), 0); if (o.position && e.cells && e.cells.some(c => c && c.text) && e.rowCount && e.columnCount) { o.grid = { rows: e.rowCount, cols: e.columnCount, rh: Array.from(e.rowHeightArr || []), cw: Array.from(e.columnWidthArr || []), dir: e.directionVector || { x: 1, y: 0 }, cells: e.cells.map(c => c && c.text != null ? String(c.text) : '') }; break; } if (!o.position) { skippedDWG[e.type] = (skippedDWG[e.type] || 0) + 1; return null; } if (!o.name) o.pending = true; break;
        case 'SOLID': case '3DFACE': o.points = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P); break;
        case 'HATCH': {
          const rings = [];
          (e.boundaryPaths || []).forEach(bp => {
            if (bp.vertices && bp.vertices.length > 2) rings.push(bp.vertices.map(P));
            else if (bp.edges && bp.edges.length) { const r = []; bp.edges.forEach(ed => { if (ed.start) r.push(P(ed.start)); }); if (r.length > 2) rings.push(r); }
          });
          if (!rings.length) return null;
          o.rings = rings; break;
        }
        default: skippedDWG[e.type] = (skippedDWG[e.type] || 0) + 1; return null;
      }
      return o;
    }
    const msBlock = db.tables.BLOCK_RECORD.entries.find(b => /^\*model_space$/i.test(b.name));
    const ents = (msBlock ? msBlock.entities : db.entities).map(adapt).filter(Boolean);
    const blocks = {};
    db.tables.BLOCK_RECORD.entries.forEach(b => { if (!/^\*/.test(b.name) || /^\*[TU]/i.test(b.name)) blocks[b.name] = { position: P(b.basePoint) || { x: 0, y: 0 }, entities: (b.entities || []).map(adapt).filter(Boolean) }; });
    // tables whose cells are not in the TABLE entity (newer DWG): draw their anonymous *T block instead
    const pend = ents.filter(e => e.type === 'ACAD_TABLE' && e.pending);
    if (pend.length) {
      const byH = {}; db.tables.BLOCK_RECORD.entries.forEach(b => { if (b.handle != null) byH[String(b.handle).toUpperCase()] = b.name; });
      const used = new Set(ents.filter(e => e.type === 'INSERT' || (e.type === 'ACAD_TABLE' && e.name)).map(e => e.name));
      pend.forEach(t => { const n = t.bh && byH[String(t.bh).toUpperCase()]; if (n && blocks[n]) { t.name = n; used.add(n); } });
      const free = Object.keys(blocks).filter(n => /^\*T/i.test(n) && !used.has(n));
      const bb = n => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; blocks[n].entities.forEach(e => (e.vertices || (e.startPoint ? [e.startPoint] : e.position ? [e.position] : [])).forEach(p => { if (!p) return; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); })); return [x1 - x0, y1 - y0]; };
      pend.filter(t => !t.name).forEach(t => { let best = null, bd = Infinity; free.forEach(n => { if (used.has(n)) return; const [w, h] = bb(n); const d = t.tw && t.th ? Math.abs(w - t.tw) / (t.tw || 1) + Math.abs(h - t.th) / (t.th || 1) : 0; if (d < bd) { bd = d; best = n; } }); if (best && (bd < 0.25 || !(t.tw && t.th))) { t.name = best; used.add(best); } });
      pend.forEach(t => { if (!t.name) skippedDWG.ACAD_TABLE = (skippedDWG.ACAD_TABLE || 0) + 1; });
    }
    const layers = {}; db.tables.LAYER.entries.forEach(l => { layers[l.name] = { color: l.color != null && l.color !== 16777215 ? l.color : (ACI_RGB[l.colorIndex] != null ? ACI_RGB[l.colorIndex] : undefined) }; });
    const res = cadToLayers({ entities: ents, blocks, tables: { layer: { layers } } });
    Object.keys(skippedDWG).forEach(k => res.cadInfo.skipped[k] = (res.cadInfo.skipped[k] || 0) + skippedDWG[k]);
    // embedded OLE objects (Excel tables pasted into the drawing) — model space and layouts
    try { const ole = []; const take = (e, where) => { if (e && e.type === 'OLE2FRAME' && e.binaryData && ole.length < 40) ole.push({ hex: e.binaryData, layer: e.layer, where }); }; (db.entities || []).forEach(e => take(e, 'Model')); (db.tables.BLOCK_RECORD.entries || []).forEach(b => { if (/^\*Paper_Space/i.test(b.name || '')) (b.entities || []).forEach(e => take(e, 'Layout')); }); if (ole.length) res.cadInfo.ole = ole; } catch (e) { }
    return res;
  }
  // AutoCAD text codes → plain text (MTEXT formatting, %%U underline, %%C Ø, %%D °, %%P ±, %%% %)
  function cadTxt(t, lines) { return cadTxt0(String(t == null ? '' : t).replace(/\\P/g, lines ? '\u2029' : ' ')).replace(/ ?\u2029 ?/g, '\n').replace(/\n{2,}/g, '\n').trim(); }
  function cadTxt0(t) { return String(t).replace(/\\[ACcFfHhQqTtWwLlOoKk][^;\\\u2029]*;?/g, '').replace(/\\S([^;]*);/g, '$1').replace(/\\[A-Za-z][^;\u2029]*;/g, '').replace(/[{}]/g, '').replace(/%%[uUoOkK]/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%(\d{3})/g, (m, d) => String.fromCharCode(+d)).replace(/[^\S\u2029]+/g, ' ').trim(); }
  function cadToLayers(dxf) {
    const cadInfo = { skipped: {}, badInserts: 0, failed: 0 };
    const layerTab = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
    const byLayer = {};
    const add = (ent, geometry, extra) => {
      const L = ent.layer || '0';
      (byLayer[L] = byLayer[L] || []).push({ type: 'Feature', properties: Object.assign({ Layer: L, Entity: ent.type, Color: ent.color != null ? dxfColor(ent.color) : null }, extra || {}), geometry, _color: dxfColor(ent.color) });
    };
    const v = p => [p.x, p.y];
    const blocks = dxf.blocks || {}; const usedBlocks = new Set();
    const KNOWN = new Set(['ATTRIB', 'ACAD_TABLE', 'TABLE', 'LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'POINT', 'TEXT', 'MTEXT', 'ATTDEF', 'INSERT', 'HATCH', 'SOLID', '3DFACE']);
    function handle(ent, tf, depth) {
      const T = tf || (p => p);
      if (!depth) { if (!KNOWN.has(ent.type)) cadInfo.skipped[ent.type] = (cadInfo.skipped[ent.type] || 0) + 1; if (ent.type === 'INSERT') { const sx = ent.xScale == null ? 1 : ent.xScale, sy = ent.yScale == null ? 1 : ent.yScale; if (!sx || !sy || Math.abs(sx) > 1000 || Math.abs(sy) > 1000) cadInfo.badInserts++; } }
      switch (ent.type) {
        case 'LINE': add(ent, { type: 'LineString', coordinates: ent.vertices.map(p => T(v(p))) }); break;
        case 'LWPOLYLINE': case 'POLYLINE': {
          const vs = ent.vertices || []; if (vs.length < 2) break;
          const pts = []; const closed = ent.shape || ent.closed;
          for (let i = 0; i < vs.length; i++) {
            const a = v(vs[i]); pts.push(a);
            const nb = vs[i + 1] || (closed ? vs[0] : null);
            if (nb && vs[i].bulge) pts.push(...bulgeSeg(a, v(nb), vs[i].bulge));
          }
          if (closed) pts.push(pts[0]);
          add(ent, { type: 'LineString', coordinates: pts.map(T) }, ent.elevation ? { Elevation: ent.elevation } : null); break;
        }
        case 'CIRCLE': add(ent, { type: 'LineString', coordinates: arcPts(ent.center.x, ent.center.y, ent.radius, 0, Math.PI * 2, 36).map(T) }, { Radius: ent.radius }); break;
        case 'ARC': add(ent, { type: 'LineString', coordinates: arcPts(ent.center.x, ent.center.y, ent.radius, ent.startAngle, ent.endAngle, 36).map(T) }, { Radius: ent.radius }); break;
        case 'ELLIPSE': {
          const c = ent.center, mj = ent.majorAxisEndPoint, r = ent.axisRatio; const pts = []; let a0 = ent.startAngle || 0, a1 = ent.endAngle || Math.PI * 2; if (a1 <= a0) a1 += Math.PI * 2;
          for (let i = 0; i <= 48; i++) { const t = a0 + (a1 - a0) * i / 48; pts.push([c.x + mj.x * Math.cos(t) - mj.y * r * Math.sin(t), c.y + mj.y * Math.cos(t) + mj.x * r * Math.sin(t)]); }
          add(ent, { type: 'LineString', coordinates: pts.map(T) }); break;
        }
        case 'SPLINE': { const ps = ent.fitPoints && ent.fitPoints.length > 1 ? ent.fitPoints : ent.controlPoints; if (ps && ps.length > 1) add(ent, { type: 'LineString', coordinates: ps.map(p => T(v(p))) }); break; }
        case 'POINT': add(ent, { type: 'Point', coordinates: T(v(ent.position)) }); break;
        case 'TEXT': case 'MTEXT': case 'ATTDEF': case 'ATTRIB': {
          if (ent.type === 'ATTRIB' && ent.invisible) break;
          const hj = ent.halign != null ? ent.halign : ent.horizontalJustification; const vj = ent.valign != null ? ent.valign : ent.verticalJustification;
          const p = (ent.type !== 'MTEXT' && (hj || vj) && ent.endPoint && (ent.endPoint.x || ent.endPoint.y) && !ent.mtext) ? ent.endPoint : (ent.startPoint || ent.position); if (!p) break;
          const txt = cadTxt(ent.text, ent.type === 'MTEXT' || ent.mtext);
          const h = ent.textHeight || ent.height || null; let rot = ent.rotation || 0;
          if (ent.type === 'MTEXT' && !ent.rotation && ent.directionVector) rot = Math.atan2(ent.directionVector.y, ent.directionVector.x) * 180 / Math.PI;
          const ex = { Text: txt, Height: h != null ? +(+h).toFixed(3) : null, Rotation: +(+rot).toFixed(2) }; if (hj === 1 || hj === 4) ex.Align = 'c'; else if (hj === 2) ex.Align = 'r'; if (ent.type === 'MTEXT' && ent.attachmentPoint) { const ap = +ent.attachmentPoint; const cc = (ap - 1) % 3, rr = Math.floor((ap - 1) / 3); if (cc === 1) ex.Align = 'c'; else if (cc === 2) ex.Align = 'r'; ex.VAlign = rr === 0 ? 't' : rr === 1 ? 'm' : 'b'; } else if (vj === 2) ex.VAlign = 'm'; else if (vj === 3) ex.VAlign = 't'; if (ent.type === 'ATTRIB' && ent.tag) ex.Attrib = ent.tag; add(ent, { type: 'Point', coordinates: T(v(p)) }, ex); break;
        }
        case 'HATCH': { const rs = ent.rings.map(r => { const c = r.map(p => T(v(p))); c.push(c[0]); return c; }); add(ent, { type: 'Polygon', coordinates: rs }); break; }
        case 'SOLID': case '3DFACE': { const ps = (ent.points || ent.vertices || []).map(p => T(v(p))); if (ps.length >= 3) { ps.push(ps[0]); add(ent, { type: 'Polygon', coordinates: [ps] }); } break; }
        case 'ACAD_TABLE': case 'TABLE': if (ent.grid && ent.position) {
            const g = ent.grid, o0 = v(ent.position); let dx = g.dir.x || 1, dy = g.dir.y || 0; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; const px = dy, py = -dx; // "down" direction
            const rh = g.rh.length === g.rows ? g.rh : Array(g.rows).fill(g.rh[0] || 1), cw = g.cw.length === g.cols ? g.cw : Array(g.cols).fill(g.cw[0] || 5);
            const at = (u, w) => T([o0[0] + dx * u + px * w, o0[1] + dy * u + py * w]); const rot = Math.atan2(dy, dx) * 180 / Math.PI;
            let y = 0; const W = cw.reduce((a, b) => a + b, 0), H = rh.reduce((a, b) => a + b, 0);
            for (let r = 0; r <= g.rows; r++) { add(ent, { type: 'LineString', coordinates: [at(0, y), at(W, y)] }, { TableLine: 1 }); if (r < g.rows) y += rh[r]; }
            let x = 0; for (let c = 0; c <= g.cols; c++) { add(ent, { type: 'LineString', coordinates: [at(x, 0), at(x, H)] }, { TableLine: 1 }); if (c < g.cols) x += cw[c]; }
            y = 0; for (let r = 0; r < g.rows; r++) { x = 0; for (let c = 0; c < g.cols; c++) { const t = cadTxt(g.cells[r * g.cols + c]).trim(); if (t) { const th = Math.min(rh[r] * 0.45, cw[c] * 0.9 / Math.max(1, t.length) * 1.6); add(ent, { type: 'Point', coordinates: at(x + cw[c] * 0.06, y + rh[r] * 0.72) }, { Text: t, Height: +th.toFixed(3), Rotation: +rot.toFixed(2), TableCell: r + ',' + c }); } x += cw[c]; } y += rh[r]; }
            break;
          }
          if (!ent.name && (ent.blockName || ent.block_name)) ent = Object.assign({}, ent, { name: ent.blockName || ent.block_name }); if (!ent.name || !blocks[ent.name]) break; ent = Object.assign({ _table: true, position: ent.position || ent.insertionPoint || { x: 0, y: 0 } }, ent);
          { const bl = blocks[ent.name]; let mx = Infinity, my = Infinity; (bl.entities || []).forEach(e => (e.vertices || (e.startPoint ? [e.startPoint] : e.position ? [e.position] : [])).forEach(p => { if (p && isFinite(p.x)) { mx = Math.min(mx, p.x); my = Math.min(my, p.y); } }));
            const ps = ent.position; if (isFinite(mx) && ps && Math.hypot(mx - ps.x, my - ps.y) < Math.hypot(mx, my) * 0.5) ent = Object.assign({}, ent, { position: { x: 0, y: 0, z: 0 }, rotation: 0 }); }
        // falls through
        case 'INSERT': {
          const pos = v(ent.position); if (!isFinite(pos[0]) || !isFinite(pos[1])) break;
          const attrs = {}; (ent.attribs || []).forEach(a => { if (a.tag) attrs[a.tag] = a.text; });
          add(ent, { type: 'Point', coordinates: T(pos) }, Object.assign({ Block: ent.name }, attrs));
          if (!depth) { const lst = byLayer[ent.layer || '0']; lst[lst.length - 1]._ins = { sx: ent.xScale || 1, sy: ent.yScale || 1, rot: ent.rotation || 0, attrs: Object.keys(attrs).filter(k => !(ent.attribs || []).some(a => a.tag === k && a.position)) }; usedBlocks.add(ent.name); }
          if (!depth) (ent.attribs || []).forEach(a => { if (!a.position || a.invisible || a.text == null || String(a.text).trim() === '') return; handle({ type: 'ATTRIB', layer: a.layer || ent.layer, color: a.color != null ? a.color : ent.color, startPoint: a.position, text: a.text, textHeight: a.height, rotation: a.rotation, halign: a.halign, tag: a.tag }, tf, depth + 1); });
          const b = blocks[ent.name];
          if (b && b._tc == null && b.entities) { b._tc = 0; b._lc = 0; b.entities.forEach(e => { if (e.type === 'TEXT' || e.type === 'MTEXT') b._tc++; else if (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') b._lc++; }); }
          // drawn tables (Civil 3D point/pipe tables, *T table blocks, schedule blocks): keep their text too
          const isTbl = /^\*T/i.test(ent.name || '') || ent._table || !!(b && b._tc >= 8 && b._lc >= 8 && b.entities.length < 8000 && (/^\*U/i.test(ent.name || '') || /TABL|TABLE|SCHED|NOTE|LEGEND|SYMBOL|جدول|ملاحظ|مفتاح/i.test((ent.layer || '') + ' ' + (ent.name || ''))));
          if (b && b.entities && depth < 3 && (b.entities.length < 200 || (isTbl && b.entities.length < 30000))) {
            const sx = ent.xScale || 1, sy = ent.yScale || 1, rot = (ent.rotation || 0) * Math.PI / 180, bp = b.position ? v(b.position) : [0, 0];
            const cos = Math.cos(rot), sin = Math.sin(rot);
            const tf2 = p => { const x = (p[0] - bp[0]) * sx, y = (p[1] - bp[1]) * sy; return T([pos[0] + x * cos - y * sin, pos[1] + x * sin + y * cos]); };
            for (const be of b.entities) { if (isTbl && (be.type === 'TEXT' || be.type === 'MTEXT')) { const hh = be.textHeight || be.height; handle(Object.assign({}, be, { layer: (be.layer === '0' || !be.layer) ? ent.layer : be.layer, textHeight: hh ? hh * Math.abs(sx) : hh, height: hh ? hh * Math.abs(sx) : hh, rotation: (be.rotation || 0) + (ent.rotation || 0), directionVector: null }), tf2, depth + 1); continue; } if (be.type === 'TEXT' || be.type === 'ATTDEF' || be.type === 'MTEXT' || be.type === 'POINT') continue; const e2 = Object.assign({}, be, { layer: (be.layer === '0' || !be.layer) ? ent.layer : be.layer, color: be.color != null ? be.color : ent.color, _sym: true }); handleSym(e2, tf2, depth + 1); }
          }
          break;
        }
      }
    }
    // block symbol geometry: drawn but not clickable as separate features
    function handleSym(ent, tf, depth) { const before = {}; for (const k in byLayer) before[k] = byLayer[k].length; handle(ent, tf, depth); for (const k in byLayer) for (let i = before[k] || 0; i < byLayer[k].length; i++) byLayer[k][i]._sym = true; }
    for (const e of dxf.entities || []) { try { handle(e, null, 0); } catch (err) { cadInfo.failed++; } }
    const res = Object.keys(byLayer).sort().map(L => ({ name: L, features: byLayer[L], crs: null, color: layerTab[L] ? dxfColor(layerTab[L].color) : null, cad: true }));
    // local geometry of used block definitions (to write them back to CAD)
    cadInfo.blocks = {};
    usedBlocks.forEach(nm => {
      const b = blocks[nm]; if (!b || !b.entities) return;
      const bp = b.position ? [b.position.x, b.position.y] : [0, 0]; const gs = [];
      const P = p => [p.x - bp[0], p.y - bp[1]];
      b.entities.forEach(e => { try {
        if (e.type === 'LINE') gs.push({ t: 'L', c: e.vertices.map(P) });
        else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices && e.vertices.length > 1) { const c = []; const vs = e.vertices; for (let i = 0; i < vs.length; i++) { const p = P(vs[i]); c.push(p); const nb = vs[i + 1] || ((e.shape || e.closed) ? vs[0] : null); if (nb && vs[i].bulge) bulgeSeg(p, P(nb), vs[i].bulge).forEach(q => c.push(q)); } gs.push({ t: 'L', c, closed: !!(e.shape || e.closed) }); }
        else if (e.type === 'CIRCLE') gs.push({ t: 'C', c: P(e.center), r: e.radius });
        else if (e.type === 'ARC') gs.push({ t: 'L', c: arcPts(e.center.x - bp[0], e.center.y - bp[1], e.radius, e.startAngle, e.endAngle, 36) });
        else if (e.type === 'SOLID' || e.type === '3DFACE') { const c = (e.points || e.vertices || []).map(P); if (c.length > 2) gs.push({ t: 'L', c, closed: true }); }
      } catch (er) { } });
      cadInfo.blocks[nm] = gs;
    });
    res.cadInfo = cadInfo; return res;
  }

  async function loadFGDBFiles(files, gdbName) {
    const layers = FGDB.readGDB(files);
    return layers.map(l => ({ name: l.name, features: l.features, crs: l.wkt, error: l.error, schema: l.schema, domains: l.domains, subtypes: l.subtypes, domainDefs: l.domainDefs }));
  }

  // dispatch: list of {name, getBuf(), getText()}
  async function loadEntries(entries, label) {
    const groups = [];
    const byExt = {};
    entries.forEach(e => { const x = ext(e.name); (byExt[x] = byExt[x] || []).push(e); });
    // FileGDB: group by parent .gdb folder
    const gdbEntries = entries.filter(e => /\.gdbtabl[ex]$/i.test(e.name));
    if (gdbEntries.length) {
      const byFolder = {};
      gdbEntries.forEach(e => { const parts = e.name.split('/'); const folder = parts.length > 1 ? parts[parts.length - 2] : (label || 'GDB'); (byFolder[folder] = byFolder[folder] || []).push(e); });
      for (const folder in byFolder) {
        const files = {};
        for (const e of byFolder[folder]) files[base(e.name).toLowerCase()] = await e.getBuf();
        groups.push({ name: folder, type: 'File Geodatabase', layers: await loadFGDBFiles(files) });
      }
    }
    // shapefiles: group by stem
    const shpStems = {};
    for (const x of ['shp', 'dbf', 'prj', 'cpg']) (byExt[x] || []).forEach(e => { const k = e.name.replace(/\.[^.]+$/, '').toLowerCase(); (shpStems[k] = shpStems[k] || {})[x] = e; });
    const shpLayers = [];
    for (const k in shpStems) {
      const s = shpStems[k]; if (!s.shp && !s.dbf) continue;
      shpLayers.push(shpFromParts(stem(k), s.shp && await s.shp.getBuf(), s.dbf && await s.dbf.getBuf(), s.prj && await s.prj.getBuf(), s.cpg && await s.cpg.getBuf()));
    }
    if (shpLayers.length) groups.push({ name: label || 'Shapefile', type: 'Shapefile', layers: shpLayers });
    for (const e of entries) {
      const x = ext(e.name);
      let layers = null, type = '';
      try {
        if (x === 'geojson' || x === 'json') { layers = await loadGeoJSON(e.name, await e.getText()); type = 'GeoJSON'; }
        else if (x === 'kml') { layers = await loadKML(e.name, await e.getText()); type = 'KML'; }
        else if (x === 'kmz') { layers = await loadKMZ(e.name, await e.getBuf()); type = 'KMZ'; }
        else if (x === 'gpx') { layers = await loadGPX(e.name, await e.getText()); type = 'GPX'; }
        else if (x === 'csv' || x === 'txt') { layers = await loadCSV(e.name, await e.getText()); type = 'CSV'; }
        else if (x === 'gpkg' || x === 'sqlite' || x === 'db' || x === 'spatialite') { layers = await loadGPKG(e.name, await e.getBuf()); type = x === 'gpkg' ? 'GeoPackage' : 'SQLite'; }
        else if (x === 'dxf') { layers = await loadDXF(e.name, await e.getText()); type = 'CAD (DXF)'; }
        else if (x === 'dwg') { layers = await loadDWG(base(e.name), await e.getBuf()); type = 'CAD (DWG)'; }
        else if (x === 'zip') { const sub = await zipEntries(await e.getBuf()); groups.push(...await loadEntries(sub, stem(e.name).replace(/\.gdb$/i, '') + (sub.some(s => /\.gdbtable$/i.test(s.name)) ? '.gdb' : ''))); continue; }
        else continue;
      } catch (err) {
        if (String(err.message) === 'DWG') groups.push({ name: base(e.name), type: 'DWG', error: 'ملفات DWG مقفولة (صيغة أوتوكاد الخاصة). من الأوتوكاد: Save As ← DXF وافتح ملف الـ DXF هنا.', layers: [] });
        else groups.push({ name: base(e.name), type: x.toUpperCase(), error: 'تعذر قراءة الملف: ' + (err.message || err), layers: [] });
        continue;
      }
      groups.push({ name: base(e.name), type, layers, cadInfo: layers && layers.cadInfo });
    }
    return groups;
  }
  async function zipEntries(buf) {
    const z = await JSZip.loadAsync(buf);
    return Object.values(z.files).filter(f => !f.dir && !/__MACOSX\//.test(f.name)).map(f => ({ name: f.name, getBuf: () => f.async('arraybuffer'), getText: () => f.async('string') }));
  }

  /* ---------------- map ---------------- */
  const map = L.map('map', { zoomControl: false, preferCanvas: false, attributionControl: true, worldCopyJump: true }).setView([24.7, 46.7], 6);
  // middle mouse button (wheel press) = pan, in every mode (select, box, move…), like CAD / GIS desktop apps
  { const mc = map.getContainer(); let mp = null;
    mc.addEventListener('mousedown', e => { if (e.button !== 1) return; e.preventDefault(); e.stopPropagation(); mp = [e.clientX, e.clientY]; mc.classList.add('mpan'); }, true);
    window.addEventListener('mousemove', e => { if (!mp) return; const dx = e.clientX - mp[0], dy = e.clientY - mp[1]; mp = [e.clientX, e.clientY]; if (dx || dy) map.panBy([-dx, -dy], { animate: false }); }, true);
    window.addEventListener('mouseup', e => { if (!mp || e.button !== 1) return; mp = null; mc.classList.remove('mpan'); e.preventDefault(); }, true);
    mc.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    const st0 = document.createElement('style'); st0.textContent = '#map.mpan,#map.mpan *{cursor:grabbing!important}'; document.head.appendChild(st0); }
  map.attributionControl.setPrefix(false);
  const canvas = L.canvas({ padding: 0.5, tolerance: 8 });
  const BASEMAPS = {
    osm: { label: 'خريطة شوارع', layer: () => GV.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, attribution: 'Esri World Street Map', cacheKey: 'street' }) },
    hyb: { label: 'قمر صناعي بأسماء', layer: () => L.layerGroup([GV.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, attribution: 'Esri World Imagery', cacheKey: 'sat' }), GV.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, cacheKey: 'places' }), GV.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, cacheKey: 'roads' })]) },
    sat: { label: 'قمر صناعي', layer: () => GV.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, attribution: 'Esri World Imagery', cacheKey: 'sat' }) },
    none: { label: 'بدون خلفية', layer: () => null }
  };
  let curBase = null, baseKey = store.get('gv_base') || 'osm', tilesOk = null;
  async function baseHelp() {
    const st = GV.deskTiles ? await GV.deskTiles.state() : 'none';
    const old = document.getElementById('baseHelp'); if (old) old.remove();
    if (st === 'granted') { toast('الخريطة الخلفية مش بتحمّل — اتأكد إن النت شغال', 5000); return; }
    const box = document.createElement('div'); box.id = 'baseHelp'; box.className = 'base-help';
    const msg = document.createElement('div');
    const b = document.createElement('button'); b.className = 'btn'; b.style.cssText = 'background:var(--accent);color:#fff;border:0;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer';
    if (st === 'prompt' || st === 'denied') { msg.textContent = 'الخريطة الخلفية محتاجة إذن تحميل من النت في نسخة الديسكتوب.'; b.textContent = st === 'denied' ? 'افتح الأذونات' : 'فعّل الخريطة الخلفية'; b.onclick = async () => { try { const d = await window.claude.use('desktop'); if (st === 'denied') await d.permissions.manage(); else await GV.deskTiles.request(); } catch (e) { } box.remove(); tilesOk = null; setBase(baseKey); }; }
    else if (st === 'install') { msg.textContent = 'الخريطة الخلفية مش بتفتح جوه صفحة Claude. ثبّت البرنامج كأبلكيشن على الديسكتوب وهتشتغل.'; b.textContent = 'ثبّت كأبلكيشن'; b.onclick = async () => { try { await GV.deskTiles.install(); } catch (e) { } box.remove(); }; }
    else { msg.textContent = 'صفحة Claude مش بتسمح بالخريطة الخلفية. افتح نسخة GitHub (موبايل أو لابتوب) وهتلاقيها شغالة.'; b.textContent = 'افتح نسخة GitHub'; b.onclick = () => { const a = document.createElement('a'); a.href = 'https://ah7medshahin.github.io/gis-viewer/'; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); box.remove(); }; }
    const x = document.createElement('button'); x.className = 'icon-btn'; x.textContent = '✕'; x.onclick = () => box.remove();
    box.append(msg, b, x); document.body.appendChild(box);
  }
  function setBase(k) {
    if (curBase) map.removeLayer(curBase);
    baseKey = k; store.set('gv_base', k); dirty();
    curBase = BASEMAPS[k].layer();
    document.body.classList.toggle('nobase', !curBase);
    if (curBase) {
      let errs = 0, oks = 0;
      const tl = curBase.getLayers ? curBase.getLayers()[0] : curBase;
      tl.on('tileerror', () => { errs++; if (errs >= 4 && oks === 0 && tilesOk !== false) { tilesOk = false; document.body.classList.add('nobase'); baseHelp(); } });
      tl.on('tileload', () => { oks++; tilesOk = true; document.body.classList.remove('nobase'); });
      curBase.addTo(map);
    }
    document.querySelectorAll('.base-opt').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  }

  const PALETTE = ['#0e7c86', '#d9480f', '#5f3dc4', '#2b8a3e', '#c2255c', '#1864ab', '#e67700', '#495057', '#0b7285', '#862e9c'];
  let colorIdx = 0;
  const sources = []; // {id,name,type,error,layers:[{id,name,features,leaf,visible,color,kind,crsLabel,native}]}
  let lid = 0, highlight = null;

  // point size follows zoom so dense networks stay readable
  const zR = r0 => { const z = map ? map.getZoom() : 18; return z >= 18 ? r0 : z >= 17 ? Math.max(2.5, r0 * 0.75) : z >= 16 ? Math.max(2, r0 * 0.55) : Math.max(1.6, r0 * 0.4); };
  let zLast = null; const reR = () => { const z = map.getZoom(); const k = z >= 18 ? 3 : z >= 17 ? 2 : z >= 16 ? 1 : 0; if (k === zLast) return; zLast = k; sources.forEach(s => s.layers.forEach(l => { if (l.leaf && l.leaf.eachLayer) l.leaf.eachLayer(function walk(m) { if (m.eachLayer) return m.eachLayer(walk); if (m.options && m.options._r && m.setRadius) m.setRadius(zR(m.options._r)); }); })); };
  setTimeout(() => map && map.on('zoomend', reR), 0);
  function buildLeaf(layer) {
    const color = layer.color;
    const fg = L.featureGroup();
    const ptStyle = { renderer: layer._renderer || canvas, radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95 };
    layer.features.forEach((f, i) => {
      if (!f.geometry) return;
      const fc = layer.theme ? layer.theme.fn(f) : f._color && layer.cad ? f._color : (f.properties && (f.properties.stroke || f.properties['marker-color'])) || color;
      let g; const hide = f.geometry.type === 'Point' && (layer.cad || (layer.src && layer.src.isCad)) && (f.properties.Text != null || (GV.cadDot && !GV.cadDot(layer, f)));
      try {
        g = L.geoJSON(f.wgs, {
          pointToLayer: (_, ll) => hide ? L.circleMarker(ll, { renderer: layer._renderer || canvas, radius: 5, opacity: 0, fillOpacity: 0 }) : (r0 => L.circleMarker(ll, Object.assign({}, ptStyle, { fillColor: fc, _r: r0, radius: zR(r0) })))(layer.cad ? (f.properties.Text != null ? 3 : 4) : 6),
          style: () => hide ? { opacity: 0, fillOpacity: 0 } : ({ renderer: layer._renderer || canvas, color: fc, weight: layer.kind === 'polygon' ? 2 : 3, opacity: 0.95, fillColor: (f.properties && f.properties.fill) || fc, fillOpacity: f.geometry.type.indexOf('Polygon') >= 0 ? 0.18 : 0 })
        });
      } catch (e) { return; }
      if (!f._sym) g.on('click', ev => { if (layer.noSelect) return; L.DomEvent.stopPropagation(ev); if (GV.editClick && GV.editClick(layer, i, ev)) return; if (GV.pick) { GV.pick(snapTo(f, ev.latlng)); return; } if (meas) { addMeasPt(snapTo(f, ev.latlng)); return; } showFeature(layer, i, ev.latlng); });
      else g.eachLayer(x => x.options.interactive = false);
      g.addTo(fg);
    });
    fg.on('add', () => { if (layer.noSelect) setTimeout(() => applySel(layer), 0); }); // lock survives rebuilds/restores
    return fg;
  }

  async function addGroups(groups, opts) {
    opts = opts || {};
    let bounds = null, needCRS = [];
    const added = [];
    for (const g of groups) {
      const src = { id: ++lid, name: g.name, type: g.type, error: g.error, layers: [], cadInfo: g.cadInfo, isCad: /CAD/.test(g.type || '') };
      for (const raw of g.layers || []) {
        const feats = raw.features || [];
        const layer = { id: ++lid, name: raw.name, features: feats, visible: true, color: raw.color && raw.color !== '#ffffff' ? raw.color : PALETTE[colorIdx++ % PALETTE.length], kind: geomKind(feats), cad: !!raw.cad, error: raw.error, crsDef: raw.crs, src, schema: raw.schema, domains: raw.domains, subtypes: raw.subtypes, domainDefs: raw.domainDefs };
        src.layers.push(layer);
        if (layer.kind === 'table' || !feats.length) continue;
        let crs = resolveCRS(raw.crs);
        if (!crs && looksGeographic(feats)) crs = resolveCRS('4326');
        if (!crs) { needCRS.push(layer); continue; }
        applyCRS(layer, crs);
      }
      sources.push(src); added.push(src);
    }
    if (needCRS.length) {
      const code = opts.noAsk ? null : await askCRS(needCRS);
      if (code) { const crs = resolveCRS(code); needCRS.forEach(l => { l.crsDef = code; applyCRS(l, crs); }); }
      else needCRS.forEach(l => { l.noCRS = true; });
    }
    if (opts.before) opts.before(added);
    if (!opts.quiet && GV.onCadLoaded) added.filter(s => s.isCad).forEach(s => setTimeout(() => GV.onCadLoaded(s), 400));
    { const NS = noSelSet(); if (NS.size) added.forEach(sr => sr.layers.forEach(l => { if (keysOf(l).some(k => NS.has(k)) || NS.has('*::' + l.name)) { l.noSelect = true; } })); }
    for (const g of sources) for (const l of g.layers) if (l.leaf && !l._shown) { l._shown = true; if (l.visible) l.leaf.addTo(map); const b = l.leaf.getBounds(); if (b.isValid()) bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast()); }
    renderLayers();
    added.forEach(sr => sr.layers.forEach(l => { if (l.noSelect) applySel(l); }));
    updateEmpty();
    refreshLabels();
    if (!opts.quiet) dirty();
    if (opts.quiet) return added;
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    const total = groups.reduce((a, g) => a + (g.layers || []).reduce((b, l) => b + (l.features || []).length, 0), 0);
    const errs = groups.filter(g => g.error);
    if (errs.length) showMsg(errs.map(e => e.name + ': ' + e.error).join('\n\n'));
    else toast('تم فتح ' + groups.reduce((a, g) => a + (g.layers || []).length, 0) + ' طبقة · ' + total.toLocaleString('en') + ' عنصر');
    return added;
  }
  function dirty() { if (GV.onDirty) GV.onDirty(); }
  // never edit the original: every destructive tool works on a "working copy" of the source
  const cloneG = g => g ? JSON.parse(JSON.stringify(g)) : g;
  async function workCopy(src) {
    if (!src || src.isCopy || src.orgOut || src.wsOut || src.flowTables || src.id === 'qc' || src.id === 'field') return src;
    if (src.copyRef && sources.indexOf(src.copyRef) >= 0) return src.copyRef;
    const g = { name: 'نسخة شغل — ' + src.name, type: src.type, cadInfo: src.cadInfo ? JSON.parse(JSON.stringify(src.cadInfo)) : undefined, layers: src.layers.map(l => ({ name: l.name, crs: l.crsDef, color: l.color, cad: l.cad, schema: l.schema, domains: l.domains, subtypes: l.subtypes, domainDefs: l.domainDefs, features: l.features.map(f => { const o = { type: 'Feature', properties: Object.assign({}, f.properties), geometry: cloneG(f.geometry) }; if (f._sym) o._sym = true; if (f._ins) o._ins = f._ins; if (f._color) o._color = f._color; return o; }) })) };
    const added = await addGroups([g], { quiet: true, noAsk: true, before: ad => { const c = ad[0]; c.isCopy = true; c.origName = src.name; c.anno = src.anno; c.netOnly = src.netOnly; c.layers.forEach((l, i) => { const o = src.layers[i]; l.visible = o.visible; l.labelField = o.labelField; l.schemaTypes = o.schemaTypes; l.schemaFields = o.schemaFields; if (!l.features.length && o.kind) l.kind = o.kind; l.annoScale = o.annoScale; }); } });
    const cp = added[0]; src.copyRef = cp; src.isOrig = true;
    cp.layers.forEach(l => { if (l.leaf && !l.visible) map.removeLayer(l.leaf); });
    src.layers.forEach(l => setVis(l, false));
    renderLayers(); refreshLabels(); dirty();
    toast('🔒 الأصل محفوظ زي ما هو — الشغل على "نسخة شغل"', 4000);
    return cp;
  }
  const superseded = s => !!(s && s.copyRef && sources.indexOf(s.copyRef) >= 0);
  const liveLayer = l => { const s = l && l.src; if (s && s.copyRef && sources.indexOf(s.copyRef) >= 0) { const i = s.layers.indexOf(l); return s.copyRef.layers[i] || l; } return l; };
  function finiteG(g) { if (!g || !g.coordinates) return false; let ok = true; const w = c => { if (!ok) return; if (typeof c[0] === 'number') { if (!(isFinite(c[0]) && isFinite(c[1])) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 540) ok = false; } else c.forEach(w); }; w(g.coordinates); return ok; }
  function applyCRS(layer, crs) {
    layer.crsLabel = crs.label;
    let bad = 0;
    for (const f of layer.features) {
      try { const g = mapCoords(f.geometry, crs.fn); f.wgs = finiteG(g) ? { type: 'Feature', properties: {}, geometry: g } : null; if (!f.wgs) bad++; } catch (e) { f.wgs = null; bad++; }
    }
    layer.leaf = buildLeaf(layer);
    layer.noCRS = false;
  }

  /* ---------------- UI ---------------- */
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2800); }
  function showMsg(text) { $('#msgText').textContent = text; openSheet('#msgSheet'); }
  let pinned = store.get('gv_pin') === '1';
  // navigation history: every sheet remembers where you came from → "رجوع" goes one step back
  let hist = [], lastOpen = null;
  function openSheet(id, opts) {
    opts = opts || {};
    const prev = opts.back || lastOpen;
    const sh0 = $(id); const isP = sh0.classList.contains('panel') || sh0.classList.contains('dock');
    // a panel/dock (results list, attribute table) lives next to the map: opening anything keeps the other panels open
    const kind = x => x.classList.contains('dock') ? 'dock' : x.classList.contains('right') ? 'pr' : 'pl'; document.querySelectorAll('.sheet.open').forEach(s => { if (pinned && s.id === 'layerSheet') return; if (s.classList.contains('panel') || s.classList.contains('dock')) { if (isP && kind(s) === kind(sh0) && s !== sh0) s.classList.remove('open'); return; } s.classList.remove('open'); }); $('#scrim').classList.remove('show');
    if (opts.reset) hist = [];
    if (!opts.noBack && prev && prev !== id && !(pinned && prev === '#layerSheet')) { if (hist[hist.length - 1] !== prev) hist.push(prev); }
    const k = hist.indexOf(id); if (k >= 0) hist = hist.slice(0, k);
    lastOpen = id;
    const sh = $(id); sh.classList.add('open'); mkResize.z = (mkResize.z || 1002) + 1; sh.style.zIndex = mkResize.z; // the window you just opened is always on top
    const isF = !/^#(crsSheet|msgSheet|pickSheet|saveSheet)$/.test(id); // every window floats: move, resize, minimise; the map stays usable
    if (!isF) sh.style.zIndex = 3000 + mkResize.z; // modal windows sit above the dimmed background, never under it
    if (isF && !sh.querySelector('.min-btn')) { const mb = el('button', 'icon-btn min-btn', '▁'); mb.title = 'صغّر / كبّر'; mb.addEventListener('click', () => { sh.classList.toggle('min'); mb.textContent = sh.classList.contains('min') ? '▢' : '▁'; }); const hd = sh.querySelector('.sh-head'); const cl = hd && hd.querySelector('[data-close]'); if (hd) hd.insertBefore(mb, cl || null); }
    if (isF) sh.classList.remove('min');
    if (isF && !sh.querySelector('.rz')) mkResize(sh);
    let bb = sh.querySelector('.back-btn');
    if (!bb) { bb = el('button', 'back-btn', '→ رجوع'); bb.title = 'ارجع للي قبلها'; bb.addEventListener('click', goBack); const hd = sh.querySelector('.sh-head'); if (hd) hd.insertBefore(bb, hd.firstChild); }
    bb.style.display = hist.length ? '' : 'none';
    const isLayer = id === '#layerSheet';
    if (!isF && !isP && !(isLayer && (window.innerWidth >= 1000 || pinned))) $('#scrim').classList.add('show');
  }
  // floating windows (panels + the attribute-table dock): drag the title bar to move, any edge or corner to resize; position and size are remembered
  function mkResize(sh) {
    if (window.innerWidth < 760) return; const key = 'gv_rect_' + sh.id;
    const setR = r => { const W = window.innerWidth, H = window.innerHeight; r.w = Math.max(280, Math.min(W - 8, r.w)); r.h = Math.max(120, Math.min(H - 8, r.h)); r.x = Math.max(0, Math.min(W - 60, r.x)); r.y = Math.max(0, Math.min(H - 40, r.y));
      Object.assign(sh.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', right: 'auto', bottom: 'auto', maxHeight: 'none', insetInline: 'auto' }); sh._r = r; };
    try { const sv = JSON.parse(store.get(key) || 'null'); if (sv && sv.w) setR(sv); } catch (e) { }
    sh.addEventListener('pointerdown', () => { mkResize.z = (mkResize.z || 1002) + 1; sh.style.zIndex = mkResize.z; }, true);
    const save = () => { if (sh._r) store.set(key, JSON.stringify(sh._r)); if (GV.map) GV.map.invalidateSize(); };
    const drag = (e, fn) => { e.preventDefault(); e.stopPropagation(); try { getSelection().removeAllRanges(); } catch (er) { } const r0 = sh.getBoundingClientRect(); const s0 = { x: r0.left, y: r0.top, w: r0.width, h: r0.height }; const x0 = e.clientX, y0 = e.clientY; const t = e.currentTarget; t.setPointerCapture(e.pointerId); sh.classList.add('moving');
      const mv = ev => setR(fn(Object.assign({}, s0), ev.clientX - x0, ev.clientY - y0)); const up = () => { sh.classList.remove('moving'); t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); save(); }; t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); };
    const E = { n: (r, dx, dy) => (r.y += dy, r.h -= dy, r), s: (r, dx, dy) => (r.h += dy, r), e: (r, dx) => (r.w += dx, r), w: (r, dx) => (r.x += dx, r.w -= dx, r) };
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(d => { const h = el('div', 'rz ' + d); h.title = 'اسحب عشان تكبّر أو تصغّر'; h.addEventListener('pointerdown', e => drag(e, (r, dx, dy) => { d.split('').forEach(c => E[c](r, dx, dy)); return r; })); sh.appendChild(h); });
    const hd = sh.querySelector('.sh-head'); if (hd) { hd.classList.add('movable'); hd.title = 'اسحب من هنا عشان تحرّك الشاشة'; hd.addEventListener('pointerdown', e => { if (e.target.closest('button,input,select,a')) return; drag(e, (r, dx, dy) => (r.x += dx, r.y += dy, r)); }); hd.addEventListener('dblclick', e => { if (e.target.closest('button')) return; store.set(key, ''); ['left', 'top', 'width', 'height', 'right', 'bottom', 'maxHeight', 'insetInline'].forEach(k => sh.style[k] = ''); sh._r = null; if (GV.map) GV.map.invalidateSize(); }); }
  }
  // the item you are looking at: a pulsing ring on the map (error, selected row, "go to")
  let selMk = null;
  function markSel(lat, lng) { try { if (selMk) map.removeLayer(selMk); selMk = L.circleMarker([lat, lng], { radius: 16, color: '#e8590c', weight: 3, dashArray: '5 4', fill: true, fillOpacity: 0.12, className: 'sel-ring', interactive: false }).addTo(map); } catch (e) { } }
  function goBack() { const b = hist.pop(); if (!b) return closeSheets(); lastOpen = null; const re = GV.sheetRefresh && GV.sheetRefresh[b]; if (re) { try { re(); } catch (e) { } } openSheet(b, { noBack: true }); }
  function closeSheets(keepBack) {
    document.querySelectorAll('.sheet.open').forEach(s => { if (pinned && s.id === 'layerSheet') return; if (keepBack === 'all' || !(s.classList.contains('panel') || s.classList.contains('dock'))) s.classList.remove('open'); });
    $('#scrim').classList.remove('show');
    if (keepBack !== true && keepBack !== 'prog') { hist = []; lastOpen = null; }
  }
  function setPinned(v) { pinned = v; store.set('gv_pin', v ? '1' : '0'); document.body.classList.toggle('pinned', v); $('#btnPin').classList.toggle('on', v); $('#btnPin').title = v ? 'إلغاء التثبيت' : 'تثبيت القائمة'; if (v) { renderLayers(); $('#layerSheet').classList.add('open'); if (!document.querySelector('.sheet.open:not(#layerSheet)')) $('#scrim').classList.remove('show'); } }
  $('#btnPin').addEventListener('click', () => setPinned(!pinned));
  setTimeout(() => setPinned(pinned), 0);
  $('#scrim').addEventListener('click', closeSheets);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheets(); return; }
    if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'o') pickFiles(); else if (k === 'l') $('#btnLayers').click(); else if (k === 'm') $('#btnMeasure').click(); else if (k === 'e') $('#btnExport').click(); else if (k === 'q') $('#btnQC').click(); else if (k === 't') $('#btnTools').click(); else if (k === 'f') $('#btnZoomAll').click();
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { const sh = b.closest('.sheet'); if (sh && (sh.classList.contains('panel') || sh.classList.contains('dock'))) { sh.classList.remove('open'); if (!document.querySelector('.sheet.open:not(.panel):not(.dock)')) $('#scrim').classList.remove('show'); } else closeSheets(); }));
  function updateEmpty() { const any = sources.some(s => s.layers.length || s.error); document.body.classList.toggle('has-data', any); $('#layerCount').textContent = sources.reduce((a, s) => a + s.layers.length, 0) || ''; }

  const KIND_ICON = { point: '●', line: '╱', polygon: '▰', mixed: '◇', table: '▦' };
  const KIND_AR = { point: 'نقاط', line: 'خطوط', polygon: 'مضلعات', mixed: 'مختلط', table: 'جدول' };
  // ---- layer groups: your own named folders for CAD or database layers (remembered) ----
  let LG = []; try { LG = JSON.parse(store.get('gv_lgroups') || '[]'); } catch (e) { }
  const saveLG = () => { store.set('gv_lgroups', JSON.stringify(LG)); if (GV.onDirty) GV.onDirty(); };
  let autoGrp = store.get('gv_autogrp') === '1';
  function groupPerFile(srcs) {
    let n = 0;
    srcs.filter(x => x && x.id !== 'field' && x.id !== 'qc' && !x.error).forEach(src => {
      const ls = src.layers.filter(l => !grpOf(l)); if (!ls.length) return;
      let name = src.name.replace(/\.(gdb|zip|dwg|dxf|gpkg|kmz|kml|geojson|json|shp|csv)(\.zip)?$/i, '') || src.name; let base = name, k = 2; while (LG.some(g => g.name === name)) name = base + ' (' + k++ + ')';
      const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, keys: [...new Set(ls.map(lkey))], open: false }; LG.push(g); ls.forEach(l => { l._grp = g.id; }); n++;
    });
    if (n) { saveLG(); renderLayers(); }
    return n;
  }
  const lkey = l => { const sr = sources.find(x => x.layers.indexOf(l) >= 0); return (sr ? sr.name : '') + '::' + l.name; };
  const keysOf = l => { const sr = sources.find(x => x.layers.indexOf(l) >= 0); const ks = [lkey(l)]; if (sr && sr.origName) ks.push(sr.origName + '::' + l.name); return ks; };
  // membership is held by the layer itself (l._grp); the saved name keys only re-attach layers after a reload, and a key
  // already held by another layer is never taken by a newly added file that happens to have the same names
  const allLayers = () => sources.flatMap(x => x.layers);
  const grpOf = l => {
    if (l._grp !== undefined) return l._grp ? LG.find(g => g.id === l._grp) || null : null;
    const ks = keysOf(l); const g = LG.find(g2 => ks.some(k => g2.keys.indexOf(k) >= 0)); if (!g) return null; // undecided: no group yet
    const k = ks.find(k2 => g.keys.indexOf(k2) >= 0);
    const holder = allLayers().find(o => o !== l && o._grp === g.id && keysOf(o).indexOf(k) >= 0);
    if (holder) { const so = x => sources.find(y => y.layers.indexOf(x) >= 0); const hs = so(holder), ms = so(l); if (hs && ms && superseded(hs) && ms.origName === hs.name) { holder._grp = ''; l._grp = g.id; return g; } l._grp = ''; return null; }
    l._grp = g.id; return g;
  };
  const inGroup = l => !!grpOf(l);
  let lgSel = null; // Set of layers while picking
  function mkRow(l) {
        const row = el('div', 'lyr' + (l.visible ? '' : ' off'));
        const sw = el('button', 'sw'); sw.style.setProperty('--c', l.color); sw.textContent = KIND_ICON[l.kind] || '●'; sw.title = 'إظهار/إخفاء';
        sw.addEventListener('click', () => { setVis(l, !l.visible); renderLayers(); });
        const info = el('div', 'lyr-info');
        info.appendChild(el('div', 'lyr-name', l.name));
        const n = l.features.length;
        info.appendChild(el('div', 'lyr-meta', n.toLocaleString('en') + ' · ' + (KIND_AR[l.kind] || '') + (l.crsLabel && l.kind !== 'table' ? ' · ' + l.crsLabel : '') + (l.noCRS ? ' · مفيش نظام إحداثيات' : '') + (l.error ? ' · خطأ' : '') + (l.theme ? ' · ملون حسب ' + l.theme.field : '') + (l.labelField ? ' · ليبل: ' + l.labelField : '') + (l.noSelect ? ' · 🔒 مقفولة للسيليكت' : '')));
        info.addEventListener('click', () => openTable(l, true));
        const acts = el('div', 'lyr-acts');
        if (l.leaf) { const z = el('button', 'icon-btn small', '⤢'); z.title = 'تكبير على الطبقة'; z.onclick = () => { setVis(l, true); const b = l.leaf.getBounds(); if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 }); closeSheets(); }; acts.appendChild(z); }
        if (l.noCRS) { const c = el('button', 'icon-btn small', '⌖'); c.title = 'اختار نظام الإحداثيات'; c.onclick = async () => { const code = await askCRS([l]); if (code) { l.crsDef = code; applyCRS(l, resolveCRS(code)); l.leaf.addTo(map); dirty(); const b = l.leaf.getBounds(); if (b.isValid()) map.fitBounds(b); renderLayers(); } }; acts.appendChild(c); }
        if (l.leaf) { const st = el('button', 'icon-btn small', '🎨'); st.title = 'تلوين حسب حقل'; st.onclick = () => openStyle(l, true); acts.appendChild(st); }
        if (l.theme) { const cs = l.theme.classes.slice(0, 6).map(c => c.color); sw.style.setProperty('--c', 'conic-gradient(' + cs.map((c, k) => c + ' ' + (k * 100 / cs.length) + '% ' + ((k + 1) * 100 / cs.length) + '%').join(',') + ')'); }
        const tb = el('button', 'icon-btn small', '☰'); tb.title = 'جدول البيانات'; tb.onclick = () => openTable(l, true); acts.appendChild(tb);
        if (lgSel) { const cb = el('input'); cb.type = 'checkbox'; cb.className = 'lg-ck'; cb.checked = lgSel.has(l); cb.onchange = () => { if (cb.checked) lgSel.add(l); else lgSel.delete(l); const n2 = $('#lgN'); if (n2) n2.textContent = lgSel.size; }; row.append(cb); }
        const mo = el('button', 'icon-btn small', '⋯'); mo.title = 'أوامر الطبقة (أو كليك يمين)'; mo.onclick = e => { e.stopPropagation(); const r = mo.getBoundingClientRect(); lyrMenu(l, r.left, r.bottom); }; acts.appendChild(mo);
        row.addEventListener('contextmenu', e => { e.preventDefault(); lyrMenu(l, e.clientX, e.clientY); });
        let lp = null; row.addEventListener('touchstart', e => { const t = e.touches[0]; lp = setTimeout(() => lyrMenu(l, t.clientX, t.clientY), 550); }, { passive: true }); ['touchend', 'touchmove', 'touchcancel'].forEach(ev => row.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
        row.append(sw, info, acts); return row;
  }
  function groupsUI(box) {
    const bar = el('div', 'src-tools lg-bar');
    if (!lgSel) { const nb = el('button', 'chip', '☑ اختار طبقات (جروب / مسح / سيب بس)'); nb.title = 'اختار طبقات (كاد أو داتا بيز) واعملهم جروب باسمك'; nb.onclick = () => { lgSel = new Set(); renderLayers(); }; bar.appendChild(nb);
      const pf = el('button', 'chip', '📁 جروب لكل ملف'); pf.title = 'كل ملف مفتوح يبقى جروب باسمه (الطبقات اللي مش في جروب بس)'; pf.onclick = () => { const n = groupPerFile(sources.slice()); toast(n ? 'اتعمل ' + n + ' جروب' : 'كل الطبقات في جروبات بالفعل'); };
      const au = el('button', 'chip' + (autoGrp ? ' on' : ''), (autoGrp ? '✓ ' : '') + 'جروب تلقائي لكل ملف أفتحه'); au.onclick = () => { autoGrp = !autoGrp; store.set('gv_autogrp', autoGrp ? '1' : '0'); renderLayers(); };
      bar.append(pf, au); }
    else {
      bar.appendChild(el('span', 'small', 'علّم على الطبقات (')); const nn = el('b', null, String(lgSel.size)); nn.id = 'lgN'; bar.appendChild(nn); bar.appendChild(el('span', 'small', ')'));
      const nm = el('input'); nm.placeholder = 'اسم الجروب الجديد'; nm.style.cssText = 'max-width:170px';
      const sel = el('select'); const o0 = el('option', null, '— أو ضيفهم لجروب موجود —'); o0.value = ''; sel.appendChild(o0); LG.forEach(g => { const o = el('option', null, g.name); o.value = g.id; sel.appendChild(o); });
      const ok = el('button', 'chip ok', 'تمام'); ok.onclick = () => { if (!lgSel.size) return toast('علّم على طبقة واحدة على الأقل'); const keys = [...lgSel].map(lkey); LG.forEach(g => { g.keys = g.keys.filter(k => keys.indexOf(k) < 0); }); let g = sel.value && LG.find(x => x.id === sel.value); if (!g) { const name = nm.value.trim() || ('جروب ' + (LG.length + 1)); g = { id: Date.now().toString(36), name, keys: [], open: true }; LG.push(g); } g.keys.push(...keys); [...lgSel].forEach(l => { l._grp = g.id; }); LG = LG.filter(x => x.keys.length); saveLG(); lgSel = null; renderLayers(); toast('اتحطوا في جروب «' + g.name + '»'); };
      const cn = el('button', 'chip', 'إلغاء'); cn.onclick = () => { lgSel = null; renderLayers(); };
      const del = el('button', 'chip', '🗑 امسح المحدد'); del.title = 'امسح الطبقات المعلّم عليها من الشغل (الملفات الأصلية مبتتلمسش)'; del.onclick = () => { if (!lgSel.size) return toast('علّم على طبقة واحدة على الأقل'); const ls = [...lgSel]; lgSel = null; removeLayers(ls); };
      const keep = el('button', 'chip', '★ سيب المحدد بس'); keep.onclick = () => { if (!lgSel.size) return toast('علّم على طبقة واحدة على الأقل'); const ls = [...lgSel]; lgSel = null; keepOnly(ls, ls.length + ' طبقة'); };
      const okc = el('button', 'chip ok', 'تمام وكمّل جروب تاني'); okc.onclick = () => { const save = lgSel; ok.onclick(); if (lgSel === null && save.size) { lgSel = new Set(); renderLayers(); const i2 = document.querySelector('.lg-bar input'); if (i2) i2.focus(); } };
      nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey ? okc : ok).onclick(); } }); nm.title = 'Enter = تمام · Shift+Enter = تمام وكمّل جروب تاني';
      bar.append(nm, sel, ok, okc, del, keep, cn);
    }
    box.appendChild(bar);
    const all = sources.flatMap(sr => sr.layers);
    LG.forEach(g => {
      const ls = all.filter(l => grpOf(l) === g); if (!ls.length && !lgSel) return;
      const sec = el('section', 'src lgrp'); const h = el('div', 'src-head'); const t = el('div', 'src-title');
      const fold = el('button', 'icon-btn small', g.open === false ? '▸' : '▾'); fold.onclick = () => { g.open = g.open === false; saveLG(); renderLayers(); };
      t.append(fold, el('b', null, '📁 ' + g.name), el('span', 'tag', ls.length + ' طبقة')); h.appendChild(t);
      const vis = el('button', 'icon-btn small', ls.some(l => l.visible) ? '👁' : '◌'); vis.title = 'إظهار/إخفاء الجروب كله'; vis.onclick = () => { const v = !ls.some(l => l.visible); ls.forEach(l => setVis(l, v)); renderLayers(); };
      const zm = el('button', 'icon-btn small', '⤢'); zm.title = 'زوم على الجروب'; zm.onclick = () => { let bb = null; ls.forEach(l => { if (l.leaf && l.visible) { const b2 = l.leaf.getBounds(); if (b2.isValid()) bb = bb ? bb.extend(b2) : L.latLngBounds(b2.getSouthWest(), b2.getNorthEast()); } }); if (bb) map.fitBounds(bb, { padding: [30, 30], maxZoom: 18 }); };
      const rn = el('button', 'icon-btn small', '✎'); rn.title = 'غيّر الاسم'; rn.onclick = () => askText('اسم الجروب', g.name).then(v => { if (v && v.trim()) { g.name = v.trim(); saveLG(); renderLayers(); } });
      const dl = el('button', 'icon-btn small', '✕'); dl.title = 'فك الجروب (الطبقات بترجع مكانها)'; dl.onclick = () => { all.forEach(o => { if (o._grp === g.id) o._grp = ''; }); LG = LG.filter(x => x !== g); saveLG(); renderLayers(); };
      const only = el('button', 'icon-btn small', '★'); only.title = 'سيب الجروب ده بس وامسح باقي الطبقات من الشغل'; only.onclick = () => keepOnly(ls, 'الجروب «' + g.name + '»');
      h.append(vis, zm, only, rn, dl); sec.appendChild(h);
      if (g.open !== false) ls.forEach(l => { const r = mkRow(l); const out = el('button', 'icon-btn small', '⇱'); out.title = 'طلّعها من الجروب'; out.onclick = () => { l._grp = ''; g.keys = g.keys.filter(k => keysOf(l).indexOf(k) < 0 || all.some(o => o !== l && o._grp === g.id && keysOf(o).indexOf(k) >= 0)); LG = LG.filter(x => x.keys.length); saveLG(); renderLayers(); }; r.querySelector('.lyr-acts').appendChild(out); sec.appendChild(r); });
      box.appendChild(sec);
    });
  }
  function renderLayers() {
    const box = $('#layerList'); box.textContent = '';
    if (!sources.length) { box.appendChild(el('p', 'muted pad', 'لسه مفيش ملفات مفتوحة.')); return; }
    groupsUI(box);
    sources.slice().reverse().forEach(src => {
      if (!src.error && src.layers.length && src.layers.every(l => grpOf(l))) return; // everything of this file lives in groups: no empty header
      const sec = el('section', 'src');
      const h = el('div', 'src-head');
      const t = el('div', 'src-title'); t.appendChild(el('b', null, src.name)); t.appendChild(el('span', 'tag', src.type || '')); if (superseded(src)) t.appendChild(el('span', 'tag lock', '🔒 الأصل — مبيتعدلش')); else if (src.isCopy) t.appendChild(el('span', 'tag copy', '✎ نسخة شغل'));
      h.appendChild(t);
      const rm = el('button', 'icon-btn small', '✕'); rm.title = 'إزالة'; if (src.id === 'field') rm.style.visibility = 'hidden'; rm.addEventListener('click', () => { const keep = src.layers.filter(inGroup); if (keep.length) { removeLayers(src.layers.filter(l => !inGroup(l)), 'اتشال الملف «' + src.name + '» — وفضلت ' + keep.length + ' طبقة جوه الجروبات زي ما هي', true); return; } removeLayers(src.layers.slice(), 'اتشال الملف «' + src.name + '»'); if (sources.indexOf(src) >= 0 && !src.layers.length) { sources.splice(sources.indexOf(src), 1); renderLayers(); updateEmpty(); } });
      const si = sources.indexOf(src); const up = el('button', 'icon-btn small', '▲'); up.title = 'الملف ده يترسم فوق'; up.disabled = si === sources.length - 1; up.onclick = () => { sources.splice(si, 1); sources.splice(si + 1, 0, src); applyOrder(); renderLayers(); dirty(); };
      const dn = el('button', 'icon-btn small', '▼'); dn.title = 'الملف ده يترسم تحت'; dn.disabled = si === 0; dn.onclick = () => { sources.splice(si, 1); sources.splice(si - 1, 0, src); applyOrder(); renderLayers(); dirty(); };
      h.append(up, dn, rm); sec.appendChild(h);
      if (src.error) sec.appendChild(el('p', 'err', src.error));
      if (src.isCad) {
        const ct = el('div', 'src-tools');
        const an = el('button', 'chip' + (src.anno !== false ? ' on' : ''), (src.anno !== false ? '✓ ' : '') + 'الأنوتيشن (النصوص)');
        an.onclick = () => { src.anno = src.anno === false; src.layers.forEach(l => { if (l.leaf) rebuild(l); }); refreshLabels(); renderLayers(); dirty(); };
        const ck = el('button', 'chip', '⚠ فحص الكاد والسكيل'); ck.onclick = () => GV.onCadLoaded && GV.onCadLoaded(src, true);
        const fx = el('button', 'chip', '🛠 إصلاح'); fx.onclick = () => GV.openFix && GV.openFix({ cad: true, src });
        const dx = el('button', 'chip', '⤓ DXF'); dx.title = 'نزّل الكاد DXF'; dx.onclick = () => GV.exportCadDxf && GV.exportCadDxf(src);
        const no = el('button', 'chip' + (src.netOnly ? ' on' : ''), (src.netOnly ? '✓ ' : '') + 'الشبكة بس'); no.title = 'اخفي الخلفية (قطع أراضي، طرق، مباني، إطار…)'; no.onclick = () => GV.cadNetOnly && GV.cadNetOnly(src, !src.netOnly);
        const ai = el('button', 'chip', '🧠 Claude يراجعه'); ai.onclick = () => GV.aiAsk && GV.aiAsk('راجع ملف الكاد ده (' + src.name + ') مراجعة كاملة زي ما كنت هتعمل لو فتحته بنفسك.');
        const fl = el('button', 'chip', '🚀 لـ GIS خطوة بخطوة'); fl.onclick = () => GV.openFlow && GV.openFlow();
        fl.textContent = '🚀 كمّل للـ GIS'; fl.className = 'chip main';
        const more = el('button', 'chip', '⋯ أدوات الكاد'); const mbox = el('div', 'src-tools more-tools'); mbox.hidden = !src._moreOpen;
        more.onclick = () => { src._moreOpen = !src._moreOpen; mbox.hidden = !src._moreOpen; };
        mbox.append(an, no, ck, fx, ai, dx);
        if (superseded(src)) ct.append(el('span', 'muted small', 'ده الأصل للقراية بس — الشغل على "نسخة شغل"'));
        else ct.append(fl, more);
        sec.appendChild(ct); if (!superseded(src)) sec.appendChild(mbox);
      }
      const folded = src._fold != null ? src._fold : (superseded(src) || (src.orgOut && /\|bg$/.test(src.orgOut)));
      if (folded) { const ex = el('button', 'chip', '▸ اعرض ' + src.layers.length + ' طبقة'); ex.onclick = () => { src._fold = false; renderLayers(); }; sec.appendChild(ex); box.appendChild(sec); return; }
      if (src._fold === false && (superseded(src) || src.orgOut)) { const cl = el('button', 'chip', '▾ اطوي'); cl.onclick = () => { src._fold = true; renderLayers(); }; sec.appendChild(cl); }
      if (src.layers.length > 3) {
        const all = el('div', 'src-tools');
        const on = el('button', 'chip', 'إظهار الكل'), off = el('button', 'chip', 'إخفاء الكل');
        on.onclick = () => { src.layers.forEach(l => setVis(l, true)); renderLayers(); }; off.onclick = () => { src.layers.forEach(l => setVis(l, false)); renderLayers(); };
        all.append(on, off); sec.appendChild(all);
      }
      src.layers.forEach(l => { if (grpOf(l)) return; sec.appendChild(mkRow(l)); });
      box.appendChild(sec);
    });
  }
  function setVis(l, v) { l.visible = v; dirty(); if (!l.leaf) return; if (v) { l.leaf.addTo(map); setTimeout(applyOrder, 0); } else map.removeLayer(l.leaf); if (l.labelField) refreshLabels(); }
  // ---- drawing order: the layer at the top of the list is drawn on top ----
  // in-page replacement for prompt() (blocked inside the Claude page)
  function askText(title, val) { return new Promise(res => { let w = document.getElementById('askBox'); if (w) w.remove(); w = el('div', 'qc-rev'); w.id = 'askBox';
    const h = el('div', 'qc-rev-h'); h.appendChild(el('b', null, title)); const x = el('button', 'icon-btn', '✕'); h.appendChild(x);
    const inp = el('input'); inp.value = val || ''; inp.style.cssText = 'width:100%;font:inherit;padding:8px;border-radius:10px';
    const ok = el('button', 'chip ok', 'تمام'); const done = v => { w.remove(); res(v); }; ok.onclick = () => done(inp.value); x.onclick = () => done(null); inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); else if (e.key === 'Escape') done(null); };
    w.append(h, inp, ok); document.body.appendChild(w); inp.focus(); inp.select(); }); }
  GV.askText = askText;
  // groups travel with the saved / synced workspace
  GV.lgState = () => ({ groups: LG.map(g => ({ id: g.id, name: g.name, keys: g.keys, open: g.open })), grpId: l => { const g = grpOf(l); return g ? g.id : ''; } });
  GV.lgApply = (groups, byKey) => {
    if (!Array.isArray(groups)) return;
    const open = new Map(LG.map(g => [g.id, g.open]));
    LG = groups.map(g => Object.assign({}, g, { open: open.has(g.id) ? open.get(g.id) : g.open }));
    store.set('gv_lgroups', JSON.stringify(LG));
    allLayers().forEach(l => { if (l.saveKey && byKey && byKey.has(l.saveKey)) l._grp = byKey.get(l.saveKey) || ''; });
    renderLayers();
  };
  GV.groupsList = () => { const all = sources.flatMap(x => x.layers); return LG.map(g => ({ name: g.name, id: g.id, layers: all.filter(l => grpOf(l) === g) })).filter(x => x.layers.length); };
  function applySel(l) { if (!l.leaf || !l.leaf.eachLayer) return; const v = l.noSelect ? 'none' : ''; l.leaf.eachLayer(x => { const go = y => { if (y.options && !y.eachLayer) y.options.interactive = !l.noSelect; if (y._path) y._path.style.pointerEvents = v; if (y._icon) y._icon.style.pointerEvents = v; if (y.eachLayer) y.eachLayer(go); }; go(x); }); }
  // layers locked for selection stay locked (also after closing and reopening the app) until unlocked by hand
  function noSelSet() { try { return new Set(JSON.parse(store.get('gv_nosel') || '[]')); } catch (e) { return new Set(); } }
  function setSelectable(l, on) { l.noSelect = !on; { const NS = noSelSet(); keysOf(l).concat(['*::' + l.name]).forEach(k => { if (on) NS.delete(k); else NS.add(k); }); store.set('gv_nosel', JSON.stringify([...NS])); } applySel(l); renderLayers(); dirty(); toast(on ? 'السيليكت اتفتح على «' + l.name + '»' : 'السيليكت اتقفل على «' + l.name + '» — الكليك بيعدّي للي تحتها'); }
  function applyOrder() { sources.forEach(src => src.layers.slice().reverse().forEach(l => { if (l.leaf && l.visible && map.hasLayer(l.leaf) && l.leaf.bringToFront) { try { l.leaf.bringToFront(); } catch (e) { } } if (l.noSelect) applySel(l); })); }
  const srcOf = l => sources.find(x => x.layers.indexOf(l) >= 0);
  function moveLayer(l, how) {
    const src = srcOf(l); if (!src) return; const a = src.layers; const i = a.indexOf(l);
    if (how === 'up' && i > 0) { a.splice(i, 1); a.splice(i - 1, 0, l); }
    else if (how === 'down' && i < a.length - 1) { a.splice(i, 1); a.splice(i + 1, 0, l); }
    else if (how === 'top') { a.splice(i, 1); a.unshift(l); sources.splice(sources.indexOf(src), 1); sources.push(src); }
    else if (how === 'bottom') { a.splice(i, 1); a.push(l); sources.splice(sources.indexOf(src), 1); sources.unshift(src); }
    applyOrder(); renderLayers(); dirty();
  }
  // ---- removing layers from the work (never touches the original files) with undo ----
  let undoRm = null;
  function removeLayers(ls, label, protect) {
    ls = ls.filter(l => l && srcOf(l) && !(srcOf(l).id === 'field')); if (protect) ls = ls.filter(l => !inGroup(l)); if (!ls.length) { if (label) toast(label); renderLayers(); return; }
    const rec = { srcs: sources.slice(), lists: new Map(sources.map(x => [x, x.layers.slice()])) };
    ls.forEach(l => { const src = srcOf(l); if (l.leaf) map.removeLayer(l.leaf); src.layers.splice(src.layers.indexOf(l), 1); if (!src.layers.length && !src.error) sources.splice(sources.indexOf(src), 1); });
    undoRm = rec; clearHL(); renderLayers(); updateEmpty(); refreshLabels(); dirty();
    undoBar((label || (ls.length === 1 ? 'طبقة «' + ls[0].name + '»' : ls.length + ' طبقة')) + ' اتمسحت من الشغل — الملف الأصلي زي ما هو');
  }
  function keepOnly(keep, label) { const ks = new Set(keep); const rm = sources.filter(x => x.id !== 'field' && x.id !== 'qc').flatMap(x => x.layers).filter(l => !ks.has(l)); const rm2 = rm.filter(l => !inGroup(l)); const kept = rm.length - rm2.length; if (!rm2.length) return toast(kept ? 'كل الطبقات التانية جوه جروبات — مامسحتش حاجة' : 'مفيش طبقات تانية'); removeLayers(rm2, 'سيبنا ' + label + ' بس — اتمسحت ' + rm2.length + ' طبقة' + (kept ? ' (وفضلت ' + kept + ' طبقة جوه جروبات تانية)' : '')); }
  function undoBar(msg) {
    let b = document.getElementById('undoBar'); if (b) b.remove(); b = el('div', 'base-help'); b.id = 'undoBar';
    const u = el('button', 'btn', '↶ تراجع'); u.style.cssText = 'background:var(--accent);color:#fff;border:0;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer';
    u.onclick = () => { if (!undoRm) return; sources.length = 0; undoRm.srcs.forEach(x => { x.layers.length = 0; x.layers.push(...undoRm.lists.get(x)); sources.push(x); x.layers.forEach(l => { if (l.leaf && l.visible) l.leaf.addTo(map); }); }); undoRm = null; applyOrder(); renderLayers(); updateEmpty(); refreshLabels(); dirty(); b.remove(); };
    const x = el('button', 'icon-btn', '✕'); x.onclick = () => b.remove();
    b.append(el('div', null, msg), u, x); document.body.appendChild(b); clearTimeout(undoBar.t); undoBar.t = setTimeout(() => b.remove(), 15000);
  }
  function zoomLayer(l) { if (!l.leaf) return toast('الطبقة دي جدول من غير مكان'); setVis(l, true); const b = l.leaf.getBounds(); if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 }); else toast('الطبقة فاضية'); }
  // ---- right-click / long-press menu on a layer ----
  function lyrMenu(l, x, y) {
    let m = document.getElementById('lyrMenu'); if (m) m.remove(); m = el('div', 'ctx-menu'); m.id = 'lyrMenu';
    const it = (t, fn, cls) => { const b = el('button', cls || '', t); b.onclick = () => { m.remove(); fn(); }; m.appendChild(b); };
    m.appendChild(el('div', 'ctx-h', l.name));
    if (l.leaf) it('⤢ زوم على الطبقة (Zoom to layer)', () => zoomLayer(l));
    it(l.visible ? '◌ إخفاء' : '👁 إظهار', () => { setVis(l, !l.visible); renderLayers(); });
    if (l.leaf) it(l.noSelect ? '🔓 افتح السيليكت للطبقة' : '🔒 اقفل السيليكت للطبقة', () => setSelectable(l, !!l.noSelect));
    it('☰ جدول البيانات', () => openTable(l, true));
    if (l.leaf && (l.kind === 'line' || l.kind === 'point') && GV.recalcLayers) it('🔄 حدّث الحقول المحسوبة', () => { const bef = l.features.map(f => Object.assign({}, f.properties || {})); const n = GV.recalcLayers([l]); rebuild(l); dirty(); if (n && GV.editSample) { const ch = []; l.features.forEach((f, i) => { if (Object.keys(f.properties || {}).some(k => String(f.properties[k]) !== String(bef[i][k]))) ch.push({ l, f, before: bef[i] }); }); GV.editSample('الحقول المحسوبة — ' + l.name, ch, () => { l.features.forEach((f, i) => { f.properties = bef[i]; }); rebuild(l); return ch.length; }); } toast(n ? 'اتحدّث ' + n + ' قيمة (إحداثيات، طول، مناسيب من النقط، عمق، ميل)' : 'كل الحقول المحسوبة مظبوطة'); });
    if (l.leaf) it('🎨 تلوين حسب حقل', () => openStyle(l, true));
    m.appendChild(el('div', 'ctx-sep'));
    it('⤒ ترسم فوق الكل', () => moveLayer(l, 'top')); it('▲ لفوق', () => moveLayer(l, 'up')); it('▼ لتحت', () => moveLayer(l, 'down')); it('⤓ ترسم تحت الكل', () => moveLayer(l, 'bottom'));
    m.appendChild(el('div', 'ctx-sep'));
    it('★ سيب الطبقة دي بس', () => keepOnly([l], '«' + l.name + '»'));
    it('🗑 امسح الطبقة من الشغل', () => removeLayers([l]), 'danger');
    document.body.appendChild(m);
    const W = window.innerWidth, H = window.innerHeight, r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(W - r.width - 6, x)) + 'px'; m.style.top = Math.max(6, Math.min(H - r.height - 6, y)) + 'px';
    setTimeout(() => { const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
  }

  // feature details
  function clearHL() { if (highlight) { map.removeLayer(highlight); highlight = null; } }
  function showFeature(layer, i, latlng) {
    const f = layer.features[i];
    clearHL();
    if (f.wgs && f.wgs.geometry) {
      highlight = L.geoJSON(f.wgs, { pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 11, color: '#ffd43b', weight: 4, fill: false }), style: { color: '#ffd43b', weight: 7, opacity: 0.9, fillOpacity: 0.1 }, interactive: false }).addTo(map);
    }
    $('#featTitle').textContent = layer.name;
    $('#featSub').textContent = (layer.src ? layer.src.name : '') + ' · #' + (i + 1);
    const tb = $('#featBody'); tb.textContent = '';
    const ex = $('#featExtra'); ex.textContent = '';
    if (f._extra) { try { f._extra(ex); } catch (e) { } }
    const props = f.properties || {};
    const keys = Object.keys(props).filter(k => k !== 'styleUrl' && k !== 'styleHash' && k !== 'styleMapHash' && !/^(stroke|fill|marker-color|stroke-width|stroke-opacity|fill-opacity|icon|icon-.*|label-.*)$/.test(k));
    keys.forEach(k => {
      const v = props[k];
      const tr = el('tr'); tr.appendChild(el('th', null, k));
      const td = el('td', null, v == null || v === '' ? '—' : (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(6))) : String(v)));
      if (v == null || v === '') td.className = 'null';
      tr.appendChild(td); tb.appendChild(tr);
    });
    if (!keys.length) tb.appendChild(el('tr')).appendChild(el('td', 'null', 'مفيش بيانات وصفية'));
    // coordinates
    const cbox = $('#featCoords'); cbox.textContent = '';
    let ll = latlng;
    if (!ll && f.wgs && f.wgs.geometry) { const c = firstCoord(f.wgs.geometry); if (c) ll = L.latLng(c[1], c[0]); }
    const g = f.geometry;
    if (g) {
      const t = g.type;
      let extra = '';
      if (t.indexOf('LineString') >= 0 && f.wgs) extra = 'الطول ≈ ' + fmtLen(lineLen(f.wgs.geometry));
      if (t.indexOf('Polygon') >= 0 && f.wgs) extra = 'المساحة ≈ ' + fmtArea(polyArea(f.wgs.geometry));
      if (extra) cbox.appendChild(el('div', 'meas', extra));
    }
    if (ll) {
      const lat = ll.lat.toFixed(6), lng = ll.lng.toFixed(6);
      const row = el('div', 'coord');
      row.appendChild(el('span', 'mono', lat + ', ' + lng));
      const cp = el('button', 'chip', 'نسخ'); cp.onclick = () => copy(lat + ', ' + lng); row.appendChild(cp);
      const a = el('a', 'chip', 'Google Maps'); a.href = 'https://www.google.com/maps?q=' + lat + ',' + lng; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a);
      cbox.appendChild(row);
      const nc = g && firstCoord(g);
      if (nc && layer.crsLabel && !/WGS ?84$|GCS_WGS_1984|EPSG:4326/i.test(layer.crsLabel)) cbox.appendChild(el('div', 'muted mono small', 'X ' + nc[0].toFixed(3) + '  ·  Y ' + nc[1].toFixed(3) + (nc[2] != null ? '  ·  Z ' + (+nc[2]).toFixed(2) : '') + '  (' + layer.crsLabel + ')'));
    }
    openSheet('#featSheet');
  }
  function hav(a, b) { const R = 6371008.8, r = Math.PI / 180; const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
  function lineLen(g) { const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates; let s = 0; for (const l of lines) for (let i = 1; i < l.length; i++) s += hav(l[i - 1], l[i]); return s; }
  function ringA(r) { const R = 6371008.8, d = Math.PI / 180; let s = 0; for (let i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * d * (2 + Math.sin(r[i][1] * d) + Math.sin(r[i + 1][1] * d)); return Math.abs(s * R * R / 2); }
  function polyArea(g) { const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; let s = 0; for (const p of ps) { s += ringA(p[0]); for (let i = 1; i < p.length; i++) s -= ringA(p[i]); } return s; }
  const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(3) + ' كم' : m.toFixed(2) + ' م';
  const fmtArea = a => a >= 1e6 ? (a / 1e6).toFixed(3) + ' كم²' : a.toFixed(1) + ' م²';
  function copy(t) { try { navigator.clipboard.writeText(t).then(() => toast('اتنسخ'), () => toast(t)); } catch (e) { toast(t); } }

  // attribute table
  let tblLayer = null, tblLimit = 200, tblOnly = null, tblNote = '';
  let tblSel = null;
  // keyboard: ←/→ scroll the table sideways, ↑/↓ scroll rows (Shift = faster), Home/End = first/last column — when not typing
  document.addEventListener('keydown', e => {
    const sh = $('#tblSheet'); if (!sh || !sh.classList.contains('open')) return;
    const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (document.getElementById('edBar') && !document.getElementById('edBar').hidden && /^Arrow/.test(e.key) && !sh.matches(':hover')) return;
    const w = sh.querySelector('.tbl-wrap'); if (!w) return; const k = e.shiftKey ? 3 : 1;
    if (e.key === 'ArrowLeft') w.scrollBy({ left: -160 * k }); else if (e.key === 'ArrowRight') w.scrollBy({ left: 160 * k });
    else if (e.key === 'ArrowUp') w.scrollBy({ top: -60 * k }); else if (e.key === 'ArrowDown') w.scrollBy({ top: 60 * k });
    else if (e.key === 'Home') w.scrollTo({ left: getComputedStyle(w).direction === 'rtl' ? 0 : 0 }); else if (e.key === 'End') w.scrollTo({ left: getComputedStyle(w).direction === 'rtl' ? -w.scrollWidth : w.scrollWidth });
    else return; e.preventDefault();
  });
  // a horizontal scroll bar that is always visible at the bottom of the table (drawn by the app, so it shows everywhere)
  { const hs = $('#tblHS'), w = document.querySelector('#tblSheet .tbl-wrap');
    if (hs && w) {
      hs.textContent = ''; const th = document.createElement('div'); th.className = 'hs-thumb'; hs.appendChild(th);
      const rtl = () => getComputedStyle(w).direction === 'rtl';
      const max = () => Math.max(0, w.scrollWidth - w.clientWidth);
      const pos = () => { const m = max(); const sl = rtl() ? -w.scrollLeft : w.scrollLeft; return m ? Math.min(1, Math.max(0, sl / m)) : 0; }; // 0 = start (right in RTL)
      const draw = () => { const m = max(); hs.style.display = m > 2 ? '' : 'none'; if (!m) return; const tw = hs.clientWidth; const len = Math.max(40, tw * w.clientWidth / w.scrollWidth); th.style.width = len + 'px'; const off = (tw - len) * pos(); if (rtl()) { th.style.right = off + 'px'; th.style.left = 'auto'; } else { th.style.left = off + 'px'; th.style.right = 'auto'; } };
      const setPos = f => { f = Math.min(1, Math.max(0, f)); const v = f * max(); w.scrollLeft = rtl() ? -v : v; };
      let drag = null;
      th.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); th.setPointerCapture(e.pointerId); drag = { x: e.clientX, p: pos() }; });
      th.addEventListener('pointermove', e => { if (!drag) return; const tw = hs.clientWidth - th.offsetWidth; if (tw <= 0) return; const dx = (e.clientX - drag.x) / tw; setPos(drag.p + (rtl() ? -dx : dx)); });
      th.addEventListener('pointerup', () => { drag = null; });
      hs.addEventListener('pointerdown', e => { if (e.target !== hs) return; const r = hs.getBoundingClientRect(); const f = rtl() ? (r.right - e.clientX) / r.width : (e.clientX - r.left) / r.width; setPos(f); });
      hs.addEventListener('wheel', e => { e.preventDefault(); w.scrollBy({ left: (e.deltaY || e.deltaX) }); }, { passive: false });
      w.addEventListener('scroll', draw); new ResizeObserver(draw).observe(w); new MutationObserver(() => setTimeout(draw, 0)).observe(w, { childList: true, subtree: true }); GV.tblHSync = draw; } }
  function openTable(l, fromList, only, note) { if (!GV._keepSelTabs) { const tb = document.getElementById('tblSelTabs'); if (tb) tb.remove(); } tblLayer = l; tblLimit = 200; tblOnly = only && only.length ? new Set(only) : null; tblNote = tblOnly ? (note || '') : ''; $('#tblTitle').textContent = l.name; $('#tblSearch').value = ''; renderTable(); openSheet('#tblSheet', fromList ? { back: '#layerSheet' } : null); }
  function renderTable() {
    const l = tblLayer; if (!l) return;
    const q = $('#tblSearch').value.trim().toLowerCase();
    const cols = []; const seen = new Set();
    for (const f of l.features.slice(0, 500)) for (const k in (f.properties || {})) if (!seen.has(k) && !/^(styleUrl|styleHash|styleMapHash|stroke.*|fill.*|marker-color|icon.*)$/.test(k)) { seen.add(k); cols.push(k); }
    const idx = [];
    for (let i = 0; i < l.features.length; i++) {
      if (tblOnly && !tblOnly.has(i)) continue;
      if (q) { const p = l.features[i].properties || {}; let hit = false; for (const k of cols) { const v = p[k]; if (v != null && String(v).toLowerCase().indexOf(q) >= 0) { hit = true; break; } } if (!hit) continue; }
      idx.push(i);
    }
    $('#tblCount').textContent = idx.length.toLocaleString('en') + ' من ' + l.features.length.toLocaleString('en') + (tblOnly ? ' · ' + (tblNote || 'عرض محدد') + ' ' : '');
    { let cl = $('#tblOnlyClr'); if (!cl) { cl = el('button', 'chip', '✕ اعرض الكل'); cl.id = 'tblOnlyClr'; cl.onclick = () => { tblOnly = null; tblNote = ''; renderTable(); }; $('#tblCount').after(cl); } cl.style.display = tblOnly ? '' : 'none'; }
    const table = $('#tbl'); table.textContent = '';
    const thead = el('thead'); const hr = el('tr'); hr.appendChild(el('th', 'rn', '#')); cols.forEach(c => hr.appendChild(el('th', null, c))); thead.appendChild(hr); table.appendChild(thead);
    const tb = el('tbody');
    idx.slice(0, tblLimit).forEach(i => {
      const f = l.features[i]; const p = f.properties || {};
      const tr = el('tr'); tr.appendChild(el('td', 'rn', String(i + 1)));
      cols.forEach(c => { const v = p[c]; tr.appendChild(el('td', v == null ? 'null' : null, v == null ? '' : (typeof v === 'number' && !Number.isInteger(v) ? String(+v.toFixed(4)) : String(v).slice(0, 120)))); });
      if (tblSel && tblSel.l === l && tblSel.i === i) tr.classList.add('sel'); if (f.wgs && f.wgs.geometry) { tr.classList.add('geo'); tr.addEventListener('click', () => { tblSel = { l, i }; try { const c = L.geoJSON(f.wgs).getBounds().getCenter(); markSel(c.lat, c.lng); } catch (e) { } table.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); setVis(l, true); const b = L.geoJSON(f.wgs).getBounds(); if (b.isValid()) map.fitBounds(b, { maxZoom: 19, padding: [60, 60] }); showFeature(l, i); }); }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    $('#tblMore').style.display = idx.length > tblLimit ? '' : 'none';
    if (!cols.length) table.appendChild(el('caption', 'muted', 'الطبقة مفيهاش حقول وصفية'));
  }
  $('#tblSearch').addEventListener('input', () => { tblLimit = 200; clearTimeout(renderTable._h); renderTable._h = setTimeout(renderTable, 150); });
  $('#tblMore').addEventListener('click', () => { tblLimit += 500; renderTable(); });

  // CRS dialog
  function askCRS(layers) {
    return new Promise(res => {
      const s = $('#crsList'); s.textContent = '';
      $('#crsWhat').textContent = layers.length === 1 ? ('الطبقة: ' + layers[0].name) : (layers.length + ' طبقات') + (layers[0].src ? ' من ' + layers[0].src.name : '');
      const sample = layers.map(l => firstCoord((l.features.find(f => f.geometry) || {}).geometry)).find(Boolean);
      $('#crsSample').textContent = sample ? 'مثال إحداثيات: X ' + (+sample[0]).toFixed(2) + ' · Y ' + (+sample[1]).toFixed(2) : '';
      const last = store.get('gv_crs') || '32638';
      CRS_CHOICES.forEach(([code, label]) => {
        const b = el('button', 'crs-opt' + (code === last ? ' on' : ''), label);
        b.onclick = () => { store.set('gv_crs', code); done(code); };
        s.appendChild(b);
      });
      const done = v => { $('#crsSheet').classList.remove('open'); $('#scrim').classList.remove('show'); $('#crsSkip').onclick = null; res(v); };
      $('#crsSkip').onclick = () => done(null);
      openSheet('#crsSheet');
    });
  }

  // file opening
  const input = $('#fileInput');
  const dirInput = document.createElement('input'); dirInput.type = 'file'; dirInput.multiple = true; dirInput.hidden = true; dirInput.setAttribute('webkitdirectory', ''); document.body.appendChild(dirInput);
  dirInput.addEventListener('change', () => handleFiles(Array.from(dirInput.files)));
  const canDir = 'webkitdirectory' in dirInput && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  function pickFiles(ev) {
    if (!canDir) { input.value = ''; input.click(); return; }
    let m = document.getElementById('openMenu'); if (m) { m.remove(); return; } m = el('div', 'ctx-menu'); m.id = 'openMenu';
    const it = (t, sub, fn) => { const b = el('button'); b.appendChild(el('div', null, t)); b.appendChild(el('div', 'muted small', sub)); b.onclick = () => { m.remove(); fn(); }; m.appendChild(b); };
    it('📄 ملفات', 'zip · DWG/DXF · SHP · KML · GPKG · Excel/CSV…', () => { input.value = ''; input.click(); });
    it('📁 فولدر كامل', 'فولدر الـ GDB نفسه (من غير ضغط) أو فولدر فيه شيب فايلات وداتا', () => { dirInput.value = ''; dirInput.click(); });
    m.appendChild(el('div', 'ctx-h', 'أو اسحب الملفات أو الفولدر على الخريطة'));
    document.body.appendChild(m);
    const r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : { width: 0 }; const mr = m.getBoundingClientRect();
    if (!r.width) { m.style.left = ((window.innerWidth - mr.width) / 2) + 'px'; m.style.top = ((window.innerHeight - mr.height) / 2) + 'px'; } else { m.style.left = Math.max(6, Math.min(window.innerWidth - mr.width - 6, r.left)) + 'px'; m.style.top = (r.top - mr.height - 8 > 6 ? r.top - mr.height - 8 : Math.min(window.innerHeight - mr.height - 6, r.bottom + 8)) + 'px'; }
    setTimeout(() => { const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
  }
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', pickFiles));
  GV.pickData = ev => pickFiles(ev);
  input.addEventListener('change', () => handleFiles(Array.from(input.files)));
  async function handleFiles(files) {
    if (!files.length) return;
    $('#busy').classList.add('show');
    $('#busyText').textContent = 'جاري قراءة ' + (files.length === 1 ? files[0].name : files.length + ' ملفات') + '…';
    await new Promise(r => setTimeout(r, 30));
    try {
      const entries = files.map(f => ({ name: f.webkitRelativePath || f.name, getBuf: () => f.arrayBuffer(), getText: () => f.text() }));
      const groups = await loadEntries(entries);
      if (!groups.length) { showMsg('الصيغة دي مش مدعومة.\n\nالصيغ المدعومة: File Geodatabase (.gdb مضغوط zip) · GeoPackage · Shapefile · KML/KMZ · GeoJSON · DXF · GPX · CSV'); return; }
      $('#busy').classList.remove('show');
      const added = await addGroups(groups);
      if (autoGrp && added && added.length) groupPerFile(added);
      if (GV.afterOpen) setTimeout(() => GV.afterOpen(added || []), 700);
    } catch (e) { showMsg('حصلت مشكلة أثناء الفتح:\n' + (e.message || e)); }
    finally { $('#busy').classList.remove('show'); }
  }
  // drag & drop (desktop)
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
  // dropped folders (a .gdb folder, a folder of shapefiles…) are read with their inner paths
  async function dropEntries(items) {
    const out = [];
    const walk = async (en, path) => {
      if (en.isFile) { const f = await new Promise((res, rej) => en.file(res, rej)); out.push({ name: f.name, webkitRelativePath: path + f.name, size: f.size, arrayBuffer: () => f.arrayBuffer(), text: () => f.text() }); }
      else if (en.isDirectory) { const rd = en.createReader(); let batch; do { batch = await new Promise((res, rej) => rd.readEntries(res, rej)); for (const c of batch) await walk(c, path + en.name + '/'); } while (batch.length); }
    };
    for (const en of items) if (en) await walk(en, '');
    return out;
  }
  document.addEventListener('drop', async e => {
    e.preventDefault(); document.body.classList.remove('drag');
    const items = Array.from(e.dataTransfer.items || []).map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null);
    if (items.some(x => x && x.isDirectory)) { try { handleFiles(await dropEntries(items)); return; } catch (er) { } }
    handleFiles(Array.from(e.dataTransfer.files || []));
  });

  $('#btnLayers').addEventListener('click', () => { renderLayers(); openSheet('#layerSheet'); });
  $('#btnBase').addEventListener('click', () => openSheet('#baseSheet'));
  $('#btnTools').addEventListener('click', () => openSheet('#toolsSheet'));
  document.querySelectorAll('.base-opt').forEach(b => b.addEventListener('click', () => { tilesOk = null; setBase(b.dataset.k); closeSheets(); }));
  $('#btnZoomAll').addEventListener('click', () => { let b = null; sources.forEach(s => s.layers.forEach(l => { if (l.leaf && l.visible) { const x = l.leaf.getBounds(); if (x.isValid()) b = b ? b.extend(x) : L.latLngBounds(x.getSouthWest(), x.getNorthEast()); } })); if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 }); });
  $('#btnZin').addEventListener('click', () => map.zoomIn()); $('#btnZout').addEventListener('click', () => map.zoomOut());
  let locMarker = null;
  // my location: live tracking (tap again to stop). Inside the Claude page the browser blocks location → point to the GitHub app.
  let locWatch = null, locFirst = true;
  const GH_URL = 'https://ah7medshahin.github.io/gis-viewer/';
  function locHelp(msg, withLink) {
    let b = document.getElementById('baseHelp'); if (b) b.remove(); b = el('div', 'base-help'); b.id = 'baseHelp'; b.appendChild(el('div', null, msg));
    if (withLink) { const a = el('a', null, 'افتح نسخة GitHub'); a.href = GH_URL; a.target = '_blank'; a.rel = 'noopener'; a.style.cssText = 'background:var(--accent);color:#fff;border-radius:10px;padding:8px 12px;text-decoration:none;white-space:nowrap'; b.appendChild(a); }
    const x = el('button', 'icon-btn', '✕'); x.onclick = () => b.remove(); b.appendChild(x); document.body.appendChild(b);
  }
  function stopLoc() { if (locWatch != null) navigator.geolocation.clearWatch(locWatch); locWatch = null; $('#btnLocate').classList.remove('on'); }
  $('#btnLocate').addEventListener('click', () => {
    if (locWatch != null) { stopLoc(); if (locMarker) { map.removeLayer(locMarker); locMarker = null; } toast('وقفت تتبّع الموقع'); return; }
    const inClaude = window.self !== window.top || /claude(usercontent)?\.(ai|com)$/.test(location.hostname);
    if (!navigator.geolocation) return locHelp('المتصفح ده مش بيدعم تحديد الموقع.');
    toast('بحدد موقعك…'); locFirst = true; $('#btnLocate').classList.add('on');
    locWatch = navigator.geolocation.watchPosition(p => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (locMarker) map.removeLayer(locMarker);
      locMarker = L.layerGroup([L.circle(ll, { radius: p.coords.accuracy, color: '#1c7ed6', weight: 1, fillOpacity: 0.1, interactive: false }), L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1c7ed6', fillOpacity: 1, interactive: false })]).addTo(map);
      if (locFirst) { map.setView(ll, Math.max(map.getZoom(), 17)); toast('دقة الموقع ± ' + Math.round(p.coords.accuracy) + ' م — دوس تاني عشان توقف التتبّع', 3500); locFirst = false; }
    }, err => {
      stopLoc();
      if (inClaude) return locHelp('صفحة Claude مش بتسمح بتحديد الموقع. افتح البرنامج من نسخة GitHub (على الموبايل أو اللابتوب) واسمح بالموقع لما يسألك.', true);
      if (err.code === 1) return locHelp('الموقع مقفول للبرنامج. من علامة القفل 🔒 جنب العنوان في المتصفح ← أذونات الموقع (Location) ← سماح، وبعدين جرّب تاني.');
      if (err.code === 2) return locHelp('الجهاز مش عارف يحدد مكانه. شغّل الـ GPS على الموبايل، أو على اللابتوب: الإعدادات ← الخصوصية والأمان ← الموقع ← شغّله واسمح للتطبيقات.');
      locHelp('تحديد الموقع أخد وقت طويل. اطلع مكان مفتوح أو اتأكد إن الـ GPS شغال وجرّب تاني.');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  });
  map.on('click', e => { if (GV.pick) GV.pick(e.latlng); else if (meas) addMeasPt(e.latlng); else clearHL(); });
  // live coordinate readout at map center
  function updCenter() { const c = map.getCenter(); $('#centerXY').textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5); }
  map.on('move', updCenter); updCenter();
  $('#centerXY').addEventListener('click', () => copy($('#centerXY').textContent));


  /* ---------------- thematic styling ---------------- */
  const CAT = ['#1971c2', '#e8590c', '#2f9e44', '#c2255c', '#7048e8', '#f08c00', '#0c8599', '#d6336c', '#5c940d', '#862e9c', '#364fc7', '#a61e4d', '#e67700', '#087f5b', '#4dabf7', '#ff922b', '#51cf66', '#f783ac', '#9775fa'];
  const SEQ = ['#ffd43b', '#ff922b', '#f03e3e', '#c2255c', '#5f3dc4'];
  const NULLC = '#adb5bd';
  const fmtNum = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : String(+(+v).toFixed(2));
  function fieldsOf(l) { const s = new Set(); for (const f of l.features.slice(0, 500)) for (const k in (f.properties || {})) if (!/^(styleUrl|styleHash|styleMapHash|stroke.*|fill.*|marker-color|icon.*|description)$/.test(k)) s.add(k); return Array.from(s); }
  function makeTheme(l, field, mode) {
    const vals = l.features.map(f => f.properties ? f.properties[field] : null);
    const nn = vals.filter(v => v != null && v !== '');
    const isNum = nn.length > 0 && nn.every(v => typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(String(v).trim())));
    const uniq = new Map(); nn.forEach(v => uniq.set(String(v), (uniq.get(String(v)) || 0) + 1));
    const nulls = vals.length - nn.length;
    let classes, fn;
    if (mode !== 'cat' && isNum && (mode === 'num' || uniq.size > 12)) {
      const nums = nn.map(Number).sort((x, y) => x - y);
      const br = []; for (let k = 1; k < 5; k++) br.push(nums[Math.floor(nums.length * k / 5)]);
      const bounds = [nums[0], ...br, nums[nums.length - 1]];
      const uniqB = []; bounds.forEach(b => { if (!uniqB.length || b > uniqB[uniqB.length - 1]) uniqB.push(b); });
      const nCls = Math.max(1, uniqB.length - 1);
      const cls = []; for (let k = 0; k < nCls; k++) cls.push({ min: uniqB[k], max: uniqB[k + 1] !== undefined ? uniqB[k + 1] : uniqB[k], color: SEQ[Math.round(k * (SEQ.length - 1) / Math.max(1, nCls - 1))], count: 0 });
      const pick = v => { for (let k = 0; k < cls.length; k++) if (v <= cls[k].max || k === cls.length - 1) return cls[k]; };
      nn.forEach(v => pick(Number(v)).count++);
      classes = cls.map(c => ({ label: fmtNum(c.min) + ' – ' + fmtNum(c.max), color: c.color, count: c.count }));
      fn = f => { const v = f.properties ? f.properties[field] : null; return v == null || v === '' ? NULLC : pick(Number(v)).color; };
    } else {
      const sorted = Array.from(uniq.entries()).sort((x, y) => y[1] - x[1]);
      const cmap = new Map(); classes = [];
      sorted.forEach(([v, c], k) => { if (k < CAT.length) { cmap.set(v, CAT[k]); classes.push({ label: v, color: CAT[k], count: c }); } });
      const rest = sorted.slice(CAT.length).reduce((s, x) => s + x[1], 0);
      if (rest) classes.push({ label: 'قيم تانية (' + (sorted.length - CAT.length) + ')', color: '#868e96', count: rest });
      fn = f => { const v = f.properties ? f.properties[field] : null; if (v == null || v === '') return NULLC; return cmap.get(String(v)) || '#868e96'; };
    }
    if (nulls) classes.push({ label: '(فاضي)', color: NULLC, count: nulls });
    return { field, fn, classes, numeric: isNum };
  }
  function rebuild(l) { if (l.leaf) map.removeLayer(l.leaf); l.leaf = buildLeaf(l); if (l.visible) l.leaf.addTo(map); if (l.noSelect) applySel(l); }
  let styleLayer = null;
  function openStyle(l, fromList) {
    styleLayer = l;
    $('#styTitle').textContent = l.name;
    const sel = $('#styField'); sel.textContent = '';
    const o0 = el('option', null, '— لون واحد —'); o0.value = ''; sel.appendChild(o0);
    fieldsOf(l).forEach(k => { const o = el('option', null, k); o.value = k; sel.appendChild(o); });
    sel.value = l.theme ? l.theme.field : '';
    const ls = $('#styLabel'); ls.textContent = ''; const n0 = el('option', null, '— بدون ليبل —'); n0.value = ''; ls.appendChild(n0);
    fieldsOf(l).forEach(k => { const o = el('option', null, k); o.value = k; ls.appendChild(o); });
    ls.value = l.labelField || '';
    $('#styMode').value = l.theme ? (l.theme.mode || 'auto') : 'auto';
    renderLegend(); openSheet('#styleSheet', fromList ? { back: '#layerSheet' } : null);
  }
  function renderLegend() {
    const l = styleLayer, box = $('#styLegend'); box.textContent = '';
    $('#styModeRow').style.display = l.theme && l.theme.numeric ? '' : 'none';
    if (!l.theme) { box.appendChild(el('p', 'muted small', 'اختار حقل علشان العناصر تتلون حسب قيمته (مثلاً المادة أو القطر).')); return; }
    l.theme.classes.forEach(c => { const r = el('div', 'leg'); const s = el('span', 'leg-c'); s.style.background = c.color; r.append(s, el('span', 'leg-l', c.label), el('span', 'leg-n', c.count.toLocaleString('en'))); box.appendChild(r); });
  }
  function applyStyle() {
    const l = styleLayer, field = $('#styField').value, mode = $('#styMode').value;
    if (!field) l.theme = null; else { l.theme = makeTheme(l, field, mode); l.theme.mode = mode; }
    rebuild(l); renderLegend(); renderLayers(); dirty();
  }
  $('#styField').addEventListener('change', () => { $('#styMode').value = 'auto'; applyStyle(); });
  $('#styMode').addEventListener('change', applyStyle);
  $('#styLabel').addEventListener('change', () => { styleLayer.labelField = $('#styLabel').value || null; refreshLabels(); renderLayers(); dirty(); });

  /* ---------------- labels ---------------- */
  const labelGroup = L.layerGroup().addTo(map);
  const MAX_LABELS = 600;
  function labelAnchor(g) {
    if (!g) return null;
    const t = g.type;
    if (t === 'Point') return g.coordinates;
    if (t === 'MultiPoint') return g.coordinates[0];
    if (t === 'LineString' || t === 'MultiLineString') { const l = t === 'LineString' ? g.coordinates : g.coordinates[0]; if (!l || !l.length) return null; if (l.length === 2) return [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]; return l[Math.floor(l.length / 2)]; }
    if (t === 'Polygon' || t === 'MultiPolygon') { const r = t === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]; let x = 0, y = 0, n = r.length - 1 || 1; for (let i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; } return [x / n, y / n]; }
    return firstCoord(g);
  }
  function lumin(hex) { const h = String(hex).replace('#', ''); if (h.length < 6) return 0.5; const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255; return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function refreshLabels() {
    labelGroup.clearLayers();
    const bounds = map.getBounds().pad(0.05);
    let count = 0, skipped = false; const occ = new Set();
    // CAD annotation (text drawn at its real size and angle)
    const z = map.getZoom(), cLat = map.getCenter().lat;
    const mpp = 40075016.686 * Math.cos(cLat * Math.PI / 180) / Math.pow(2, z + 8);
    let annoN = 0, tinyN = 0;
    for (const s of sources) {
      if (!s.isCad || s.anno === false) continue;
      for (const l of s.layers) {
        if (!l.visible || !l.leaf) continue;
        const sc = l.annoScale || 1;
        for (const f of l.features) {
          const t = f.properties && f.properties.Text; if (t == null || t === '' || !f.wgs || !f.wgs.geometry) continue;
          if (!f._lbl) { const c = f.wgs.geometry.coordinates; f._lbl = L.latLng(c[1], c[0]); }
          if (!bounds.contains(f._lbl)) continue;
          const hM = (f.properties.Height || 0) * sc;
          let px = hM > 0 ? hM / mpp : 11;
          const TL = String(t).split('\n'); const longest = TL.reduce((a, x) => Math.max(a, x.length), 0);
          if (px < 4) { if (px >= 0.6 && tinyN < 4000) { tinyN++; const w = Math.max(2, longest * px * 0.62); const d = document.createElement('div'); d.className = 'anno-tiny'; d.style.width = w.toFixed(1) + 'px'; d.style.height = Math.max(1, px * (TL.length > 1 ? 1.667 * TL.length - 0.667 : 0.7)).toFixed(1) + 'px'; d.style.background = f._color || l.color || '#333'; const rot = -(f.properties.Rotation || 0); d.style.transform = 'translateY(-100%)' + (rot ? ' rotate(' + rot + 'deg)' : ''); L.marker(f._lbl, { icon: L.divIcon({ className: 'lbl-wrap', html: d, iconSize: null }), interactive: false, keyboard: false }).addTo(labelGroup); } continue; }
          if (annoN > 2500) { skipped = true; break; }
          px = Math.min(px, 72);
          const d = document.createElement('div'); d.className = 'anno'; d.textContent = TL.slice(0, 30).map(x => x.slice(0, 120)).join('\n');
          // CAD text height is the capital-letter height; a line of MTEXT takes 5/3 of it
          d.style.fontSize = (px * 1.4).toFixed(1) + 'px'; d.style.lineHeight = (px * 1.667).toFixed(1) + 'px'; if (TL.length > 1) d.style.whiteSpace = 'pre';
          const col = f._color || l.color || '#333'; d.style.color = lumin(col) > 0.72 ? '#334' : col;
          const rot = -(f.properties.Rotation || 0); const al = f.properties.Align, va = f.properties.VAlign; const tx = al === 'c' ? '-50%' : al === 'r' ? '-100%' : '0'; const ty = va === 'm' ? '-50%' : va === 't' ? '0' : '-100%'; if (al || va) d.style.transformOrigin = (al === 'c' ? '50%' : al === 'r' ? '100%' : '0') + ' ' + (va === 'm' ? '50%' : va === 't' ? '0' : '100%'); if (rot || al || va) d.style.transform = 'translate(' + tx + ',' + ty + ')' + (rot ? ' rotate(' + rot + 'deg)' : '');
          L.marker(f._lbl, { icon: L.divIcon({ className: 'lbl-wrap', html: d, iconSize: null }), interactive: false, keyboard: false }).addTo(labelGroup);
          annoN++;
        }
      }
    }
    for (const s of sources) for (const l of s.layers) {
      if (!l.labelField || !l.visible || !l.leaf) continue;
      for (const f of l.features) {
        if (!f.wgs || !f.wgs.geometry) continue;
        if (!f._lbl) { const c = labelAnchor(f.wgs.geometry); f._lbl = c ? L.latLng(c[1], c[0]) : null; }
        if (!f._lbl || !bounds.contains(f._lbl)) continue;
        const v = f.properties ? f.properties[l.labelField] : null;
        if (v == null || v === '') continue;
        if (count >= MAX_LABELS) { skipped = true; break; }
        const sp = map.latLngToContainerPoint(f._lbl); const ck = Math.round(sp.x / 70) + ':' + Math.round(sp.y / 22);
        if (occ.has(ck)) { skipped = true; continue; } occ.add(ck);
        const d = document.createElement('div'); d.className = 'lbl' + (l.kind === 'point' ? ' pt' : ''); d.textContent = typeof v === 'number' && !Number.isInteger(v) ? String(+v.toFixed(2)) : String(v).slice(0, 40);
        d.style.setProperty('--lc', l.labelColor || l.color);
        L.marker(f._lbl, { icon: L.divIcon({ className: 'lbl-wrap', html: d, iconSize: null }), interactive: false, keyboard: false }).addTo(labelGroup);
        count++;
      }
    }
    $('#lblNote').textContent = skipped ? 'الليبلز كتير، كبّر علشان تشوفها كلها' : 'فيه كتابة صغيرة (الشرط الرمادي) — كبّر علشان تقراها'; $('#lblNote').classList.toggle('show', skipped || tinyN > 0);
  }
  map.on('moveend', refreshLabels);

  /* ---------------- measure ---------------- */
  let meas = null;
  function snapTo(f, ll) {
    if (!f.wgs || !f.wgs.geometry) return ll;
    const p0 = map.latLngToContainerPoint(ll); let best = null, bd = 22;
    const visit = c => { if (typeof c[0] === 'number') { const q = map.latLngToContainerPoint([c[1], c[0]]); const d = q.distanceTo(p0); if (d < bd) { bd = d; best = L.latLng(c[1], c[0]); } } else c.forEach(visit); };
    try { visit(f.wgs.geometry.coordinates); } catch (e) { }
    return best || ll;
  }
  function startMeasure() { closeSheets(); clearHL(); if (meas) return endMeasure(); meas = { pts: [], area: false, grp: L.layerGroup().addTo(map) }; document.body.classList.add('measuring'); drawMeas(); }
  function endMeasure() { if (meas) map.removeLayer(meas.grp); meas = null; document.body.classList.remove('measuring'); }
  function addMeasPt(ll) { meas.pts.push(L.latLng(ll.lat, ll.lng)); drawMeas(); }
  function drawMeas() {
    const m = meas; m.grp.clearLayers();
    const ll = m.pts;
    if (m.area && ll.length >= 3) L.polygon(ll, { color: '#f03e3e', weight: 3, dashArray: '6 6', fillOpacity: 0.15, interactive: false }).addTo(m.grp);
    else if (ll.length >= 2) L.polyline(ll, { color: '#f03e3e', weight: 3, dashArray: '6 6', interactive: false }).addTo(m.grp);
    ll.forEach((p, k) => L.circleMarker(p, { radius: k === ll.length - 1 ? 7 : 5, color: '#fff', weight: 2, fillColor: '#f03e3e', fillOpacity: 1, interactive: false }).addTo(m.grp));
    let tot = 0; for (let k = 1; k < ll.length; k++) tot += ll[k - 1].distanceTo(ll[k]);
    const last = ll.length >= 2 ? ll[ll.length - 2].distanceTo(ll[ll.length - 1]) : 0;
    if (m.area && ll.length >= 3) { tot += ll[ll.length - 1].distanceTo(ll[0]); }
    $('#measMain').textContent = ll.length < 2 ? 'اضغط على الخريطة لإضافة نقطة' : (m.area && ll.length >= 3 ? 'المساحة: ' + fmtArea(ringA([...ll, ll[0]].map(p => [p.lng, p.lat]))) : 'المسافة: ' + fmtLen(tot));
    $('#measSub').textContent = ll.length < 2 ? 'بيلقط على رؤوس الخطوط والنقط لو ضغطت جنبها' : (m.area && ll.length >= 3 ? 'المحيط: ' + fmtLen(tot) : 'آخر جزء: ' + fmtLen(last)) + ' · ' + ll.length + ' نقط';
    $('#measArea').classList.toggle('on', m.area);
  }
  $('#btnMeasure').addEventListener('click', startMeasure);
  $('#measDone').addEventListener('click', endMeasure);
  $('#measUndo').addEventListener('click', () => { meas.pts.pop(); drawMeas(); });
  $('#measClear').addEventListener('click', () => { meas.pts = []; drawMeas(); });
  $('#measArea').addEventListener('click', () => { meas.area = !meas.area; drawMeas(); });

  setBase(BASEMAPS[baseKey] ? baseKey : 'osm');
  updateEmpty();
  Object.assign(GV, { applyOrder, removeLayers, zoomLayer, markSel, workCopy, liveLayer, superseded, handleFiles, sources, map, addGroups, toast, showMsg, openSheet, closeSheets: () => closeSheets('prog'), goBack, renderLayers, updateEmpty, resolveCRS, epsgDef, mapCoords, firstCoord, el, $, buildLeaf, rebuild, applyCRS, fmtLen, fmtArea, ringA, lineLen, polyArea, store, CRS_CHOICES, PALETTE, setVis, showFeature, clearHL, snapTo, fieldsOf, copy, geomKind, openTable, makeTheme, setBase, getBase: () => baseKey, removeSource: src => { src.layers.forEach(l => l.leaf && map.removeLayer(l.leaf)); sources.splice(sources.indexOf(src), 1); }, refreshLabels: () => refreshLabels() });
  document.dispatchEvent(new Event('gv-ready'));
})();
