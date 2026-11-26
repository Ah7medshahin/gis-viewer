/* Derived fields kept in step with the geometry and the network automatically:
   coordinates, length, start/end ground & invert levels of a line taken from the points at its ends, depth = GL − IL,
   slope = (start IL − end IL) / length × 100. Runs after every geometry edit (move / vertex), after edits applied by Claude,
   and on demand for whole layers. Only fields that already exist are written; originals are never touched (edits run
   on work copies). */
(function () {
  'use strict';
  const GV = window.GV;
  const RE = {
    x: /^(x|xcoordinate|x_coordinates?|easting|point_x)$/i, y: /^(y|ycoordinate|y_coordinates?|northing|point_y)$/i,
    sx: /^(start_?x_?coord(inate)?s?_?|startxcoordinate)$/i, sy: /^(start_?y_?coord(inate)?s?_?|startycoordinate)$/i,
    ex: /^(end_?x_?coord(inate)?s?_?|endxcoordinate)$/i, ey: /^(end_?y_?coord(inate)?s?_?|endycoordinate)$/i,
    len: /^(length|len|pipe_?length|pipelength|measuredlength|shape_?length|shape_leng|cable_?length)$/i,
    sg: /^(start_?pipe_?ground_?elevation|startpipegroundelevation|us_?gl|us_?ground(_?level)?|start_?gl|us_?cover(_?level)?|start_?ground(_?level)?)$/i,
    si: /^(start_?pipe_?elevation|startpipeelevation|us_?(pipe_?)?il|us_?inv(ert)?(_?level)?|start_?inv(ert)?(_?level)?|start_?il)$/i,
    eg: /^(end_?pipe_?ground_?elevation|endpipegroundelevation|ds_?gl|ds_?ground(_?level)?|end_?gl|ds_?cover(_?level)?|end_?ground(_?level)?)$/i,
    ei: /^(end_?pipe_?elevation|endpipeelevation|ds_?(pipe_?)?il|ds_?inv(ert)?(_?level)?|end_?inv(ert)?(_?level)?|end_?il)$/i,
    sd: /^(start_?depth|us_?depth)$/i, ed: /^(end_?depth|ds_?depth)$/i,
    slope: /^(slope|slope_?percent|slope_?pct|gradient)$/i,
    pg: /^(ground_?elevation|groundelevation|ground_?level|cover_?level|cover|cl|gl|rim(_?level)?|rim_?elevation)$/i,
    pi: /^(elevation|invert_?level|invert|il|inv|invert_?elevation|bottom_?elevation)$/i,
    pd: /^(depth|mh_?depth|manhole_?depth)$/i,
    drop: /^(?!.*(date|type|id$)).*drop/i // DROP, DROPHEIGHT, INTERIOR_DROP / INTERIORDROP / INTRIER DROP, INTERNAL_DROP…
  };
  const keyOf = (p, re) => Object.keys(p).find(k => re.test(k));
  const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
  const r3 = v => +v.toFixed(3);
  // metres between two WGS84 points (short distances)
  const dM = (a, b) => { const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180) * 111320; return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540); };
  const ends = f => { const g = f.wgs && f.wgs.geometry; if (!g) return null; const c = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' && g.coordinates.length ? [].concat(...g.coordinates) : null; return c && c.length > 1 ? [c[0], c[c.length - 1]] : null; };
  const lenOf = f => { const g = f.geometry; if (!g) return null; const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null; if (!parts) return null;
    const geo = Math.abs((parts[0][0] || [0])[0]) <= 180 && Math.abs((parts[0][0] || [0, 0])[1]) <= 90; let L = 0;
    parts.forEach(c => { for (let i = 1; i < c.length; i++) L += geo ? dM(c[i - 1], c[i]) : Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); }); return L; };
  const layers = () => GV.sources.filter(s => s.id !== 'qc' && s.id !== 'field').flatMap(s => s.layers.map(l => ({ s, l })));
  const editable = s => !(GV.superseded && GV.superseded(s)) && !s.readOnly;
  const pointAt = (c, tol) => { let best = null; layers().forEach(({ l }) => { if (l.kind !== 'point') return; l.features.forEach(f => { const g = f.wgs && f.wgs.geometry; if (!g || g.type !== 'Point' || f._sym) return; const d = dM(c, g.coordinates); if (d <= tol && (!best || d < best.d)) best = { d, f, l }; }); }); return best; };
  function setV(p, re, v, log) { const k = keyOf(p, re); if (!k || v == null || !isFinite(v)) return 0; const nv = r3(v); if (num(p[k]) === nv) return 0; p[k] = typeof p[k] === 'string' ? String(nv) : nv; if (log) log.push(k); return 1; }
  function linePart(l, f, log) {
    const p = f.properties || (f.properties = {}); let n = 0; const g = f.geometry; if (!g) return 0;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null; if (!parts) return 0;
    const a = parts[0][0], b = parts[parts.length - 1][parts[parts.length - 1].length - 1];
    n += setV(p, RE.sx, a[0], log) + setV(p, RE.sy, a[1], log) + setV(p, RE.ex, b[0], log) + setV(p, RE.ey, b[1], log);
    const L = lenOf(f); if (L != null) n += setV(p, RE.len, L, log);
    const e = ends(f);
    if (e) { // levels from the structures at both ends
      [[e[0], RE.sg, RE.si, 's'], [e[1], RE.eg, RE.ei, 'e']].forEach(([c, rg, ri, side]) => {
        const pt = pointAt(c, 0.5); if (!pt) return; const pp = pt.f.properties || {};
        if (/^(METR|HYDT|POLE|PANL)/.test(pt.l.netEl || '')) return;
        const gl = num(pp[keyOf(pp, RE.pg)]), il = num(pp[keyOf(pp, RE.pi)]);
        if (gl != null) n += setV(p, rg, gl, log); const ik = keyOf(p, ri);
        // manhole invert = its OUTLET (flow). Pipe start (leaving the manhole) always follows it; pipe end (arriving) = outlet + drop
        // when the manhole records a drop, otherwise it is only filled when blank (Ahmed's convention)
        if (il != null && ik) { if (side === 's') n += setV(p, ri, il, log); else { const dk = keyOf(pp, RE.drop); const dr = dk ? num(pp[dk]) : null; if (dr != null && dr > 0) n += setV(p, ri, il + dr, log); else if (num(p[ik]) == null) n += setV(p, ri, il, log); } }
      });
    }
    const sg = num(p[keyOf(p, RE.sg)]), si = num(p[keyOf(p, RE.si)]), eg = num(p[keyOf(p, RE.eg)]), ei = num(p[keyOf(p, RE.ei)]);
    if (sg != null && si != null && sg > si) n += setV(p, RE.sd, sg - si, log);
    if (eg != null && ei != null && eg > ei) n += setV(p, RE.ed, eg - ei, log);
    if (si != null && ei != null && L) n += setV(p, RE.slope, (si - ei) / L * 100, log);
    return n;
  }
  function pointPart(l, f, log) {
    const p = f.properties || (f.properties = {}); let n = 0; const g = f.geometry; if (!g || g.type !== 'Point') return 0;
    n += setV(p, RE.x, g.coordinates[0], log) + setV(p, RE.y, g.coordinates[1], log);
    const gl = num(p[keyOf(p, RE.pg)]), il = num(p[keyOf(p, RE.pi)]);
    if (gl != null && il != null && gl > il) n += setV(p, RE.pd, gl - il, log);
    return n;
  }
  // a changed feature + the lines touching it (a moved/edited manhole updates the pipes on it)
  function recalc(l, f, opts) {
    opts = opts || {}; const log = []; let n = 0; const touched = new Set();
    if (l.kind === 'point' || (f.geometry && f.geometry.type === 'Point')) {
      n += pointPart(l, f, log);
      const c = f.wgs && f.wgs.geometry && f.wgs.geometry.coordinates;
      if (c) layers().forEach(({ s, l: L2 }) => { if (L2.kind !== 'line' || !editable(s)) return; L2.features.forEach(lf => { const e = ends(lf); if (e && (dM(e[0], c) <= 0.5 || dM(e[1], c) <= 0.5)) { n += linePart(L2, lf, log); touched.add(L2); } }); });
    } else n += linePart(l, f, log);
    if (n && !opts.quiet) GV.toast('اتحدّث تلقائي: ' + [...new Set(log)].slice(0, 6).join('، ') + (new Set(log).size > 6 ? '…' : ''), 2500);
    return { n, touched: [...touched] };
  }
  // whole layers on demand
  function recalcLayers(ls) { let n = 0; ls.forEach(l => l.features.forEach(f => { const log = []; n += (l.kind === 'point' ? pointPart(l, f, log) : l.kind === 'line' ? linePart(l, f, log) : 0); })); return n; }
  // flip a gravity line so it is drawn in the flow direction: geometry reversed, start/end fields swapped
  const PAIRS = [['sg', 'eg'], ['si', 'ei'], ['sx', 'ex'], ['sy', 'ey'], ['sd', 'ed']];
  const MHP = [/^(us_?mh(_?id|_?no)?|from_?mh|start_?mh|upstream_?mh)$/i, /^(ds_?mh(_?id|_?no)?|to_?mh|end_?mh|downstream_?mh)$/i];
  function flipOne(f) { const rev = g => g.type === 'LineString' ? { type: g.type, coordinates: g.coordinates.slice().reverse() } : g.type === 'MultiLineString' ? { type: g.type, coordinates: g.coordinates.slice().reverse().map(c => c.slice().reverse()) } : g;
    f.geometry = rev(f.geometry); if (f.wgs) f.wgs = { type: 'Feature', properties: {}, geometry: rev(f.wgs.geometry) };
    const p = f.properties || {}; PAIRS.concat([[0, 1]]).forEach(([a, b]) => { const ka = a === 0 ? keyOf(p, MHP[0]) : keyOf(p, RE[a]), kb = b === 1 ? keyOf(p, MHP[1]) : keyOf(p, RE[b]); if (ka && kb) { const t = p[ka]; p[ka] = p[kb]; p[kb] = t; } });
    const si = num(p[keyOf(p, RE.si)]), ei = num(p[keyOf(p, RE.ei)]), L = lenOf(f); if (si != null && ei != null && L) setV(p, RE.slope, (si - ei) / L * 100); }
  // every gravity line whose own levels say it is drawn uphill (start IL below end IL) is flipped; undo kept
  GV.flipByLevels = ls => { const undo = []; let n = 0; (ls || layers().map(x => x.l)).forEach(l => { if (l.kind !== 'line') return; l.features.forEach(f => { const p = f.properties || {}; const si = num(p[keyOf(p, RE.si)]), ei = num(p[keyOf(p, RE.ei)]); if (si == null || ei == null || si >= ei) return; undo.push({ l, f, g: JSON.parse(JSON.stringify(f.geometry)), w: f.wgs ? JSON.parse(JSON.stringify(f.wgs)) : null, p: Object.assign({}, p) }); flipOne(f); n++; }); if (n && GV.rebuild) GV.rebuild(l); });
    GV.flipUndo = undo; if (n && GV.onDirty) GV.onDirty(); return n; };
  GV.flipUndoFn = () => { (GV.flipUndo || []).forEach(u => { u.f.geometry = u.g; u.f.wgs = u.w; u.f.properties = u.p; }); const n = (GV.flipUndo || []).length; GV.flipUndo = null; GV.sources.forEach(s => s.layers.forEach(l => GV.rebuild && l.leaf && GV.rebuild(l))); return n; };
  GV.flipLine = flipOne;
  GV.recalcDerived = recalc; GV.recalcLayers = recalcLayers; GV.deriveRE = RE;
})();
