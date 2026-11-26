/* 🗻 Surfaces & elevation rasters: show any surface (DEM or TIN) as colour ramp / hillshade / both / slope, make contour
   lines as a real layer, convert a Civil surface (TIN / LandXML / survey points) to a DEM (GeoTIFF or ASCII grid), and
   keep opened surfaces on this device so they come back after a restart. */
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const SURF = GV.surfaces; const M = L.CRS.EPSG3857;
  /* ---------- device store for surfaces ---------- */
  const db = () => new Promise((res, rej) => { const r = indexedDB.open('gv-surf', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = async (k, v) => { try { const d = await db(); d.transaction('s', 'readwrite').objectStore('s').put(v, k); } catch (e) { } };
  const del = async k => { try { const d = await db(); d.transaction('s', 'readwrite').objectStore('s').delete(k); } catch (e) { } };
  const all = async () => { try { const d = await db(); return await new Promise(r => { const out = []; const q = d.transaction('s').objectStore('s').openCursor(); q.onsuccess = () => { const c = q.result; if (c) { out.push([c.key, c.value]); c.continue(); } else r(out); }; q.onerror = () => r(out); }); } catch (e) { return []; } };
  GV.surfKeep = (s, rec) => { s.keepKey = s.keepKey || ('K' + Date.now().toString(36)); if (rec && (rec.size || 0) < 150e6) put(s.keepKey, Object.assign({ name: s.name, style: s.style || null }, rec)); };

  /* ---------- sample a surface on a web-mercator grid ---------- */
  function grid(s, maxW) {
    const b = s.bounds; const p0 = M.project(L.latLng(b[0][0], b[0][1])), p1 = M.project(L.latLng(b[1][0], b[1][1]));
    const dx = p1.x - p0.x, dy = p1.y - p0.y; const W = Math.max(2, Math.min(maxW, Math.round(maxW * Math.min(1, dx / dy)))), H = Math.max(2, Math.round(W * dy / dx));
    const z = new Float32Array(W * H).fill(NaN);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const ll = M.unproject(L.point(p0.x + (i + 0.5) / W * dx, p1.y - (j + 0.5) / H * dy)); const v = s.sample(ll.lng, ll.lat); if (v != null && isFinite(v)) z[j * W + i] = v; }
    const lat = (b[0][0] + b[1][0]) / 2; const cell = dx / W * Math.cos(lat * Math.PI / 180); // ground metres per pixel
    return { z, W, H, p0, p1, dx, dy, cell };
  }
  const ramp = [[0, [38, 115, 77]], [0.25, [122, 171, 74]], [0.5, [236, 219, 125]], [0.75, [196, 132, 72]], [1, [248, 245, 240]]];
  const col = t => { t = Math.max(0, Math.min(1, t)); for (let k = 1; k < ramp.length; k++) if (t <= ramp[k][0]) { const [a, ca] = ramp[k - 1], [b2, cb] = ramp[k]; const u = (t - a) / (b2 - a); return [0, 1, 2].map(c => ca[c] + (cb[c] - ca[c]) * u); } return ramp[ramp.length - 1][1]; };
  const STY = { color: 'ألوان المناسيب', hs: 'هيل شيد (تضاريس)', both: 'ألوان + هيل شيد', slope: 'الميول', none: 'مخفي' };
  function render(s, style, zf) {
    if (s.leaf) { GV.map.removeLayer(s.leaf); s.leaf = null; } s.style = style; if (!style || style === 'none') return;
    const G = grid(s, 1400); const { z, W, H } = G;
    const vals = []; for (let k = 0; k < z.length; k += Math.max(1, Math.floor(z.length / 20000))) if (!isNaN(z[k])) vals.push(z[k]); vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.02)] || 0, hi = vals[Math.floor(vals.length * 0.98)] || 1; s.lohi = [lo, hi];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'); const im = cx.createImageData(W, H);
    const Z = (i, j) => { i = Math.max(0, Math.min(W - 1, i)); j = Math.max(0, Math.min(H - 1, j)); const v = z[j * W + i]; return isNaN(v) ? z[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))] : v; };
    const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180; zf = zf || 2;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const o = j * W + i, v = z[o]; if (isNaN(v)) continue;
      const a = Z(i - 1, j - 1), b = Z(i, j - 1), c = Z(i + 1, j - 1), d = Z(i - 1, j), f = Z(i + 1, j), g = Z(i - 1, j + 1), h = Z(i, j + 1), ii = Z(i + 1, j + 1);
      const gx = ((c + 2 * f + ii) - (a + 2 * d + g)) / (8 * G.cell) * zf, gy = ((g + 2 * h + ii) - (a + 2 * b + c)) / (8 * G.cell) * zf;
      const sl = Math.atan(Math.hypot(gx, gy)); const as = Math.atan2(gy, -gx);
      const shade = Math.max(0, Math.cos(Math.PI / 2 - alt) * Math.cos(sl) + Math.sin(Math.PI / 2 - alt) * Math.sin(sl) * Math.cos(az - as));
      let rgb;
      if (style === 'hs') { const g2 = 40 + shade * 215; rgb = [g2, g2, g2]; }
      else if (style === 'slope') { const deg = Math.atan(Math.hypot(gx, gy) / zf) * 180 / Math.PI; rgb = col(1 - Math.min(1, deg / 30)).map((x, k) => [x, x, x][k]); const t = Math.min(1, deg / 20); rgb = [60 + 195 * t, 180 - 120 * t, 80 - 40 * t]; }
      else { const c0 = col((v - lo) / ((hi - lo) || 1)); rgb = style === 'both' ? c0.map(x => x * (0.45 + 0.65 * shade)) : c0; }
      im.data[o * 4] = rgb[0]; im.data[o * 4 + 1] = rgb[1]; im.data[o * 4 + 2] = rgb[2]; im.data[o * 4 + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    s.leaf = L.imageOverlay(cv.toDataURL('image/png'), s.bounds, { opacity: s.opacity == null ? 0.85 : s.opacity, zIndex: 240, interactive: false }).addTo(GV.map);
    if (s.keepKey) all().then(rs => { const r = rs.find(x => x[0] === s.keepKey); if (r) put(s.keepKey, Object.assign(r[1], { style })); });
  }
  GV.styleSurface = render;

  /* ---------- contours → a real line layer ---------- */
  async function contours(s, step) {
    const G = grid(s, 1600); const { z, W, H, p0, dx, dy } = G;
    let mn = Infinity, mx = -Infinity; for (const v of z) if (!isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!step) { const r = mx - mn; step = r > 200 ? 10 : r > 60 ? 5 : r > 15 ? 1 : r > 4 ? 0.5 : 0.25; }
    const toLL = (x, y) => { const ll = M.unproject(L.point(p0.x + x / W * dx, p0.y + dy - y / H * dy)); return [+ll.lng.toFixed(8), +ll.lat.toFixed(8)]; };
    const feats = [];
    for (let lv = Math.ceil(mn / step) * step; lv <= mx; lv += step) {
      const segs = [];
      for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
        const a = z[j * W + i], b = z[j * W + i + 1], c = z[(j + 1) * W + i + 1], d = z[(j + 1) * W + i]; if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) continue;
        const idx = (a >= lv ? 8 : 0) | (b >= lv ? 4 : 0) | (c >= lv ? 2 : 0) | (d >= lv ? 1 : 0); if (idx === 0 || idx === 15) continue;
        const t = (u, v) => (lv - u) / ((v - u) || 1e-9);
        const T = [i + 0.5 + t(a, b), j + 0.5], R = [i + 1.5, j + 0.5 + t(b, c)], B = [i + 0.5 + t(d, c), j + 1.5], Lf = [i + 0.5, j + 0.5 + t(a, d)];
        const S = { 1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]], 8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]] }[idx];
        S.forEach(sg => segs.push(sg));
      }
      // chain the segments into lines
      const key = p => p[0].toFixed(4) + ',' + p[1].toFixed(4); const ends = new Map(); const used = new Uint8Array(segs.length);
      segs.forEach((sg, k) => { for (const p of sg) { const kk = key(p); let a = ends.get(kk); if (!a) ends.set(kk, a = []); a.push(k); } });
      for (let k = 0; k < segs.length; k++) { if (used[k]) continue; used[k] = 1; const line = [segs[k][0], segs[k][1]];
        for (const dir of [1, 0]) { for (let g = 0; g < 100000; g++) { const tip = dir ? line[line.length - 1] : line[0]; const nx = (ends.get(key(tip)) || []).find(q => !used[q]); if (nx == null) break; used[nx] = 1; const sg = segs[nx]; const other = key(sg[0]) === key(tip) ? sg[1] : sg[0]; if (dir) line.push(other); else line.unshift(other); } }
        if (line.length > 1) feats.push({ type: 'Feature', properties: { ELEVATION: +lv.toFixed(3), INDEX: Math.abs(lv / (step * 5) - Math.round(lv / (step * 5))) < 1e-6 ? 1 : 0 }, geometry: { type: 'LineString', coordinates: line.map(p => toLL(p[0], p[1])) } }); }
      if (feats.length > 60000) break;
    }
    await GV.addGroups([{ name: 'كنتور — ' + s.name, type: 'Contours', layers: [{ name: 'Contours_' + step + 'm', features: feats, crs: '4326', color: '#8d5524' }] }], { noAsk: true });
    GV.renderLayers(); GV.updateEmpty(); if (GV.onDirty) GV.onDirty();
    GV.toast('اتعمل ' + feats.length.toLocaleString('en') + ' خط كنتور كل ' + step + ' م — تقدر تصدّرهم كاد أو SHP', 6000);
  }

  /* ---------- Civil surface (TIN) → DEM ---------- */
  function tiffFloat(data, w, h, x0, y1, cell, epsg, geographic) {
    const ifdN = 15; const gk = [1, 1, 0, 3, 1024, 0, 1, geographic ? 2 : 1, 1025, 0, 1, 1, geographic ? 2048 : 3072, 0, 1, +epsg];
    const nd = '-9999\0'; const dataOff = 8 + 2 + ifdN * 12 + 4; let extra = dataOff;
    const scaleOff = extra; extra += 24; const tieOff = extra; extra += 48; const gkOff = extra; extra += gk.length * 2; const ndOff = extra; extra += nd.length; if (extra % 2) extra++;
    const imgOff = extra; const size = imgOff + w * h * 4; const buf = new ArrayBuffer(size); const v = new DataView(buf);
    v.setUint16(0, 0x4949); v.setUint16(2, 42, true); v.setUint32(4, 8, true); v.setUint16(8, ifdN, true);
    let p = 10; const tag = (t, type, n, val) => { v.setUint16(p, t, true); v.setUint16(p + 2, type, true); v.setUint32(p + 4, n, true); if (type === 3 && n === 1) v.setUint16(p + 8, val, true); else v.setUint32(p + 8, val, true); p += 12; };
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 32); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(273, 4, 1, imgOff); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, w * h * 4); tag(284, 3, 1, 1); tag(339, 3, 1, 3);
    tag(33550, 12, 3, scaleOff); tag(33922, 12, 6, tieOff); tag(34735, 3, gk.length, gkOff); tag(42113, 2, nd.length, ndOff);
    v.setUint32(p, 0, true);
    [cell, cell, 0].forEach((d, k) => v.setFloat64(scaleOff + k * 8, d, true)); [0, 0, 0, x0, y1, 0].forEach((d, k) => v.setFloat64(tieOff + k * 8, d, true)); gk.forEach((s, k) => v.setUint16(gkOff + k * 2, s, true));
    for (let k = 0; k < nd.length; k++) v.setUint8(ndOff + k, nd.charCodeAt(k));
    new Float32Array(buf, imgOff, w * h).set(data); return new Uint8Array(buf);
  }
  function toDEM(s, code, cell, fmt) {
    const crs = GV.resolveCRS(code); if (!crs) throw new Error('اختار نظام إحداثيات');
    const b = s.bounds; const cs = [[b[0][1], b[0][0]], [b[1][1], b[0][0]], [b[0][1], b[1][0]], [b[1][1], b[1][0]]].map(c => crs.inv(c));
    const geo = !!crs.geographic; const c = geo ? cell / 111320 : cell;
    const x0 = Math.min(...cs.map(p => p[0])), x1 = Math.max(...cs.map(p => p[0])), y0 = Math.min(...cs.map(p => p[1])), y1 = Math.max(...cs.map(p => p[1]));
    const w = Math.ceil((x1 - x0) / c), h = Math.ceil((y1 - y0) / c); if (w * h > 40e6) throw new Error('الـ DEM هيطلع كبير جداً (' + w + '×' + h + ') — كبّر حجم الخلية');
    const data = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const ll = crs.fn([x0 + (i + 0.5) * c, y1 - (j + 0.5) * c]); const z = s.sample(ll[0], ll[1]); data[j * w + i] = z == null || !isFinite(z) ? -9999 : z; }
    const epsg = String(code).replace(/e$/, '');
    if (fmt === 'asc') { const rows = ['ncols ' + w, 'nrows ' + h, 'xllcorner ' + x0, 'yllcorner ' + (y1 - h * c), 'cellsize ' + c, 'NODATA_value -9999']; for (let j = 0; j < h; j++) { const r = []; for (let i = 0; i < w; i++) r.push(+data[j * w + i].toFixed(3)); rows.push(r.join(' ')); } return [{ name: '.asc', data: new TextEncoder().encode(rows.join('\n')) }, { name: '.prj', data: new TextEncoder().encode(Writers && Writers.wktForEPSG ? (Writers.wktForEPSG(+epsg) || '') : '') }]; }
    return [{ name: '.tif', data: tiffFloat(data, w, h, x0, y1, c, epsg, geo) }];
  }
  GV.surfaceToDEM = toDEM;

  /* ---------- the surfaces screen ---------- */
  const sh = el('div', 'sheet panel right'); sh.id = 'surfSheet';
  sh.innerHTML = '<div class="grab"></div><div class="sh-head"><h2>🗻 أسطح وراسترات المناسيب</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="surfBody"></div>';
  document.body.appendChild(sh); sh.querySelector('[data-close]').onclick = () => sh.classList.remove('open');
  function open() {
    const b = $('#surfBody'); b.innerHTML = '';
    const top = el('div', 'mp-btns'); const a = el('button', 'chip done', '➕ افتح سطح أو DEM'); a.onclick = () => { sh.classList.remove('open'); GV.openLevels(); }; top.appendChild(a);
    const r = el('button', 'chip', '🖼 صور وراسترات تانية (أورثو · TPK…)'); r.onclick = () => { sh.classList.remove('open'); GV.openServices(); }; top.appendChild(r); b.appendChild(top);
    b.appendChild(el('p', 'muted small', 'أي ملف مناسيب بيدخل هنا: DEM (TIF · IMG · ASC · HGT · DTED · BIL…)، سطح Civil 3D (LandXML)، نقاط رفع، أو طبقة نقاط بمناسيب.'));
    if (!SURF.length) { b.appendChild(el('p', 'muted', 'لسه مفيش أسطح.')); GV.openSheet('#surfSheet'); return; }
    SURF.forEach(s => {
      const box = el('div', 'step'); box.appendChild(el('b', '', '⛰️ ' + s.name)); box.appendChild(el('div', 'muted small', s.kind + (s.n ? ' · ' + s.n.toLocaleString('en') + ' مثلث' : '') + ' · مناسيب ' + s.zmin.toFixed(2) + ' ← ' + s.zmax.toFixed(2)));
      const r1 = el('div', 'civ-g'); const stS = el('select'); Object.keys(STY).forEach(k => { const o = el('option', '', STY[k]); o.value = k; stS.appendChild(o); }); stS.value = s.style || 'none';
      const zf = el('input'); zf.type = 'number'; zf.value = s.zf || 2; zf.min = 1; zf.max = 20; zf.style.width = '60px'; zf.title = 'تكبير التضاريس (للمناطق المستوية)';
      const op = el('input'); op.type = 'range'; op.min = 0.1; op.max = 1; op.step = 0.05; op.value = s.opacity == null ? 0.85 : s.opacity; op.oninput = () => { s.opacity = +op.value; if (s.leaf) s.leaf.setOpacity(s.opacity); };
      const apply = () => { $('#busy').classList.add('show'); $('#busyText').textContent = 'برسم السطح…'; setTimeout(() => { try { s.zf = +zf.value || 2; render(s, stS.value, s.zf); } finally { $('#busy').classList.remove('show'); } }, 30); };
      stS.onchange = apply; zf.onchange = apply; r1.append(el('span', 'small', 'العرض:'), stS, el('span', 'small', 'تكبير التضاريس ×'), zf, op); box.appendChild(r1);
      const r2 = el('div', 'civ-g'); const step = el('input'); step.type = 'number'; step.placeholder = 'تلقائي'; step.step = 0.25; step.style.width = '80px';
      const cb = el('button', 'chip', '〰️ اعمل كنتور'); cb.onclick = async () => { $('#busy').classList.add('show'); $('#busyText').textContent = 'بعمل الكنتور…'; await new Promise(r0 => setTimeout(r0, 30)); try { await contours(s, +step.value || 0); } catch (e) { GV.showMsg(e.message || e); } finally { $('#busy').classList.remove('show'); } };
      r2.append(el('span', 'small', 'الكنتور كل (م):'), step, cb); box.appendChild(r2);
      const r3 = el('div', 'civ-g'); const crs = el('select'); GV.CRS_CHOICES.forEach(([c, l]) => { const o = el('option', '', l); o.value = c; crs.appendChild(o); }); crs.value = GV.store.get('gv_crs') || '32638';
      const cell = el('input'); cell.type = 'number'; cell.value = GV.store.get('gv_demcell') || 1; cell.step = 0.1; cell.style.width = '70px';
      const fm = el('select'); [['tif', 'GeoTIFF'], ['asc', 'ASCII Grid (.asc)']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; fm.appendChild(o); });
      const db2 = el('button', 'chip done', '⬇️ حوّله لـ DEM'); db2.onclick = async () => { GV.store.set('gv_demcell', cell.value); GV.store.set('gv_crs', crs.value); $('#busy').classList.add('show'); $('#busyText').textContent = 'بحوّل السطح لـ DEM…'; await new Promise(r0 => setTimeout(r0, 30));
        try { const base = s.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_') + '_DEM_' + cell.value + 'm'; const out = toDEM(s, crs.value, +cell.value || 1, fm.value);
          if (out.length === 1) await GV.saveFile(base + out[0].name, out[0].data); else { const z = new JSZip(); out.forEach(f => z.file(base + f.name, f.data)); await GV.saveFile(base + '.zip', await z.generateAsync({ type: 'uint8array' })); }
          GV.toast('✅ اتعمل الـ DEM', 4000); } catch (e) { GV.showMsg(e.message || e); } finally { $('#busy').classList.remove('show'); } };
      r3.append(el('span', 'small', 'DEM بخلية (م):'), cell, crs, fm, db2); box.appendChild(r3);
      const x = el('button', 'chip danger', 'شيل السطح'); x.onclick = () => { render(s, 'none'); SURF.splice(SURF.indexOf(s), 1); if (s.keepKey) del(s.keepKey); open(); }; box.appendChild(x);
      b.appendChild(box);
    });
    GV.openSheet('#surfSheet');
  }
  GV.openSurfaces = open;
  // surfaces opened before come back on this device
  setTimeout(async () => { for (const [k, v] of await all()) { try { let s = null;
    if (v.kind === 'dem' && v.buf) s = await GV.addDemBuffer(v.buf, v.name, v.crs, true);
    else if (v.kind === 'file' && v.bytes) s = await GV.openSurfaceFile(new File([v.bytes], v.fname || v.name), v.crs, true);
    if (s) { s.keepKey = k; if (v.style && v.style !== 'none') render(s, v.style, 2); } } catch (e) { } } }, 1500);
  { const t = [...document.querySelectorAll('#toolsSheet .tool b')].find(b => b.textContent === 'مناسيب من سطح'); if (t) { const b = el('button', 'tool'); b.innerHTML = '<span>🗻</span><b>أسطح وراسترات المناسيب</b><small>ألوان · هيل شيد · كنتور · سطح Civil ← DEM</small>'; b.onclick = open; t.parentNode.parentNode.insertBefore(b, t.parentNode.nextSibling); } }
})();
