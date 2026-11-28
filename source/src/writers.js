// Writers: GeoJSON, KML/KMZ, Shapefile, CSV, DXF, GeoPackage. Input layers: [{name, color, fields:[...], features:[{properties, geometry}]}]
(function (root) {
  'use strict';
  const enc = new TextEncoder();

  /* ---------- CRS WKT for .prj / gpkg ---------- */
  const GCS_WGS = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const GCS_AEA = 'GEOGCS["GCS_Ain_el_Abd_1970",DATUM["D_Ain_el_Abd_1970",SPHEROID["International_1924",6378388.0,297.0]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  function utmWKT(name, gcs, zone, south) {
    return 'PROJCS["' + name + '",' + gcs + ',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",' + (south ? '10000000.0' : '0.0') + '],PARAMETER["Central_Meridian",' + (-183 + 6 * zone) + '.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
  }
  function wktForEPSG(code) {
    const n = +code;
    if (n === 4326) return GCS_WGS;
    if (n === 4204) return GCS_AEA;
    if (n >= 32601 && n <= 32660) return utmWKT('WGS_1984_UTM_Zone_' + (n - 32600) + 'N', GCS_WGS, n - 32600, false);
    if (n >= 32701 && n <= 32760) return utmWKT('WGS_1984_UTM_Zone_' + (n - 32700) + 'S', GCS_WGS, n - 32700, true);
    if (n >= 20436 && n <= 20440) return utmWKT('Ain_el_Abd_UTM_Zone_' + (n - 20400) + 'N', GCS_AEA, n - 20400, false);
    return null;
  }

  /* ---------- geometry helpers ---------- */
  const fam = g => !g ? null : g.type.replace('Multi', '');
  function polys(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
  function lines(g) { return g.type === 'LineString' ? [g.coordinates] : g.coordinates; }
  function pts(g) { return g.type === 'Point' ? [g.coordinates] : g.coordinates; }
  function signedArea(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
  function closeRing(r) { const a = r[0], b = r[r.length - 1]; return (a[0] === b[0] && a[1] === b[1]) ? r : r.concat([a]); }
  function explode(g) { if (!g) return []; if (g.type === 'GeometryCollection') return g.geometries.flatMap(explode); return [g]; }
  const isNum = v => typeof v === 'number' && isFinite(v);

  function toWKT(g) {
    if (!g) return '';
    const c = p => p.slice(0, p.length > 2 && p[2] != null ? 3 : 2).join(' ');
    const ring = r => '(' + r.map(c).join(', ') + ')';
    switch (g.type) {
      case 'Point': return 'POINT (' + c(g.coordinates) + ')';
      case 'MultiPoint': return 'MULTIPOINT (' + g.coordinates.map(p => '(' + c(p) + ')').join(', ') + ')';
      case 'LineString': return 'LINESTRING ' + ring(g.coordinates);
      case 'MultiLineString': return 'MULTILINESTRING (' + g.coordinates.map(ring).join(', ') + ')';
      case 'Polygon': return 'POLYGON (' + g.coordinates.map(ring).join(', ') + ')';
      case 'MultiPolygon': return 'MULTIPOLYGON (' + g.coordinates.map(p => '(' + p.map(ring).join(', ') + ')').join(', ') + ')';
      case 'GeometryCollection': return 'GEOMETRYCOLLECTION (' + g.geometries.map(toWKT).join(', ') + ')';
    }
    return '';
  }

  function toWKB(g) {
    // little-endian ISO WKB, 2D
    const parts = [];
    const u8 = v => parts.push(Uint8Array.of(v));
    const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); parts.push(b); };
    const pt = p => { const b = new Uint8Array(16); const d = new DataView(b.buffer); d.setFloat64(0, p[0], true); d.setFloat64(8, p[1], true); parts.push(b); };
    const T = { Point: 1, LineString: 2, Polygon: 3, MultiPoint: 4, MultiLineString: 5, MultiPolygon: 6, GeometryCollection: 7 };
    (function w(g) {
      u8(1); u32(T[g.type]);
      switch (g.type) {
        case 'Point': pt(g.coordinates); break;
        case 'LineString': u32(g.coordinates.length); g.coordinates.forEach(pt); break;
        case 'Polygon': u32(g.coordinates.length); g.coordinates.forEach(r => { u32(r.length); r.forEach(pt); }); break;
        case 'MultiPoint': u32(g.coordinates.length); g.coordinates.forEach(p => w({ type: 'Point', coordinates: p })); break;
        case 'MultiLineString': u32(g.coordinates.length); g.coordinates.forEach(p => w({ type: 'LineString', coordinates: p })); break;
        case 'MultiPolygon': u32(g.coordinates.length); g.coordinates.forEach(p => w({ type: 'Polygon', coordinates: p })); break;
        case 'GeometryCollection': u32(g.geometries.length); g.geometries.forEach(w); break;
      }
    })(g);
    return concat(parts);
  }
  function concat(parts) { let n = 0; parts.forEach(p => n += p.length); const o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; }
  function bbox(features) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = c => { if (typeof c[0] === 'number') { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; } else c.forEach(v); };
    features.forEach(f => { explode(f.geometry).forEach(g => v(g.coordinates)); });
    return isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0];
  }
  const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'layer';

  /* ---------- GeoJSON ---------- */
  function geojson(layer, epsg) {
    const fc = { type: 'FeatureCollection', name: layer.name };
    if (epsg && +epsg !== 4326) fc.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::' + epsg } };
    fc.features = layer.features.map(f => ({ type: 'Feature', properties: f.properties, geometry: f.geometry || null }));
    return JSON.stringify(fc);
  }

  /* ---------- CSV ---------- */
  function csv(layer) {
    const cols = layer.fields;
    const allPts = layer.features.every(f => !f.geometry || f.geometry.type === 'Point');
    const head = cols.slice(); if (allPts) head.push('X', 'Y'); else head.push('WKT');
    const q = v => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [head.map(q).join(',')];
    for (const f of layer.features) {
      const r = cols.map(c => q(f.properties[c]));
      if (allPts) { const c = f.geometry ? f.geometry.coordinates : null; r.push(c ? c[0] : '', c ? c[1] : ''); }
      else r.push(q(toWKT(f.geometry)));
      rows.push(r.join(','));
    }
    return '﻿' + rows.join('\r\n');
  }

  /* ---------- KML ---------- */
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function kmlColor(hex, a) { hex = (hex || '#0e7c86').replace('#', ''); return a + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2); }
  function kml(layers, labelField, kopts) {
    const c = p => p[0] + ',' + p[1] + (p.length > 2 && p[2] != null ? ',' + p[2] : '');
    const geo = g => {
      switch (g.type) {
        case 'Point': return '<Point><coordinates>' + c(g.coordinates) + '</coordinates></Point>';
        case 'LineString': return '<LineString><tessellate>1</tessellate><coordinates>' + g.coordinates.map(c).join(' ') + '</coordinates></LineString>';
        case 'Polygon': return '<Polygon>' + g.coordinates.map((r, i) => (i ? '<innerBoundaryIs>' : '<outerBoundaryIs>') + '<LinearRing><coordinates>' + closeRing(r).map(c).join(' ') + '</coordinates></LinearRing>' + (i ? '</innerBoundaryIs>' : '</outerBoundaryIs>')).join('') + '</Polygon>';
        case 'MultiPoint': return '<MultiGeometry>' + g.coordinates.map(p => geo({ type: 'Point', coordinates: p })).join('') + '</MultiGeometry>';
        case 'MultiLineString': return '<MultiGeometry>' + g.coordinates.map(p => geo({ type: 'LineString', coordinates: p })).join('') + '</MultiGeometry>';
        case 'MultiPolygon': return '<MultiGeometry>' + g.coordinates.map(p => geo({ type: 'Polygon', coordinates: p })).join('') + '</MultiGeometry>';
        case 'GeometryCollection': return '<MultiGeometry>' + g.geometries.map(geo).join('') + '</MultiGeometry>';
      }
      return '';
    };
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' + (kopts && kopts.name ? '<name>' + xe(kopts.name) + '</name>' : '');
    layers.forEach((l, i) => {
      out += '<Style id="s' + i + '"><IconStyle><color>' + kmlColor(l.color, 'ff') + '</color><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LineStyle><color>' + kmlColor(l.color, 'ff') + '</color><width>3</width></LineStyle><PolyStyle><color>' + kmlColor(l.color, '55') + '</color></PolyStyle></Style>';
    });
    layers.forEach((l, i) => {
      out += '<Folder><name>' + xe(l.name) + '</name>';
      const lf = labelField && l.fields.indexOf(labelField) >= 0 ? labelField : null;
      for (const f of l.features) {
        if (!f.geometry) continue;
        const nm = lf ? f.properties[lf] : (f.properties.name || f.properties.Name || f.properties.NAME);
        out += '<Placemark>' + (nm != null ? '<name>' + xe(nm) + '</name>' : '') + '<styleUrl>#s' + i + '</styleUrl><ExtendedData>';
        for (const k of l.fields) { const v = f.properties[k]; if (v != null) out += '<Data name="' + xe(k) + '"><value>' + xe(v) + '</value></Data>'; }
        out += '</ExtendedData>' + geo(f.geometry) + '</Placemark>';
      }
      out += '</Folder>';
    });
    return out + '</Document></kml>';
  }

  /* ---------- Shapefile ---------- */
  function shapefiles(layer, prjWkt) {
    // split by geometry family
    const groups = {};
    for (const f of layer.features) {
      const gs = explode(f.geometry);
      const fm = gs.length ? fam(gs[0]) : 'None';
      (groups[fm] = groups[fm] || []).push(f);
    }
    const keys = Object.keys(groups).filter(k => k !== 'None');
    if (!keys.length) keys.push('None');
    const out = [];
    for (const k of keys) {
      const feats = k === 'None' ? (groups.None || []) : groups[k];
      const name = safeName(layer.name) + (keys.length > 1 ? '_' + k.toLowerCase() : '');
      const st = { Point: 1, LineString: 3, Polygon: 5, None: 0 }[k];
      const multiPt = k === 'Point' && feats.some(f => f.geometry && f.geometry.type === 'MultiPoint');
      const shapeType = multiPt ? 8 : st;
      const recs = feats.map(f => shpRecord(shapeType, f.geometry));
      const shpLen = 100 + recs.reduce((a, r) => a + 8 + r.length, 0);
      const shp = new Uint8Array(shpLen), shx = new Uint8Array(100 + 8 * recs.length);
      const bb = bbox(feats);
      [shp, shx].forEach((b, i) => { const d = new DataView(b.buffer); d.setInt32(0, 9994, false); d.setInt32(24, (i ? b.length : shpLen) / 2, false); d.setInt32(28, 1000, true); d.setInt32(32, shapeType, true); d.setFloat64(36, bb[0], true); d.setFloat64(44, bb[1], true); d.setFloat64(52, bb[2], true); d.setFloat64(60, bb[3], true); });
      const ds = new DataView(shp.buffer), dx = new DataView(shx.buffer);
      let off = 100;
      recs.forEach((r, i) => { ds.setInt32(off, i + 1, false); ds.setInt32(off + 4, r.length / 2, false); shp.set(r, off + 8); dx.setInt32(100 + i * 8, off / 2, false); dx.setInt32(104 + i * 8, r.length / 2, false); off += 8 + r.length; });
      out.push({ name: name + '.shp', data: shp }, { name: name + '.shx', data: shx }, { name: name + '.dbf', data: dbf(layer.fields, feats) }, { name: name + '.cpg', data: 'UTF-8' });
      if (prjWkt) out.push({ name: name + '.prj', data: prjWkt });
      if (st === 0) return out.filter(f => /\.(dbf|cpg)$/.test(f.name));
    }
    return out;
  }
  function shpRecord(type, g) {
    if (!g || type === 0) return new Uint8Array(4);
    const gs = explode(g);
    if (type === 1) { const b = new Uint8Array(20); const d = new DataView(b.buffer); const c = pts(gs[0])[0]; d.setInt32(0, 1, true); d.setFloat64(4, c[0], true); d.setFloat64(12, c[1], true); return b; }
    let parts = [];
    if (type === 8) { const all = gs.flatMap(pts); const b = new Uint8Array(40 + 16 * all.length); const d = new DataView(b.buffer); const bb = bbox([{ geometry: { type: 'MultiPoint', coordinates: all } }]); d.setInt32(0, 8, true); [0, 1, 2, 3].forEach(i => d.setFloat64(4 + i * 8, bb[i], true)); d.setInt32(36, all.length, true); all.forEach((p, i) => { d.setFloat64(40 + i * 16, p[0], true); d.setFloat64(48 + i * 16, p[1], true); }); return b; }
    if (type === 3) parts = gs.flatMap(lines);
    if (type === 5) gs.flatMap(polys).forEach(p => p.forEach((r, i) => { r = closeRing(r); const a = signedArea(r); const wantCW = i === 0; if ((wantCW && a > 0) || (!wantCW && a < 0)) r = r.slice().reverse(); parts.push(r); }));
    const np = parts.reduce((a, p) => a + p.length, 0);
    const b = new Uint8Array(44 + 4 * parts.length + 16 * np); const d = new DataView(b.buffer);
    const bb = bbox([{ geometry: { type: 'MultiLineString', coordinates: parts } }]);
    d.setInt32(0, type, true); [0, 1, 2, 3].forEach(i => d.setFloat64(4 + i * 8, bb[i], true)); d.setInt32(36, parts.length, true); d.setInt32(40, np, true);
    let k = 0, off = 44 + 4 * parts.length;
    parts.forEach((p, i) => { d.setInt32(44 + i * 4, k, true); p.forEach(c => { d.setFloat64(off, c[0], true); d.setFloat64(off + 8, c[1], true); off += 16; }); k += p.length; });
    return b;
  }
  function dbf(fields, feats) {
    // field defs
    const used = new Set();
    const defs = fields.map((f, i) => {
      let n = String(f).replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 10) || ('F' + (i + 1));
      let base = n, k = 1; while (used.has(n.toUpperCase())) { const s = String(k++); n = base.slice(0, 10 - s.length) + s; }
      used.add(n.toUpperCase());
      const vals = feats.map(ft => ft.properties[f]).filter(v => v != null && v !== '');
      const numeric = vals.length > 0 && vals.every(isNum);
      if (numeric) {
        const ints = vals.every(v => Number.isInteger(v));
        return { src: f, name: n, type: 'N', len: ints ? 18 : 24, dec: ints ? 0 : 8 };
      }
      let len = 1; vals.forEach(v => { const l = enc.encode(String(v)).length; if (l > len) len = l; });
      return { src: f, name: n, type: 'C', len: Math.min(254, len), dec: 0 };
    });
    const recLen = 1 + defs.reduce((a, d) => a + d.len, 0);
    const hLen = 32 + 32 * defs.length + 1;
    const b = new Uint8Array(hLen + recLen * feats.length + 1);
    const d = new DataView(b.buffer); const now = new Date();
    b[0] = 3; b[1] = now.getFullYear() - 1900; b[2] = now.getMonth() + 1; b[3] = now.getDate();
    d.setUint32(4, feats.length, true); d.setUint16(8, hLen, true); d.setUint16(10, recLen, true); b[29] = 0;
    defs.forEach((f, i) => { const o = 32 + i * 32; b.set(enc.encode(f.name), o); b[o + 11] = f.type.charCodeAt(0); b[o + 16] = f.len; b[o + 17] = f.dec; });
    b[hLen - 1] = 0x0d;
    let o = hLen;
    feats.forEach(ft => {
      b[o] = 0x20; let p = o + 1;
      defs.forEach(f => {
        const v = ft.properties[f.src]; let bytes;
        if (f.type === 'N') { const s = v == null || v === '' ? '' : (f.dec ? Number(v).toFixed(f.dec) : String(Math.round(v))); bytes = enc.encode(s.padStart(f.len, ' ').slice(-f.len)); }
        else { let s = v == null ? '' : String(v); bytes = enc.encode(s); if (bytes.length > f.len) { let cut = f.len; while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--; bytes = bytes.slice(0, cut); } const pad = new Uint8Array(f.len).fill(0x20); pad.set(bytes); bytes = pad; }
        b.set(bytes, p); p += f.len;
      });
      o += recLen;
    });
    b[o] = 0x1a;
    return b;
  }

  /* ---------- DXF (R12) with CAD-standard options ---------- */
  // full AutoCAD Color Index palette (approximation of the standard 256 colors)
  const ACI_PAL = (() => {
    const p = [null, [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
    const hsv = (h, s, v) => { const f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); return [f(5), f(3), f(1)].map(x => Math.round(x * 255)); };
    const V = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3], S = [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5];
    for (let i = 10; i < 250; i++) { const h = (Math.floor(i / 10) - 1) * 15, k = i % 10; p[i] = hsv(h, S[k], V[k]); }
    for (let i = 250; i < 256; i++) { const g = Math.round(51 + (i - 250) * 40.8); p[i] = [g, g, g]; }
    return p;
  })();
  function aci(hex) {
    if (!hex) return 7; const h = String(hex).replace('#', ''); if (h.length < 6) return 7;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (r > 240 && g > 240 && b > 240) return 7;
    let best = 7, bd = 1e9; for (let i = 1; i < 256; i++) { const c = ACI_PAL[i]; if (!c || i === 7) continue; const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  const DISTINCT_ACI = [1, 5, 3, 30, 6, 4, 2, 140, 200, 40, 94, 12, 174, 220, 60, 112, 8];
  const dxfText = s => String(s).replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const dxfLayer = s => String(s).replace(/[<>\/\\":;?*|=,`]/g, '_').replace(/\s+/g, '_').slice(0, 250) || '0';
  function cadLayerName(pattern, layer, props, pad) {
    const out = String(pattern || '{LAYER}').replace(/\{([^}:]+)(?::(\d+))?\}/g, (m, k, p) => {
      const has = props && props[k] != null && props[k] !== ''; if (k !== 'LAYER' && !(props && k in props)) return layer; let v = k === 'LAYER' ? layer : (has ? props[k] : 'NA');
      const n = p != null ? +p : (k === 'LAYER' ? 0 : pad || 0);
      if (n && /^-?\d+(\.\d+)?$/.test(String(v))) v = String(Math.round(+v)).padStart(n, '0');
      return String(v);
    });
    return dxfLayer(out.toUpperCase() === out ? out : out);
  }
  const tagName = (s, used) => { let t = String(s).toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+/, '').slice(0, 31) || 'F'; let b = t, k = 2; while (used.has(t)) t = b.slice(0, 28) + '_' + k++; used.add(t); return t; };
  function dxf(layers, opts, legacyTextH) {
    if (typeof opts === 'string' || opts == null) opts = { labelField: opts || null, textH: legacyTextH || 1 };
    const o = Object.assign({ mode: 'layer', pattern: '{LAYER}', pad: 0, colorMode: 'layer', colorField: '', labelField: null, textH: 1, textSuffix: '', alignText: true, points: 'point', symSize: 1, attrs: false, z3d: false, anno: [], annoH: null }, opts);
    // sheet scale first: symbol + annotation sizes follow the plotted scale (like 2 m text at 1:500 on A1)
    let SHEET_S = null;
    if (o.sheet) { let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity; const ex2 = c => { if (typeof c[0] === 'number') { if (isFinite(c[0]) && isFinite(c[1])) { X0 = Math.min(X0, c[0]); Y0 = Math.min(Y0, c[1]); X1 = Math.max(X1, c[0]); Y1 = Math.max(Y1, c[1]); } } else c.forEach(ex2); }; layers.forEach(l => l.features.forEach(f => { if (f.geometry && f.geometry.coordinates) ex2(f.geometry.coordinates); }));
      const MW = 841 - 125 - 25, MH = 594 - 25; const SC = [200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000];
      if (isFinite(X0)) { SHEET_S = o.sheet.scale || 500; const kk = SHEET_S / 1000; o.symSize = 2.4 * kk; o.annoH = 4 * kk; o.textH = 2.5 * kk; if (o.sheet.tile) o._mapArea = [o.sheet.tile.x0, o.sheet.tile.y0, o.sheet.tile.x0 + o.sheet.tile.w, o.sheet.tile.y0 + o.sheet.tile.h]; } }
    const ANNO = (o.anno || []).filter(Boolean); const aH = o.annoH || o.textH * 0.6; const aLH = aH * 1.45;
    const L = []; const w = (c, v) => { L.push(String(c)); L.push(String(v)); };
    const layerDefs = new Map(); // name -> aci
    const valColor = new Map(); let vc = 0;
    const colorFor = (l, f) => {
      if (o.colorMode === 'field' && o.colorField) { const v = String(f.properties[o.colorField]); if (!valColor.has(v)) valColor.set(v, DISTINCT_ACI[vc++ % DISTINCT_ACI.length]); return valColor.get(v); }
      if (o.colorMode === 'feature') return aci(f.color || l.color);
      return aci(l.color);
    };
    // drawing standard (NCS names, APWA colours, lineweight by diameter, annotation per element)
    const layerMeta = new Map(); const NOLAB = { n: 0 }; const STY = new Map(); const PLAB = [], LLAB = [], PTS = [];
    const styOf = l => { if (!o.styleFor) return null; if (!STY.has(l)) STY.set(l, o.styleFor(l)); return STY.get(l); };
    const diaOf = p => { const k = Object.keys(p || {}).find(x => /^(diameter|pipe_size|dia)$/i.test(x)); const v = k ? parseFloat(p[k]) : NaN; return isFinite(v) && v > 0 ? v : NaN; };
    const nameFor0 = (l, f) => o.mode === 'layer' && !/\{/.test(o.pattern) ? dxfLayer(l.name) : cadLayerName(o.mode === 'layer' ? (o.pattern || '{LAYER}') : o.pattern, l.name, f.properties, o.pad);
    const nameFor = (l, f) => { const S = styOf(l); if (!S) return nameFor0(l, f); const d = S.byDia || S.el === 'SERV' ? diaOf(f.properties) : NaN; const n = dxfLayer((isFinite(d) ? S.name + '-' + String(Math.round(d)).padStart(4, '0') : S.name) + (S.status || '')); if (!layerMeta.has(n)) layerMeta.set(n, { lt: S.lt, lw: isFinite(d) && o.lwForDia && S.el !== 'SERV' ? o.lwForDia(d) : S.lw }); if (!layerDefs.has(n)) { layerDefs.set(n, o.cadColor ? o.cadColor(S, d) : S.aci); } return n; };
    // blocks for point layers
    const blocks = []; const usedB = new Set();
    const ents = [];
    const E = (fn) => ents.push(fn);
    const poly = (ln, r, closed, col) => E(() => { w(0, 'POLYLINE'); w(8, ln); if (col) w(62, col); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, (closed ? 1 : 0) | (o.z3d ? 8 : 0)); r.forEach(p => { w(0, 'VERTEX'); w(8, ln); w(10, p[0]); w(20, p[1]); w(30, o.z3d && p[2] != null ? p[2] : 0); if (o.z3d) w(70, 32); }); w(0, 'SEQEND'); w(8, ln); });
    layers.forEach((l, li) => {
      let blk = null, tags = null;
      const bname0 = tagName('SYM_' + l.name, new Set()).slice(0, 31) + (li ? '_' + li : ''); const isPt = l.features.some(f => f.geometry && fam(explode(f.geometry)[0] || { type: '' }) === 'Point') || !!(o.sheet && o.sheet.rows && o.sheet.rows.some(r => r.block === bname0));
      if (isPt && o.points === 'block') {
        const used = new Set(); tags = (o.attrs ? l.fields : []).map(k => [k, tagName(k, used)]);
        blk = { name: tagName('SYM_' + l.name, new Set()).slice(0, 31) + (li ? '_' + li : ''), tags, tpl: !!o.styleFor, layer: l };
        blocks.push(blk);
      }
      l.features.forEach(f => {
        if (f.sym) return;
        const ln = nameFor(l, f); const col = colorFor(l, f);
        if (o.cad) {
          if (!layerDefs.has(ln)) layerDefs.set(ln, aci(l.color));
          const ec = f.color ? aci(f.color) : null; const ecol = ec && ec !== layerDefs.get(ln) ? ec : null;
          const g = f.geometry; if (!g) return;
          const pr = f.properties || {};
          if (pr.Text != null && g.type === 'Point' && /\n/.test(String(pr.Text))) { const c = g.coordinates; const ap = { t: 1, m: 4, b: 7 }[pr.VAlign || 't'] + ({ c: 1, r: 2 }[pr.Align] || 0); E(() => { w(0, 'MTEXT'); w(8, ln); if (ecol) w(62, ecol); w(10, c[0]); w(20, c[1]); w(30, c[2] || 0); w(40, pr.Height || o.textH); w(71, ap); w(1, String(pr.Text).split('\n').map(dxfText).join('\\P')); if (pr.Rotation) w(50, pr.Rotation * Math.PI / 180); }); return; }
          if (pr.Text != null && g.type === 'Point') { const c = g.coordinates; E(() => { w(0, 'TEXT'); w(8, ln); if (ecol) w(62, ecol); w(10, c[0]); w(20, c[1]); w(30, c[2] || 0); w(40, pr.Height || o.textH); w(1, dxfText(pr.Text)); if (pr.Rotation) w(50, pr.Rotation); }); return; }
          if (f.ins && pr.Block && o.blocks && o.blocks[pr.Block]) {
            const bn = dxfLayer(pr.Block).slice(0, 250); usedB.add(pr.Block); const c = g.coordinates; const tags = (f.ins.attrs || []).filter(k => pr[k] != null);
            E(() => { w(0, 'INSERT'); w(8, ln); if (ecol) w(62, ecol); if (tags.length) w(66, 1); w(2, bn); w(10, c[0]); w(20, c[1]); w(30, c[2] || 0); w(41, f.ins.sx); w(42, f.ins.sy); w(43, 1); if (f.ins.rot) w(50, f.ins.rot);
              if (tags.length) { tags.forEach(k => { w(0, 'ATTRIB'); w(8, ln); w(10, c[0]); w(20, c[1]); w(30, 0); w(40, o.textH * 0.5); w(1, dxfText(pr[k])); w(2, tagName(k, new Set())); w(70, 0); }); w(0, 'SEQEND'); w(8, ln); } });
            return;
          }
        }
        { const S = styOf(l); if (!layerDefs.has(ln)) layerDefs.set(ln, S ? S.aci : o.colorMode === 'feature' ? aci(l.color) : col); }
        const ecol = styOf(l) ? null : o.colorMode === 'feature' && layerDefs.get(ln) !== col ? col : null;
        explode(f.geometry).forEach(g => {
          const t = fam(g);
          if (t === 'Point') pts(g).forEach(p => E(() => {
            const z = o.z3d && p[2] != null ? p[2] : 0;
            if (blk) {
              w(0, 'INSERT'); w(8, ln); if (ecol) w(62, ecol); if (tags.length) w(66, 1); w(2, blk.name); w(10, p[0]); w(20, p[1]); w(30, z); w(41, o.symSize); w(42, o.symSize); w(43, o.symSize);
              if (tags.length) { tags.forEach(([k, tg]) => { const v = f.properties[k]; const ai = o.styleFor ? -1 : ANNO.indexOf(k); w(0, 'ATTRIB'); w(8, ln); if (ai >= 0) { w(10, p[0] + o.symSize * 0.9); w(20, p[1] + ((ANNO.length - 1) / 2 - ai) * aLH - aH / 2); w(30, z); w(40, aH); } else { w(10, p[0]); w(20, p[1]); w(30, z); w(40, o.textH * 0.5); } w(1, dxfText(v == null ? '' : v)); w(2, tg); w(70, ai >= 0 ? 0 : 1); }); w(0, 'SEQEND'); w(8, ln); }
            } else if (o.points === 'circle') { w(0, 'CIRCLE'); w(8, ln); if (ecol) w(62, ecol); w(10, p[0]); w(20, p[1]); w(30, z); w(40, o.symSize / 2); }
            else { w(0, 'POINT'); w(8, ln); if (ecol) w(62, ecol); w(10, p[0]); w(20, p[1]); w(30, z); }
          }));
          if (t === 'LineString') lines(g).forEach(r => poly(ln, r, false, ecol));
          if (t === 'Polygon') polys(g).forEach(pp => pp.forEach(r => { r = closeRing(r); poly(ln, r.slice(0, -1), true, ecol); }));
        });
        const S0 = styOf(l);
        if (S0 && f.geometry && (o.annoLines || o.pointLabel)) {
          const gs = explode(f.geometry); const g0 = gs[0]; const kind = g0 ? fam(g0) : null; const tl = dxfLayer(S0.annoLayer);
          const ll = dxfLayer(S0.annoLayer.replace('-IDEN', '-LEAD')); const reg = () => { if (!layerDefs.has(tl)) { layerDefs.set(tl, 7); layerMeta.set(tl, { lt: 'CONTINUOUS', lw: 0 }); } if (!layerDefs.has(ll)) { layerDefs.set(ll, S0.aci === 1 || S0.aci === 6 ? 4 : 1); layerMeta.set(ll, { lt: 'CONTINUOUS', lw: 13 }); } };
          if (kind === 'Point') { const p = pts(g0)[0]; PTS.push(p); const lab = o.pointLabel && !f.nolab ? o.pointLabel(S0, f.properties || {}, p, o.geographic, f.labTitle, f.labExtra) : null; if (f.nolab) NOLAB.n++; if (lab && lab.lines.length) { reg(); PLAB.push({ p, lines: lab.lines, box: lab.box, layer: tl, lead: ll }); } }
          else if (kind === 'LineString' && S0.anno && o.annoLines) {
            let len = null; if (!o.geographic) { len = 0; gs.forEach(g => lines(g).forEach(c => { for (let i = 1; i < c.length; i++) len += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); })); }
            const txt = o.annoLines(S0.anno, f.properties || {}, len); if (txt.length) { reg(); LLAB.push({ path: lines(g0)[0], txt, layer: tl, len: len || 0 }); }
          }
        }
        const annoK = o.styleFor ? [] : ANNO.filter(k => f.properties[k] != null && f.properties[k] !== '' && !(blk && (o.attrs ? true : false) && (blk.tags || []).some(t => t[0] === k) && fam(explode(f.geometry)[0] || { type: '' }) === 'Point'));
        if (annoK.length && f.geometry) {
          const lp = labelPoint(f.geometry);
          if (lp) {
            let rot = 0; const gs = explode(f.geometry); const isLn = gs.length && fam(gs[0]) === 'LineString';
            if (isLn && o.alignText) { const l0 = lines(gs[0])[0]; const i0 = Math.max(1, Math.floor(l0.length / 2)); const a = l0[i0 - 1], b = l0[Math.min(i0, l0.length - 1)]; rot = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (rot > 90) rot -= 180; if (rot < -90) rot += 180; }
            const tl = o.textSuffix ? dxfLayer(ln + o.textSuffix) : ln; if (!layerDefs.has(tl)) layerDefs.set(tl, layerDefs.get(ln));
            const r = rot * Math.PI / 180, nx = -Math.sin(r), ny = Math.cos(r); const isP = !isLn && fam(gs[0]) === 'Point';
            annoK.forEach((k, i) => { const off = isLn ? aH * 0.6 + (annoK.length - 1 - i) * aLH : ((annoK.length - 1) / 2 - i) * aLH; const x = lp[0] + nx * off + (isP ? o.symSize * 0.9 : 0), y = lp[1] + ny * off - (isP ? aH / 2 : 0);
              E(() => { w(0, 'TEXT'); w(8, tl); w(10, x); w(20, y); w(30, 0); w(40, aH); w(1, dxfText(f.properties[k])); if (rot) w(50, rot.toFixed(3)); if (isLn) { w(72, 1); w(11, x); w(21, y); w(31, 0); } }); });
          }
        }
        const lf = o.labelField;
        if (lf && f.geometry && f.properties[lf] != null && f.properties[lf] !== '') {
          const lp = labelPoint(f.geometry); if (!lp) return;
          let rot = 0;
          if (o.alignText) { const gs = explode(f.geometry); if (gs.length && fam(gs[0]) === 'LineString') { const l0 = lines(gs[0])[0]; const i = Math.max(1, Math.floor(l0.length / 2)); const a = l0[i - 1], b = l0[Math.min(i, l0.length - 1)]; rot = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (rot > 90) rot -= 180; if (rot < -90) rot += 180; } }
          const tl = o.textSuffix ? dxfLayer(ln + o.textSuffix) : ln;
          if (!layerDefs.has(tl)) layerDefs.set(tl, layerDefs.get(ln));
          const isP = fam(explode(f.geometry)[0]) === 'Point';
          const x = lp[0] + (isP ? o.textH * 0.8 : 0), y = lp[1] + (isP ? o.textH * 0.3 : 0);
          E(() => { w(0, 'TEXT'); w(8, tl); w(10, x); w(20, y); w(30, 0); w(40, o.textH); w(1, dxfText(f.properties[lf])); if (rot) w(50, rot.toFixed(3)); if (!isP) { w(72, 1); w(11, x); w(21, y); w(31, 0); w(73, 2); } });
        }
      });
    });
    /* ---- annotation placement without overlaps: point labels first, then pipe/cable labels (shrunk or skipped if no room) ---- */
    const STAT = { pointLabels: 0, lineLabels: 0, lineShrunk: 0, lineSkipped: 0, pointFiltered: NOLAB.n };
    if (PLAB.length || LLAB.length) {
      const H = o.annoH || 2, CELL = Math.max(H * 12, 10); const G = new Map(); const boxes = [];
      const keyOf = (i, j) => i + ',' + j;
      const addBox = b => { boxes.push(b); for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) { const k = keyOf(i, j); if (!G.has(k)) G.set(k, []); G.get(k).push(b); } };
      let MA = o._mapArea; const GT = !o._mapArea && o.sheet && SHEET_S ? GRID() : null; const areaAt = (x, y) => { if (!GT) return o._mapArea; const i = Math.floor((x - GT.ox) / GT.TW), j = Math.floor((y - GT.oy) / GT.TH); const e = GT.TW * 0.004; return [GT.ox + i * GT.TW + e, GT.oy + j * GT.TH + e, GT.ox + (i + 1) * GT.TW - e, GT.oy + (j + 1) * GT.TH - e]; };
      const hits = b => { let n = MA && (b[0] < MA[0] || b[1] < MA[1] || b[2] > MA[2] || b[3] > MA[3]) ? 50 : 0; const seen = new Set(); for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) (G.get(keyOf(i, j)) || []).forEach(q => { if (seen.has(q)) return; seen.add(q); if (q[0] < b[2] && q[2] > b[0] && q[1] < b[3] && q[3] > b[1]) n += q.s ? 0.01 : 1; }); return n; };
      const tw = (t, h) => String(t).replace(/%%[cCdDpP]/g, 'Ø').length * h * 0.72;
      const sym = (o.symSize || 1) * 0.6; PTS.forEach(p => { const bb = [p[0] - sym, p[1] - sym, p[0] + sym, p[1] + sym]; bb.s = 1; addBox(bb); });
      const order = PLAB.slice().sort((a, b) => (b.box ? 1 : 0) - (a.box ? 1 : 0));
      order.forEach(L => {
        MA = areaAt(L.p[0], L.p[1]);
        let h, pad, ls, w0, h0, best = null;
        for (const sc of [1, 0.85]) {
          h = (L.box ? H : H * 0.8) * sc; pad = L.box ? h * 0.6 : h * 0.2; ls = h * 1.6;
          w0 = Math.max(...L.lines.map(t => tw(t, h))) + pad * 2; h0 = L.lines.length * ls + pad * 2 - (ls - h);
          const D = L.box ? [h * 2.5, h * 4, h * 7, h * 11, h * 16, h * 23, h * 32, h * 44, h * 58] : [h * 0.8, h * 2, h * 4];
          const A = [45, 135, -45, -135, 0, 180, 90, -90, 22, 158, -22, -158, 67, 113, -67, -113];
          let bs = null;
          for (const d of D) { for (const ang of A) { const r = ang * Math.PI / 180, cx = Math.cos(r), cy = Math.sin(r); const ax = L.p[0] + cx * d, ay = L.p[1] + cy * d;
              const bx0 = cx >= -0.2 ? ax : ax - w0, by0 = cy >= 0.2 ? ay : cy <= -0.2 ? ay - h0 : ay - h0 / 2; const bb = [bx0, by0, bx0 + w0, by0 + h0]; const n = hits(bb);
              if (!bs || n < bs.n) bs = { b: bb, n, d }; if (n === 0) break; }
            if (bs && bs.n === 0) break; }
          bs = Object.assign(bs, { h, pad, ls, w0, h0, sc });
          // keep the label as close as possible: full size if it fits near the point, else a slightly smaller label that sits closer
          if (!best || (bs.n < 1 && (best.n >= 1 || (best.d > (L.box ? H : H * 0.8) * 16 && bs.d < best.d * 0.5))) || (best.n >= 1 && bs.n < best.n)) best = bs;
          if (best.n < 1 && best.d <= (L.box ? H : H * 0.8) * 11) break; }
        ({ h, pad, ls, w0, h0 } = best); if (h < (L.box ? H : H * 0.8) * 0.99) STAT.pointShrunk = (STAT.pointShrunk || 0) + 1;
        if (o.noOverlap && best.n >= 1) { STAT.pointSkipped = (STAT.pointSkipped || 0) + 1; (STAT.skippedAt = STAT.skippedAt || []).push(L.lines[0] + ' @ ' + L.p[0].toFixed(2) + ',' + L.p[1].toFixed(2)); return; } const b = best.b; addBox(b); STAT.pointLabels++;
        E(() => {
          if (L.box) { const c = Math.min(w0, h0) * 0.12; const P = [[b[0] + c, b[1]], [b[2] - c, b[1]], [b[2], b[1] + c], [b[2], b[3] - c], [b[2] - c, b[3]], [b[0] + c, b[3]], [b[0], b[3] - c], [b[0], b[1] + c]];
            w(0, 'POLYLINE'); w(8, L.lead); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 1); P.forEach(q => { w(0, 'VERTEX'); w(8, L.lead); w(10, q[0]); w(20, q[1]); w(30, 0); }); w(0, 'SEQEND'); w(8, L.lead);
            // leader snaps to the box (nearest vertex or side midpoint of the chamfered frame) and to the object's own insertion point
            const SN = P.concat(P.map((q, i) => { const r2 = P[(i + 1) % P.length]; return [(q[0] + r2[0]) / 2, (q[1] + r2[1]) / 2]; })); let tx = SN[0][0], ty = SN[0][1], bd = Infinity; SN.forEach(q => { const d2 = Math.hypot(q[0] - L.p[0], q[1] - L.p[1]); if (d2 < bd) { bd = d2; tx = q[0]; ty = q[1]; } }); const dd = bd;
            if (dd > sym * 1.5) { const ux = (tx - L.p[0]) / dd, uy = (ty - L.p[1]) / dd; const al = Math.min(h * 0.85, dd * 0.3), aw = al * 0.3; const tip = [L.p[0], L.p[1]], bs = [tip[0] + ux * al, tip[1] + uy * al];
              w(0, 'LINE'); w(8, L.lead); w(10, bs[0]); w(20, bs[1]); w(30, 0); w(11, tx); w(21, ty); w(31, 0);
              w(0, 'POLYLINE'); w(8, L.lead); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 0); w(0, 'VERTEX'); w(8, L.lead); w(10, bs[0]); w(20, bs[1]); w(30, 0); w(40, aw * 2); w(41, 0.001); w(0, 'VERTEX'); w(8, L.lead); w(10, tip[0]); w(20, tip[1]); w(30, 0); w(0, 'SEQEND'); w(8, L.lead);
              w(0, 'CIRCLE'); w(8, L.lead); w(10, L.p[0]); w(20, L.p[1]); w(30, 0); w(40, sym * 1.15); } }
          L.lines.forEach((t, i) => { const x = b[0] + pad, y = b[3] - pad - h - i * ls; w(0, 'TEXT'); w(8, L.layer); w(10, x); w(20, y); w(30, 0); w(40, h); w(7, 'GV_ANNO'); w(1, dxfText(String(t).replace(/Ø/g, '%%C'))); });
        });
      });
      LLAB.sort((a, b) => b.len - a.len).forEach(L => {
        const P = L.path; if (!P || P.length < 2) return; let tot = 0; const seg = []; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); seg.push(d); tot += d; }
        const at = t => { let r = tot * t; for (let i = 0; i < seg.length; i++) { if (r <= seg[i] || i === seg.length - 1) { const k = seg[i] ? r / seg[i] : 0; const a = P[i], b = P[i + 1]; let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, ang, segLen: seg[i] }; } r -= seg[i]; } };
        let done = false;
        for (const sc of [0.75, 0.6, 0.48]) { const h = H * sc, ls = h * 1.5; const wT = Math.max(...L.txt.map(t => tw(t, h)));
          for (const t of [0.5, 0.3, 0.7, 0.18, 0.82]) { const m = at(t); if (!m || wT > tot * 1.6) continue; const r = m.ang * Math.PI / 180, nx = -Math.sin(r), ny = Math.cos(r), ux = Math.cos(r), uy = Math.sin(r);
            const offs = L.txt.map((_, i) => h * 0.5 + (L.txt.length - 1 - i) * ls); const corners = []; offs.forEach(off => [[-wT / 2, 0], [wT / 2, 0], [-wT / 2, h], [wT / 2, h]].forEach(([du, dv]) => corners.push([m.x + ux * du + nx * (off + dv), m.y + uy * du + ny * (off + dv)])));
            const b = [Math.min(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[0])), Math.max(...corners.map(c => c[1]))];
            MA = areaAt(m.x, m.y); if (hits(b) > 0) continue; addBox(b); STAT.lineLabels++; if (sc < 0.75) STAT.lineShrunk++; done = true;
            E(() => L.txt.forEach((tx, i) => { const off = offs[i]; const x = m.x + nx * off, y = m.y + ny * off; w(0, 'TEXT'); w(8, L.layer); w(10, x); w(20, y); w(30, 0); w(40, h); w(7, 'GV_ANNO'); w(1, dxfText(String(tx).replace(/Ø/g, '%%C'))); if (m.ang) w(50, m.ang.toFixed(3)); w(72, 1); w(11, x); w(21, y); w(31, 0); }));
            break; }
          if (done) break; }
        if (!done) STAT.lineSkipped++;
      });
    }
    dxf.lastStats = STAT; dxf.lastSheet = null;
    /* ---- A1 layouts (paper space): one sheet per 1:S tile that has network; each with frame, notes, legend (as-built quantities only), north arrow, scale bar, title block ---- */
    dxf.lastLayouts = null; dxf.lastPlan = null; dxf.lastSheetBox = null; dxf.lastImages = []; dxf.lastVP = null;
    // the A1 sheet grid (same for the full drawing and the per-sheet files)
    function GRID() { if (GRID.c) return GRID.c; const VW = 841 - 125 - 20 - 4, VH = 594 - 20 - 4; const k = SHEET_S / 1000, TW = VW * k, TH = VH * k;
      let X0 = Infinity, Y0 = Infinity; const allP = []; const col = c => { if (typeof c[0] === 'number') { if (isFinite(c[0]) && isFinite(c[1])) { allP.push(c); if (c[0] < X0) X0 = c[0]; if (c[1] < Y0) Y0 = c[1]; } } else c.forEach(col); }; layers.forEach(l => l.features.forEach(f => { if (f.geometry && f.geometry.coordinates) col(f.geometry.coordinates); }));
      let bestG = null; for (const fx of [0, 0.2, 0.4, 0.6, 0.8]) for (const fy of [0, 0.2, 0.4, 0.6, 0.8]) { const ox2 = X0 - fx * TW, oy2 = Y0 - fy * TH; const hs = new Set(); allP.forEach(c => hs.add(Math.floor((c[0] - ox2) / TW) + ',' + Math.floor((c[1] - oy2) / TH))); if (!bestG || hs.size < bestG.has.size) bestG = { ox: ox2, oy: oy2, has: hs }; }
      return (GRID.c = { ox: bestG.ox, oy: bestG.oy, has: bestG.has, TW, TH, allP }); }
    if (o.sheet && SHEET_S) buildLayouts();
    function buildLayouts() {
      let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity; const ex2 = c => { if (typeof c[0] === 'number') { if (isFinite(c[0]) && isFinite(c[1])) { X0 = Math.min(X0, c[0]); Y0 = Math.min(Y0, c[1]); X1 = Math.max(X1, c[0]); Y1 = Math.max(Y1, c[1]); } } else c.forEach(ex2); };
      layers.forEach(l => l.features.forEach(f => { if (f.geometry && f.geometry.coordinates) ex2(f.geometry.coordinates); })); if (!isFinite(X0)) return;
      const PW = 841, PH = 594, STRIP = 125, MAR = 10; const VX0 = MAR + 2, VY0 = MAR + 2, VW = PW - STRIP - MAR * 2 - 4, VH = PH - MAR * 2 - 4;
      let S = SHEET_S, k = S / 1000; const TW = VW * k, TH = VH * k; const GG = GRID();
      const LY = { frame: 'G-TTLB-LINE', text: 'G-TTLB-TEXT', legn: 'G-ANNO-LEGN', note: 'G-ANNO-NOTE', sym: 'G-ANNO-SYMB', vp: 'G-ANNO-VPRT', matc: 'G-ANNO-MATC', keyp: 'G-ANNO-KEYP', keyh: 'G-ANNO-KEYH', logo: 'G-TTLB-LOGO' };
      Object.values(LY).forEach(n => { if (!layerDefs.has(n)) layerDefs.set(n, n === LY.matc ? 6 : n === LY.keyh ? 1 : n === LY.keyp ? 8 : 7); layerMeta.set(n, { lt: n === LY.matc ? 'DASHED' : 'CONTINUOUS', lw: n === LY.frame || n === LY.keyh ? 50 : n === LY.text || n === LY.legn || n === LY.note || n === LY.keyp ? 0 : 18 }); });
      // tiles over the network (only those containing features)
      // pick the grid offset that needs the fewest sheets
      const allP = GG.allP; const ox = GG.ox, oy = GG.oy, has = GG.has; let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity; has.forEach(k2 => { const [i, j] = k2.split(',').map(Number); iMin = Math.min(iMin, i); iMax = Math.max(iMax, i); jMin = Math.min(jMin, j); jMax = Math.max(jMax, j); }); const nx = iMax + 1, ny = jMax + 1;
      const tiles = []; for (let j = jMax; j >= jMin; j--) for (let i = iMin; i <= iMax; i++) if (has.has(i + ',' + j)) tiles.push({ i, j, x0: ox + i * TW, y0: oy + j * TH });
      // model space: sheet boundaries (match lines) + sheet numbers
      if (!o.sheet.tile) tiles.forEach((t, n) => { E(() => { w(0, 'POLYLINE'); w(8, LY.matc); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 1); [[t.x0, t.y0], [t.x0 + TW, t.y0], [t.x0 + TW, t.y0 + TH], [t.x0, t.y0 + TH]].forEach(q => { w(0, 'VERTEX'); w(8, LY.matc); w(10, q[0]); w(20, q[1]); w(30, 0); }); w(0, 'SEQEND'); w(8, LY.matc); w(0, 'TEXT'); w(8, LY.matc); w(10, t.x0 + 4 * k); w(20, t.y0 + TH - 18 * k); w(30, 0); w(40, 14 * k); w(1, 'SHEET ' + String(n + 1).padStart(2, '0')); }); });
      // as-built quantities (existing excluded)
      const groups = new Map();
      layers.forEach(l => { const S0 = styOf(l); if (!S0 || S0.status) return; l.features.forEach(f => { const g = f.geometry; if (!g) return; const gs = explode(g); const kd = gs.length ? fam(gs[0]) : null; const p = f.properties || {};
        let key, qty = 0, isLen = false;
        if (kd === 'LineString') { const d = diaOf(p); key = S0.el === 'CABL' ? (o.cadVal ? o.cadVal(p, 'CABLE_SIZE|CROSS_SECTIONAL_AREA|SIZE', null) : '') || '-' : isFinite(d) ? String(Math.round(d)) : '-'; let L0 = 0; gs.forEach(g2 => lines(g2).forEach(c => { for (let i = 1; i < c.length; i++) L0 += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); })); qty = L0; isLen = S0.el !== 'SERV'; if (S0.el === 'SERV') qty = 1; }
        else if (kd === 'Point') { key = (o.cadVal ? o.cadVal(p, 'FEATURETYPE|VALVETYPE|TYPE|POLE_TYPE', null) : '') || ''; qty = 1; if (S0.el === 'FITT' && /saddle|tee|elbow|bend|cap|cross/i.test(key)) return; if (!key && o.typeName) key = o.typeName[S0.el] || S0.el; if (S0.el === 'HYDT') key = 'FIRE HYDRANT'; if (S0.el === 'METR') key = 'WATER METER'; }
        else return;
        const gk = l.name + '|' + kd + '|' + key; if (!groups.has(gk)) groups.set(gk, { l, S0, kd, key, qty: 0, isLen, props: p, layer: nameFor(l, f) }); groups.get(gk).qty += qty; }); });
      const rows = o.sheet.tile ? [] : Array.from(groups.values()).sort((a, b) => (a.kd === 'LineString' ? 0 : 1) - (b.kd === 'LineString' ? 0 : 1) || (a.S0.el === 'SERV' ? 1 : 0) - (b.S0.el === 'SERV' ? 1 : 0) || (parseFloat(b.key) || 0) - (parseFloat(a.key) || 0)).slice(0, 26);
      const ROWS = o.sheet.rows || rows.map(r => ({ kd: r.kd, layer: r.layer, block: (blocks.find(b2 => b2.layer === r.l) || {}).name || null, name: o.legendName ? o.legendName(r.S0, r.key, r.props) : r.key, qty: r.qty, isLen: r.isLen }));
      const NT = o.sheet.total || tiles.length;
      // one page (mm), shared by every sheet except viewport + sheet no.
      const page = (n, t) => {
        const P = []; const rect = (ly, a, b, c, d) => P.push({ t: 'poly', ly, pts: [[a, b], [c, b], [c, d], [a, d]], closed: 1 }); const line = (ly, a, b, c, d) => P.push({ t: 'line', ly, a: [a, b], b: [c, d] }); const text = (ly, x, y, h, s, al) => P.push({ t: 'text', ly, p: [x, y], h, s, al: al || 0 });
        rect(LY.frame, 0, 0, PW, PH); rect(LY.frame, MAR, MAR, PW - MAR, PH - MAR); rect(LY.vp, VX0, VY0, VX0 + VW, VY0 + VH);
        const sx0 = PW - MAR - STRIP, sx1 = PW - MAR; line(LY.frame, sx0, MAR, sx0, PH - MAR);
        let y = PH - MAR - 8; const sep = () => { y -= 3; line(LY.frame, sx0, y, sx1, y); y -= 7; };
        text(LY.text, sx0 + 4, y, 3.5, '%%UNOTES'); y -= 6;
        ['1. ALL DIMENSIONS ARE IN METERS UNLESS OTHERWISE STATED.', '2. ALL PIPE DIAMETERS ARE IN MILLIMETERS.', '3. COORDINATES: ' + (o.sheet.crsName || '') + '.', '4. LEGEND QUANTITIES = AS-BUILT ONLY (EXISTING EXCLUDED).'].forEach(s2 => { text(LY.note, sx0 + 4, y, 2, s2); y -= 4; });
        sep(); text(LY.text, sx0 + 4, y, 3.5, '%%ULEGEND'); y -= 8;
        ROWS.forEach(r => { const ym = y + 1;
          if (r.kd === 'LineString') P.push({ t: 'line', ly: r.layer, a: [sx0 + 4, ym], b: [sx0 + 18, ym] });
          else if (r.block) P.push({ t: 'insert', ly: r.layer, name: r.block, p: [sx0 + 11, ym], sc: 2.4 }); else P.push({ t: 'circle', ly: r.layer, p: [sx0 + 11, ym], r: 1.2 });
          const nm = r.name; text(LY.legn, sx0 + 22, y, 2.5, nm.length > 40 ? nm.slice(0, 40) : nm);
          text(LY.legn, sx1 - 4, y, 2.5, r.isLen ? r.qty.toFixed(3) + ' M' : '(' + Math.round(r.qty) + ')', 2);
          if (r.isLen) { text(LY.note, sx0 + 22, y - 3.4, 1.8, 'TOTAL LENGTH'); y -= 3.2; } y -= 7; });
        sep();
        const cx = sx0 + STRIP / 2, cy = y - 14; P.push({ t: 'poly', ly: LY.sym, pts: [[cx, cy + 10], [cx + 5, cy - 6], [cx, cy - 2], [cx - 5, cy - 6]], closed: 1 }); text(LY.text, cx, cy + 12.5, 4, 'N', 1); y = cy - 14;
        const nice = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]; const unit = nice.find(u => u * 1000 / S >= 12) || 1000; const segmm = unit * 1000 / S; const nseg = Math.max(2, Math.min(5, Math.floor((STRIP - 20) / segmm)));
        for (let i = 0; i < nseg; i++) { const a = sx0 + 8 + i * segmm; rect(LY.sym, a, y, a + segmm, y + 2); if (i % 2 === 0) P.push({ t: 'solid', ly: LY.sym, pts: [[a, y], [a + segmm, y], [a, y + 2], [a + segmm, y + 2]] }); text(LY.note, a, y - 4, 1.8, (i * unit) + 'm', 1); }
        text(LY.note, sx0 + 8 + nseg * segmm, y - 4, 1.8, (nseg * unit) + 'm', 1);
        y -= 10; text(LY.text, cx, y, 2.5, 'VISUAL SCALE 1:' + S + '  @ A1', 1); y -= 5; text(LY.note, cx, y, 2, o.sheet.crsName || '', 1);
        { const KT = o.sheet.allTiles || tiles; if (KT.length > 1) { y -= 6; sep(); text(LY.text, sx0 + 4, y, 3.5, '%%UKEY PLAN'); y -= 4;
            const kx0 = Math.min(...KT.map(q => q.x0)), ky0 = Math.min(...KT.map(q => q.y0)), kx1 = Math.max(...KT.map(q => q.x0 + TW)), ky1 = Math.max(...KT.map(q => q.y0 + TH));
            const bw = STRIP - 12, bh = 46, f = Math.min(bw / (kx1 - kx0), bh / (ky1 - ky0)); const gx = sx0 + 6 + (bw - (kx1 - kx0) * f) / 2, gy = y - bh + (bh - (ky1 - ky0) * f) / 2;
            const cur = o.sheet.tile ? o.sheet.index : n; const th = Math.min(TW, TH) * f;
            KT.forEach((q, m) => { const a = gx + (q.x0 - kx0) * f, b2 = gy + (q.y0 - ky0) * f, c2 = a + TW * f, d2 = b2 + TH * f; const me = m === cur;
              rect(me ? LY.keyh : LY.keyp, a, b2, c2, d2); if (me) rect(LY.keyh, a + 0.6, b2 + 0.6, c2 - 0.6, d2 - 0.6);
              text(me ? LY.keyh : LY.keyp, (a + c2) / 2, (b2 + d2) / 2 - th * 0.15, Math.max(1.4, Math.min(3, th * 0.32)), String(m + 1).padStart(2, '0'), 1); });
            y -= bh + 4; text(LY.note, sx0 + 4, y, 1.8, '' + (cur < 0 ? 'SEE SHEET FILES 01-' + String(KT.length).padStart(2, '0') : 'THIS SHEET = ' + String(cur + 1).padStart(2, '0') + ' (HIGHLIGHTED)')); y -= 3; } }
        sep();
        [['PROJECT', o.sheet.project || ''], ['DRAWING TITLE', o.sheet.title || ''], ['DRAWING NO.', (o.sheet.no || '') + (n < 0 ? '  (OVERALL KEY MAP - ' + NT + ' SHEETS)' : NT > 1 ? '  (SHEET ' + String(n + 1).padStart(2, '0') + ' OF ' + String(NT).padStart(2, '0') + ')' : '')], ['COORDINATE SYSTEM', o.sheet.crsText || o.sheet.crsName || ''], ['DATE', o.sheet.date || '']].forEach(([k2, v]) => { text(LY.note, sx0 + 4, y, 1.8, k2); y -= 5; (String(v || '-').match(/.{1,40}(\s|$)|.{1,40}/g) || ['-']).filter(Boolean).slice(0, 3).forEach(t2 => { text(LY.text, sx0 + 4, y, 2.8, t2.trim()); y -= 4.5; }); y -= 2; line(LY.frame, sx0, y + 1, sx1, y + 1); y -= 4; });
        { const SL = [['OWNER', 'owner'], ['AUTHORITY (WATER CO. / AMANAH)', 'authority'], ['CONSULTANT', 'consultant'], ['CONTRACTOR', 'contractor']];
          const per = Math.max(22, (y - MAR - 2) / SL.length); const lh = Math.min(20, per * 0.42), bw2 = STRIP - 8;
          SL.forEach(([lab, key]) => { const top = y, b2 = y - per; rect(LY.logo, sx0 + 4, b2 + 1, sx1 - 4, top - 1);
            text(LY.note, sx0 + 6, top - 4, 1.8, lab); const L = (o.sheet.logos || {})[key]; const ly0 = top - 5.5 - lh;
            if (L && L.w && L.h) { const f = Math.min((bw2 - 6) / L.w, lh / L.h); const iw = L.w * f, ih = L.h * f; P.push({ t: 'image', ly: LY.logo, p: [sx0 + 4 + (bw2 - iw) / 2, ly0 + (lh - ih) / 2], w: iw, h: ih, file: L.file, px: L.w, py: L.h, key }); }
            else text(LY.note, sx0 + STRIP / 2, ly0 + lh / 2 - 0.8, 1.6, '[ ' + lab.split(' ')[0] + ' LOGO ]', 1);
            line(LY.logo, sx0 + 4, ly0 - 1.5, sx1 - 4, ly0 - 1.5); text(LY.note, sx0 + 6, ly0 - 5, 1.6, 'STAMP / SIGNATURE:'); y = b2; }); }
        return { name: 'SHEET-' + String(n + 1).padStart(2, '0'), page: P, vp: { c: [VX0 + VW / 2, VY0 + VH / 2], w: VW, h: VH, vc: [t.x0 + TW / 2, t.y0 + TH / 2], vh: TH }, paper: [PW, PH] };
      };
      const PAPER = o.sheet.paper !== false; dxf.lastImages = dxf.lastImages || [];
      const emit = (pg, T) => { const kk = PAPER ? 1 : k; const M = PAPER ? (q => [q[0], q[1]]) : (q => [T.x0 + (q[0] - VX0) * k, T.y0 + (q[1] - VY0) * k]); const w8 = ly => { w(8, ly); if (PAPER) w(67, 1); }; if (PAPER) dxf.lastVP = { c: [VX0 + VW / 2, VY0 + VH / 2], w: VW, h: VH, vc: [T.x0 + VW * k / 2, T.y0 + VH * k / 2], vh: VH * k, ly: LY.vp };
        pg.page.forEach(p => { const ly = p.ly; if (!layerDefs.has(ly)) layerDefs.set(ly, 7);
          if (p.t === 'line') { const a = M(p.a), b = M(p.b); E(() => { w(0, 'LINE'); w8(ly); w(10, a[0]); w(20, a[1]); w(30, 0); w(11, b[0]); w(21, b[1]); w(31, 0); }); }
          else if (p.t === 'poly') { const q2 = p.pts.map(M); E(() => { w(0, 'POLYLINE'); w8(ly); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, p.closed ? 1 : 0); q2.forEach(q => { w(0, 'VERTEX'); w8(ly); w(10, q[0]); w(20, q[1]); w(30, 0); }); w(0, 'SEQEND'); w8(ly); }); }
          else if (p.t === 'text') { const a = M(p.p); E(() => { w(0, 'TEXT'); w8(ly); w(10, a[0]); w(20, a[1]); w(30, 0); w(40, p.h * kk); w(7, 'GV_ANNO'); w(1, dxfText(p.s)); if (p.al) { w(72, p.al); w(11, a[0]); w(21, a[1]); w(31, 0); } }); }
          else if (p.t === 'insert') { const a = M(p.p); E(() => { w(0, 'INSERT'); w8(ly); w(2, p.name); w(10, a[0]); w(20, a[1]); w(30, 0); w(41, p.sc * kk); w(42, p.sc * kk); w(43, 1); }); }
          else if (p.t === 'circle') { const a = M(p.p); E(() => { w(0, 'CIRCLE'); w8(ly); w(10, a[0]); w(20, a[1]); w(30, 0); w(40, p.r * kk); }); }
          else if (p.t === 'image') { const a = M(p.p); dxf.lastImages.push({ file: p.file, x: a[0], y: a[1], w: p.w * kk, h: p.h * kk, px: p.px, py: p.py, layer: ly, paper: PAPER, key: p.key }); }
          else if (p.t === 'solid') { const q2 = p.pts.map(M); E(() => { w(0, 'SOLID'); w8(ly); [10, 11, 12, 13].forEach((c, i) => { w(c, q2[i][0]); w(c + 10, q2[i][1]); w(c + 20, 0); }); }); } }); };
      if (o.sheet.tile) { const T = o.sheet.tile; emit(page(o.sheet.index || 0, { x0: T.x0, y0: T.y0 }), T);
        if (!PAPER) dxf.lastSheetBox = [T.x0 - VX0 * k, T.y0 - VY0 * k, T.x0 + (PW - VX0) * k, T.y0 + (PH - VY0) * k]; return; }
      { const xs = allP.map(c => c[0]), ys = allP.map(c => c[1]); if (xs.length) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; xs.forEach(v => { if (v < x0) x0 = v; if (v > x1) x1 = v; }); ys.forEach(v => { if (v < y0) y0 = v; if (v > y1) y1 = v; });
          tiles.forEach(t => { x0 = Math.min(x0, t.x0); y0 = Math.min(y0, t.y0); x1 = Math.max(x1, t.x0 + TW); y1 = Math.max(y1, t.y0 + TH); });
          const need = Math.max((x1 - x0) / VW, (y1 - y0) / VH) * 1000 * 1.04; const S1 = [500, 1000, 1250, 2000, 2500, 5000, 7500, 10000, 20000, 25000, 50000].find(v => v >= need) || Math.ceil(need / 1000) * 1000;
          const S0b = S, k0 = k; S = S1; k = S1 / 1000; const T = { x0: (x0 + x1) / 2 - VW * k / 2, y0: (y0 + y1) / 2 - VH * k / 2 }; emit(page(-1, T), T); if (!PAPER) dxf.lastSheetBox = [T.x0 - VX0 * k, T.y0 - VY0 * k, T.x0 + (PW - VX0) * k, T.y0 + (PH - VY0) * k]; S = S0b; k = k0; } }
      dxf.lastPlan = { S, tiles: tiles.map(t => ({ x0: t.x0, y0: t.y0, w: TW, h: TH })), rows: rows.map(r => ({ kd: r.kd, layer: r.layer, block: (blocks.find(b2 => b2.layer === r.l) || {}).name || null, name: o.legendName ? o.legendName(r.S0, r.key, r.props) : r.key, qty: r.qty, isLen: r.isLen })) };
      dxf.lastSheet = { scale: S, rows: rows.length, sheets: tiles.length };
    }
    // drawing extents so AutoCAD / Civil 3D opens zoomed on the data (not at 0,0)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const ext = c => { if (typeof c[0] === 'number') { if (isFinite(c[0]) && isFinite(c[1])) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); } } else c.forEach(ext); };
    layers.forEach(l => l.features.forEach(f => { if (f.geometry && f.geometry.coordinates) ext(f.geometry.coordinates); }));
    if (o.sheet && dxf.lastSheetBox) { [x0, y0, x1, y1] = dxf.lastSheetBox; }
    if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 100; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hh = Math.max(y1 - y0, (x1 - x0) * 0.6, 10) * 1.1;
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$DWGCODEPAGE'); w(3, 'ANSI_1252'); w(9, '$INSBASE'); w(10, 0); w(20, 0); w(30, 0); w(9, '$EXTMIN'); w(10, x0); w(20, y0); w(30, 0); w(9, '$EXTMAX'); w(10, x1); w(20, y1); w(30, 0); w(9, '$LIMMIN'); w(10, x0); w(20, y0); w(9, '$LIMMAX'); w(10, x1); w(20, y1); w(9, '$TEXTSIZE'); w(40, o.textH); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'VPORT'); w(70, 1); w(0, 'VPORT'); w(2, '*ACTIVE'); w(70, 0); w(10, 0); w(20, 0); w(11, 1); w(21, 1); w(12, cx); w(22, cy); w(13, 0); w(23, 0); w(14, 1); w(24, 1); w(15, 0); w(25, 0); w(16, 0); w(26, 0); w(36, 1); w(17, 0); w(27, 0); w(37, 0); w(40, hh); w(41, 1.6); w(42, 50); w(43, 0); w(44, 0); w(50, 0); w(51, 0); w(71, 0); w(72, 100); w(73, 1); w(74, 3); w(75, 0); w(76, 0); w(77, 0); w(78, 0); w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 1); w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, 0); w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, layerDefs.size + 1);
    w(0, 'LAYER'); w(2, '0'); w(70, 0); w(62, 7); w(6, 'CONTINUOUS');
    layerDefs.forEach((c, n) => { const m = layerMeta.get(n); w(0, 'LAYER'); w(2, n); w(70, 0); w(62, c || 7); w(6, 'CONTINUOUS'); if (m) w(999, 'GVMETA lt=' + (m.lt || 'CONTINUOUS') + ' lw=' + (m.lw == null ? -3 : m.lw)); });
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'STYLE'); w(70, 2); w(0, 'STYLE'); w(2, 'STANDARD'); w(70, 0); w(40, 0); w(41, 1); w(50, 0); w(71, 0); w(42, o.textH); w(3, 'arial.ttf'); w(4, ''); w(0, 'STYLE'); w(2, 'GV_ANNO'); w(70, 0); w(40, 0); w(41, 0.9); w(50, 0); w(71, 0); w(42, o.textH); w(3, 'arialn.ttf'); w(4, ''); w(0, 'ENDTAB');
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'BLOCKS');
    blocks.forEach(b => {
      w(0, 'BLOCK'); w(8, '0'); w(2, b.name); w(70, b.tags.length ? 2 : 0); w(10, 0); w(20, 0); w(30, 0); w(3, b.name);
      w(0, 'CIRCLE'); w(8, '0'); w(62, 0); w(10, 0); w(20, 0); w(30, 0); w(40, 0.5);
      w(0, 'LINE'); w(8, '0'); w(62, 0); w(10, -0.35); w(20, -0.35); w(30, 0); w(11, 0.35); w(21, 0.35); w(31, 0);
      w(0, 'LINE'); w(8, '0'); w(62, 0); w(10, -0.35); w(20, 0.35); w(30, 0); w(11, 0.35); w(21, -0.35); w(31, 0);
      b.tags.forEach(([k, tg], i) => { const ai = b.tpl ? -1 : ANNO.indexOf(k); w(0, 'ATTDEF'); w(8, '0'); w(10, ai >= 0 ? 0.9 : 0.8); w(20, ai >= 0 ? ((ANNO.length - 1) / 2 - ai) * aLH / Math.max(o.symSize, 1e-6) - aH / 2 / Math.max(o.symSize, 1e-6) : -0.6 * i); w(30, 0); w(40, ai >= 0 ? aH / Math.max(o.symSize, 1e-6) : 0.5); w(1, ''); w(3, dxfText(k)); w(2, tg); w(70, ai >= 0 ? 0 : 1); });
      w(0, 'ENDBLK'); w(8, '0');
    });
    usedB.forEach(nm => {
      const gs = o.blocks[nm] || []; const bn = dxfLayer(nm).slice(0, 250);
      w(0, 'BLOCK'); w(8, '0'); w(2, bn); w(70, 0); w(10, 0); w(20, 0); w(30, 0); w(3, bn);
      gs.forEach(g => { if (g.t === 'C') { w(0, 'CIRCLE'); w(8, '0'); w(62, 0); w(10, g.c[0]); w(20, g.c[1]); w(30, 0); w(40, g.r); } else { w(0, 'POLYLINE'); w(8, '0'); w(62, 0); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, g.closed ? 1 : 0); g.c.forEach(p => { w(0, 'VERTEX'); w(8, '0'); w(10, p[0]); w(20, p[1]); w(30, 0); }); w(0, 'SEQEND'); w(8, '0'); } });
      w(0, 'ENDBLK'); w(8, '0');
    });
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES'); ents.forEach(fn => fn()); w(0, 'ENDSEC'); w(0, 'EOF');
    return L.join('\r\n') + '\r\n';
  }
  function labelPoint(g) { const gs = explode(g); if (!gs.length) return null; const t = fam(gs[0]); if (t === 'Point') return pts(gs[0])[0]; if (t === 'LineString') { const l = lines(gs[0])[0]; if (l.length === 2) return [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]; return l[Math.floor(l.length / 2)]; } const r = polys(gs[0])[0][0]; let x = 0, y = 0; r.forEach(p => { x += p[0]; y += p[1]; }); return [x / r.length, y / r.length]; }


  // clip layers to a rectangle (for one printable sheet): points inside, lines cut at the edge
  function clipLayers(layers, R) {
    const inside = p => p[0] >= R[0] && p[0] <= R[2] && p[1] >= R[1] && p[1] <= R[3];
    const code = p => (p[0] < R[0] ? 1 : p[0] > R[2] ? 2 : 0) | (p[1] < R[1] ? 4 : p[1] > R[3] ? 8 : 0);
    const seg = (a, b) => { let c1 = code(a), c2 = code(b); a = a.slice(); b = b.slice(); for (let k = 0; k < 20; k++) { if (!(c1 | c2)) return [a, b]; if (c1 & c2) return null; const c = c1 || c2; let x, y; const dx = b[0] - a[0], dy = b[1] - a[1];
        if (c & 8) { x = a[0] + dx * (R[3] - a[1]) / dy; y = R[3]; } else if (c & 4) { x = a[0] + dx * (R[1] - a[1]) / dy; y = R[1]; } else if (c & 2) { y = a[1] + dy * (R[2] - a[0]) / dx; x = R[2]; } else { y = a[1] + dy * (R[0] - a[0]) / dx; x = R[0]; }
        if (c === c1) { a = [x, y].concat(a.slice(2)); c1 = code(a); } else { b = [x, y].concat(b.slice(2)); c2 = code(b); } } return null; };
    const clipLine = c => { const out = []; let cur = null; for (let i = 1; i < c.length; i++) { const s2 = seg(c[i - 1], c[i]); if (!s2) { if (cur) { out.push(cur); cur = null; } continue; } if (cur && Math.hypot(cur[cur.length - 1][0] - s2[0][0], cur[cur.length - 1][1] - s2[0][1]) < 1e-9) cur.push(s2[1]); else { if (cur) out.push(cur); cur = [s2[0], s2[1]]; } } if (cur) out.push(cur); return out.filter(p => p.length > 1); };
    return layers.map(l => Object.assign({}, l, { features: l.features.map(f => { const g = f.geometry; if (!g) return null;
      if (g.type === 'Point') return inside(g.coordinates) ? f : null;
      if (g.type === 'MultiPoint') { const c = g.coordinates.filter(inside); return c.length ? Object.assign({}, f, { geometry: { type: 'MultiPoint', coordinates: c } }) : null; }
      if (g.type === 'LineString' || g.type === 'MultiLineString') { const parts = (g.type === 'LineString' ? [g.coordinates] : g.coordinates).flatMap(clipLine); if (!parts.length) return null; return Object.assign({}, f, { geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts } }); }
      const bb = bbox([f]); return bb[2] >= R[0] && bb[0] <= R[2] && bb[3] >= R[1] && bb[1] <= R[3] ? f : null; }).filter(Boolean) }));
  }
  /* ---------- GeoPackage ---------- */
  async function gpkg(layers, epsg, wkt, SQL) {
    const db = new SQL.Database();
    db.run('PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;');
    db.run("CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT)");
    db.run("INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS',-1,'NONE',-1,'undefined',NULL),('Undefined geographic SRS',0,'NONE',0,'undefined',NULL),('WGS 84 geodetic',4326,'EPSG',4326,?,NULL)", [GCS_WGS]);
    let srsId = epsg ? +epsg : -1;
    if (srsId !== 4326 && srsId !== -1) db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,NULL)', ['EPSG:' + srsId, srsId, 'EPSG', srsId, wkt || wktForEPSG(srsId) || 'undefined']);
    if (srsId === -1 && wkt) { srsId = 100000; db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,NULL)', ['custom', srsId, 'NONE', srsId, wkt]); }
    db.run("CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER)");
    db.run('CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name))');
    const usedT = new Set(); const domRows = [];
    for (const l of layers) {
      let tn = String(l.name).replace(/[^\p{L}\p{N}_]/gu, '_') || 'layer'; let b = tn, k = 2; while (usedT.has(tn.toLowerCase())) tn = b + '_' + k++; usedT.add(tn.toLowerCase());
      const hasGeom = !!l.gt || l.features.some(f => f.geometry);
      const TM = { int: 'INTEGER', real: 'REAL', date: 'DATETIME', text: 'TEXT' };
      const cols = l.fields.map(f => { if (l.types && l.types[f] && TM[l.types[f]]) return { src: f, name: String(f), type: TM[l.types[f]] }; const vals = l.features.map(x => x.properties[f]).filter(v => v != null && v !== ''); const num = vals.length && vals.every(isNum); return { src: f, name: String(f), type: num ? (vals.every(Number.isInteger) ? 'INTEGER' : 'REAL') : 'TEXT' }; });
      const seen = new Set(['fid', 'geom']); cols.forEach(c => { let n = c.name, k2 = 2; while (seen.has(n.toLowerCase())) n = c.name + '_' + k2++; seen.add(n.toLowerCase()); c.name = n; });
      const q = s => '"' + String(s).replace(/"/g, '""') + '"';
      if (l.dom) cols.forEach(c => { if (l.dom[c.src]) { domRows.push([tn, c.name, l.dom[c.src]]); if (c.type === 'INTEGER') c.type = 'MEDIUMINT'; } }); // GDAL reads INTEGER as Integer64; a 32-bit column keeps it matching the 32-bit domain
      db.run('CREATE TABLE ' + q(tn) + ' (fid INTEGER PRIMARY KEY AUTOINCREMENT' + (hasGeom ? ', geom BLOB' : '') + cols.map(c => ', ' + q(c.name) + ' ' + c.type).join('') + ')');
      const fams = new Set(l.features.filter(f => f.geometry).map(f => f.geometry.type));
      const gtn = l.gt || (fams.size === 1 ? [...fams][0].toUpperCase() : 'GEOMETRY');
      const bb = bbox(l.features);
      db.run('INSERT INTO gpkg_contents (table_name,data_type,identifier,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?)', [tn, hasGeom ? 'features' : 'attributes', tn, bb[0], bb[1], bb[2], bb[3], hasGeom ? srsId : null]);
      if (hasGeom) db.run('INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,0,0)', [tn, 'geom', gtn, srsId]);
      const stmt = db.prepare('INSERT INTO ' + q(tn) + ' (' + (hasGeom ? 'geom' + (cols.length ? ',' : '') : '') + cols.map(c => q(c.name)).join(',') + ') VALUES (' + [...(hasGeom ? ['?'] : []), ...cols.map(() => '?')].join(',') + ')');
      db.run('BEGIN');
      for (const f of l.features) {
        const vals = [];
        if (hasGeom) { if (f.geometry) { const wkb = toWKB(f.geometry); const h = new Uint8Array(8 + wkb.length); h[0] = 0x47; h[1] = 0x50; h[2] = 0; h[3] = 1; new DataView(h.buffer).setInt32(4, srsId, true); h.set(wkb, 8); vals.push(h); } else vals.push(null); }
        cols.forEach(c => { const v = f.properties[c.src]; if (v == null || v === '') { vals.push(null); return; } if (c.type === 'TEXT') vals.push(String(v)); else if (c.type === 'DATETIME') { const d = new Date(v); vals.push(isNaN(d) ? null : d.toISOString().replace(/\.\d+Z$/, 'Z')); } else { const n = Number(v); vals.push(isFinite(n) ? (c.type === 'INTEGER' ? Math.round(n) : n) : null); } });
        stmt.run(vals);
      }
      db.run('COMMIT'); stmt.free();
    }
    // field domains (GeoPackage schema extension) → GDAL turns them into File Geodatabase domains
    if (domRows.length) {
      db.run('CREATE TABLE IF NOT EXISTS gpkg_extensions (table_name TEXT, column_name TEXT, extension_name TEXT NOT NULL, definition TEXT NOT NULL, scope TEXT NOT NULL, CONSTRAINT ge_tce UNIQUE (table_name, column_name, extension_name))');
      db.run("INSERT INTO gpkg_extensions VALUES ('gpkg_data_columns',NULL,'gpkg_schema','http://www.geopackage.org/spec121/#extension_schema','read-write'),('gpkg_data_column_constraints',NULL,'gpkg_schema','http://www.geopackage.org/spec121/#extension_schema','read-write')");
      db.run('CREATE TABLE gpkg_data_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, name TEXT, title TEXT, description TEXT, mime_type TEXT, constraint_name TEXT, CONSTRAINT pk_gdc PRIMARY KEY (table_name, column_name), CONSTRAINT gdc_tn UNIQUE (table_name, name))');
      db.run('CREATE TABLE gpkg_data_column_constraints (constraint_name TEXT NOT NULL, constraint_type TEXT NOT NULL, value TEXT, min NUMERIC, min_is_inclusive BOOLEAN, max NUMERIC, max_is_inclusive BOOLEAN, description TEXT, CONSTRAINT gdcc_ntv UNIQUE (constraint_name, constraint_type, value))');
      const doneD = new Set();
      domRows.forEach(([tn, col, d]) => {
        const cn = String(d.name || (tn + '_' + col)); db.run('INSERT INTO gpkg_data_columns (table_name,column_name,constraint_name) VALUES (?,?,?)', [tn, col, cn]);
        if (doneD.has(cn)) return; doneD.add(cn);
        if (d.range) db.run("INSERT INTO gpkg_data_column_constraints VALUES (?,'range',NULL,?,1,?,1,?)", [cn, d.range[0], d.range[1], cn]);
        else (d.codes || []).forEach(c => { try { db.run("INSERT INTO gpkg_data_column_constraints VALUES (?,'enum',?,NULL,NULL,NULL,NULL,?)", [cn, String(c.code), String(c.name == null ? c.code : c.name)]); } catch (e) { } });
      });
    }
    const out = db.export(); db.close();
    return out;
  }


  /* ---------- prepare layers for File Geodatabase ---------- */
  const RESERVED = /^(objectid|fid|oid|shape|shape_length|shape_area|shape_len|shape\.stlength\(\)|shape\.starea\(\))$/i;
  function gdbName(s, used, prefix) {
    let n = String(s).normalize('NFC').replace(/[^\p{L}\p{N}_]/gu, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!n || !/^\p{L}/u.test(n)) n = prefix + (n ? '_' + n : '');
    n = n.slice(0, 60); let b = n, k = 2; while (used.has(n.toLowerCase())) n = b.slice(0, 56) + '_' + k++; used.add(n.toLowerCase()); return n;
  }
  function toMulti(g) {
    if (!g) return null;
    if (g.type === 'Point') return { type: 'MultiPoint', coordinates: [g.coordinates] };
    if (g.type === 'LineString') return { type: 'MultiLineString', coordinates: [g.coordinates] };
    if (g.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [g.coordinates] };
    if (g.type === 'GeometryCollection') return null;
    return g;
  }
  function prepGDB(layers) {
    const usedL = new Set(); const out = [];
    const FAM_AR = { Point: 'points', LineString: 'lines', Polygon: 'polygons' };
    for (const l of layers) {
      const groups = {};
      for (const f of l.features) {
        const gs = explode(f.geometry);
        if (!gs.length) { (groups.None = groups.None || []).push({ properties: f.properties, geometry: null }); continue; }
        const byFam = {}; gs.forEach(g => { const fm = fam(g); (byFam[fm] = byFam[fm] || []).push(g); });
        for (const fm in byFam) {
          const parts = byFam[fm].flatMap(g => fm === 'Point' ? pts(g) : fm === 'LineString' ? lines(g) : polys(g));
          const mg = { type: 'Multi' + fm, coordinates: parts };
          (groups[fm] = groups[fm] || []).push({ properties: f.properties, geometry: mg });
        }
      }
      if (groups.Point && groups.Point.every(f => f.geometry.coordinates.length === 1)) groups.Point.forEach(f => { f.geometry = { type: 'Point', coordinates: f.geometry.coordinates[0] }; });
      const fams = Object.keys(groups).filter(k => k !== 'None');
      const usedF = new Set(['objectid', 'shape', 'shape_length', 'shape_area']);
      const fmap = l.fields.filter(k => !RESERVED.test(k)).map(k => [k, gdbName(k, usedF, 'F')]);
      const types = {}; if (l.types) fmap.forEach(([a, b]) => { if (l.types[a]) types[b] = l.types[a]; });
      const dom = {}; if (l._dom) fmap.forEach(([a, b]) => { const k = Object.keys(l._dom).find(x => x.toLowerCase() === String(a).toLowerCase()); if (k) dom[b] = l._dom[k]; });
      const mk = (fm, feats) => ({ name: gdbName(l.name + (fams.length > 1 && fm !== 'None' ? '_' + FAM_AR[fm] : ''), usedL, 'L'), color: l.color, types, dom, fields: fmap.map(x => x[1]), features: feats.map(f => { const p = {}; fmap.forEach(([a, b]) => { if (f.properties && a in f.properties) p[b] = f.properties[a]; }); return { properties: p, geometry: f.geometry }; }) });
      if (!fams.length) { const o2 = mk('None', groups.None || []); const GTH = { point: 'POINT', line: 'MULTILINESTRING', polygon: 'MULTIPOLYGON' }; if (!o2.features.length && GTH[l.kind]) o2.gt = GTH[l.kind]; out.push(o2); }
      fams.forEach(fm => out.push(mk(fm, groups[fm])));
    }
    return out;
  }
  const api = { clipLayers, prepGDB, toMulti, cadLayerName, aci, geojson, csv, kml, shapefiles, dxf, gpkg, toWKT, toWKB, wktForEPSG, safeName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Writers = api;
})(this);
