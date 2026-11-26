// Minimal Esri File Geodatabase (.gdb) reader -> GeoJSON-like layers (native coordinates)
// Based on the OpenFileGDB format description (GDAL). Supports v10+ tables, point/multipoint/line/polygon (+Z).
(function (root) {
  'use strict';
  const TD = new TextDecoder('utf-8');
  const TD16 = new TextDecoder('utf-16le');

  function Reader(buf) { this.b = new Uint8Array(buf); this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength); this.p = 0; }
  Reader.prototype = {
    u8() { return this.b[this.p++]; },
    u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; },
    i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; },
    u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; },
    i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; },
    f32() { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; },
    f64() { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; },
    u64() { const lo = this.dv.getUint32(this.p, true), hi = this.dv.getUint32(this.p + 4, true); this.p += 8; return hi * 4294967296 + lo; },
    i64() { const lo = this.dv.getUint32(this.p, true), hi = this.dv.getInt32(this.p + 4, true); this.p += 8; return hi * 4294967296 + lo; },
    varuint() { let v = 0, mul = 1, b; do { b = this.b[this.p++]; v += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80); return v; },
    varint() { let b = this.b[this.p++]; let v = b & 0x3f; const neg = b & 0x40; let mul = 64; while (b & 0x80) { b = this.b[this.p++]; v += (b & 0x7f) * mul; mul *= 128; } return neg ? -v : v; },
    utf16(nchars) { const s = TD16.decode(this.b.subarray(this.p, this.p + nchars * 2)); this.p += nchars * 2; return s; },
    bytes(n) { const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  };

  // field types
  const T = { INT16: 0, INT32: 1, FLOAT32: 2, FLOAT64: 3, STRING: 4, DATETIME: 5, OBJECTID: 6, GEOMETRY: 7, BINARY: 8, RASTER: 9, GUID: 10, GLOBALID: 11, XML: 12, INT64: 13, DATE: 14, TIME: 15, DATETIMEOFFSET: 16 };

  function parseHeader(tableBuf) {
    const r = new Reader(tableBuf);
    const magic = r.i32();
    const nValid = r.u32();
    r.p = 32;
    const offDesc = r.u64();
    r.p = offDesc;
    const descLen = r.u32();
    const version = r.u32();
    const geomType = r.b[r.p]; const utf8 = (r.b[r.p + 1] & 1) !== 0; const zmFlags = r.b[r.p + 3];
    r.p += 4;
    const nFields = r.u16();
    const hasZ = (zmFlags & 0x80) !== 0, hasM = (zmFlags & 0x40) !== 0;
    const fields = [];
    let geom = null;
    for (let i = 0; i < nFields; i++) {
      const name = r.utf16(r.u8());
      const alias = r.utf16(r.u8());
      const type = r.u8();
      const f = { name, alias, type, nullable: false };
      if (type !== T.GEOMETRY && type !== T.RASTER) {
        let flags = 0, defLen = 0;
        if (type === T.STRING) { r.i32(); flags = r.u8(); defLen = r.varuint(); }
        else if (type === T.OBJECTID || type === T.BINARY || type === T.GUID || type === T.GLOBALID || type === T.XML) { r.u8(); flags = r.u8(); }
        else { r.u8(); flags = r.u8(); defLen = r.u8(); }
        r.p += defLen;
        f.nullable = (flags & 1) !== 0;
      } else {
        r.u8(); const flags = r.u8(); f.nullable = (flags & 1) !== 0;
        if (type === T.RASTER) { const n = r.u8(); r.utf16(n); }
        const wktLen = r.u16();
        f.wkt = r.utf16(wktLen / 2);
        const gflags = r.u8();
        const fM = (gflags & 2) !== 0, fZ = (gflags & 4) !== 0;
        if (type === T.GEOMETRY || gflags > 0) {
          f.xorig = r.f64(); f.yorig = r.f64(); f.xyscale = r.f64();
          if (fM) { f.morig = r.f64(); f.mscale = r.f64(); }
          if (fZ) { f.zorig = r.f64(); f.zscale = r.f64(); }
          r.f64(); if (fM) r.f64(); if (fZ) r.f64();
        }
        if (type === T.RASTER) { r.u8(); }
        else {
          f.extent = [r.f64(), r.f64(), r.f64(), r.f64()];
          if (hasZ) { r.f64(); r.f64(); }
          if (hasM) { r.f64(); r.f64(); }
          r.u8(); const ng = r.u32(); r.p += ng * 8;
          geom = f;
        }
      }
      fields.push(f);
    }
    return { magic, nValid, version, utf8, geomType, hasZ, hasM, fields, geom };
  }

  function rowOffsets(tablxBuf) {
    const r = new Reader(tablxBuf);
    r.i32(); const nBlocks = r.u32(); const nTotal = r.i32(); const osz = r.u32();
    const offs = [];
    const readOff = (pos) => { let v = 0, mul = 1; for (let k = 0; k < osz; k++) { v += r.b[pos + k] * mul; mul *= 256; } return v; };
    const trailer = 16 + osz * 1024 * nBlocks;
    let blockMap = null;
    if (nBlocks > 0 && r.b.length >= trailer + 16) {
      r.p = trailer;
      const nWords = r.u32(); const nBits = r.u32(); r.u32(); r.u32();
      if (nWords > 0) { blockMap = r.b.subarray(r.p, r.p + Math.ceil(nBits / 8)); }
    }
    for (let i = 0; i < nTotal; i++) {
      let idx = i;
      if (blockMap) {
        const blk = Math.floor(i / 1024);
        if (!(blockMap[blk >> 3] & (1 << (blk & 7)))) { offs.push(0); continue; }
        let before = 0; for (let j = 0; j < blk; j++) if (blockMap[j >> 3] & (1 << (j & 7))) before++;
        idx = before * 1024 + (i % 1024);
      }
      const pos = 16 + osz * idx;
      offs.push(pos + osz <= trailer ? readOff(pos) : 0);
    }
    return offs;
  }

  function dateFromDays(d) { if (!isFinite(d)) return null; const ms = (d - 25569) * 86400000; const dt = new Date(Math.round(ms)); return isNaN(dt) ? null : dt.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '').replace(/ 00:00:00$/, ''); }
  function hex(b) { return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
  function guid(b) { // stored little-endian for first 3 groups
    const h = hex(b);
    const rev = s => s.match(/../g).reverse().join('');
    return '{' + (rev(h.slice(0, 8)) + '-' + rev(h.slice(8, 12)) + '-' + rev(h.slice(12, 16)) + '-' + h.slice(16, 20) + '-' + h.slice(20)).toUpperCase() + '}';
  }

  const PT = new Set([1, 9, 11, 21, 52]), MPT = new Set([8, 18, 20, 28, 53]), LN = new Set([3, 10, 13, 23, 50]), PG = new Set([5, 15, 19, 25, 51]);
  const ZT = new Set([9, 11, 18, 20, 10, 13, 15, 19]);

  function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }

  function readGeom(bytes, gf) {
    const r = new Reader(bytes);
    const t = r.varuint();
    const base = t & 0xff;
    const hasZ = ZT.has(base) || (t & 0x80000000) !== 0;
    const sx = gf.xyscale, ox = gf.xorig, oy = gf.yorig;
    const zs = gf.zscale || 1, oz = gf.zorig || 0;
    if (base === 0) return null;
    if (PT.has(base)) {
      const x = r.varuint(), y = r.varuint();
      if (x === 0) return null;
      const c = [(x - 1) / sx + ox, (y - 1) / sx + oy];
      if (hasZ) { const z = r.varuint(); if (z) c.push((z - 1) / zs + oz); }
      return { type: 'Point', coordinates: c };
    }
    const isMP = MPT.has(base), isLN = LN.has(base), isPG = PG.has(base);
    if (!isMP && !isLN && !isPG) return null; // multipatch etc. unsupported
    const nPts = r.varuint();
    if (nPts === 0) return null;
    let nParts = 1;
    if (!isMP) { nParts = r.varuint(); if (t & 0x20000000) r.varuint(); }
    r.varuint(); r.varuint(); r.varuint(); r.varuint();
    const counts = [];
    if (!isMP) { let s = 0; for (let i = 0; i < nParts - 1; i++) { const c = r.varuint(); counts.push(c); s += c; } counts.push(nPts - s); }
    const pts = new Array(nPts);
    let dx = 0, dy = 0;
    for (let i = 0; i < nPts; i++) { dx += r.varint(); dy += r.varint(); pts[i] = [dx / sx + ox, dy / sx + oy]; }
    if (hasZ && r.p < r.b.length) { let dz = 0; for (let i = 0; i < nPts && r.p < r.b.length; i++) { dz += r.varint(); pts[i].push(dz / zs + oz); } }
    if (isMP) return { type: 'MultiPoint', coordinates: pts };
    const parts = []; let k = 0; for (const c of counts) { parts.push(pts.slice(k, k + c)); k += c; }
    if (isLN) return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
    // polygon: esri outer rings are clockwise (negative area in y-up)
    const polys = [];
    for (const ring of parts) {
      if (ring.length < 4) continue;
      if (ringArea(ring) <= 0 || polys.length === 0) polys.push([ring]); else polys[polys.length - 1].push(ring);
    }
    if (!polys.length) return null;
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }

  function readTable(tableBuf, tablxBuf, opts) {
    opts = opts || {};
    const h = parseHeader(tableBuf);
    const r = new Reader(tableBuf);
    const offs = tablxBuf ? rowOffsets(tablxBuf) : [];
    const nNullable = h.fields.filter(f => f.nullable).length;
    const nullBytes = Math.ceil(nNullable / 8);
    const features = [];
    const limit = opts.limit || Infinity;
    for (let i = 0; i < offs.length && features.length < limit; i++) {
      const off = offs[i]; if (!off) continue;
      r.p = off;
      let blen = r.i32(); if (blen < 0) blen = -blen; // deleted rows can be negative
      const start = r.p, end = start + blen;
      const nulls = r.b.subarray(start, start + nullBytes);
      r.p = start + nullBytes;
      const props = {}; let geometry = null; let iNull = 0;
      try {
        for (const f of h.fields) {
          if (f.nullable) { const isNull = nulls[iNull >> 3] & (1 << (iNull & 7)); iNull++; if (isNull) { if (f.type !== T.GEOMETRY && f.type !== T.RASTER) props[f.name] = null; continue; } }
          switch (f.type) {
            case T.OBJECTID: props[f.name] = i + 1; break;
            case T.INT16: props[f.name] = r.i16(); break;
            case T.INT32: props[f.name] = r.i32(); break;
            case T.FLOAT32: props[f.name] = r.f32(); break;
            case T.FLOAT64: props[f.name] = r.f64(); break;
            case T.INT64: props[f.name] = r.i64(); break;
            case T.STRING: case T.XML: { const n = r.varuint(); const bs = r.bytes(n); props[f.name] = h.utf8 ? TD.decode(bs) : TD16.decode(bs); break; }
            case T.DATETIME: case T.DATE: props[f.name] = dateFromDays(r.f64()); break;
            case T.TIME: { const d = r.f64(); const s = Math.round(d * 86400); props[f.name] = new Date(s * 1000).toISOString().substr(11, 8); break; }
            case T.DATETIMEOFFSET: { const d = r.f64(); r.i16(); props[f.name] = dateFromDays(d); break; }
            case T.GEOMETRY: { const n = r.varuint(); const bs = r.bytes(n); try { geometry = readGeom(bs, f); } catch (e) { geometry = null; } break; }
            case T.BINARY: { const n = r.varuint(); r.p += n; props[f.name] = '[binary ' + n + ' B]'; break; }
            case T.RASTER: { const n = r.varuint(); r.p += n; break; }
            case T.GUID: case T.GLOBALID: props[f.name] = guid(r.bytes(16)); break;
          }
          if (r.p > end) throw new Error('overrun');
        }
      } catch (e) { continue; }
      features.push({ type: 'Feature', properties: props, geometry });
    }
    return { header: h, features };
  }

  // files: { 'a00000001.gdbtable': ArrayBuffer, ... } (basename keys, lower case)
  function readGDB(files, opts) {
    const get = n => files[n.toLowerCase()];
    const cat = get('a00000001.gdbtable');
    if (!cat) throw new Error('GDB_SystemCatalog (a00000001.gdbtable) غير موجود');
    const catalog = readTable(cat, get('a00000001.gdbtablx'));
    const layers = [];
    catalog.features.forEach((ft, idx) => {
      const name = ft.properties.Name || ft.properties.NAME;
      const id = ft.properties.ID || ft.properties.OBJECTID || idx + 1;
      if (!name || /^GDB_/i.test(name)) return;
      const base = 'a' + id.toString(16).padStart(8, '0');
      const tb = get(base + '.gdbtable'); if (!tb) return;
      try {
        const t = readTable(tb, get(base + '.gdbtablx'), opts);
        const GT = { 1: 'point', 2: 'point', 3: 'line', 4: 'polygon' }; const FT = { 0: 'int', 1: 'int', 2: 'real', 3: 'real', 4: 'text', 5: 'date', 10: 'text', 12: 'text', 13: 'int', 14: 'date', 15: 'text', 16: 'date' };
        layers.push({ name, schema: { geom: GT[t.header.geomType] || null, fields: t.header.fields.filter(f => FT[f.type]).map(f => ({ name: f.name, type: FT[f.type] })) }, wkt: t.header.geom ? t.header.geom.wkt : null, geomType: t.header.geomType, fields: t.header.fields.filter(f => f.type !== T.GEOMETRY && f.type !== T.RASTER).map(f => f.name), features: t.features, hasGeometry: !!t.header.geom });
      } catch (e) { layers.push({ name, error: String(e.message || e), features: [] }); }
    });
    // domains and subtypes from GDB_Items (coded values, field→domain, subtype field and codes)
    try {
      const it = catalog.features.find(ft => /^GDB_Items$/i.test(ft.properties.Name || '')); const iid = it ? (it.properties.ID || it.properties.OBJECTID) : 4;
      const ib = 'a' + Number(iid).toString(16).padStart(8, '0'); const itb = get(ib + '.gdbtable');
      if (itb) { const items = readTable(itb, get(ib + '.gdbtablx')).features; const DOM = {}; const tag = (x, t) => { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(x); return m ? m[1] : null; }; const unx = v => v == null ? v : v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        items.forEach(r => { const d = String(r.properties.Definition || ''); if (/^(<\?xml[^>]*>\s*)?<(\w+:)?GPCodedValueDomain2/.test(d)) { const nm = unx(tag(d, 'DomainName')); const ft = tag(d, 'FieldType') || ''; const codes = []; (d.match(/<CodedValue [\s\S]*?<\/CodedValue>/g) || []).forEach(cv => { const n2 = unx(tag(cv, 'Name')); const c = unx((/<Code\b[^>]*>([\s\S]*?)<\/Code>/.exec(cv) || [])[1]); codes.push({ code: /Integer|Double|Single/.test(ft) && c != null && c !== '' && isFinite(+c) ? +c : c, name: n2 }); }); DOM[nm] = { name: nm, type: ft, codes }; } else if (/^(<\?xml[^>]*>\s*)?<(\w+:)?GPRangeDomain2/.test(d)) { const nm = unx(tag(d, 'DomainName')); DOM[nm] = { name: nm, range: [+tag(d, 'MinValue'), +tag(d, 'MaxValue')] }; } });
        items.forEach(r => { const d = String(r.properties.Definition || ''); if (!/^(<\?xml[^>]*>\s*)?<(\w+:)?DE(FeatureClass|Table)Info/.test(d)) return; const nm = String(r.properties.Name || '').split(/[\\.]/).pop(); const L = layers.find(l => l.name === nm || l.name.toLowerCase() === nm.toLowerCase()); if (!L) return;
          const fd = {}; (d.match(/<GPFieldInfoEx [\s\S]*?<\/GPFieldInfoEx>/g) || []).forEach(x => { const f = tag(x, 'Name'), dn = tag(x, 'DomainName'); if (f && dn && DOM[unx(dn)]) fd[f] = unx(dn); });
          const sfn = tag(d, 'SubtypeFieldName'); let st = null; if (sfn) { st = { field: sfn, list: [] }; (d.match(/<Subtype [\s\S]*?<\/Subtype>/g) || []).forEach(x => { const fdm = {}; (x.match(/<SubtypeFieldInfo [\s\S]*?<\/SubtypeFieldInfo>/g) || []).forEach(y => { const f = tag(y, 'FieldName'), dn = tag(y, 'DomainName'); if (f && dn && DOM[unx(dn)]) fdm[f] = unx(dn); }); st.list.push({ code: +tag(x, 'SubtypeCode'), name: unx(tag(x, 'SubtypeName')), fieldDomains: fdm }); }); if (!st.list.length) st = null; }
          L.domains = fd; L.subtypes = st; L.domainDefs = DOM; });
      }
    } catch (e) { }
    return layers;
  }

  const api = { readGDB, readTable, parseHeader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FGDB = api;
})(this);
