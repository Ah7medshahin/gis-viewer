// Re-emit our simple R12 DXF as a modern AutoCAD 2007 DXF (handles, owners, BLOCK_RECORDs, units, extents)
// so AutoCAD / Civil 3D open it without "Invalid or incomplete DXF input".
(function () {
  'use strict';
  function convert(txt, extra) {
    const D = window.DxfLib; if (!D) return txt;
    const psp0 = () => (d.document && d.document.blocks && d.document.blocks.paperSpace) || d.modelSpace;
    const L = txt.split(/\r?\n/); const P = []; for (let i = 0; i + 1 < L.length; i += 2) P.push([+L[i].trim(), L[i + 1]]);
    const d = new D.DxfWriter(); d.setUnits(D.Units.Meters);
    const num = v => +v; const vec = (o, a) => D.point3d(num(o[10 + a] || 0), num(o[20 + a] || 0), num(o[30 + a] || 0));
    let i = 0; const next = () => P[i++];
    // read one entity's group codes until next 0
    const readEnt = () => { const o = {}; const multi = {}; while (i < P.length && P[i][0] !== 0) { const [c, v] = P[i++]; if (o[c] !== undefined) (multi[c] = multi[c] || [o[c]]).push(v); o[c] = v; } o._m = multi; return o; };
    const opt = o => { const x = {}; if (o[8] != null) x.layerName = o[8]; if (o[62] != null && +o[62] > 0) x.colorNumber = +o[62]; return x; };
    class AttribF extends D.Attrib { dxfyChild(dx) { dx.point3d(this.position); dx.push(40, this.height); dx.primaryText(this.value); dx.push(50, this.rotation); dx.textStyle(this.textStyle); dx.push(72, this.horizontalAlignment); dx.point3d(this.secondAlignmentPoint, 1); dx.push(73, this.verticalAlignment); dx.subclassMarker('AcDbAttribute'); dx.push(280, 0); dx.push(2, this.tag); dx.push(70, this.flags || 0); } }
    const invisAttrib = (a, flags) => { a.flags = flags; return a; };
    const addEnt = (tgt, type, o, verts) => {
      const op = opt(o);
      if (type === 'POINT') tgt.addPoint(num(o[10]), num(o[20]), num(o[30] || 0), op);
      else if (type === 'CIRCLE') tgt.addCircle(vec(o, 0), num(o[40]), op);
      else if (type === 'LINE') tgt.addLine(vec(o, 0), vec(o, 1), op);
      else if (type === 'POLYLINE') { const fl = +(o[70] || 0); if (fl & 8) tgt.addPolyline3D(verts.map(v => ({ point: D.point3d(v[0], v[1], v[2]) })), Object.assign(op, { flags: (fl & 1) ? 1 : 0 })); else tgt.addLWPolyline(verts.map(v => Object.assign({ point: { x: v[0], y: v[1] } }, v[3] != null ? { startingWidth: v[3], endWidth: v[4] || 0 } : {})), Object.assign(op, { flags: (fl & 1) ? D.LWPolylineFlags.Closed : D.LWPolylineFlags.None })); }
      else if (type === 'TEXT') { const t = { rotation: o[50] != null ? num(o[50]) : undefined }; if (o[72] != null) { t.horizontalAlignment = +o[72]; t.secondAlignmentPoint = vec(o, 1); } if (o[73] != null) t.verticalAlignment = +o[73]; const tx = tgt.addText(vec(o, 0), num(o[40] || 1), o[1] || '', Object.assign(op, t)); if (o[7] && tx) { if (!d.__sty) { d.__sty = 1; const st = (d.addStyle ? d : d.tables).addStyle('GV_ANNO'); st.fontFileName = 'arialn.ttf'; st.widthFactor = 0.9; } tx.textStyle = o[7]; } }
      else if (type === 'ATTDEF') { const a = tgt.addAttdef(vec(o, 0), num(o[40] || 1), o[2] || 'TAG', o[1] || '', op); if (o[3]) a.prompt = o[3]; }
    };
    let ents = 0; const EXT = {}; const LT = {};
    let patched = false; const patchLayer = ly => { if (patched) return; patched = true; const proto = Object.getPrototypeOf(ly); const base = Object.getPrototypeOf(proto).dxfy; proto.dxfy = function (dx) { base.call(this, dx); dx.subclassMarker('AcDbLayerTableRecord'); dx.name(this.name); dx.push(70, this.flags); dx.colorNumber(this.colorNumber); dx.push(420, this.trueColor); dx.lineType(this.lineType); dx.push(370, this.lw == null ? -3 : this.lw); dx.push(390, 0); dx.push(347, this.materialObject); }; };
    while (i < P.length) {
      const [c, v] = next(); if (c !== 0 || v !== 'SECTION') continue;
      const [, sec] = next();
      if (sec === 'TABLES') { while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) { const [c2, v2] = next(); if (c2 === 0 && v2 === 'LAYER') { const o = readEnt(); if (o[2] && o[2] !== '0' && !d.layer(o[2])) { const meta = String(o[999] || ''); const lt = (meta.match(/lt=(\S+)/) || [])[1] || 'CONTINUOUS'; const lw = +((meta.match(/lw=(-?\d+)/) || [])[1] || -3); if (lt === 'HIDDEN' && !LT.HIDDEN) { d.addLType('HIDDEN', '__ __ __ __', [2.0, -1.0]); LT.HIDDEN = 1; } if (lt === 'DASHED' && !LT.DASHED) { d.addLType('DASHED', '___ ___ ___', [4.0, -2.0]); LT.DASHED = 1; } const ly = d.addLayer(o[2], Math.abs(+(o[62] || 7)) || 7, lt); ly.lw = lw; patchLayer(ly); } } } }
      else if (sec === 'BLOCKS') {
        let blk = null;
        while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) {
          const [c2, v2] = next(); if (c2 !== 0) continue;
          if (v2 === 'BLOCK') { const o = readEnt(); blk = d.addBlock(o[2]); continue; }
          if (v2 === 'ENDBLK') { readEnt(); blk = null; continue; }
          if (!blk) { readEnt(); continue; }
          if (v2 === 'POLYLINE') { const o = readEnt(); const vs = []; while (i < P.length && P[i][1] === 'VERTEX') { next(); const vo = readEnt(); vs.push(vo[40] != null ? [num(vo[10]), num(vo[20]), num(vo[30] || 0), num(vo[40]), num(vo[41] || 0)] : [num(vo[10]), num(vo[20]), num(vo[30] || 0)]); } if (P[i] && P[i][1] === 'SEQEND') { next(); readEnt(); } addEnt(blk, 'POLYLINE', o, vs); continue; }
          addEnt(blk, v2, readEnt());
        }
      } else if (sec === 'ENTITIES') {
        const msp0 = d.modelSpace; const psp = (d.document && d.document.blocks && d.document.blocks.paperSpace) || msp0; const PS = (tg, n0) => { if (tg !== msp0) tg.entities.slice(n0).forEach(e => { e.inPaperSpace = true; }); };
        while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) {
          const [c2, v2] = next(); if (c2 !== 0) continue;
          if (v2 === 'POLYLINE') { const o = readEnt(); const msp = o[67] == 1 ? psp : msp0; const n0 = msp.entities.length; const vs = []; while (i < P.length && P[i][1] === 'VERTEX') { next(); const vo = readEnt(); vs.push(vo[40] != null ? [num(vo[10]), num(vo[20]), num(vo[30] || 0), num(vo[40]), num(vo[41] || 0)] : [num(vo[10]), num(vo[20]), num(vo[30] || 0)]); } if (P[i] && P[i][1] === 'SEQEND') { next(); readEnt(); } if (vs.length > 1) { addEnt(msp, 'POLYLINE', o, vs); ents++; } continue; }
          if (v2 === 'INSERT') {
            const o = readEnt(); const msp = o[67] == 1 ? psp : msp0; const n0 = msp.entities.length; const op = opt(o); op.scaleFactor = { x: num(o[41] || 1), y: num(o[42] || 1), z: num(o[43] || 1) }; if (o[50] != null) op.rotationAngle = num(o[50]);
            const ins = msp.addInsert(o[2], vec(o, 0), op); ents++;
            const atts = []; while (i < P.length && P[i][1] === 'ATTRIB') { next(); atts.push(readEnt()); }
            if (P[i] && P[i][1] === 'SEQEND') { next(); readEnt(); }
            if (atts.length) { ins.attributesFollowFlag = 1; atts.forEach(a => { const e = invisAttrib(new AttribF(vec(a, 0), num(a[40] || 1), a[2] || 'TAG', a[1] || '', opt(a)), +(a[70] || 0)); msp.addEntity(e); e.ownerBlockRecord = ins.handle; }); const se = msp.addEntity(new D.SeqEnd()); se.ownerBlockRecord = ins.handle; se.layerName = o[8]; }
            PS(msp, n0); continue;
          }
          { const o = readEnt(); const msp = o[67] == 1 ? psp : msp0; const n0 = msp.entities.length; addEnt(msp, v2, o); PS(msp, n0); ents++; }
        }
      } else if (sec === 'HEADER') {
        while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) { const [c2, v2] = next(); if (c2 === 9 && /^\$(EXTMIN|EXTMAX|LIMMIN|LIMMAX)$/.test(v2)) { const o = {}; while (i < P.length && P[i][0] !== 9 && P[i][0] !== 0) { const [cc, vv] = next(); o[cc] = num(vv); } d.setVariable(v2, o); if (v2 === '$EXTMIN') EXT.min = o; if (v2 === '$EXTMAX') EXT.max = o; } }
      }
    }
    if (EXT.min && EXT.max) { const cx = (EXT.min[10] + EXT.max[10]) / 2, cy = (EXT.min[20] + EXT.max[20]) / 2, hh = Math.max(EXT.max[20] - EXT.min[20], (EXT.max[10] - EXT.min[10]) * 0.6, 10) * 1.1; const ms = d.document.modelSpace; ms.centerView = () => ({ x: cx, y: cy }); ms.viewHeight = () => hh; }
    try { if (extra && extra.vp) addViewport(d, D, extra.vp); } catch (e) { console.error('vp', e); }
    try { (extra && extra.images || []).forEach((im, j) => { const tg = im.paper ? psp0() : d.modelSpace; const n0 = tg.entities.length; tg.addImage(im.path, 'LOGO_' + (im.key || j), D.point3d(im.x, im.y, 0), im.px, im.py, im.w, 0, { layerName: im.layer }); if (im.paper) tg.entities.slice(n0).forEach(e => { e.inPaperSpace = true; }); }); } catch (e) { console.error('images', e); }
    try { if (extra && extra.layouts && extra.layouts.length) addLayouts(d, D, extra.layouts, EXT); } catch (e) { console.error('layouts', e); }
    try { d.setVariable('$LTSCALE', { 40: 1 }); d.setVariable('$LWDISPLAY', { 290: 1 }); } catch (e) { }
    return d.stringify();
  }

  // one model viewport on the default Layout1 (plus the overall paper viewport, ID 1) — no extra LAYOUT objects
  function addViewport(d, D, v) {
    const Ent = Object.getPrototypeOf(D.SeqEnd); const ps = d.document.blocks.paperSpace;
    class VPE extends Ent {
      constructor(o) { super('VIEWPORT', 'AcDbViewport', { layerName: o.ly || '0' }); this.o = o; }
      dxfyChild(dx) { const o = this.o; dx.push(10, o.c[0]); dx.push(20, o.c[1]); dx.push(30, 0); dx.push(40, o.w); dx.push(41, o.h); dx.push(68, o.id); dx.push(69, o.id); dx.push(12, o.vc[0]); dx.push(22, o.vc[1]); dx.push(13, 0); dx.push(23, 0); dx.push(14, 10); dx.push(24, 10); dx.push(15, 10); dx.push(25, 10); dx.push(16, 0); dx.push(26, 0); dx.push(36, 1); dx.push(17, 0); dx.push(27, 0); dx.push(37, 0); dx.push(42, 50); dx.push(43, 0); dx.push(44, 0); dx.push(45, o.vh); dx.push(50, 0); dx.push(51, 0); dx.push(72, 100); dx.push(90, o.id === 1 ? 557088 : 0); dx.push(1, ''); dx.push(281, 0); dx.push(71, 0); dx.push(74, 0); dx.push(110, 0); dx.push(120, 0); dx.push(130, 0); dx.push(111, 1); dx.push(121, 0); dx.push(131, 0); dx.push(112, 0); dx.push(122, 1); dx.push(132, 0); dx.push(79, 0); dx.push(146, 0); dx.push(282, 0); }
    }
    if (!d.layer('VIEWPORTS')) d.addLayer('VIEWPORTS', 7);
    const e1 = new VPE({ ly: 'VIEWPORTS', c: [420.5, 297], w: 925.1, h: 653.4, vc: [420.5, 297], vh: 653.4, id: 1 }); ps.addEntity(e1); e1.inPaperSpace = true; ps.entities.unshift(ps.entities.pop());
    const e2 = new VPE({ ly: v.ly || 'VIEWPORTS', c: v.c, w: v.w, h: v.h, vc: v.vc, vh: v.vh, id: 2 }); e2.inPaperSpace = true; ps.addEntity(e2);
  }
  // paper-space layouts: LAYOUT objects (ACAD_LAYOUT dictionary), BLOCK_RECORD links, overall + model viewports, sheet content in mm
  function addLayouts(d, D, layouts, EXT) {
    const doc = d.document; const objs = doc.objects; const Ent = Object.getPrototypeOf(D.SeqEnd);
    const recs = []; const walk = (o, depth) => { if (!o || depth > 4 || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(x => walk(x, depth + 1)); if (o.type === 'BLOCK_RECORD' && o.name) { recs.push(o); return; } Object.keys(o).forEach(k => { const v = o[k]; if (v && typeof v === 'object') walk(v, depth + 1); }); };
    walk(doc.tables, 0); const rec = n => recs.find(r => r.name === n);
    class Layout extends D.DxfObject {
      constructor(name, tab, brHandle, paper, ext) { super('LAYOUT'); this.name = name; this.tab = tab; this.br = brHandle; this.paper = paper; this.ext = ext; }
      dxfy(dx) { super.dxfy(dx); const pw = this.paper[0], ph = this.paper[1];
        dx.subclassMarker('AcDbPlotSettings'); dx.push(1, ''); dx.push(2, 'none_device'); dx.push(4, this.tab ? 'ISO_full_bleed_A1_(841.00_x_594.00_MM)' : ''); dx.push(6, ''); dx.push(40, 0); dx.push(41, 0); dx.push(42, 0); dx.push(43, 0); dx.push(44, pw); dx.push(45, ph); dx.push(46, 0); dx.push(47, 0); dx.push(48, 0); dx.push(49, 0); dx.push(140, 0); dx.push(141, 0); dx.push(142, 1); dx.push(143, 1); dx.push(70, this.tab ? 688 : 1712); dx.push(72, 1); dx.push(73, 0); dx.push(74, this.tab ? 5 : 1); dx.push(7, ''); dx.push(75, 16); dx.push(76, 0); dx.push(77, 2); dx.push(78, 300); dx.push(147, 1); dx.push(148, 0); dx.push(149, 0);
        dx.subclassMarker('AcDbLayout'); dx.push(1, this.name); dx.push(70, 1); dx.push(71, this.tab); dx.push(10, 0); dx.push(20, 0); dx.push(11, pw); dx.push(21, ph); dx.push(12, 0); dx.push(22, 0); dx.push(32, 0); dx.push(14, this.ext[0]); dx.push(24, this.ext[1]); dx.push(34, 0); dx.push(15, this.ext[2]); dx.push(25, this.ext[3]); dx.push(35, 0); dx.push(146, 0); dx.push(13, 0); dx.push(23, 0); dx.push(33, 0); dx.push(16, 1); dx.push(26, 0); dx.push(36, 0); dx.push(17, 0); dx.push(27, 1); dx.push(37, 0); dx.push(76, 0); dx.push(330, this.br); }
    }
    class Viewport extends Ent {
      constructor(o) { super('VIEWPORT', 'AcDbViewport', { layerName: o.ly || '0' }); this.o = o; }
      dxfyChild(dx) { const o = this.o; dx.push(10, o.c[0]); dx.push(20, o.c[1]); dx.push(30, 0); dx.push(40, o.w); dx.push(41, o.h); dx.push(68, o.status); dx.push(69, o.id); dx.push(12, o.vc[0]); dx.push(22, o.vc[1]); dx.push(13, 0); dx.push(23, 0); dx.push(14, 10); dx.push(24, 10); dx.push(15, 10); dx.push(25, 10); dx.push(16, 0); dx.push(26, 0); dx.push(36, 1); dx.push(17, 0); dx.push(27, 0); dx.push(37, 0); dx.push(42, 50); dx.push(43, 0); dx.push(44, 0); dx.push(45, o.vh); dx.push(50, 0); dx.push(51, 0); dx.push(72, 1000); dx.push(90, o.id === 1 ? 557088 : 819232); dx.push(1, ''); dx.push(281, 0); dx.push(71, 1); dx.push(74, 0); dx.push(110, 0); dx.push(120, 0); dx.push(130, 0); dx.push(111, 1); dx.push(121, 0); dx.push(131, 0); dx.push(112, 0); dx.push(122, 1); dx.push(132, 0); dx.push(79, 0); dx.push(146, 0); dx.push(170, 0); }
    }
    const ld = objs.addDictionary(); objs.root.addEntryObject('ACAD_LAYOUT', ld.handle);
    const ext = EXT.min && EXT.max ? [EXT.min[10], EXT.min[20], EXT.max[10], EXT.max[20]] : [0, 0, 100, 100];
    const ms = rec('*Model_Space'); const lm = objs.addObject(new Layout('Model', 0, ms ? ms.handle : '0', [420, 297], ext)); lm.ownerObjecthandle = ld.handle; ld.addEntryObject('Model', lm.handle); if (ms) ms.layoutObject = lm.handle;
    layouts.forEach((L, i) => {
      const blk = i === 0 ? doc.blocks.paperSpace : doc.blocks.addPaperSpace(); const br = rec(blk.name);
      const lo = objs.addObject(new Layout(L.name, i + 1, br ? br.handle : '0', L.paper, [0, 0, L.paper[0], L.paper[1]])); lo.ownerObjecthandle = ld.handle; ld.addEntryObject(L.name, lo.handle); if (br) br.layoutObject = lo.handle;
      const ps = i === 0; const add = e => { if (ps) e.inPaperSpace = true; return e; };
      add(blk.addEntity(new Viewport({ c: [L.paper[0] / 2, L.paper[1] / 2], w: L.paper[0], h: L.paper[1], vc: [L.paper[0] / 2, L.paper[1] / 2], vh: L.paper[1], status: 1, id: 1 })));
      L.page.forEach(p => { const op = { layerName: p.ly };
        if (p.t === 'line') add(blk.addLine(D.point3d(p.a[0], p.a[1], 0), D.point3d(p.b[0], p.b[1], 0), op));
        else if (p.t === 'poly') add(blk.addLWPolyline(p.pts.map(q => ({ point: { x: q[0], y: q[1] } })), Object.assign(op, { flags: p.closed ? D.LWPolylineFlags.Closed : D.LWPolylineFlags.None })));
        else if (p.t === 'text') { const t = { }; if (p.al) { t.horizontalAlignment = p.al; t.secondAlignmentPoint = D.point3d(p.p[0], p.p[1], 0); } add(blk.addText(D.point3d(p.p[0], p.p[1], 0), p.h, p.s, Object.assign(op, t))); }
        else if (p.t === 'insert') add(blk.addInsert(p.name, D.point3d(p.p[0], p.p[1], 0), Object.assign(op, { scaleFactor: { x: p.sc, y: p.sc, z: 1 } })));
        else if (p.t === 'circle') add(blk.addCircle(D.point3d(p.p[0], p.p[1], 0), p.r, op));
        else if (p.t === 'solid') { try { add(blk.addSolid ? blk.addSolid(...p.pts.map(q => D.point3d(q[0], q[1], 0)), op) : null); } catch (e) { } }
      });
      add(blk.addEntity(new Viewport({ ly: 'G-ANNO-VPRT', c: L.vp.c, w: L.vp.w, h: L.vp.h, vc: L.vp.vc, vh: L.vp.vh, status: 2, id: 2 })));
    });
    const cc = doc.classes; const orig = cc.collect.bind(cc); cc.collect = types => { orig(types); cc.classes.push({ dxfy: dx => { dx.type('CLASS'); dx.push(1, 'LAYOUT'); dx.push(2, 'AcDbLayout'); dx.push(3, 'ObjectDBX Classes'); dx.push(90, 0); dx.push(91, layouts.length + 1); dx.push(280, 0); dx.push(281, 0); } }); };
  }
  window.DxfModern = convert;
})();
