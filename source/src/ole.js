// Embedded OLE objects inside DWG (Excel tables pasted into drawings): CFB → Excel package / picture → table
(function () {
  'use strict';
  const GV = window.GV;
  const hex2u8 = h => { if (h instanceof Uint8Array) return h; const n = h.length >> 1; const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };
  const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  const find = (u, sig, from) => { outer: for (let i = from || 0; i <= u.length - sig.length; i++) { for (let j = 0; j < sig.length; j++) if (u[i + j] !== sig[j]) continue outer; return i; } return -1; };
  // minimal Compound File Binary reader → {name: Uint8Array}
  function cfb(u) {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength); const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), cutoff = dv.getUint32(56, true), miniFatStart = dv.getUint32(60, true), difStart = dv.getUint32(68, true), nDif = dv.getUint32(72, true);
    const sec = i => (i + 1) * ss; const fatSecs = []; for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
    let d = difStart; for (let k = 0; k < nDif && d < 0xFFFFFFFA; k++) { for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(sec(d) + i * 4, true)); d = dv.getUint32(sec(d) + ss - 4, true); }
    const fat = []; fatSecs.forEach(fs => { for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(sec(fs) + i * 4, true)); });
    const chain = (st, tbl) => { const out = []; let c = st, g = 0; while (c < 0xFFFFFFFA && g++ < 1e6) { out.push(c); c = tbl[c]; } return out; };
    const readBig = (st, size) => { const out = new Uint8Array(size); let o = 0; chain(st, fat).forEach(c => { const n = Math.min(ss, size - o); if (n > 0) out.set(u.subarray(sec(c), sec(c) + n), o); o += n; }); return out; };
    const dirCh = chain(dirStart, fat); const ents = [];
    dirCh.forEach(c => { for (let k = 0; k < ss / 128; k++) { const o = sec(c) + k * 128; const nl = dv.getUint16(o + 64, true); let name = ''; for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(dv.getUint16(o + i * 2, true)); ents.push({ name, type: u[o + 66], start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) }); } });
    const root = ents[0]; const miniStream = root ? readBig(root.start, root.size) : new Uint8Array(0);
    const miniFat = []; if (miniFatStart < 0xFFFFFFFA) chain(miniFatStart, fat).forEach(c => { for (let i = 0; i < ss / 4; i++) miniFat.push(dv.getUint32(sec(c) + i * 4, true)); });
    const readMini = (st, size) => { const out = new Uint8Array(size); let o = 0; chain(st, miniFat).forEach(c => { const n = Math.min(mss, size - o); if (n > 0) out.set(miniStream.subarray(c * mss, c * mss + n), o); o += n; }); return out; };
    const streams = {}; ents.forEach(e => { if (e.type === 2) streams[e.name] = e.size < cutoff ? readMini(e.start, e.size) : readBig(e.start, e.size); });
    return streams;
  }

  const u32 = (u, o) => (u[o] | u[o + 1] << 8 | u[o + 2] << 16 | u[o + 3] << 24) >>> 0, u16 = (u, o) => u[o] | u[o + 1] << 8;
  function dib2bmp(dib) { if (!dib || dib.length < 40 || u32(dib, 0) < 12) return null; const hs = u32(dib, 0); const bits = u16(dib, 14); const clr = hs >= 40 ? u32(dib, 32) : 0; const comp = hs >= 40 ? u32(dib, 16) : 0; const pal = bits <= 8 ? (clr || (1 << bits)) * 4 : (comp === 3 && hs === 40 ? 12 : 0); const out = new Uint8Array(14 + dib.length); out[0] = 0x42; out[1] = 0x4D; const dv = new DataView(out.buffer); dv.setUint32(2, out.length, true); dv.setUint32(10, 14 + hs + pal, true); out.set(dib, 14); return out; }
  function bmpOf(p) {
    if (!p || p.length < 64) return null;
    const bm = find(p.subarray(0, 64), [0x42, 0x4D]); if (bm >= 0 && u32(p, bm + 2) > 64) return p.subarray(bm);
    // placeable WMF → META_STRETCHDIB (0x0F43) / META_DIBSTRETCHBLT (0x0B41)
    if (u32(p, 0) === 0x9AC6CDD7) { let q = 22 + 18, best = null; while (q + 6 <= p.length) { const sz = u32(p, q) * 2, fn = u16(p, q + 4); if (sz < 6) break; if (fn === 0x0F43 || fn === 0x0B41) { const dib = p.subarray(q + (fn === 0x0F43 ? 28 : 26), q + sz); if (!best || dib.length > best.length) best = dib; } q += sz; } return best ? dib2bmp(best) : null; }
    // EMF (optionally after a 4-byte prefix) → EMR_STRETCHDIBITS (81) / EMR_BITBLT (76) / EMR_STRETCHBLT (77)
    for (const st of [0, 4, 8]) { if (u32(p, st) !== 1 || u32(p, st + 40) !== 0x464D4520) continue; let q = st, best = null; while (q + 8 <= p.length) { const t = u32(p, q), sz = u32(p, q + 4); if (sz < 8 || q + sz > p.length) break; let ob = 0, cb = 0, obits = 0, cbits = 0; if (t === 81) { ob = u32(p, q + 48); cb = u32(p, q + 52); obits = u32(p, q + 56); cbits = u32(p, q + 60); } else if (t === 76 || t === 77) { const k = t === 76 ? 84 : 92; ob = u32(p, q + k); cb = u32(p, q + k + 4); obits = u32(p, q + k + 8); cbits = u32(p, q + k + 12); } if (cb && cbits && (!best || cbits > best.c)) { const dib = new Uint8Array(cb + cbits); dib.set(p.subarray(q + ob, q + ob + cb)); dib.set(p.subarray(q + obits, q + obits + cbits), cb); best = { dib, c: cbits }; } q += sz; } if (best) return dib2bmp(best.dib); }
    // bare DIB
    if (u32(p, 0) === 40 || u32(p, 0) === 108 || u32(p, 0) === 124) return dib2bmp(p);
    return null;
  }
  // → [{kind:'xlsx'|'image', blob, name}]
  async function extract(item, idx) {
    const u = hex2u8(item.hex); const out = []; const nm = 'جدول ملزوق ' + (idx + 1);
    const pk = find(u, [0x50, 0x4B, 0x03, 0x04]); const c0 = find(u, SIG);
    let st = {}; if (c0 >= 0) { try { st = cfb(u.subarray(c0)); } catch (e) { console.warn('OLE CFB', e); } }
    // a full Excel workbook inside ("Package" stream = .xlsx)
    const pkg = st.Package || (pk >= 0 && (c0 < 0 || pk < c0) ? u.subarray(pk) : null);
    if (pkg && pkg[0] === 0x50 && pkg[1] === 0x4B) out.push({ kind: 'xlsx', blob: new Blob([pkg]), name: nm + '.xlsx' });
    // the picture AutoCAD draws: BMP, DIB, or a WMF/EMF that wraps a bitmap (Excel "paste as picture")
    const pics = []; if (st.CONTENTS) pics.push(st.CONTENTS); if (st['\x01Ole10Native']) pics.push(st['\x01Ole10Native']); Object.keys(st).filter(k => /OlePres/i.test(k)).forEach(k => pics.push(st[k]));
    let bmp = null;
    for (const pic of pics) { bmp = bmpOf(pic); if (bmp) break; }
    if (!out.length && bmp) {
      try { const bm2 = await createImageBitmap(new Blob([bmp], { type: 'image/bmp' })); const sc = Math.min(1, 3000 / Math.max(bm2.width, bm2.height)); const cv = document.createElement('canvas'); cv.width = Math.round(bm2.width * sc); cv.height = Math.round(bm2.height * sc); const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bm2, 0, 0, cv.width, cv.height); const png = await new Promise(r => cv.toBlob(r, 'image/png'));
        // tables are white paper + dark text/grid; logos are small or colourful → keep them out of Claude's queue
        let sat = 0, white = 0, n = 0; try { const st2 = Math.max(1, Math.floor(Math.sqrt(cv.width * cv.height / 40000))); const d = g.getImageData(0, 0, cv.width, cv.height).data; for (let y = 0; y < cv.height; y += st2) for (let x = 0; x < cv.width; x += st2) { const i = (y * cv.width + x) * 4; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); n++; if (mx - mn > 60) sat++; if (mn > 225) white++; } } catch (e) { }
        let rules = 0; try { const d = g.getImageData(0, 0, cv.width, cv.height).data; let prev = false; for (let y = 0; y < cv.height; y++) { let dk = 0; for (let x = 0; x < cv.width; x += 2) { const i = (y * cv.width + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) < 170) dk++; } const on = dk / (cv.width / 2) > 0.5; if (on && !prev) rules++; prev = on; } } catch (e) { }
        const isTable = cv.width >= 300 && cv.height >= 100 && n && sat / n < 0.07 && white / n > 0.45 && rules >= 3;
        out.push({ kind: 'image', blob: png, name: nm + '.png', w: cv.width, h: cv.height, isTable }); } catch (e) { console.warn('OLE BMP', e); }
    }
    return out;
  }
  GV.oleCount = src => new Set(((src && src.cadInfo && src.cadInfo.ole) || []).map(o => o.hex.length + ':' + o.hex.slice(0, 64) + o.hex.slice(-64))).size;
  GV.oleExtract = async src => { const seen = new Set(); const items = ((src && src.cadInfo && src.cadInfo.ole) || []).filter(o => { const k = o.hex.length + ':' + o.hex.slice(0, 64) + o.hex.slice(-64); if (seen.has(k)) return false; seen.add(k); return true; }); const all = []; for (let i = 0; i < items.length; i++) { try { (await extract(items[i], i)).forEach(x => all.push(Object.assign(x, { where: items[i].where, layer: items[i].layer }))); } catch (e) { console.warn(e); } } return all; };
  // send them to "data from files" as if the user attached them (Excel is read directly; pictures go to Claude)
  GV.oleToAttrSrc = async src => {
    const xs = await GV.oleExtract(src); if (!xs.length) return GV.showMsg('ملقتش جوه الـ OLE لا Excel ولا صورة أقدر أقراها.');
    const files = xs.map(x => new File([x.blob], x.name, { type: x.kind === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'image/png' }));
    GV.openAttrSrc(null, files);
  };
  // read them into tables: Excel directly, pictures by Claude → shown in the table viewer (roles, Excel, GIS points)
  GV.oleReadTables = async src => {
    const xs = await GV.oleExtract(src); const out = []; const crs = (src.layers.find(l => l.crsDef) || {}).crsDef || null;
    for (const x of xs) {
      try {
        if (x.kind === 'xlsx') (await GV.readXlsxRows(await x.blob.arrayBuffer())).forEach(sh => { const t = GV.shapeTable(sh.rows); if (t.rows && t.rows.length) out.push({ name: x.name + ' · ' + sh.name, t }); });
        else if (!x.isTable) { out.push({ name: x.name, logo: true }); }
        else { $busy('Claude بيقرا ' + x.name + '…'); (await GV.readImageTables(x.blob, x.name)).forEach(r => { const t = GV.shapeTable([r.head].concat(r.rows)); if (t.rows && t.rows.length) out.push({ name: r.name, t }); }); }
      } catch (e) { out.push({ name: x.name, err: e.message || String(e), img: x }); }
    }
    out.forEach(o => { if (o.t) GV.ctPrep(Object.assign(o.t, { title: [o.name] }), crs); });
    return { tables: out.filter(o => o.t), errors: out.filter(o => o.err), logos: out.filter(o => o.logo).length, extracted: xs };
  };
  const $busy = t => { const b = document.getElementById('busyText'); if (b) b.textContent = t; };
  GV.oleSaveImages = async src => { const xs = await GV.oleExtract(src); for (const x of xs.filter(x => x.kind !== 'image' || x.isTable)) await GV.saveFile(x.name, new Uint8Array(await x.blob.arrayBuffer())); if (!xs.length) GV.toast('مفيش حاجة اتطلعت'); };
})();
