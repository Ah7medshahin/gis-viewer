// Network build after CAD → GIS: surveyed nodes first, lines from the drawing, then connect them like a real network.
// Works on the converted classes in the projected target CRS (metres). Originals are never touched.
(function () {
  'use strict';
  const GV = window.GV;
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const proj = (q, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const x = [a[0] + t * dx, a[1] + t * dy]; return { t, x, d: D(q, x) }; };
  const elOf = n => (GV.netElemOf ? GV.netElemOf(n) : null);
  const LINE_EL = { MAIN: 1, SERV: 1, FORC: 1, CULV: 1, CABL: 1, MVCB: 1, DUCT: 1 };
  // which node types cut a line into separate features (measured from the delivered GDBs)
  const SPLITS = {
    water: { VALV: ['MAIN', 'FORC', 'SERV'] }, irrigation: { VALV: ['MAIN', 'SERV'] }, gas: { VALV: ['MAIN', 'SERV'] },
    storm: { MHOL: ['MAIN'], INSP: ['MAIN'], OUTF: ['MAIN'] }, sewer: { MHOL: ['MAIN'], INSP: ['MAIN'] },
    lighting: { POLE: ['CABL', 'MAIN'], PANL: ['CABL', 'MAIN'] }, power: { SUBS: ['CABL', 'MVCB'], RMU: ['MVCB'], FPIL: ['CABL'] }, telecom: { MHOL: ['DUCT'], HHOL: ['DUCT'], CABN: ['DUCT'] }
  };
  // node types that physically sit ON the line (a symbol drawn beside it gets moved onto it). Manholes/inlets/hydrants/panels are not moved: lines are connected to them instead.
  const ONLINE = { water: { VALV: 1, FITT: 1, METR: 1 }, irrigation: { VALV: 1, FITT: 1, SPRK: 1 }, gas: { VALV: 1, FITT: 1, REGU: 1 }, lighting: { POLE: 1 }, power: {}, telecom: {}, storm: {}, sewer: { CLNO: 1, INSP: 1 } };
  function grid(cell) { const G = new Map(); return { add(x0, y0, x1, y1, v) { for (let i = Math.floor(Math.min(x0, x1) / cell); i <= Math.floor(Math.max(x0, x1) / cell); i++) for (let j = Math.floor(Math.min(y0, y1) / cell); j <= Math.floor(Math.max(y0, y1) / cell); j++) { const k = i + ',' + j; if (!G.has(k)) G.set(k, []); G.get(k).push(v); } }, near(x, y, r) { const o = new Set(); for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) (G.get(i + ',' + j) || []).forEach(v => o.add(v)); return Array.from(o); } }; }

  function build(out, net, survey) {
    const R = { net, surveyMatched: 0, surveyAdded: 0, movedToLine: 0, moveAvg: 0, endsSnapped: 0, splits: 0, vertices: 0, nodesOff: 0, danglingEnds: 0, maxMove: 0, notes: [] };
    const cls = out.map(o => ({ o, el: elOf(o.name), geom: (o.features.find(f => f.geometry) || {}).geometry }));
    const lineC = cls.filter(c => LINE_EL[c.el] || (c.geom && /Line/.test(c.geom.type)));
    const nodeC = cls.filter(c => !lineC.includes(c) && c.el && (!c.geom || c.geom.type === 'Point'));
    if (!lineC.length) return R;
    // --- lines (single parts) ---
    lineC.forEach(c => { const n0 = c.o.features.length; c.o.features = c.o.features.filter(f => { const g = f.geometry; if (!g || !/Line/.test(g.type)) return true; const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates; let L = 0; parts.forEach(p => { for (let i = 1; i < p.length; i++) L += D(p[i], p[i - 1]); }); return L >= 0.05; }); R.zeroDropped = (R.zeroDropped || 0) + n0 - c.o.features.length; });
    const lines = []; lineC.forEach(c => c.o.features.forEach(f => { const g = f.geometry; if (!g) return; if (g.type === 'MultiLineString') { if (g.coordinates.length === 1) f.geometry = g = { type: 'LineString', coordinates: g.coordinates[0] }; else return; } if (g.type === 'LineString' && g.coordinates.length > 1) lines.push({ c, f, el: c.el || 'MAIN', p: g.coordinates }); }));
    const LG = grid(10); const indexLines = () => { lines.forEach((ln, li) => { for (let i = 1; i < ln.p.length; i++) LG.add(ln.p[i - 1][0], ln.p[i - 1][1], ln.p[i][0], ln.p[i][1], [li, i]); }); };
    indexLines();
    const nearestOnLines = (q, r, filt) => { let best = null; LG.near(q[0], q[1], r).forEach(([li, i]) => { const ln = lines[li]; if (filt && !filt(ln)) return; const a = ln.p[i - 1], b = ln.p[i]; if (!a || !b) return; const pr = proj(q, a, b); if (pr.d <= r && (!best || pr.d < best.d)) best = Object.assign(pr, { li, i }); }); return best; };
    // vertex/end of a line near q (the base of a symbol drawn beside the line is usually where the line bends or ends)
    const nearestVertex = (q, r, filt) => { let best = null; LG.near(q[0], q[1], r).forEach(([li, i]) => { const ln = lines[li]; if (filt && !filt(ln)) return; [i - 1, i].forEach(k => { const v = ln.p[k]; if (!v) return; const d = D(q, v); if (d <= r && (!best || d < best.d)) best = { d, x: v.slice(0, 2), li, k }; }); }); return best; };
    const lineFor = el => ln => { const sp = (SPLITS[net] || {})[el]; return sp ? sp.includes(ln.el) : true; };

    // --- 1. surveyed points win: a drawn symbol next to a surveyed point takes the surveyed position ---
    const nodes = []; nodeC.forEach(c => c.o.features.forEach(f => { if (f.geometry && f.geometry.type === 'Point') nodes.push({ c, f, el: (() => { const t = f.properties && (f.properties.FEATURETYPE || f.properties.Block); const e2 = t && GV.netElemOf ? GV.netElemOf(String(t)) : null; return e2 && !LINE_EL[e2] && /^(CLNO|INSP|MHOL|OUTF|INLT)$/.test(e2) && /^(MHOL|INSP|CLNO)$/.test(c.el || '') ? e2 : c.el; })(), p: f.geometry.coordinates, fromSurvey: /^نقط جدول|table/i.test(String(f.properties.SOURCE_LAYER || '')) }); }));
    const sv = (survey || []).filter(s => s.p && isFinite(s.p[0]));
    if (sv.length && nodes.length) {
      const SG = grid(5); sv.forEach((s, i) => SG.add(s.p[0], s.p[1], s.p[0], s.p[1], i));
      const pairs = []; nodes.forEach((n, ni) => { if (n.fromSurvey) return; SG.near(n.p[0], n.p[1], 12).forEach(si => { const s = sv[si]; if (s.el && n.el && s.el !== n.el && !(s.el === 'FITT' && n.el === 'VALV')) return; const d = D(n.p, s.p); if (d <= 12) pairs.push({ ni, si, d }); }); });
      // adaptive radius: symbols are drawn at a fairly constant offset from their surveyed base
      const ds = pairs.map(x => x.d).sort((a, b) => a - b); const med = ds.length ? ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.5))] : 0; const rad = Math.min(12, Math.max(2, med * 2.5 + 0.5));
      pairs.sort((a, b) => a.d - b.d); const usedN = new Set(), usedS = new Set(); let mv = 0;
      pairs.forEach(({ ni, si, d }) => { if (d > rad || usedN.has(ni) || usedS.has(si)) return; usedN.add(ni); usedS.add(si); const n = nodes[ni], s = sv[si]; n.p[0] = s.p[0]; n.p[1] = s.p[1]; if (s.z != null && n.p.length > 2) n.p[2] = s.z; n.surveyed = true; mv += d; R.maxMove = Math.max(R.maxMove, d); fillFromSurvey(n.f, s); R.surveyMatched++; });
      if (R.surveyMatched) R.notes.push('الرموز المرسومة كانت بعيدة عن نقطة الرفع بمتوسط ' + (mv / R.surveyMatched).toFixed(2) + ' م (الرسم بيحط الرمز جنب القاعدة) — اتنقلت لإحداثيات الرفع');
      // surveyed points of a known element with no drawn symbol → new node (as-built survey is the truth)
      sv.forEach((s, si) => { if (usedS.has(si) || !s.el) return; const c = nodeC.find(x => x.el === s.el) || (s.el === 'FITT' ? null : null); if (!c) return; const near = nodes.find(n => n.el === s.el && D(n.p, s.p) < 0.3); if (near) return; const f = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: s.p.slice() } }; (c.o.fields || []).forEach(k => f.properties[k] = null); f.properties.SOURCE_LAYER = 'جدول الرفع'; fillFromSurvey(f, s); c.o.features.push(f); nodes.push({ c, f, el: s.el, p: f.geometry.coordinates, surveyed: true }); R.surveyAdded++; });
    }
    // --- 2. no survey for a node: put it on the network (base of the symbol = where the line is) ---
    let mvSum = 0; const occ = new Map(); const ok = q => Math.round(q[0] * 20) + ',' + Math.round(q[1] * 20); nodes.forEach(n => occ.set(ok(n.p), (occ.get(ok(n.p)) || 0) + 1));
    nodes.forEach(n => {
      if (n.surveyed || n.fromSurvey || !(ONLINE[net] || {})[n.el]) return; const filt = /^(INSP|CLNO)$/.test(n.el) ? (() => true) : lineFor(n.el);
      const on = nearestOnLines(n.p, 0.0005, filt); if (on) return;
      const v = nearestVertex(n.p, 6, filt); const s = nearestOnLines(n.p, 6, filt);
      const small = /^(INSP|CLNO)$/.test(n.el); const t = small ? (s && s.d <= 0.1 ? (v && v.d <= s.d + 0.005 ? v.x : s.x) : null) : v && (!s || v.d <= s.d + 1.5) ? v.x : s ? s.x : null; if (!t) return;
      if (/^(INSP|CLNO)$/.test(n.el) && occ.get(ok(t))) return; const d = D(n.p, t); occ.set(ok(n.p), (occ.get(ok(n.p)) || 1) - 1); occ.set(ok(t), (occ.get(ok(t)) || 0) + 1); n.p[0] = t[0]; n.p[1] = t[1]; mvSum += d; R.movedToLine++; R.maxMove = Math.max(R.maxMove, d);
    });
    if (R.movedToLine) { R.moveAvg = mvSum / R.movedToLine; R.notes.push(R.movedToLine + ' رمز اتنقل على الخط (متوسط ' + R.moveAvg.toFixed(2) + ' م) — مكان القاعدة اللي الخط بيعدي عليها'); }
    // keep X/Y fields in step with the node position
    nodes.forEach(n => { const pr = n.f.properties; Object.keys(pr).forEach(k => { if (/^(x|xcoordinate|x_coordinates?|easting|point_x)$/i.test(k)) pr[k] = +n.p[0].toFixed(3); if (/^(y|ycoordinate|y_coordinates?|northing|point_y)$/i.test(k)) pr[k] = +n.p[1].toFixed(3); }); });
    // --- 3. lines meet nodes: snap ends to the node they were drawn to ---
    const NG = grid(5); nodes.forEach((n, i) => NG.add(n.p[0], n.p[1], n.p[0], n.p[1], i));
    const nodeNear = (q, r, filt) => { let b = null; NG.near(q[0], q[1], r).forEach(i => { const n = nodes[i]; if (filt && !filt(n)) return; const d = D(q, n.p); if (d <= r && (!b || d < b.d)) b = { n, d }; }); return b; };
    const ATTACH = { MAIN: { storm: 'MHOL INSP OUTF', sewer: 'MHOL INSP OUTF', water: 'VALV FITT HYDT', irrigation: 'VALV FITT', gas: 'VALV FITT REGU', lighting: 'POLE PANL' }, FORC: { water: 'VALV FITT', sewer: 'VALV MHOL' }, SERV: { storm: 'INLT MHOL INSP', sewer: 'MHOL INSP CLNO', water: 'METR HYDT VALV FITT', irrigation: 'SPRK VALV FITT', gas: 'METR VALV REGU' }, CABL: { lighting: 'POLE PANL', power: 'SUBS RMU FPIL METR POLE' }, MVCB: { power: 'SUBS RMU' }, DUCT: { telecom: 'MHOL HHOL CABN' } };
    const nodeForLine = ln => n => { const a = (ATTACH[ln.el] || {})[net]; if (a) return a.split(' ').includes(n.el); const sp = (SPLITS[net] || {})[n.el]; return sp ? sp.includes(ln.el) : !LINE_EL[n.el]; };
    lines.forEach(ln => [0, ln.p.length - 1].forEach(k => { const e = ln.p[k]; const h = nodeNear(e, 2.5, nodeForLine(ln)); if (h && h.d > 0.001) { e[0] = h.n.p[0]; e[1] = h.n.p[1]; R.endsSnapped++; } }));
    // line ends that still hang free: join to another line end / onto a line within 0.5 m
    const ends = []; lines.forEach((ln, li) => [0, ln.p.length - 1].forEach(k => ends.push({ li, k, p: ln.p[k] })));
    ends.forEach(e => { if (nodeNear(e.p, 0.001)) return; let b = null; ends.forEach(o => { if (o === e || o.li === e.li) return; const d = D(o.p, e.p); if (d > 0.001 && d <= 0.5 && (!b || d < b.d)) b = { d, x: o.p }; }); if (b) { e.p[0] = b.x[0]; e.p[1] = b.x[1]; R.endsSnapped++; } });
    // --- 4. split lines at nodes that cut them; vertex where something connects mid-span ---
    const LG2 = grid(10); lines.forEach((ln, li) => { for (let i = 1; i < ln.p.length; i++) LG2.add(ln.p[i - 1][0], ln.p[i - 1][1], ln.p[i][0], ln.p[i][1], [li, i]); });
    const cuts = new Map(); const addV = (li, i, x, split) => { if (!cuts.has(li)) cuts.set(li, []); cuts.get(li).push({ i, x, split }); };
    nodes.forEach(n => { LG2.near(n.p[0], n.p[1], 0.05).forEach(([li, i]) => { const ln = lines[li]; const a = ln.p[i - 1], b = ln.p[i]; const pr = proj(n.p, a, b); if (pr.d > 0.05) return; if (D(n.p, ln.p[0]) < 0.05 || D(n.p, ln.p[ln.p.length - 1]) < 0.05) return; const split = ((SPLITS[net] || {})[n.el] || []).includes(ln.el); addV(li, i, n.p.slice(0, 2), split); }); });
    lines.forEach((ln, li) => [0, ln.p.length - 1].forEach(k => { const e = ln.p[k]; LG2.near(e[0], e[1], 0.05).forEach(([lj, i]) => { if (lj === li) return; const o = lines[lj]; const pr = proj(e, o.p[i - 1], o.p[i]); if (pr.d > 0.05 || D(e, o.p[0]) < 0.05 || D(e, o.p[o.p.length - 1]) < 0.05) return; const tee = ln.el === o.el && (o.el === 'MAIN' || o.el === 'FORC'); addV(lj, i, e.slice(0, 2), tee); }); }));
    const newFeats = new Map(); // class → features to add
    cuts.forEach((arr, li) => {
      const ln = lines[li]; const pts = ln.p; const z = pts[0].length > 2;
      arr.sort((a, b) => b.i - a.i || D(b.x, pts[b.i - 1]) - D(a.x, pts[a.i - 1]));
      const at = []; arr.forEach(c => { const ex = pts.findIndex(p => D(p, c.x) < 0.001); if (ex >= 0) { if (c.split) at.push(ex); return; } const a = pts[c.i - 1], b = pts[c.i]; const t = D(a, c.x) / (D(a, b) || 1); const np = z ? [c.x[0], c.x[1], a[2] + ((b[2] || a[2]) - a[2]) * t] : [c.x[0], c.x[1]]; pts.splice(c.i, 0, np); R.vertices++; at.forEach((v, k) => { if (v >= c.i) at[k]++; }); if (c.split) at.push(c.i); });
      const idx = Array.from(new Set(at)).filter(i => i > 0 && i < pts.length - 1).sort((a, b) => a - b); if (!idx.length) return;
      let st = 0; const parts = []; idx.forEach(i => { parts.push(pts.slice(st, i + 1)); st = i; }); parts.push(pts.slice(st));
      ln.f.geometry = { type: 'LineString', coordinates: parts[0] };
      parts.slice(1).forEach(pp => { const f2 = { type: 'Feature', properties: Object.assign({}, ln.f.properties), geometry: { type: 'LineString', coordinates: pp } }; if (!newFeats.has(ln.c)) newFeats.set(ln.c, []); newFeats.get(ln.c).push(f2); R.splits++; });
    });
    newFeats.forEach((fs, c) => fs.forEach(f => c.o.features.push(f)));
    // --- 5. refresh measured fields on every line ---
    lineC.forEach(c => c.o.features.forEach(f => { const g = f.geometry; if (!g || g.type !== 'LineString') return; const cc = g.coordinates; let L = 0; for (let i = 1; i < cc.length; i++) L += D(cc[i], cc[i - 1]); const pr = f.properties; Object.keys(pr).forEach(k => { const K = k.toUpperCase(); if (/^(ACTUALLENGTH|LENGTH|PIPE_LENGTH|LATERALLENGTH|CABEL_LENGHTH_BETWEEN_POLE_?)$/.test(K)) pr[k] = +L.toFixed(3); if (/^(STARTXCOORDINATE|START_X_COORDINATES_?)$/.test(K)) pr[k] = +cc[0][0].toFixed(3); if (/^(STARTYCOORDINATE|START_Y_COORDINATES_?)$/.test(K)) pr[k] = +cc[0][1].toFixed(3); if (/^(ENDXCOORDINATE|END_X_COORDINATES_?)$/.test(K)) pr[k] = +cc[cc.length - 1][0].toFixed(3); if (/^(ENDYCOORDINATE|END_Y_COORDINATES_?)$/.test(K)) pr[k] = +cc[cc.length - 1][1].toFixed(3); }); }));
    // --- 6. what is still not connected ---
    const allL = []; lineC.forEach(c => c.o.features.forEach(f => { if (f.geometry && f.geometry.type === 'LineString') allL.push(f.geometry.coordinates); }));
    const LG3 = grid(10); allL.forEach((p, li) => { for (let i = 1; i < p.length; i++) LG3.add(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], [li, i]); });
    const onAny = (q, self) => LG3.near(q[0], q[1], 0.01).some(([li, i]) => { if (li === self) return false; return proj(q, allL[li][i - 1], allL[li][i]).d <= 0.01; });
    nodes.forEach(n => { if (!onAny(n.p, -1)) R.nodesOff++; });
    allL.forEach((p, li) => [p[0], p[p.length - 1]].forEach(e => { if (!onAny(e, li) && !nodeNear(e, 0.01)) R.danglingEnds++; }));
    return R;
  }
  function fillFromSurvey(f, s) {
    const pr = f.properties; const set = (re, v) => { if (v == null || v === '') return; const k = Object.keys(pr).find(x => re.test(x)); if (k && (pr[k] == null || pr[k] === '')) pr[k] = v; };
    set(/^(asset_?number|mh_?id|manhole_anno|catchbasin_(id|anno)|serialnumber|cabel_number_?|pole_?no)$/i, s.id);
    set(/^(groundelevation|cover_level|elevation|z)$/i, s.z);
    set(/^(remarks|comments|description)$/i, s.desc);
    if ('SURVEY_ID' in pr || !Object.keys(pr).length) pr.SURVEY_ID = s.id;
  }
  // survey points from the coordinate tables found in the drawing (or read from pasted Excel)
  GV.netSurveyPoints = fwd => {
    const out = []; GV.sources.filter(s => s.flowTables).forEach(s => s.layers.forEach(l => l.features.forEach(f => { if (!f.wgs || !f.wgs.geometry || f.wgs.geometry.type !== 'Point') return; const p = fwd(f.wgs.geometry.coordinates); const pr = f.properties || {}; const keys = Object.keys(pr); const pick = re => { const k = keys.find(x => re.test(x)); return k ? pr[k] : null; };
      const desc = pick(/(desc|وصف|description|remark|code)/i); const code = pr['لير الكاد'] || ''; const el = elOf(code) || (desc ? elOf(String(desc)) : null) || elOf(l.name);
      const z0 = pick(/^(z|elev|elevation|level|منسوب|gl|rl)$/i); out.push({ p: [p[0], p[1]], z: z0 != null && isFinite(+z0) ? +z0 : null, id: pick(/^(point|pt|no|id|رقم|point ?#|point_?no|sn)/i), desc, el: el && !LINE_EL[el] ? el : null }); })));
    return out;
  };
  GV.netBuild = build;
})();
