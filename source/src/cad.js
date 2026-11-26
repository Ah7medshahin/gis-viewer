// CAD checks: units/scale detection, georeferencing sanity, outliers, oddities + fix tools (scale / move)
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const UTM_RANGE = { e: [160000, 840000], n: [0, 9400000] };

  function nativePts(src, max) {
    const out = [];
    for (const l of src.layers) for (const f of l.features) {
      const g = f.geometry; if (!g) continue;
      let c = g.coordinates; while (c && Array.isArray(c[0])) c = c[0];
      if (c && isFinite(c[0]) && isFinite(c[1])) out.push({ x: c[0], y: c[1], z: c[2], l, f });
      if (out.length >= (max || 200000)) return out;
    }
    return out;
  }
  const median = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  function crsKind(def) {
    const s = String(def || '');
    if (/^(326|327|204)\d\d$/.test(s) || /UTM/i.test(s)) return 'utm';
    if (s === '4326' || /^GEOG/i.test(s)) return 'geo';
    if (s === '3857') return 'merc';
    return s ? 'other' : 'none';
  }

  function analyze(src) {
    const W = []; // {sev, title, detail, fix?}
    const pts = nativePts(src);
    const lay = src.layers.filter(l => l.features.length);
    const def = (lay.find(l => l.crsDef) || {}).crsDef;
    const kind = crsKind(def);
    if (!pts.length) return { W, stats: {} };
    const mx = median(pts.map(p => p.x)), my = median(pts.map(p => p.y));
    const stats = { n: pts.length, mx, my, crs: def };
    // units / georeference
    if (kind === 'none') W.push({ sev: 'warn', title: 'الكاد مش متحدد له نظام إحداثيات', detail: 'اختار نظام الإحداثيات من ⌖ جنب الطبقة علشان يظهر في مكانه.' });
    if (kind === 'utm') {
      const inE = v => v >= UTM_RANGE.e[0] && v <= UTM_RANGE.e[1], inN = v => v >= UTM_RANGE.n[0] && v <= UTM_RANGE.n[1];
      if (!(inE(mx) && inN(my))) {
        const cands = [[0.001, 'الرسمة بالملّي (mm)'], [0.01, 'الرسمة بالسنتي (cm)'], [0.1, 'الرسمة بالديسي (dm)'], [0.3048, 'الرسمة بالقدم (ft)'], [1000, 'الرسمة بالكيلومتر (km)']];
        const hit = cands.find(([k]) => inE(mx * k) && inN(my * k));
        if (hit) W.push({ sev: 'err', title: 'السكيل غلط: ' + hit[1], detail: 'الإحداثيات (' + fmt(mx) + ', ' + fmt(my) + ') مش منطقية لـ UTM. لو ضربناها في ' + hit[0] + ' هتبقى (' + fmt(mx * hit[0]) + ', ' + fmt(my * hit[0]) + ') وده منطقي.', fix: { label: 'صحّح السكيل ×' + hit[0], s: hit[0] } });
        else if (Math.abs(mx) < 100000 && Math.abs(my) < 100000) W.push({ sev: 'err', title: 'إحداثيات محلية (الكاد مش مربوط بالطبيعة)', detail: 'الإحداثيات حوالين (' + fmt(mx) + ', ' + fmt(my) + ')، ودي مش إحداثيات UTM. محتاج تحرّك الرسمة لمكانها الحقيقي.', fix: { label: 'حرّك الرسمة لمكانها', move: true } });
        else W.push({ sev: 'err', title: 'الإحداثيات برّه نطاق UTM', detail: 'متوسط الإحداثيات (' + fmt(mx) + ', ' + fmt(my) + '). اتأكد من نظام الإحداثيات أو وحدات الرسمة.', fix: { label: 'حرّك الرسمة لمكانها', move: true } });
      }
    }
    if (kind === 'geo' && (Math.abs(mx) > 180 || Math.abs(my) > 90)) W.push({ sev: 'err', title: 'اخترت WGS84 درجات بس الإحداثيات بالمتر', detail: 'غيّر النظام لـ UTM المناسب من ⌖.' });
    // swapped X/Y for UTM
    if (kind === 'utm' && mx > 1e6 && my >= UTM_RANGE.e[0] && my <= UTM_RANGE.e[1]) W.push({ sev: 'err', title: 'شكل X و Y متبدّلين', detail: 'الـ Easting جاي في مكان الـ Northing.', fix: { label: 'بدّل X و Y', swap: true } });
    // zone sanity vs other data
    const others = GV.sources.filter(s => s !== src && !s.isCad && s.id !== 'field').flatMap(s => s.layers.filter(l => l.leaf));
    if (others.length && kind === 'utm') {
      const ob = L.latLngBounds([]); others.forEach(l => { const b = l.leaf.getBounds(); if (b.isValid()) ob.extend(b); });
      const ll = toLL(src, mx, my);
      if (ob.isValid() && ll) {
        const d = ob.getCenter().distanceTo(ll);
        if (d > 20000) {
          let best = null;
          GV.CRS_CHOICES.forEach(([code]) => { const c = GV.resolveCRS(code); if (!c || c.geographic) return; try { const r = c.fn([mx, my]); const dd = ob.getCenter().distanceTo([r[1], r[0]]); if (!best || dd < best.d) best = { code, d: dd }; } catch (e) { } });
          W.push({ sev: 'warn', title: 'الكاد بعيد ' + (d / 1000).toFixed(0) + ' كم عن باقي الداتا', detail: best && best.d < d / 5 ? 'لو النظام ' + GV.CRS_CHOICES.find(c => c[0] === best.code)[1] + ' هيبقى على بعد ' + (best.d / 1000).toFixed(1) + ' كم بس. غالبًا الزون غلط.' : 'اتأكد من نظام الإحداثيات.', fix: best && best.d < d / 5 ? { label: 'استخدم ' + GV.CRS_CHOICES.find(c => c[0] === best.code)[1], crs: best.code } : null });
        }
      }
    }
    // outliers (stray objects far away)
    const dists = pts.map(p => Math.hypot(p.x - mx, p.y - my)); const md = median(dists) || 1;
    const lim = Math.max(md * 20, kind === 'geo' ? 0.05 : 3000);
    const far = new Set(); pts.forEach((p, i) => { if (dists[i] > lim) far.add(p.f); });
    if (far.size) W.push({ sev: 'warn', title: far.size + ' عنصر بعيد جدًا عن باقي الرسمة', detail: 'غالبًا عناصر متنسية أو اترسمت عند (0,0). بتكبّر حدود الرسمة وبتبوّظ الزووم.', fix: { label: 'اخفيهم', hideFar: far } });
    const zero = pts.filter(p => Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6).length;
    if (zero) W.push({ sev: 'warn', title: zero + ' عنصر عند النقطة (0,0)', detail: 'غالبًا عناصر من غير إحداثيات حقيقية.' });
    // Z / elevation
    const zs = pts.map(p => p.z).filter(z => z != null && isFinite(z));
    if (zs.length) {
      const nz = zs.filter(z => z !== 0);
      if (nz.length && nz.length < zs.length * 0.9) W.push({ sev: 'info', title: 'المناسيب (Z) مش ثابتة', detail: nz.length + ' عنصر ليه منسوب و ' + (zs.length - nz.length) + ' عنصر منسوبه صفر.' });
      const crazy = zs.filter(z => Math.abs(z) > 5000).length;
      if (crazy) W.push({ sev: 'warn', title: crazy + ' عنصر منسوبه غير منطقي (أكبر من 5000)', detail: 'غالبًا Z اتسجل غلط أو بوحدة مختلفة.' });
    }
    // text heights
    const hs = []; src.layers.forEach(l => l.features.forEach(f => { if (f.properties && f.properties.Height > 0) hs.push(f.properties.Height); }));
    if (hs.length) {
      const mh = median(hs);
      if (kind === 'utm' && (mh > 50 || mh < 0.05)) W.push({ sev: 'warn', title: 'ارتفاع النصوص مش منطقي (' + fmt(mh) + ')', detail: 'المفروض بين 0.1 و 5 متر تقريبًا. الأنوتيشن هيظهر ' + (mh > 50 ? 'كبير أوي' : 'صغير أوي') + '.', fix: { label: 'ظبّط حجم النص', anno: mh > 50 ? 1 / Math.pow(10, Math.round(Math.log10(mh / 1.5))) : Math.pow(10, Math.round(Math.log10(1.5 / mh))) } });
      const big = hs.filter(h => h > mh * 20).length; if (big) W.push({ sev: 'info', title: big + ' نص ارتفاعه أكبر من الطبيعي بكتير', detail: 'ممكن يكون عناوين أو جداول.' });
    }
    // CAD-level info
    const ci = src.cadInfo || {};
    if (ci.badInserts) W.push({ sev: 'warn', title: ci.badInserts + ' بلوك سكيله صفر أو كبير جدًا', detail: 'البلوكات دي هتظهر نقطة بس.' });
    const sk = Object.entries(ci.skipped || {}).filter(([k]) => !/VIEWPORT|ATTRIB/.test(k));
    if (sk.length) W.push({ sev: 'info', title: 'عناصر مش بتتعرض: ' + sk.map(([k, n]) => k + ' (' + n + ')').join('، '), detail: 'زي الأبعاد والجداول. مش بتأثر على الشبكة.' });
    // zero-length & duplicates
    let zl = 0; const seen = new Set(); let dup = 0;
    src.layers.forEach(l => l.features.forEach(f => {
      const g = f.geometry; if (!g || f._sym) return;
      if (g.type === 'LineString') { const c = g.coordinates; let len = 0; for (let i = 1; i < c.length; i++) len += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); if (len < 1e-6) zl++; }
      const k = l.name + '|' + JSON.stringify(g.coordinates).slice(0, 400); if (seen.has(k)) dup++; else seen.add(k);
    }));
    if (zl) W.push({ sev: 'warn', title: zl + ' خط طوله صفر', detail: 'خطوط ملهاش طول، بتعمل مشاكل في الطوبولوجي.' });
    if (dup) W.push({ sev: 'warn', title: dup + ' عنصر متكرر (نفس الشكل على نفس الطبقة)', detail: 'لازم تتشال قبل التحويل لـ GIS.' });
    const l0 = src.layers.filter(l => /^(0|defpoints)$/i.test(l.name)).reduce((a, l) => a + l.features.length, 0);
    if (l0) W.push({ sev: 'info', title: l0 + ' عنصر على لير 0 أو Defpoints', detail: 'العناصر دي مالهاش تصنيف، ومش هتتربط بفيتشر كلاس في التحويل.' });
    return { W, stats };
  }
  const fmt = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : (+v).toFixed(2);
  function toLL(src, x, y) { const l = src.layers.find(l => l.crsDef); if (!l) return null; const c = GV.resolveCRS(l.crsDef); if (!c) return null; try { const r = c.fn([x, y]); return L.latLng(r[1], r[0]); } catch (e) { return null; } }

  function transformSrc(src, xf) {
    src.layers.forEach(l => {
      l.saveKey = null;
      l.features.forEach(f => { if (f.geometry) f.geometry = GV.mapCoords(f.geometry, xf); f._lbl = null; });
      if (l.crsDef) { if (l.leaf) GV.map.removeLayer(l.leaf); GV.applyCRS(l, GV.resolveCRS(l.crsDef)); if (l.visible) l.leaf.addTo(GV.map); }
    });
    fit(src); GV.renderLayers(); GV.refreshLabels(); if (GV.onDirty) GV.onDirty();
  }
  function fit(src) { const b = L.latLngBounds([]); src.layers.forEach(l => { if (l.leaf) { const x = l.leaf.getBounds(); if (x.isValid()) b.extend(x); } }); if (b.isValid()) GV.map.fitBounds(b, { padding: [30, 30], maxZoom: 18 }); }

  async function applyFixSafe(src, fix, silent) { if (!fix.crs) { const cp = await GV.workCopy(src); if (cp !== src) { src = cp; } } return applyFix(src, fix, silent); }
  function applyFix(src, fix, silent) {
    if (fix.s) { const s = fix.s; transformSrc(src, c => [c[0] * s, c[1] * s]); src.layers.forEach(l => { l.annoScale = (l.annoScale || 1); l.features.forEach(f => { if (f.properties && f.properties.Height) f.properties.Height = +(f.properties.Height * s).toFixed(4); }); }); GV.toast('اتصحح السكيل ×' + s); }
    else if (fix.swap) { transformSrc(src, c => [c[1], c[0]]); GV.toast('اتبدّل X و Y'); }
    else if (fix.crs) { src.layers.forEach(l => { if (l.crsDef || l.noCRS) { l.crsDef = fix.crs; l.noCRS = false; } }); transformSrc(src, c => c); GV.toast('اتغيّر النظام'); }
    else if (fix.hideFar) { src.layers.forEach(l => { l.saveKey = null; const n = l.features.length; l.features = l.features.filter(f => !fix.hideFar.has(f)); if (l.features.length !== n && l.leaf) { GV.map.removeLayer(l.leaf); l.leaf = GV.buildLeaf(l); if (l.visible) l.leaf.addTo(GV.map); } }); fit(src); GV.renderLayers(); GV.refreshLabels(); if (GV.onDirty) GV.onDirty(); GV.toast('اتشالوا ' + fix.hideFar.size + ' عنصر بعيد'); }
    else if (fix.anno) { src.layers.forEach(l => l.annoScale = (l.annoScale || 1) * fix.anno); GV.refreshLabels(); GV.toast('اتظبط حجم الأنوتيشن'); }
    else if (fix.move) startMove(src);
    if (!silent) setTimeout(() => show(src, true), 300);
  }

  function startMove(src) {
    const l0 = src.layers.find(l => l.crsDef);
    if (!l0) return GV.showMsg('اختار نظام الإحداثيات للكاد الأول (من ⌖).');
    const def = GV.epsgDef(l0.crsDef) || l0.crsDef; let inv; try { inv = proj4(def, 'WGS84'); } catch (e) { return GV.showMsg('النظام ده مش بيدعم التحريك.'); }
    const pts = nativePts(src); const cx = median(pts.map(p => p.x)), cy = median(pts.map(p => p.y));
    GV.closeSheets(); document.body.classList.add('picking');
    $('#pickMsg').textContent = 'اضغط على الخريطة المكان اللي المفروض يكون فيه نص الرسمة'; $('#pickDone').style.display = 'none'; $('#pickGPS').style.display = 'none'; $('#pickPhotoIn').parentElement.style.display = 'none';
    const done = () => { GV.pick = null; document.body.classList.remove('picking'); $('#pickGPS').style.display = ''; $('#pickPhotoIn').parentElement.style.display = ''; $('#pickCancel').removeEventListener('click', done); };
    $('#pickCancel').addEventListener('click', done);
    GV.pick = ll => { done(); const t = inv.inverse([ll.lng, ll.lat]); const dx = t[0] - cx, dy = t[1] - cy; transformSrc(src, c => [c[0] + dx, c[1] + dy]); GV.toast('الرسمة اتحركت. لو محتاجة تظبيط أدق كرّر وانت مكبّر.', 4500); };
  }

  function show(src, force) {
    const { W } = analyze(src);
    const bad = W.filter(w => w.sev !== 'info');
    if (!force && !bad.length) { GV.toast('فحص الكاد: مفيش مشاكل في السكيل أو الإحداثيات ✓'); return; }
    $('#cadTitle').textContent = src.name;
    const box = $('#cadBody'); box.textContent = '';
    if (!W.length) box.appendChild(el('p', 'ok-note', '✓ مفيش مشاكل في السكيل أو الإحداثيات.'));
    W.forEach(w => {
      const c = el('div', 'cmp'); c.style.setProperty('--sc', w.sev === 'err' ? '#e03131' : w.sev === 'warn' ? '#f08c00' : '#1c7ed6');
      c.appendChild(el('b', null, (w.sev === 'err' ? '⛔ ' : w.sev === 'warn' ? '⚠ ' : 'ℹ ') + w.title));
      c.appendChild(el('div', 'small', w.detail));
      if (w.fix) { const b = el('button', 'chip', w.fix.label); b.onclick = () => applyFixSafe(src, w.fix); c.appendChild(b); }
      box.appendChild(c);
    });
    const af = el('button', 'open-btn', '🛠 صلّح الكاد أوتوماتيك (السكيل والسنابينج والتنضيف)'); af.style.width = '100%'; af.style.justifyContent = 'center'; af.style.margin = '6px 0 12px'; af.onclick = () => GV.openFix({ cad: true, src }); box.appendChild(af);
    const man = el('div', 'step'); man.appendChild(el('b', null, 'تظبيط يدوي'));
    const row = el('div', 'row3');
    const sIn = el('input'); sIn.type = 'number'; sIn.step = 'any'; sIn.placeholder = 'معامل السكيل (مثلاً 0.001)';
    const sB = el('button', 'chip', 'طبّق السكيل'); sB.onclick = () => { const s = parseFloat(sIn.value); if (s > 0) applyFixSafe(src, { s }); };
    const mB = el('button', 'chip', 'حرّك الرسمة'); mB.onclick = () => applyFixSafe(src, { move: true });
    row.append(sIn, sB, mB); man.appendChild(row); box.appendChild(man);
    GV.openSheet('#cadSheet');
  }
  GV.onCadLoaded = (src, force) => show(src, force);
  GV.cadApplyFix = applyFixSafe;
  GV.analyzeCad = analyze;
})();
