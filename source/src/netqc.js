// Network-specific engineering & attribute rules (water, sewer, storm, power, lighting, telecom, gas, irrigation)
(function () {
  'use strict';
  const GV = window.GV;
  const NETS = { water: 'مياه', sewer: 'صرف صحي', storm: 'أمطار', power: 'كهرباء', lighting: 'إنارة', telecom: 'اتصالات', gas: 'غاز', irrigation: 'ري' };
  // element recognition (layer name, NWC class names, org codes, block/type text)
  const E = [
    ['MVCB', /(\bmv\b|mvcb|11\s?kv|13\.8|33\s?kv|medium)/i],
    ['CABL', /(cable|cabl|cabels|lvcb|\blv\b|ltg|كابل)/i],
    ['POLE', /(pole|\blp\d*\b|lt-sym|lighting_poles|عمود|اعمدة|أعمدة)/i],
    ['MAIN', /^stw.*network$/i],
    ['DUCT', /duct.?bank/i],
    ['SERV', /(serv|lateral|later|\blat\b|\bhc\b|house|conn|وصل|توصيل|W_LATERAL)/i],
    ['MAIN', /(main|pipe|prpl|watr|water|w[-_ ]?line|خط|ماسور|مواسير|W_MAINLINE|sswr|sewer|grav|strm|storm|drain|ngas|gas.?line|irr.?main)/i],
    ['FORC', /(force|rising|\bfm\b)/i],
    ['CULV', /(culv|box.?culv)/i],
    ['VALV', /(valv|vlv|\bgv\b|\bbv\b|\bav\b|\bwo\b|air.?rel|wash|scour|butter|gate|check|prv|محبس|W_VALVE)/i],
    ['HYDT', /(hydr|hydt|\bfh\b|fire|حريق|طفاي)/i],
    ['FITT', /(wye|\by\b|واي|fitt|tee|bend|reduc|\bcap\b|plug|cross|elbow|coupl|saddle|sadl|كوع|مشترك|مسلوب|طبة|سادل|W_FITTING|junction)/i],
    ['METR', /(meter|metr|عداد)/i],
    ['CLNO', /(clean.?out|clno|\bg?co\b|كلين)/i],
    ['INSP', /(\bic\b|(^|[_\s-])ic($|[_\s-\d])|inspection|insp)/i],
    ['MHOL', /(\bmh\b|(^|[_\s-])mh($|[_\s-\d])|manhole|mhol|chamber|chmb|غرفة|غرف)/i],
    ['INLT', /(inlet|inlt|gully|catch|\bcb\b|grat)/i],
    ['OUTF', /(outfall|outf|outlet)/i],
    ['PANL', /(panel|panl|\bslp\b|\bmdb\b|feeder|لوحة)/i],
    ['SUBS', /(substation|subs|s\/s|محطة)/i],
    ['RMU', /(\brmu\b|ring.?main)/i],
    ['FPIL', /(pillar|fpil|\bfp\b)/i],
    ['DUCT', /(duct|conduit|fib|tele|comm)/i],
    ['HHOL', /(handhole|hhol|\bhh\b|\bjb\b)/i],
    ['CABN', /(cabinet|cabn|\bfdh\b)/i],
    ['REGU', /(regul|regu|\bprs\b|\bdrs\b)/i],
    ['SPRK', /(sprink|sprk|emitter|bubbler|rotor|spray)/i]
  ];
  const ORG = /^[A-Z]-[A-Z]{4}-([A-Z]{3,4})(?:-|$)/;
  function elemOfText(t) { const m = ORG.exec(t || ''); if (m) return m[1] === 'GRAV' || m[1] === 'PIPE' ? 'MAIN' : m[1] === 'LATR' ? 'SERV' : m[1] === 'LVCB' ? 'CABL' : m[1] === 'CHMB' ? 'MHOL' : m[1]; const e = E.find(x => x[1].test(t || '')); return e ? e[0] : null; }
  const DEV_LINE = { MAIN: 1, SERV: 1, FORC: 1, CULV: 1, MVCB: 1, CABL: 1, DUCT: 1 };
  const STD_DIA = [20, 25, 32, 40, 50, 63, 75, 80, 90, 100, 110, 125, 150, 160, 200, 225, 250, 280, 300, 315, 350, 355, 375, 400, 450, 500, 525, 600, 630, 700, 750, 800, 900, 1000, 1050, 1100, 1200, 1350, 1400, 1500, 1600, 1800, 2000];
  const MIN_SLOPE = d => !d ? 0.004 : d <= 150 ? 0.006 : d <= 200 ? 0.004 : d <= 250 ? 0.003 : d <= 300 ? 0.0022 : d <= 375 ? 0.0018 : 0.0015;
  const F = (props, re) => props ? Object.keys(props).find(k => re.test(k)) : null;
  const RE = {
    dia: /^(diam|diameter|dia|dn|nom_?dia|pipe_?dia|size|pipesize|قطر|القطر)$/i, mat: /^(material|mat|pipe_?mat|المادة|ماده)$/i,
    us: /^(us_?il|us_?inv|up_?inv|upstream_?inv(ert)?|inv_?up|start_?inv|from_?inv|start_?pipe_?elevation|startpipeelevation)/i, ds: /^(ds_?il|ds_?inv|dn_?inv|down_?inv|downstream_?inv(ert)?|inv_?dn|end_?inv|to_?inv|end_?pipe_?elevation|endpipeelevation)/i,
    cover: /^(cover|cover_?level|cl|rim|rim_?elev|ground|gl|ngl|ground_?level)$/i, inv: /^(invert|inv|il|invert_?level|bottom|منسوب_?القاع)$/i, depth: /^(depth|mh_?depth|العمق)$/i,
    vtype: /^(valve_?type|vtype|type|subtype|assettype|نوع)$/i, status: /^(status|valve_?status|normal_?status|حالة)$/i, volt: /^(voltage|volt|kv)$/i, csize: /^(cable_?size|size|section|mm2|cross_?section)$/i,
    height: /^(pole_?height|height|ht|الارتفاع)$/i, watt: /^(wattage|watt|lamp_?watt|power|w)$/i, ptype: /^(pole_?type|type|النوع)$/i, press: /^(pressure|press|pn|pressure_?class)$/i, len: /^(length|len|shape_?length|الطول)$/i
  };
  const MATS = { water: ['di', 'ductile', 'upvc', 'pvc', 'hdpe', 'pe', 'grp', 'steel', 'ms', 'cs', 'ci', 'ac', 'gi', 'pe100', 'pe80'], sewer: ['upvc', 'pvc', 'grp', 'rc', 'rcp', 'vc', 'vcp', 'hdpe', 'di', 'pp', 'concrete'], gas: ['pe', 'pe100', 'pe80', 'steel', 'cs', 'ms'] };
  MATS.storm = MATS.sewer; MATS.irrigation = MATS.water;
  const VTYPES = ['gate', 'butterfly', 'air', 'air release', 'arv', 'washout', 'scour', 'check', 'nrv', 'prv', 'pressure reducing', 'isolation', 'globe', 'ball', 'sluice', 'gv', 'bv', 'av', 'wo'];
  const ATTR = {
    water: { MAIN: [['dia', 'القطر', 'req+dia'], ['mat', 'المادة', 'mat']], SERV: [['dia', 'القطر', 'req+dia'], ['mat', 'المادة', 'mat']], VALV: [['dia', 'القطر', 'req+dia'], ['vtype', 'نوع المحبس', 'vtype'], ['status', 'الحالة (مفتوح/مقفول)', 'opt']], HYDT: [['dia', 'القطر', 'opt']], METR: [['dia', 'القطر', 'opt']] },
    sewer: { MAIN: [['dia', 'القطر', 'req+dia'], ['mat', 'المادة', 'mat'], ['us', 'منسوب القاع فوق (US IL)', 'req'], ['ds', 'منسوب القاع تحت (DS IL)', 'req']], SERV: [['dia', 'القطر', 'req+dia']], MHOL: [['cover', 'منسوب الغطا', 'req'], ['inv', 'منسوب القاع', 'req'], ['depth', 'العمق', 'opt']] },
    power: { MVCB: [['volt', 'الجهد', 'req'], ['csize', 'مقطع الكابل', 'req']], CABL: [['csize', 'مقطع الكابل', 'req']] },
    lighting: { POLE: [['height', 'ارتفاع العمود', 'req+range:4:16'], ['watt', 'قدرة الكشاف', 'opt+range:10:600'], ['ptype', 'نوع العمود', 'opt']], CABL: [['csize', 'مقطع الكابل', 'req']] },
    telecom: { DUCT: [['csize', 'المقاس/العدد', 'opt']] },
    gas: { MAIN: [['dia', 'القطر', 'req+dia'], ['mat', 'المادة', 'mat'], ['press', 'الضغط', 'opt']], SERV: [['dia', 'القطر', 'req+dia']] },
    irrigation: { MAIN: [['dia', 'القطر', 'req+dia'], ['mat', 'المادة', 'mat']], SERV: [['dia', 'القطر', 'opt+dia']] }
  };
  ATTR.storm = { MAIN: ATTR.sewer.MAIN, MHOL: ATTR.sewer.MHOL, CULV: [['csize', 'المقاس', 'opt']] };
  function diaOf(l, f) { const p = f.properties || {}; const k = F(p, RE.dia); let v = k != null ? parseFloat(String(p[k]).replace(/[^\d.]/g, '')) : NaN; if (!isFinite(v)) { const m = /(\d{2,4})\s*(mm)?\s*$/.exec(l.name) || /-(\d{3,4})(?:-|$)/.exec(l.name); v = m ? +m[1] : NaN; } if (isFinite(v) && v > 0 && v < 3) v = v * 1000; return isFinite(v) && v > 0 ? v : null; }
  const numOf = (p, re) => { const k = F(p, re); if (k == null) return null; const v = parseFloat(p[k]); return isFinite(v) ? v : null; };

  function run(o) {
    const { sel, lines, points, add, snap, near } = o; const net = o.net || 'water';
    const anchor = f => f.wgs && f.wgs.geometry ? GV.firstCoord(f.wgs.geometry) : null;
    const lEl = new Map(); sel.forEach(({ l, role }) => { const e = elemOfText(l.name); lEl.set(l, e || (role === 'line' ? 'MAIN' : null)); });
    const ptEl = p => { const e0 = lEl.get(p.l); const pr = p.l.features[p.fi].properties || {}; const t = [pr.Block, pr.ASSETTYPE, pr.ASSETGROUP, pr.TYPE, pr.Type, pr.type, pr.SUBTYPE, pr.Description, pr.DESC].filter(Boolean).join(' '); const e1 = t ? elemOfText(t) : null; return e1 && !DEV_LINE[e1] ? e1 : e0; };
    const L = lines.map(x => Object.assign({}, x, { el: lEl.get(x.l) || 'MAIN', f: x.l.features[x.fi] })).filter(x => DEV_LINE[x.el] || !lEl.get(x.l));
    const P = points.map(x => Object.assign({}, x, { el: ptEl(x), f: x.l.features[x.fi] }));
    // spatial index over segments, endpoints, points
    const cell = Math.max(near * 3, 5); const G = new Map(); const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
    const put = (x0, y0, x1, y1, v) => { for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) { const k = x + ',' + y; if (!G.has(k)) G.set(k, []); G.get(k).push(v); } };
    L.forEach((ln, li) => { ln.len = 0; for (let i = 1; i < ln.c.length; i++) { const a = ln.c[i - 1], b = ln.c[i]; ln.len += Math.hypot(b[0] - a[0], b[1] - a[1]); put(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { t: 's', li, i }); } });
    P.forEach((p, pi) => put(p.c[0], p.c[1], p.c[0], p.c[1], { t: 'p', pi }));
    const near_ = (c, r) => { const out = []; const seen = new Set(); for (let x = Math.floor((c[0] - r) / cell); x <= Math.floor((c[0] + r) / cell); x++) for (let y = Math.floor((c[1] - r) / cell); y <= Math.floor((c[1] + r) / cell); y++) (G.get(x + ',' + y) || []).forEach(v => { const k = v.t + (v.li != null ? v.li + ':' + v.i : v.pi); if (!seen.has(k)) { seen.add(k); out.push(v); } }); return out; };
    const segD = (c, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(c[0] - a[0] - t * dx, c[1] - a[1] - t * dy); };
    const lineNear = (c, r, filt) => { let best = null, bd = Infinity; near_(c, r).forEach(v => { if (v.t !== 's') return; const ln = L[v.li]; if (filt && !filt(ln)) return; const d = segD(c, ln.c[v.i - 1], ln.c[v.i]); if (d < bd) { bd = d; best = ln; } }); return bd <= r ? { ln: best, d: bd } : null; };
    const ptNear = (c, r, filt) => { let best = null, bd = Infinity; near_(c, r).forEach(v => { if (v.t !== 'p') return; const p = P[v.pi]; if (filt && !filt(p)) return; const d = Math.hypot(p.c[0] - c[0], p.c[1] - c[1]); if (d < bd) { bd = d; best = p; } }); return bd <= r ? { p: best, d: bd } : null; };
    const endsAt = (c, r, filt, self) => { const out = []; near_(c, r).forEach(v => { if (v.t !== 's') return; const ln = L[v.li]; if (ln === self || (filt && !filt(ln))) return; [ln.c[0], ln.c[ln.c.length - 1]].forEach((e, k) => { if (Math.hypot(e[0] - c[0], e[1] - c[1]) <= r && out.every(o2 => o2.ln !== ln || o2.k !== k)) out.push({ ln, k }); }); }); return out; };
    const tol = Math.max(snap, 0.05);
    const A = (sev, type, x, detail, meta) => add(sev, 'net', type, x.l, x.fi, anchor(x.f), detail, meta);
    const isGravity = net === 'sewer' || net === 'storm';
    const isPressure = net === 'water' || net === 'gas' || net === 'irrigation';
    const isWire = net === 'power' || net === 'lighting' || net === 'telecom';
    const mains = L.filter(x => x.el === 'MAIN' || x.el === 'FORC');

    if (isPressure) {
      P.forEach(p => {
        if (p.el === 'VALV' || p.el === 'FITT' || p.el === 'METR' || p.el === 'REGU') { const h = lineNear(p.c, tol); if (!h) { const h2 = lineNear(p.c, near * 3); A('err', ({ VALV: 'محبس', FITT: 'فيتنج', METR: 'عداد', REGU: 'منظم' })[p.el] + ' مش على الخط', p, h2 ? 'أقرب خط على ' + h2.d.toFixed(2) + ' م' : 'مفيش خط قريب'); } }
        if (p.el === 'HYDT') { const h = lineNear(p.c, tol); if (!h) { const h2 = lineNear(p.c, 30); if (!h2) A('warn', 'حنفية حريق مش متوصلة بالشبكة', p, 'مفيش خط في حدود 30 م'); else if (h2.d > near) A('warn', 'حنفية حريق مش لازقة في خط', p, 'أقرب خط على ' + h2.d.toFixed(2) + ' م'); } }
      });
      L.filter(x => x.el === 'SERV').forEach(s => {
        const ends = [s.c[0], s.c[s.c.length - 1]]; const hits = ends.map(c => lineNear(c, tol, ln => ln.el === 'MAIN'));
        if (!hits[0] && !hits[1] && !ends.some(c => ptNear(c, Math.max(tol, 0.05), p => p.el === 'VALV' || p.el === 'FITT') || endsAt(c, tol, ln => ln.el === 'SERV', s).length)) A('err', 'توصيلة مش متوصلة بخط رئيسي', s, 'ولا طرف من الطرفين على ماسورة رئيسية أو محبس أو توصيلة تانية');
        if (s.len > 50) A('warn', 'توصيلة منزلية طويلة', s, s.len.toFixed(1) + ' م (أكتر من 50 م)');
        const h = hits[0] || hits[1]; if (h) { const ds = diaOf(s.l, s.f), dm = diaOf(h.ln.l, h.ln.f); if (ds && dm && ds > dm) A('warn', 'قطر التوصيلة أكبر من الماسورة الرئيسية', s, ds + ' > ' + dm + ' مم'); }
      });
      mains.forEach(m => {
        [0, m.c.length - 1].forEach(k => {
          const c = m.c[k]; const others = endsAt(c, tol, ln => ln.el === 'MAIN' || ln.el === 'FORC', m); const onMid = lineNear(c, tol, ln => ln !== m && (ln.el === 'MAIN' || ln.el === 'FORC'));
          const pt = ptNear(c, Math.max(tol, 0.5));
          if (!others.length && !onMid && !pt) A('warn', 'نهاية ماسورة من غير طبة/محبس/حنفية', m, 'آخر الخط مفتوح — لو ده نهاية فعلًا حط Cap أو Washout');
          if (others.length === 1 && !pt) { const d1 = diaOf(m.l, m.f), d2 = diaOf(others[0].ln.l, others[0].ln.f); if (d1 && d2 && d1 !== d2 && k === m.c.length - 1) A('warn', 'تغيير قطر من غير مسلوب', m, d1 + ' ← ' + d2 + ' مم في نفس النقطة'); }
        });
        const d = diaOf(m.l, m.f); if (d && STD_DIA.indexOf(Math.round(d)) < 0) A('warn', 'قطر مش قياسي', m, d + ' مم');
      });
      // valve spacing along each connected group of mains
      const par = mains.map((_, i) => i); const fd = i => par[i] === i ? i : (par[i] = fd(par[i]));
      const idx = new Map(mains.map((m, i) => [m, i]));
      mains.forEach((m, i) => [m.c[0], m.c[m.c.length - 1]].forEach(c => { endsAt(c, tol, ln => idx.has(ln), m).forEach(o2 => { par[fd(i)] = fd(idx.get(o2.ln)); }); const h = lineNear(c, tol, ln => ln !== m && idx.has(ln)); if (h) par[fd(i)] = fd(idx.get(h.ln)); }));
      const grp = new Map(); mains.forEach((m, i) => { const r = fd(i); if (!grp.has(r)) grp.set(r, { len: 0, ms: [], v: 0 }); const g = grp.get(r); g.len += m.len; g.ms.push(m); });
      P.filter(p => p.el === 'VALV').forEach(p => { const h = lineNear(p.c, tol, ln => idx.has(ln)); if (h) grp.get(fd(idx.get(h.ln))).v++; });
      grp.forEach(g => { if (g.len > 600 && g.len / Math.max(1, g.v) > 500) A('info', 'المحابس قليلة على الخط', g.ms[0], 'طول ' + (g.len / 1000).toFixed(2) + ' كم وعليه ' + g.v + ' محبس (أكتر من 500 م لكل محبس)'); });
    }
    if (isGravity) {
      // a gravity pipe may start/end at any network structure or junction: manhole, IC, clean-out (main or branch), WYE/TEE/junction chamber, outfall, inlet
      const mh = p => !/^(METR|HYDT|VALV|SADL|POLE)$/.test(p.el || '');
      const struct = p => p.el === 'MHOL' || p.el === 'INSP' || p.el === 'CLNO';
      const at = new Map(); // manhole → {in:[], out:[]}
      mains.forEach(m => {
        const a = m.c[0], b = m.c[m.c.length - 1]; const pa = ptNear(a, Math.max(tol, 0.5), mh), pb = ptNear(b, Math.max(tol, 0.5), mh);
        if (!pa || !pb) A('err', 'ماسورة انحدار مش بتبدأ وتنتهي عند غرفة', m, (!pa && !pb ? 'الطرفين' : !pa ? 'البداية' : 'النهاية') + ' مش عند غرفة تفتيش');
        if (pa) { if (!at.has(pa.p)) at.set(pa.p, { in: [], out: [] }); at.get(pa.p).out.push(m); }
        if (pb) { if (!at.has(pb.p)) at.set(pb.p, { in: [], out: [] }); at.get(pb.p).in.push(m); }
        // spacing between manholes: storm → netstd ST_SPACING; sewer spacing is off (Ahmed's decision)
        const pr = m.f.properties || {}; let us = numOf(pr, RE.us), ds = numOf(pr, RE.ds); let src = 'الحقول';
        if (us == null || ds == null) { const za = a[2] != null ? a[2] : (m.z[0] || [])[2], zb = b[2] != null ? b[2] : (m.z[m.z.length - 1] || [])[2]; if (isFinite(za) && isFinite(zb) && (za || zb)) { us = za; ds = zb; src = 'Z'; } }
        if (us != null && ds != null && m.len > 0) {
          const s = (us - ds) / m.len; const d = diaOf(m.l, m.f);
          if (s < 0) A('err', 'ميل عكسي', m, 'من ' + us + ' لـ ' + ds + ' (' + (s * 100).toFixed(2) + '%) — من ' + src + '. لو الرسم معكوس الاتجاه، اعكس الخط');
          else if (s === 0) A('err', 'ماسورة انحدار من غير ميل', m, 'المنسوبين متساويين');
          else if (s < MIN_SLOPE(d)) A('warn', 'الميل أقل من الحد الأدنى', m, (s * 100).toFixed(2) + '% والأدنى لقطر ' + (d || '?') + ' مم = ' + (MIN_SLOPE(d) * 100).toFixed(2) + '%');
          else if (s > 0.15) A('warn', 'ميل كبير جدًا', m, (s * 100).toFixed(1) + '%');
        }
      });
      P.filter(p => mh(p) && (struct(p) || p.el === 'INLT' || p.el === 'OUTF')).forEach(p => {
        const c = at.get(p); const pr = p.f.properties || {};
        if (!c && struct(p) && !lineNear(p.c, Math.max(tol, 0.5))) A('warn', 'غرفة مش متوصلة بأي ماسورة', p);
        if (c && struct(p) && c.in.length && !c.out.length && p.el !== 'OUTF') A('warn', 'غرفة مفيهاش خروج (نهاية الشبكة؟)', p, c.in.length + ' داخل · 0 خارج — لو مش آخر الشبكة يبقى اتجاه رسم غلط');
        if (c && c.out.length && c.in.length) { const di = Math.max(...c.in.map(m => diaOf(m.l, m.f) || 0)), dO = Math.min(...c.out.map(m => diaOf(m.l, m.f) || 1e9)); if (di && dO < 1e9 && dO < di) A('err', 'القطر بيصغر مع اتجاه السريان', p, 'داخل ' + di + ' مم ← خارج ' + dO + ' مم'); }
        const cv = numOf(pr, RE.cover), iv = numOf(pr, RE.inv); let dp = numOf(pr, RE.depth); if (dp == null && cv != null && iv != null) dp = cv - iv;
        if (cv != null && iv != null && iv > cv) A('err', 'منسوب القاع أعلى من الغطا', p, 'القاع ' + iv + ' > الغطا ' + cv);
        else if (dp != null && (dp < 0.8 || dp > 8)) A('warn', 'عمق غرفة غير منطقي', p, dp.toFixed(2) + ' م (المعقول 0.8–8 م)');
        if (p.el === 'INLT' && !lineNear(p.c, near * 2)) A('warn', 'مصيدة/جالي مش متوصلة بماسورة', p);
      });
      L.filter(x => x.el === 'SERV').forEach(s => { const ok = [s.c[0], s.c[s.c.length - 1]].some(c => lineNear(c, tol, ln => ln.el === 'MAIN') || ptNear(c, Math.max(tol, 0.5), mh)); if (!ok) A('err', 'وصلة منزلية مش متوصلة بغرفة أو خط', s); });
    }
    if (isWire) {
      const dev = p => /POLE|PANL|SUBS|RMU|FPIL|MHOL|HHOL|CABN|METR/.test(p.el || '');
      const cables = L.filter(x => x.el === 'CABL' || x.el === 'MVCB' || x.el === 'DUCT' || x.el === 'MAIN');
      cables.forEach(cb => [0, cb.c.length - 1].forEach(k => { const c = cb.c[k]; if (!ptNear(c, Math.max(near, 0.5), dev) && !endsAt(c, tol, null, cb).length && !lineNear(c, tol, ln => ln !== cb)) A('err', net === 'telecom' ? 'دكت نهايته مش عند غرفة/كابينة' : 'كابل نهايته مش عند جهاز (عمود/لوحة/محطة)', cb, k ? 'النهاية' : 'البداية'); }));
      if (net === 'power') cables.filter(x => x.el === 'CABL').forEach(cb => [cb.c[0], cb.c[cb.c.length - 1]].forEach(c => { const mv = endsAt(c, tol, ln => ln.el === 'MVCB'); if (mv.length && !ptNear(c, near, p => /SUBS|RMU/.test(p.el || ''))) A('warn', 'كابل منخفض متوصل بمتوسط من غير محطة/RMU', cb); }));
      if (net === 'lighting') {
        const poles = P.filter(p => p.el === 'POLE');
        poles.forEach(p => { if (!lineNear(p.c, Math.max(near, 0.5), ln => cables.indexOf(ln) >= 0)) A('warn', 'عمود إنارة مش متوصل بكابل', p); let nd = Infinity; poles.forEach(q => { if (q !== p) { const d = Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]); if (d < nd) nd = d; } }); if (nd < 8) A('warn', 'عمودين قريبين جدًا', p, nd.toFixed(1) + ' م'); else if (nd > 80 && nd < Infinity) A('info', 'عمود بعيد عن اللي جنبه', p, nd.toFixed(0) + ' م'); });
        // every group of connected poles/cables must reach a panel
        const nodes = cables.concat(P.filter(p => p.el === 'POLE' || p.el === 'PANL')); const par = nodes.map((_, i) => i); const fd = i => par[i] === i ? i : (par[i] = fd(par[i])); const id = new Map(nodes.map((n, i) => [n, i]));
        cables.forEach(cb => [cb.c[0], cb.c[cb.c.length - 1]].forEach(c => { endsAt(c, tol, ln => id.has(ln), cb).forEach(o2 => { par[fd(id.get(cb))] = fd(id.get(o2.ln)); }); const pp = ptNear(c, Math.max(near, 0.5), p => id.has(p)); if (pp) par[fd(id.get(cb))] = fd(id.get(pp.p)); }));
        P.filter(p => id.has(p)).forEach(p => { const h = lineNear(p.c, Math.max(near, 0.5), ln => id.has(ln)); if (h) par[fd(id.get(p))] = fd(id.get(h.ln)); });
        const g = new Map(); nodes.forEach((n, i) => { const r = fd(i); if (!g.has(r)) g.set(r, { poles: 0, panel: 0, cab: 0, first: null }); const x = g.get(r); if (cables.indexOf(n) >= 0) x.cab++; if (n.el === 'POLE') { x.poles++; x.first = x.first || n; } if (n.el === 'PANL') x.panel++; });
        if (P.some(p => p.el === 'PANL')) g.forEach(x => { if (x.poles && x.cab && !x.panel) A('err', 'مجموعة أعمدة من غير لوحة تغذية', x.first, x.poles + ' عمود متوصلين ببعض ومش واصلين لأي لوحة'); });
      }
    }

    /* ---- "طريقتنا": conventions measured from the delivered GDBs (NWC water, Amanah storm, lighting zones) ---- */
    const OUR = (sev, type, x, detail) => A(sev, type, x, detail, { our: 1 });
    const vtxD = (c, ln) => { let d = Infinity; ln.c.forEach(v => { const e = Math.hypot(v[0] - c[0], v[1] - c[1]); if (e < d) d = e; }); return d; };
    const isEnd = (c, ln) => Math.min(Math.hypot(ln.c[0][0] - c[0], ln.c[0][1] - c[1]), Math.hypot(ln.c[ln.c.length - 1][0] - c[0], ln.c[ln.c.length - 1][1] - c[1])) <= tol;
    const nm = (pr, re) => { const k = F(pr, re); return k ? String(pr[k] == null ? '' : pr[k]).trim() : ''; };
    if (isPressure) {
      const servs = L.filter(x => x.el === 'SERV'); const hasJ = P.some(p => p.el === 'FITT'); const hasM = P.some(p => p.el === 'METR');
      // 1) a valve on a line always splits it (mains and hydrant branches) — 0 exceptions in the delivered water GDB
      P.filter(p => p.el === 'VALV').forEach(p => { const h = lineNear(p.c, tol, ln => ln.el === 'MAIN' || ln.el === 'SERV' || ln.el === 'FORC'); if (h && !isEnd(p.c, h.ln)) OUR('warn', 'الخط مش مقطوع عند المحبس', p, 'في الداتا المسلّمة الماسورة بتتقسم عند كل محبس (حتى فرعة الحنفية) — شغّل «قسم الخطوط عند الأجهزة» في الإصلاح'); });
      // 2) main-to-main tee: the through main is split at the tee
      mains.forEach(m => [m.c[0], m.c[m.c.length - 1]].forEach(c => { const h = lineNear(c, tol, ln => ln !== m && (ln.el === 'MAIN' || ln.el === 'FORC')); if (h && !isEnd(c, h.ln)) OUR('warn', 'الماسورة مش مقطوعة عند التفريعة (Tee)', h.ln, 'ماسورة تانية لازقة في نصها — المسلّم: الرئيسي بيتقسم عند كل Tee وعليها Junction'); }));
      servs.forEach(s => {
        const a = s.c[0], b = s.c[s.c.length - 1]; const ha = lineNear(a, tol, ln => ln.el === 'MAIN'), hb = lineNear(b, tol, ln => ln.el === 'MAIN');
        // 3) laterals are drawn FROM the main TO the meter
        if (!ha && hb) OUR('info', 'اتجاه التوصيلة معكوس', s, 'المسلّم: التوصيلة بتبدأ من الماسورة وتنتهي عند العداد/الحنفية');
        const h = ha || hb, c = ha ? a : b;
        if (h) {
          // 4) tap point is a vertex of the main (main NOT split for house connections)
          if (vtxD(c, h.ln) > tol) OUR('warn', 'التوصيلة لازقة في نص سيجمنت من غير vertex', s, 'المسلّم: مكان التفريعة vertex على الماسورة (من غير تقسيم) — شغّل «إضافة vertex» في الإصلاح');
          if (hasJ && !ptNear(c, Math.max(tol, 0.05), p => p.el === 'FITT' || p.el === 'VALV')) OUR('info', 'مفيش Junction عند تفريعة التوصيلة', s, 'في الداتا المسلّمة كل توصيلة عند بدايتها W_JUNCTION (Tee)');
        }
        const far = ha ? b : a;
        if (hasM && h && !ptNear(far, Math.max(tol, 0.05), p => p.el === 'METR' || p.el === 'HYDT' || p.el === 'VALV')) OUR('info', 'آخر التوصيلة مفيهوش عداد', s, 'المسلّم: كل توصيلة منزلية آخرها W_METERINGPOINT');
      });
      // 5) devices sit exactly on vertices (0 cm in the delivered data)
      P.filter(p => p.el && p.el !== 'HYDT').forEach(p => { const h = lineNear(p.c, tol); if (h && vtxD(p.c, h.ln) > 0.001 && vtxD(p.c, h.ln) <= tol) OUR('info', 'الجهاز مش على vertex بالظبط', p, (vtxD(p.c, h.ln) * 100).toFixed(1) + ' سم'); });
    }
    if (isGravity) {
      const mhs = P.filter(p => p.el === 'MHOL' || p.el === 'INSP' || p.el === 'OUTF');
      const idOf = p => !p ? '' : nm(p.f.properties || {}, /^(mh_?id|manhole_?id|manhole_anno|id|name|label|tag)$/i);
      mains.forEach(m => {
        if (m.c.length > 2) { const a0 = m.c[0], b0 = m.c[m.c.length - 1]; const dev = Math.max(...m.c.slice(1, -1).map(v => segD(v, a0, b0))); if (dev > 0.05) OUR('info', 'ماسورة انحدار فيها انحناء', m, 'بتبعد ' + dev.toFixed(2) + ' م عن الخط المستقيم — المسلّم: خط مستقيم من غرفة لغرفة'); }
        const pr = m.f.properties || {}; const a = m.c[0], b = m.c[m.c.length - 1];
        const ua = ptNear(a, Math.max(tol, 0.5), p => mhs.indexOf(p) >= 0), ub = ptNear(b, Math.max(tol, 0.5), p => mhs.indexOf(p) >= 0);
        const us = nm(pr, /^(us_?mh_?id|from_?mh|up_?mh|us_?node|from_?node)$/i), ds = nm(pr, /^(ds_?mh_?id|to_?mh|down_?mh|ds_?node|to_?node)$/i);
        if (us && ua && idOf(ua.p) && idOf(ua.p) !== us) OUR('err', 'US_MH_ID مش مطابق للغرفة اللي في أول الخط', m, us + ' ≠ ' + idOf(ua.p) + (us.replace(/[^0-9A-Z]/gi, '') === idOf(ua.p).replace(/[^0-9A-Z]/gi, '') ? ' (فرق كتابة بس)' : ''));
        if (ds && ub && idOf(ub.p) && idOf(ub.p) !== ds) OUR('err', 'DS_MH_ID مش مطابق للغرفة اللي في آخر الخط', m, ds + ' ≠ ' + idOf(ub.p) + (ds.replace(/[^0-9A-Z]/gi, '') === idOf(ub.p).replace(/[^0-9A-Z]/gi, '') ? ' (فرق كتابة بس)' : ''));
        if ((!us && ua && idOf(ua.p)) || (!ds && ub && idOf(ub.p))) OUR('info', 'US/DS_MH_ID فاضي وممكن يتملى من الغرف', m, (us || idOf(ua ? ua.p : null) || '?') + ' → ' + (ds || (ub ? idOf(ub.p) : '?')));
        const ui = numOf(pr, RE.us), di = numOf(pr, RE.ds), sl = numOf(pr, /^(slope|grad(e|ient)?|الميل)$/i);
        if (ui != null && di != null && sl != null && m.len > 0) { const calc = (ui - di) / m.len * 100; if (Math.abs(calc - sl) > 0.05 && Math.abs(calc / 100 - sl) > 0.0005) OUR('warn', 'SLOPE مش مطابق للمناسيب', m, 'الحقل ' + sl + ' والمحسوب ' + calc.toFixed(2) + '% (US−DS)/الطول×100'); }
      });
      mhs.forEach(p => { const pr = p.f.properties || {}; const cv = numOf(pr, RE.cover), iv = numOf(pr, RE.inv), dp = numOf(pr, RE.depth); if (cv != null && iv != null && dp != null && Math.abs(cv - iv - dp) > 0.05) OUR('warn', 'DEPTH مش = COVER − INVERT', p, dp + ' والمحسوب ' + (cv - iv).toFixed(2)); });
      // catch-basin connection lines: from the catch basin to a manhole or onto the pipe
      L.filter(x => x.el === 'SERV').forEach(s => {
        const a = s.c[0], b = s.c[s.c.length - 1]; const cb = c => ptNear(c, Math.max(near, 0.5), p => p.el === 'INLT'); const dn = c => ptNear(c, Math.max(tol, 0.5), p => mhs.indexOf(p) >= 0) || lineNear(c, tol, ln => ln.el === 'MAIN') || lineNear(c, tol, ln => ln !== s && ln.el === 'SERV');
        if (P.some(p => p.el === 'INLT')) { if (!cb(a) && !cb(b)) OUR('warn', 'خط توصيل مصيدة مش طالع من مصيدة', s); else if (!cb(a) && cb(b)) OUR('info', 'اتجاه خط المصيدة معكوس', s, 'المسلّم: من المصيدة للغرفة/الماسورة'); }
        if (!dn(a) && !dn(b)) OUR('err', 'خط المصيدة مش واصل لغرفة أو ماسورة', s);
      });
    }
    if (net === 'lighting') {
      const cbs = L.filter(x => x.el === 'CABL' || x.el === 'MAIN'); const poles = P.filter(p => p.el === 'POLE');
      // cables run pole-to-pole: one feature per span
      poles.forEach(p => { const h = lineNear(p.c, Math.max(tol, 0.05), ln => cbs.indexOf(ln) >= 0); if (h && !isEnd(p.c, h.ln)) OUR('warn', 'الكابل مش مقطوع عند العمود', h.ln, 'المسلّم: كابل لكل باكية من عمود لعمود — شغّل «قسم الخطوط عند الأجهزة» في الإصلاح'); });
      const cnt = new Map(); cbs.forEach(cb => [cb.c[0], cb.c[cb.c.length - 1]].forEach(c => { const pp = ptNear(c, Math.max(tol, 0.05), p => p.el === 'POLE'); if (pp) cnt.set(pp.p, (cnt.get(pp.p) || 0) + 1); }));
      cnt.forEach((n, p) => { if (n > 3) OUR('info', 'عمود داخل عليه كابلات كتير', p, n + ' كابل (المعتاد 1–3)'); });
      // ArcGIS rule used on delivery: Cabels — Must Not Overlap
      const seen = new Set();
      cbs.forEach((cb, ci) => { for (let i = 1; i < cb.c.length; i++) { const a = cb.c[i - 1], b = cb.c[i]; const sl = Math.hypot(b[0] - a[0], b[1] - a[1]); if (sl < 0.05) continue; const q = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; const h = lineNear(q(0.5), 0.002, ln => ln !== cb && cbs.indexOf(ln) >= 0); if (h && !(lineNear(q(0.25), 0.002, ln => ln === h.ln) && lineNear(q(0.75), 0.002, ln => ln === h.ln))) continue; if (h) { const k = [ci, cbs.indexOf(h.ln)].sort().join('|'); if (seen.has(k)) continue; seen.add(k); OUR('err', 'كابلين فوق بعض (Must Not Overlap)', cb, 'متطابق مع كابل تاني على طول ~' + sl.toFixed(1) + ' م'); } } });
      poles.forEach(p => { const pr = p.f.properties || {}; const an = nm(pr, /^asset_?number_?$/i), pn = nm(pr, /^panel_?$/i); if (an && pn && an.toUpperCase().indexOf(pn.toUpperCase()) !== 0) OUR('info', 'رقم الأصل مش بيبدأ باسم اللوحة', p, an + ' / ' + pn + ' — المسلّم: PANEL-FEED-رقم (زي LSP5-1-22)'); });
    }
    if (GV.netStd) { try { GV.netStd.run({ net, L, P, lineNear, ptNear, endsAt, tol, near, A, diaOf, segD }); } catch (e) { console.error('netStd', e); } }
    // attribute rules per network
    if (o.attr) {
      const pack = ATTR[net] || {};
      sel.forEach(({ l }) => {
        const feats = l.features.map((f, fi) => ({ f, fi })).filter(x => !x.f._sym && !(x.f.properties && x.f.properties.Text != null));
        if (!feats.length) return;
        const groups = new Map(); const le = lEl.get(l);
        feats.forEach(x => { const pr = x.f.properties || {}; const t = [pr.Block, pr.ASSETTYPE, pr.TYPE, pr.Type].filter(Boolean).join(' '); const e = (t && elemOfText(t)) || le; if (!e || !pack[e]) return; if (!groups.has(e)) groups.set(e, []); groups.get(e).push(x); });
        groups.forEach((xs, e) => pack[e].forEach(([fk, ar, spec]) => {
          const k = F(xs[0].f.properties || {}, RE[fk]) || (xs.find(x => F(x.f.properties || {}, RE[fk])) && F(xs.find(x => F(x.f.properties || {}, RE[fk])).f.properties, RE[fk]));
          const req = /req/.test(spec);
          if (!k) { if (req && !(fk === 'dia' && xs.every(x => diaOf(l, x.f)))) add(req ? 'warn' : 'info', 'attr', 'حقل ' + ar + ' مش موجود', l, null, null, 'مطلوب لـ ' + NETS[net] + ' — اقترح اسم: ' + ({ dia: 'DIAMETER', mat: 'MATERIAL', us: 'US_IL', ds: 'DS_IL', cover: 'COVER_LEVEL', inv: 'INVERT_LEVEL', depth: 'DEPTH', vtype: 'VALVE_TYPE', status: 'STATUS', volt: 'VOLTAGE', csize: 'CABLE_SIZE', height: 'POLE_HEIGHT', watt: 'WATTAGE', ptype: 'POLE_TYPE', press: 'PRESSURE' })[fk]); return; }
          const rng = /range:([\d.]+):([\d.]+)/.exec(spec);
          xs.forEach(({ f, fi }) => {
            const v = (f.properties || {})[k]; const empty = v == null || String(v).trim() === '';
            if (empty) { if (req) add('err', 'attr', ar + ' فاضي', l, fi, anchor(f), k, { field: k }); return; }
            if (/dia/.test(spec)) { const d = parseFloat(String(v).replace(/[^\d.]/g, '')); if (!isFinite(d) || d <= 0) add('err', 'attr', 'قطر مش رقم', l, fi, anchor(f), k + ' = ' + v, { field: k, value: v }); else if (d < 3) add('warn', 'attr', 'القطر شكله بالمتر مش بالملي', l, fi, anchor(f), k + ' = ' + v, { field: k, value: v }); else if (STD_DIA.indexOf(Math.round(d)) < 0) add('warn', 'attr', 'قطر مش قياسي', l, fi, anchor(f), k + ' = ' + v, { field: k, value: v }); }
            if (spec === 'mat') { const s = String(v).toLowerCase().replace(/[^a-z0-9 ]/g, ' '); if (!(MATS[net] || []).some(m => s.split(/\s+/).indexOf(m) >= 0 || s.indexOf(m) >= 0)) add('warn', 'attr', 'مادة مش معروفة', l, fi, anchor(f), k + ' = "' + v + '"', { field: k, value: v }); }
            if (spec === 'vtype') { const s = String(v).toLowerCase(); if (!VTYPES.some(t => s.indexOf(t) >= 0)) add('info', 'attr', 'نوع محبس مش معروف', l, fi, anchor(f), k + ' = "' + v + '"', { field: k, value: v }); }
            if (rng) { const n = parseFloat(v); if (!isFinite(n) || n < +rng[1] || n > +rng[2]) add('warn', 'attr', ar + ' برّه المعقول', l, fi, anchor(f), k + ' = ' + v + ' (المعقول ' + rng[1] + '–' + rng[2] + ')', { field: k, value: v }); }
          });
        }));
      });
    }
  }
  GV.netElemOf = t => elemOfText(t);
  GV.netQC = run; GV.NET_NAMES = NETS;
})();
