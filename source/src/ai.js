// "Claude يراجع": Claude inspects the opened data itself through page tools (like a GIS engineer would)
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  let sampleFn = null, msgs = [], busy = null, notes = [], noteLayer = null, pend = [];
  const MAXJ = 7000;
  const J = o => { let s = JSON.stringify(o); if (s.length > MAXJ) s = s.slice(0, MAXJ) + '…(اتقص، اطلب أقل)'; return s; };
  async function getSample() {
    if (sampleFn) return sampleFn;
    try { if (!window.claude || !window.claude.use) return null; sampleFn = await window.claude.use('sample'); } catch (e) { sampleFn = null; }
    return sampleFn;
  }

  /* ---------- data access ---------- */
  const allLayers = () => GV.sources.filter(s => s.id !== 'qc').flatMap(s => s.layers.map(l => ({ l, s })));
  const byId = id => { const x = allLayers().find(({ l }) => String(l.id) === String(id) || l.name === id); if (!x) throw new Error('مفيش لير بالرقم/الاسم ده: ' + id); return x; };
  const isText = f => f.properties && f.properties.Text != null;
  const r3 = v => Math.round(v * 1000) / 1000;
  function bboxOf(l, wgs) { let b = null; l.features.forEach(f => { const g = wgs ? f.wgs && f.wgs.geometry : f.geometry; if (!g) return; walk(g.coordinates, c => { if (!b) b = [c[0], c[1], c[0], c[1]]; else { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } }); }); return b && b.map(r3); }
  function walk(c, fn) { if (typeof c[0] === 'number') fn(c); else c.forEach(x => walk(x, fn)); }
  const lenM = f => { const g = f.wgs && f.wgs.geometry; return g && g.type.indexOf('LineString') >= 0 ? GV.lineLen(g) : 0; };
  function nVert(g) { let n = 0; walk(g.coordinates, () => n++); return n; }
  function geomSum(f) { const g = f.geometry; if (!g) return null; const o = { type: g.type, vertices: nVert(g) }; const c = GV.firstCoord(g); if (c) o.first = c.slice(0, 3).map(r3); if (g.type.indexOf('LineString') >= 0) o.length_m = Math.round(lenM(f) * 100) / 100; return o; }
  const propsOf = (f, max) => { const o = {}; Object.keys(f.properties || {}).slice(0, max || 20).forEach(k => { let v = f.properties[k]; if (typeof v === 'string' && v.length > 80) v = v.slice(0, 80) + '…'; o[k] = v; }); return o; };
  // local metres around a lon/lat
  function frame(lat) { const ky = 110540, kx = 111320 * Math.cos(lat * Math.PI / 180); return { kx, ky }; }
  const wfirst = f => f.wgs && f.wgs.geometry ? GV.firstCoord(f.wgs.geometry) : null;

  const TOOLS = [
    { name: 'overview', description: 'كل المصادر واللايرات المفتوحة: id، الاسم، العدد، نوع الهندسة، نظام الإحداثيات، الحقول، ظاهرة ولا لأ، وهل هي كاد. ابدأ بيها دايمًا.', inputSchema: { type: 'object', properties: {} },
      execute: () => J(GV.sources.filter(s => s.id !== 'qc').map(s => ({ source: s.name, type: s.type, isCad: !!s.isCad, role: s.isCopy ? 'نسخة شغل (اتعدلت)' : GV.superseded(s) ? 'الأصل (متعدلش — بص على النسخة)' : undefined, organized: s.orgOut || undefined, layers: s.layers.map(l => ({ id: l.id, name: l.name, n: l.features.length, kind: l.kind, crs: l.crsDef ? String(l.crsDef).slice(0, 40) : null, visible: l.visible, fields: GV.fieldsOf(l).slice(0, 25) })) }))) },
    { name: 'layer_profile', description: 'بروفايل كامل للير: لكل حقل (نوعه، % الفاضي، عدد القيم المختلفة، أكتر القيم تكرارًا، أقل/أكبر رقم)، وإحصائيات الهندسة (أطوال بالمتر، رؤوس، Z، خطوط مقفولة، الحدود). للكاد: البلوكات، عينات النصوص، أنواع الكيانات، الألوان.', inputSchema: { type: 'object', properties: { layer: { type: ['string', 'number'], description: 'id أو اسم اللير' } }, required: ['layer'] },
      execute: ({ layer }) => {
        const { l, s } = byId(layer); const F = l.features.filter(f => !f._sym); const out = { id: l.id, name: l.name, source: s.name, n: F.length, kind: l.kind };
        const gt = {}; let len = 0, z = 0, closed = 0, vtx = 0, nullG = 0, multi = 0; const ents = {}, cols = {}, blocks = {}; const texts = new Map();
        F.forEach(f => { const g = f.geometry; if (!g) { nullG++; return; } gt[g.type] = (gt[g.type] || 0) + 1; if (/^Multi/.test(g.type)) multi++; const c = GV.firstCoord(g); if (c && c.length > 2 && c[2]) z++; vtx += nVert(g); len += lenM(f); if (g.type === 'LineString') { const a = g.coordinates[0], b = g.coordinates[g.coordinates.length - 1]; if (g.coordinates.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) closed++; }
          const p = f.properties || {}; if (p.Entity) ents[p.Entity] = (ents[p.Entity] || 0) + 1; if (p.Color != null) cols[p.Color] = (cols[p.Color] || 0) + 1; if (p.Block) blocks[p.Block] = (blocks[p.Block] || 0) + 1; if (isText(f)) { const t = String(p.Text).trim(); texts.set(t, (texts.get(t) || 0) + 1); } });
        out.geometry = { types: gt, null_geometry: nullG, multipart: multi, with_z: z, avg_vertices: F.length ? Math.round(vtx / F.length * 10) / 10 : 0, total_length_m: Math.round(len * 10) / 10, closed_polylines: closed, bbox_native: bboxOf(l) };
        const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 15);
        if (s.isCad) { out.cad = { entities: top(ents), colors: top(cols), blocks: top(blocks), text_count: Array.from(texts.values()).reduce((a, b) => a + b, 0), text_samples: Array.from(texts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30) }; }
        const flds = GV.fieldsOf(l).filter(k => !s.isCad || !/^(Layer|Entity|Color|Text|Height|Rotation|Block)$/.test(k)).slice(0, 40);
        out.fields = flds.map(k => { const vals = F.map(f => f.properties ? f.properties[k] : null); const ne = vals.filter(v => v != null && v !== ''); const nums = ne.map(Number).filter(v => isFinite(v)); const cnt = new Map(); ne.forEach(v => cnt.set(String(v), (cnt.get(String(v)) || 0) + 1));
          const o = { field: k, empty_pct: F.length ? Math.round((1 - ne.length / F.length) * 1000) / 10 : 0, distinct: cnt.size, top: Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8) };
          if (ne.length && nums.length / ne.length > 0.9) { o.numeric = true; o.min = Math.min(...nums); o.max = Math.max(...nums); } return o; });
        if (l.schemaTypes) out.schema_types = l.schemaTypes;
        return J(out);
      } },
    { name: 'features', description: 'عناصر من لير (بالترتيب أو بفلتر): رقمها index، بياناتها، وملخص الهندسة (النوع، الرؤوس، الطول بالمتر، أول إحداثي بنظام الملف). where.op: = أو != أو contains أو > أو < أو empty أو notempty.', inputSchema: { type: 'object', properties: { layer: { type: ['string', 'number'] }, offset: { type: 'number' }, limit: { type: 'number', description: 'أقصى حاجة 30' }, where: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} } } }, required: ['layer'] },
      execute: ({ layer, offset, limit, where }) => {
        const { l } = byId(layer); let idx = l.features.map((f, i) => i).filter(i => !l.features[i]._sym);
        if (where && where.field) { const { field, op, value } = where; idx = idx.filter(i => { const v = (l.features[i].properties || {})[field]; const vs = v == null ? '' : String(v); switch (op) { case '!=': return vs !== String(value); case 'contains': return vs.toLowerCase().indexOf(String(value).toLowerCase()) >= 0; case '>': return +v > +value; case '<': return +v < +value; case 'empty': return vs === ''; case 'notempty': return vs !== ''; default: return vs === String(value); } }); }
        const lim = Math.min(30, limit || 15), off = offset || 0;
        return J({ matched: idx.length, items: idx.slice(off, off + lim).map(i => ({ index: i, props: propsOf(l.features[i], 15), geom: geomSum(l.features[i]) })) });
      } },
    { name: 'distinct_values', description: 'كل القيم المختلفة لحقل في لير وعدد كل قيمة (لحد 120 قيمة).', inputSchema: { type: 'object', properties: { layer: { type: ['string', 'number'] }, field: { type: 'string' } }, required: ['layer', 'field'] },
      execute: ({ layer, field }) => { const { l } = byId(layer); const m = new Map(); l.features.forEach(f => { if (f._sym) return; const v = f.properties ? f.properties[field] : null; const k = v == null || v === '' ? '(فاضي)' : String(v); m.set(k, (m.get(k) || 0) + 1); }); return J({ distinct: m.size, values: Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 120) }); } },
    { name: 'nearby', description: 'كل اللي حوالين عنصر معين في كل اللايرات الظاهرة (نصوص، بلوكات، خطوط) جوه نصف قطر بالمتر. مفيد تعرف الخط ده قطره كام من النص اللي جنبه، أو البلوك ده إيه.', inputSchema: { type: 'object', properties: { layer: { type: ['string', 'number'] }, index: { type: 'number' }, radius_m: { type: 'number' } }, required: ['layer', 'index'] },
      execute: ({ layer, index, radius_m }) => {
        const { l } = byId(layer); const f = l.features[index]; if (!f || !f.wgs) throw new Error('العنصر مش موجود أو ملوش إحداثيات'); const R = Math.min(radius_m || 5, 200);
        const pts = []; walk(f.wgs.geometry.coordinates, c => pts.push(c)); const c0 = pts[0]; const { kx, ky } = frame(c0[1]);
        const dTo = g => { let best = Infinity; const cs = []; walk(g.coordinates, c => cs.push(c)); cs.forEach(c => pts.forEach(p => { const d = Math.hypot((c[0] - p[0]) * kx, (c[1] - p[1]) * ky); if (d < best) best = d; })); return best; };
        const out = []; allLayers().forEach(({ l: L2 }) => { if (!L2.visible) return; L2.features.forEach((g, i) => { if (g === f || g._sym || !g.wgs || !g.wgs.geometry) return; const c = GV.firstCoord(g.wgs.geometry); if (!c || Math.abs(c[0] - c0[0]) * kx > R * 40 || Math.abs(c[1] - c0[1]) * ky > R * 40) return; const d = dTo(g.wgs.geometry); if (d <= R) out.push({ layer: L2.name, layer_id: L2.id, index: i, d_m: Math.round(d * 100) / 100, type: g.geometry.type, text: isText(g) ? String(g.properties.Text).slice(0, 60) : undefined, block: g.properties && g.properties.Block || undefined }); }); });
        out.sort((a, b) => a.d_m - b.d_m); return J({ found: out.length, items: out.slice(0, 40) });
      } },
    { name: 'relate', description: 'علاقة لير نقط (أو لير خطوط) بلير خطوط بمسافة سماح بالمتر. للنقط: كام نقطة على vertex، كام في نص خط من غير vertex، كام قريبة ومش لازقة، كام بعيدة. للخطوط: كام طرف متوصل بطرف/vertex، كام بيلمس نص خط، كام طرف حر. بيرجع أمثلة بالـ index.', inputSchema: { type: 'object', properties: { a: { type: ['string', 'number'], description: 'لير النقط أو الخطوط' }, b: { type: ['string', 'number'], description: 'لير الخطوط (ممكن نفس a)' }, tol_m: { type: 'number' }, near_m: { type: 'number' } }, required: ['a', 'b'] },
      execute: ({ a, b, tol_m, near_m }) => {
        const A = byId(a).l, B = byId(b).l; const tol = tol_m || 0.01, near = near_m || 1;
        const c0 = (B.features.find(f => f.wgs) || {}).wgs; if (!c0) throw new Error('لير الخطوط ملوش إحداثيات'); const o0 = GV.firstCoord(c0.geometry); const { kx, ky } = frame(o0[1]); const M = c => [(c[0] - o0[0]) * kx, (c[1] - o0[1]) * ky];
        const segs = [], verts = [], ends = []; const G = new Map(), cell = Math.max(near * 2, 2);
        const gk = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell); const gp = (k, v) => { if (!G.has(k)) G.set(k, []); G.get(k).push(v); };
        B.features.forEach((f, fi) => { const g = f.wgs && f.wgs.geometry; if (!g || g.type.indexOf('LineString') < 0 || f._sym || isText(f)) return; const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; ls.forEach(cs => { const m = cs.map(M); m.forEach((p, i) => { verts.push({ p, fi, end: i === 0 || i === m.length - 1 }); gp(gk(p[0], p[1]), { t: 'v', i: verts.length - 1 }); if (i) { segs.push({ a: m[i - 1], b: p, fi }); const s = segs.length - 1; const x0 = Math.min(m[i - 1][0], p[0]), x1 = Math.max(m[i - 1][0], p[0]), y0 = Math.min(m[i - 1][1], p[1]), y1 = Math.max(m[i - 1][1], p[1]); for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) gp(x + ',' + y, { t: 's', i: s }); } }); }); });
        const q = (p, r) => { const out = []; for (let x = Math.floor((p[0] - r) / cell); x <= Math.floor((p[0] + r) / cell); x++) for (let y = Math.floor((p[1] - r) / cell); y <= Math.floor((p[1] + r) / cell); y++) (G.get(x + ',' + y) || []).forEach(v => out.push(v)); return out; };
        const segD = (p, s) => { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1]; const L2 = dx * dx + dy * dy; let t = L2 ? ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - s.a[0] - t * dx, p[1] - s.a[1] - t * dy); };
        const classify = (p, selfFi) => { let dv = Infinity, ds = Infinity; q(p, near).forEach(v => { if (v.t === 'v') { const w = verts[v.i]; if (w.fi === selfFi) return; dv = Math.min(dv, Math.hypot(w.p[0] - p[0], w.p[1] - p[1])); } else { const s = segs[v.i]; if (s.fi === selfFi) return; ds = Math.min(ds, segD(p, s)); } }); if (dv <= tol) return 'on_vertex'; if (ds <= tol) return 'on_segment_midspan'; if (Math.min(dv, ds) <= near) return 'near_not_touching'; return 'far'; };
        const res = {}, ex = {}; const put = (k, i) => { res[k] = (res[k] || 0) + 1; (ex[k] = ex[k] || []).length < 8 && ex[k].push(i); };
        A.features.forEach((f, fi) => { const g = f.wgs && f.wgs.geometry; if (!g || f._sym || isText(f)) return; if (g.type === 'Point') put(classify(M(g.coordinates), A === B ? fi : -1), fi); else if (g.type.indexOf('LineString') >= 0) { const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; ls.forEach(cs => { [cs[0], cs[cs.length - 1]].forEach(c => put('endpoint_' + classify(M(c), A === B ? fi : -1), fi)); }); } });
        return J({ a: A.name, b: B.name, tol_m: tol, near_m: near, counts: res, examples_index: ex });
      } },
    { name: 'run_qc', description: 'شغّل الفحص الكامل بتاع البرنامج (إحداثيات، مناسيب، هندسة، طوبولوجي، بيانات، Utility Network) على لايرات محددة أو اللايرات الظاهرة، وارجع الملخص الذكي (مشاكل متجمعة بالسبب + أسئلة). القواعد اللي اليوزر وافق عليها بتتطبق.', inputSchema: { type: 'object', properties: { layers: { type: 'array', items: { type: ['string', 'number'] } }, utility_network: { type: 'boolean' } } },
      execute: async ({ layers, utility_network }) => {
        const pre = layers && layers.length ? layers.map(x => byId(x).l) : null;
        GV.openQC(pre); const un = $('#qc_un'); if (un && utility_network != null) un.checked = !!utility_network;
        await GV.runQC(); GV.closeSheets(); GV.openSheet('#aiSheet');
        const sm = GV.qcSmart(); if (!sm) return 'مفيش نتيجة';
        return J({ problems: sm.problems.slice(0, 40).map(p => ({ sev: p.sev, problem: p.title || p.type, layer: p.layer, places: p.n, systematic: !!p.systematic, hint: p.hint || undefined, first_lonlat: (p.items.find(i => i.ll) || {}).ll })), questions: sm.questions.map(qq => ({ text: typeof qq.text === 'function' ? qq.text(qq.items.length) : qq.text, rule: qq.rule })), rules_active: sm.rules.length });
      } },
    { name: 'mark', description: 'علّم مكان على الخريطة بملاحظة لليوزر (بتظهر في لستة "ملاحظات Claude" وتقدر تروحلها). استخدمها لكل مشكلة مهمة لقيتها. ادّي layer+index أو lon+lat.', inputSchema: { type: 'object', properties: { layer: { type: ['string', 'number'] }, index: { type: 'number' }, lon: { type: 'number' }, lat: { type: 'number' }, note: { type: 'string' }, severity: { type: 'string', enum: ['error', 'warning', 'info'] } }, required: ['note'] },
      execute: ({ layer, index, lon, lat, note, severity }) => { let ll = null, ref = null; if (layer != null && index != null) { const { l } = byId(layer); const f = l.features[index]; const c = f && wfirst(f); if (c) { ll = [c[1], c[0]]; ref = { l, i: index }; } } else if (lon != null && lat != null) ll = [lat, lon]; if (!ll) throw new Error('مكان مش واضح'); notes.push({ ll, note, sev: severity || 'warning', ref }); drawNotes(); return 'تم (' + notes.length + ')'; } },
    { name: 'propose_rule', description: 'اقترح قاعدة فحص لليوزر يوافق عليها (حاجة طبيعية بالتصميم مش خطأ، أو شرط لازم يتحقق). kind واحد من: midspan_ok, close_ok, end_ok, dangle_ok, cross_ok, optional_field, value_ok, length_ok, isolated_ok, required, range, domain. layer اسم اللير أو *، field اسم الحقل أو *، value كلمة أو كلمات مفصولة بـ | (بتتدور في اسم اللير والبيانات)، min/max للمدى، values للـ domain.', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, layer: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' }, values: { type: 'string' }, why: { type: 'string' } }, required: ['kind', 'why'] },
      execute: r => { const why = r.why; delete r.why; pend.push({ t: 'rule', r, why }); drawPend(); return 'اتعرض على اليوزر'; } },
    { name: 'propose_edit', description: 'اقترح تعديل على البيانات (طلب مخصص من اليوزر): حساب حقل، تصحيح قيم، توحيد كتابة، ملء حقل من حقل تاني… layer اسم اللير. where تعبير JavaScript على p (خصائص العنصر) و i (رقمه) بيرجع true للعناصر اللي هتتعدل (أو "true" للكل). set كائن: اسم الحقل ← تعبير JavaScript بيحسب القيمة الجديدة من p (مثال: {"FEATURETYPE": "p.FEATURETYPE.trim().toUpperCase()"}). مفيش تعديل بيحصل غير لما اليوزر يوافق، وتقدر تتراجع.', inputSchema: { type: 'object', properties: { layer: { type: 'string' }, where: { type: 'string' }, set: { type: 'object' }, why: { type: 'string' } }, required: ['layer', 'where', 'set'] },
      execute: ({ layer, where, set, why }) => { const { l } = byId(layer); const wf = new Function('p', 'i', 'return (' + (where || 'true') + ')'); const sf = Object.keys(set).map(k => [k, new Function('p', 'i', 'return (' + set[k] + ')')]); let n = 0; const sample = [];
        l.features.forEach((f, i) => { const p = f.properties || {}; let hit = false; try { hit = !!wf(p, i); } catch (e) { } if (!hit) return; n++; if (sample.length < 5) { const o = {}; sf.forEach(([k, fn]) => { let v; try { v = fn(p, i); } catch (e) { v = '⚠ ' + e.message; } o[k] = String(p[k]) + ' ← ' + String(v); }); sample.push(o); } });
        pend.push({ t: 'edit', layer: l.name, l, where, set, wf, sf, n, why }); drawPend(); return 'اتعرض على اليوزر: هيتعدل ' + n + ' عنصر. أمثلة: ' + J(sample); } },
    { name: 'org_categories', description: 'التصنيفات المتاحة لتنظيم الكاد وتسمية اللايرات (حسب نوع الشبكة المختار)، وتصنيف البرنامج الحالي لكل لير كاد.', inputSchema: { type: 'object', properties: {} },
      execute: () => { const c = GV.orgCategories(); c.current = GV.sources.filter(s => s.isCad && !s.orgOut).flatMap(s => s.layers.filter(l => l.features.length).map(l => { const k = GV.orgClassify(l); return { layer: l.name, now: k.kind + ':' + (k.code || '') }; })); return J(c); } },
    { name: 'propose_category', description: 'اقترح تصنيف لير كاد (لما تصنيف البرنامج غلط أو "unk"). category لازم تكون من org_categories زي net:MAIN أو bg:V-PLOT أو keep: أو drop:.', inputSchema: { type: 'object', properties: { layer: { type: 'string' }, category: { type: 'string' }, why: { type: 'string' } }, required: ['layer', 'category', 'why'] },
      execute: ({ layer, category, why }) => { pend.push({ t: 'cat', layer, category, why }); drawPend(); return 'اتعرض على اليوزر'; } }
  ];

  /* ---------- picture of the data ---------- */
  async function snapshot() {
    const ls = allLayers().filter(({ l }) => l.visible && l.leaf);
    let b = null; ls.forEach(({ l }) => { const bb = l.leaf.getBounds(); if (bb.isValid()) b = b ? b.extend(bb) : L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); });
    if (!b) return null;
    const W = 1100, H = 1100, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const lat0 = b.getCenter().lat, kx = Math.cos(lat0 * Math.PI / 180); const w = (b.getEast() - b.getWest()) * kx || 1e-9, h = (b.getNorth() - b.getSouth()) || 1e-9; const sc = 0.94 * Math.min(W / w, H / h);
    const P = c => [W / 2 + (c[0] - b.getCenter().lng) * kx * sc, H / 2 - (c[1] - lat0) * sc];
    ls.forEach(({ l }) => { x.strokeStyle = x.fillStyle = l.color; x.lineWidth = 1.2; l.features.forEach(f => { const g = f.wgs && f.wgs.geometry; if (!g || isText(f)) return; if (g.type === 'Point') { if (f._sym) return; const p = P(g.coordinates); x.fillRect(p[0] - 2, p[1] - 2, 4, 4); return; } const draw = cs => { x.beginPath(); cs.forEach((c, i) => { const p = P(c); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.stroke(); }; const t = g.type; if (t === 'LineString') draw(g.coordinates); else if (t === 'MultiLineString' || t === 'Polygon') g.coordinates.forEach(draw); else if (t === 'MultiPolygon') g.coordinates.forEach(pp => pp.forEach(draw)); }); });
    x.fillStyle = '#000'; x.font = '14px sans-serif'; let yy = 20; ls.slice(0, 30).forEach(({ l }) => { x.fillStyle = l.color; x.fillRect(10, yy - 10, 12, 12); x.fillStyle = '#000'; x.fillText(l.name + ' (' + l.features.length + ')', 28, yy); yy += 18; });
    return await new Promise(r => cv.toBlob(r, 'image/png'));
  }

  /* ---------- prompt ---------- */
  const SYS = `أنت مهندس GIS وكاد خبير في شبكات البنية التحتية (مياه، صرف، أمطار، كهرباء، إنارة، اتصالات، غاز، ري) في السعودية، وبتجهز داتا للتسليم لشركة المياه الوطنية (NWC) وللتحويل لـ Utility Network.
اليوزر فاتح داتا (كاد DWG/DXF أو GDB أو SHP…) في برنامج GIS، وإنت عندك أدوات بتبص بيها على الداتا نفسها. اشتغل زي المهندس اللي فاتح الملف بنفسه:
- ابدأ بـ overview، وبعدين layer_profile للايرات المهمة، وfeatures/nearby/distinct_values عشان تتأكد بنفسك، وrelate عشان تشوف الاتصال، وrun_qc لو محتاج فحص شامل.
- متخمنش: كل رقم أو حكم تقوله لازم يكون طالع من أداة. لو حاجة مش واضحة اسأل اليوزر سؤال محدد.
- فرّق بين: (1) أخطاء لازم تتصلح، (2) حاجات محتاجة مراجعة بالعين، (3) حاجات طبيعية بالتصميم (زي السادل في نص الماسورة، أو نهايات الوصلات المنزلية) — وللنوع التالت اقترح قاعدة بـ propose_rule.
- فكّر في المعنى الهندسي: أقطار منطقية؟ مواد؟ المحابس على الخطوط؟ الحنفيات متوصلة؟ الأطوال والمناسيب والميول؟ السكيل والوحدات والإحداثيات في المنطقة الصح (UTM 37/38/39N أو Ain el Abd)؟ لايرات مختلطة؟ نصوص القطر جنب الخطوط بتتطابق مع اللير؟
- علّم كل مشكلة مهمة على الخريطة بـ mark (بحد أقصى 25 علامة). لو تصنيف لاير كاد غلط اقترح الصح بـ propose_category.
- الرد النهائي بالعامية المصرية، مختصر ومنظم: ملخص في سطرين، بعدين "لازم يتصلح" و"راجعه بعينك" و"طبيعي/مقصود" و"أسئلة ليك"، بأرقام وأسماء لايرات. استخدم Markdown بسيط (عناوين ### ونقط وجداول صغيرة).`;

  /* ---------- UI ---------- */
  const PRESETS = [
    ['🔍 راجع كل حاجة زي مهندس', 'راجع كل الداتا المفتوحة مراجعة كاملة زي ما كنت هتعمل لو فتحت الملف بنفسك، وقولي الجودة إيه والمطلوب مني.'],
    ['📐 راجع ملف الكاد', 'راجع ملف الكاد: اللايرات والبلوكات والنصوص، السكيل والإحداثيات، كل لير فيه إيه فعلاً ويتصنف إزاي، الأقطار من النصوص، والاتصال بين المواسير والمحابس والتوصيلات. واقترح تصنيف اللايرات الغلط.'],
    ['🗄 جاهزية التسليم لشركة المياه', 'راجع الـ GDB/الطبقات كأنها هتتسلم لشركة المياه وتتحول Utility Network: السكيما والحقول الإجبارية والدومينز والقيم الشاذة والاتصال والمناسيب. شغّل run_qc مع utility_network.'],
    ['🧮 حصر وكميات', 'اعملي حصر كميات دقيق: أطوال المواسير بكل قطر ومادة، وعدد المحابس والحنفيات والتوصيلات وكل نوع، ونبهني على أي حاجة ناقصة بياناتها.']
  ];
  function open() {
    const box = $('#aiBody');
    if (!box.dataset.init) { box.dataset.init = 1; build(); }
    GV.openSheet('#aiSheet');
    refreshAvail();
  }
  async function refreshAvail() { const s = await getSample(); $('#aiNA').style.display = s ? 'none' : ''; $('#aiMain').style.display = s ? '' : 'none'; }
  function build() {
    const box = $('#aiBody');
    const na = el('div', 'cmp'); na.id = 'aiNA'; na.style.display = 'none'; na.append(el('b', null, 'المراجعة بـ Claude شغالة من لينك Claude بس'), el('p', 'small', 'الملف اللي على اللابتوب مش متوصل بـ Claude. افتح اللينك (وانت مسجل دخول) وافتح الداتا هناك.')); box.appendChild(na);
    const main = el('div'); main.id = 'aiMain'; box.appendChild(main);
    main.appendChild(el('p', 'muted small', 'Claude بيفتح الداتا بنفسه: بيقرا اللايرات والبيانات والنصوص والبلوكات، وبيقيس الاتصال، وبيشغّل الفحص، وبيعلّم المشاكل على الخريطة. الإجابة بتاخد دقيقة أو اتنين.'));
    const pr = el('div', 'ai-pre'); PRESETS.forEach(([t, q]) => { const b = el('button', 'chip', t); b.onclick = () => ask(q, true); pr.appendChild(b); }); main.appendChild(pr);
    const log = el('div', 'ai-log'); log.id = 'aiLog'; main.appendChild(log);
    const pend0 = el('div'); pend0.id = 'aiPend'; main.appendChild(pend0);
    const nt = el('div'); nt.id = 'aiNotes'; main.appendChild(nt);
    const row = el('div', 'ai-in'); const ta = el('textarea'); ta.id = 'aiQ'; ta.rows = 2; ta.placeholder = 'اسأل Claude عن الداتا… (مثلاً: ليه المحابس دي مش على الخط؟)'; ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } };
    const send = el('button', 'open-btn sm', 'ابعت'); send.id = 'aiSend'; send.onclick = () => { if (busy) { busy.abort(); return; } const v = ta.value.trim(); if (v) { ta.value = ''; ask(v); } };
    const clr = el('button', 'chip', 'محادثة جديدة'); clr.onclick = () => { if (busy) return; msgs = []; $('#aiLog').textContent = ''; pend = []; drawPend(); };
    row.append(ta, send); main.append(row, clr);
  }
  function bubble(role, text) { const b = el('div', 'ai-msg ' + role); b.dir = 'auto'; if (role === 'claude') b.innerHTML = md(text); else b.textContent = text; $('#aiLog').appendChild(b); b.scrollIntoView({ block: 'end' }); return b; }
  async function ask(q, fresh) {
    if (busy) return; const sample = await getSample(); if (!sample) return refreshAvail();
    if (fresh && msgs.length) { msgs = []; $('#aiLog').textContent = ''; }
    if (!allLayers().some(({ l }) => l.features.length)) return GV.showMsg('افتح الداتا الأول.');
    bubble('user', q);
    const first = !msgs.length;
    msgs.push({ role: 'user', content: (first ? SYS + '\n\n---\nطلب اليوزر: ' : '') + q });
    const out = bubble('claude', '…'); const act = el('div', 'ai-act'); out.before(act);
    let images; if (first) { try { const lim = sample.limits ? await sample.limits() : null; if (lim && lim.images) { const img = await snapshot(); if (img) { images = [img]; msgs[msgs.length - 1].content += '\n\n(مرفق صورة للرسمة كلها باللايرات الظاهرة وأسمائها.)'; } } } catch (e) { } }
    busy = new AbortController(); $('#aiSend').textContent = 'وقّف';
    const tools = TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: async inp => { const ln = el('div', null, '🔎 ' + label(t.name, inp || {})); act.appendChild(ln); try { return await t.execute(inp || {}); } catch (e) { ln.textContent += ' ✗'; throw e; } } }));
    try {
      const r = await sample(msgs, { tools, images, modelTier: 'complex', signal: busy.signal, cache: false, onText: ({ text }) => { out.innerHTML = md(text || '…'); } });
      out.innerHTML = md(r.text || ''); msgs.push({ role: 'assistant', content: r.text || '' });
      if (r.truncated) out.appendChild(el('p', 'muted small', '(الرد اتقص — قول "كمّل")'));
    } catch (e) {
      msgs.pop();
      const m = e && e.code === 'not_granted' ? 'لازم توافق على إن الصفحة تسأل Claude.' : e && e.code === 'rate_limited' ? 'وصلت للحد المسموح دلوقتي، جرّب بعد شوية.' : e && e.name === 'AbortError' ? 'اتوقف.' : 'حصلت مشكلة: ' + ((e && e.message) || e);
      out.innerHTML = md((e && e.text ? e.text + '\n\n' : '') + '_' + m + '_');
    } finally { busy = null; $('#aiSend').textContent = 'ابعت'; act.classList.add('done'); }
  }
  function label(n, i) { const L = i.layer != null ? (() => { try { return byId(i.layer).l.name; } catch (e) { return i.layer; } })() : ''; return ({ overview: 'بيبص على كل اللايرات', layer_profile: 'بيحلل ' + L, features: 'بيقرا عناصر من ' + L, distinct_values: 'القيم في ' + L + ' · ' + (i.field || ''), nearby: 'بيشوف حوالين عنصر في ' + L, relate: 'بيقيس الاتصال ' + (i.a != null ? (() => { try { return byId(i.a).l.name + ' ↔ ' + byId(i.b).l.name; } catch (e) { return ''; } })() : ''), run_qc: 'بيشغّل الفحص الكامل', mark: 'بيعلّم: ' + (i.note || '').slice(0, 50), propose_rule: 'بيقترح قاعدة', org_categories: 'بيشوف تصنيفات الكاد', propose_category: 'بيقترح تصنيف ' + (i.layer || '') })[n] || n; }

  function drawNotes() {
    if (noteLayer) GV.map.removeLayer(noteLayer);
    const C = { error: '#e03131', warning: '#f08c00', info: '#1c7ed6' };
    noteLayer = L.layerGroup(notes.map((n, i) => L.marker(n.ll, { icon: L.divIcon({ className: 'ai-pin', html: '<b style="background:' + C[n.sev] + '">' + (i + 1) + '</b>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).bindTooltip(n.note))).addTo(GV.map);
    const box = $('#aiNotes'); box.textContent = ''; if (!notes.length) return;
    const h = el('div', 'fc-acts'); h.append(el('b', null, '📍 ملاحظات Claude على الخريطة (' + notes.length + ')')); const cl = el('button', 'chip', 'امسحهم'); cl.onclick = () => { notes = []; drawNotes(); }; h.appendChild(cl); box.appendChild(h);
    notes.forEach((n, i) => { const r = el('button', 'ai-note'); r.append(el('b', null, String(i + 1)), el('span', null, n.note)); r.querySelector('b').style.background = C[n.sev]; r.onclick = () => { GV.closeSheets(); GV.map.setView(n.ll, Math.max(GV.map.getZoom(), 19)); if (n.ref && GV.showFeature) setTimeout(() => GV.showFeature(n.ref.l, n.ref.i, L.latLng(n.ll)), 350); }; box.appendChild(r); });
  }
  function drawPend() {
    const box = $('#aiPend'); if (!box) return; box.textContent = ''; if (!pend.length) return;
    box.appendChild(el('b', null, '✋ اقتراحات محتاجة موافقتك'));
    pend.forEach((p, i) => {
      const r = el('div', 'rule'); const t = p.t === 'edit' ? ('تعديل ' + p.n + ' عنصر في ' + p.layer + ' · لو: ' + p.where + ' · ' + Object.keys(p.set).map(k => k + ' = ' + p.set[k]).join(' · ')) : p.t === 'rule' ? (p.r.kind + ' · ' + (p.r.layer || '*') + (p.r.field && p.r.field !== '*' ? ' · ' + p.r.field : '') + (p.r.value ? ' · "' + p.r.value + '"' : '') + (p.r.min != null || p.r.max != null ? ' · ' + (p.r.min ?? '') + '..' + (p.r.max ?? '') : '') + (p.r.values ? ' · {' + p.r.values + '}' : '')) : ('تصنيف ' + p.layer + ' ← ' + p.category);
      const sp = el('span'); sp.append(el('b', 'mono', t), el('br'), el('small', 'muted', p.why || '')); r.appendChild(sp);
      const ok = el('button', 'chip ok', 'موافق'); ok.onclick = () => { if (p.t === 'edit') { const undo = []; let n = 0; p.l.features.forEach((f, i) => { const pr = f.properties || (f.properties = {}); let hit = false; try { hit = !!p.wf(pr, i); } catch (e) { } if (!hit) return; undo.push({ f, old: Object.assign({}, pr) }); const nv = {}; p.sf.forEach(([k, fn]) => { try { nv[k] = fn(pr, i); } catch (e) { } }); Object.assign(pr, nv); if (GV.recalcDerived) { try { GV.recalcDerived(p.l, f, { quiet: true }); } catch (e) { } } n++; }); GV.aiUndo = { undo, layer: p.l }; if (GV.editSample && undo.length) GV.editSample('تعديل Claude على ' + p.l.name, undo.map(x => ({ l: p.l, f: x.f, before: x.old })), () => { undo.forEach(x => { x.f.properties = x.old; }); GV.rebuild && GV.rebuild(p.l); return undo.length; }); if (GV.onDirty) GV.onDirty(); GV.rebuild && p.l.leaf && GV.rebuild(p.l); GV.toast('اتعدل ' + n + ' عنصر — تقدر تتراجع من زرار ↶ في شاشة Claude'); pend.splice(i, 1); drawPend(); const u = el('button', 'chip', '↶ تراجع عن آخر تعديل'); u.onclick = () => { (GV.aiUndo.undo || []).forEach(x => { x.f.properties = x.old; }); GV.aiUndo = null; u.remove(); GV.toast('اتراجعت'); }; $('#aiPend').appendChild(u); return; } if (p.t === 'rule') { const rr = Object.assign({}, p.r); if (rr.values) rr.values = String(rr.values).split(/[|,]/).map(s => s.trim()).filter(Boolean); GV.qcAddRule(rr); GV.toast('اتضافت القاعدة — هتتطبق في الفحص الجاي'); } else { GV.orgOverrides[p.layer] = p.category; GV.toast('اتسجل — هيظهر في "تنظيم الكاد"'); } pend.splice(i, 1); drawPend(); };
      const no = el('button', 'chip', 'لأ'); no.onclick = () => { pend.splice(i, 1); drawPend(); };
      r.append(ok, no); box.appendChild(r);
    });
    if (pend.some(p => p.t === 'cat')) { const g = el('button', 'chip', '🗂 افتح تنظيم الكاد'); g.onclick = () => GV.openOrg(); box.appendChild(g); }
  }
  // tiny markdown
  function md(s) {
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inl = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/_([^_\n]{2,})_/g, '<i>$1</i>');
    const lines = String(s).split('\n'); let h = '', list = null, tbl = null;
    const flush = () => { if (list) { h += '</' + list + '>'; list = null; } if (tbl) { h += '<table class="dtable">' + tbl.map((r, i) => '<tr>' + r.map(c => i ? '<td>' + inl(c) + '</td>' : '<th>' + inl(c) + '</th>').join('') + '</tr>').join('') + '</table>'; tbl = null; } };
    lines.forEach(l => {
      const t = l.trim();
      if (/^\|.*\|$/.test(t)) { if (/^\|[\s:\-|]+\|$/.test(t)) return; if (list) { h += '</' + list + '>'; list = null; } (tbl = tbl || []).push(t.slice(1, -1).split('|').map(c => c.trim())); return; }
      if (tbl) flush();
      let m;
      if ((m = t.match(/^(#{1,4})\s+(.*)/))) { flush(); h += '<h4>' + inl(m[2]) + '</h4>'; }
      else if ((m = t.match(/^[-*•]\s+(.*)/))) { if (list !== 'ul') { flush(); h += '<ul>'; list = 'ul'; } h += '<li>' + inl(m[1]) + '</li>'; }
      else if ((m = t.match(/^\d+[.)]\s+(.*)/))) { if (list !== 'ol') { flush(); h += '<ol>'; list = 'ol'; } h += '<li>' + inl(m[1]) + '</li>'; }
      else if (!t) { flush(); }
      else { flush(); h += '<p>' + inl(t) + '</p>'; }
    });
    flush(); return h;
  }
  $('#btnAI').addEventListener('click', open);
  GV.openAI = open; GV.aiAsk = q => { open(); setTimeout(() => ask(q), 50); };
  GV.customRequest = () => { // prompt() is blocked inside the Claude page, so the request is typed in a small in-page box
    let w = document.getElementById('crBox'); if (w) w.remove(); w = el('div', 'qc-rev'); w.id = 'crBox';
    const h = el('div', 'qc-rev-h'); h.appendChild(el('b', null, '🛠 طلب مخصص')); const x = el('button', 'icon-btn', '✕'); x.onclick = () => w.remove(); h.appendChild(x);
    const ta = el('textarea'); ta.rows = 4; ta.placeholder = 'اكتب طلبك: تكويد أو تعديل معين على الداتا أو الكاد…'; ta.style.cssText = 'width:100%;font:inherit;border-radius:10px;padding:8px';
    const go = el('button', 'chip ok', 'ابعت لـ Claude'); go.onclick = () => { const t = ta.value; if (!t.trim()) return ta.focus(); w.remove(); GV._crSend(t); };
    w.append(h, ta, go); document.body.appendChild(w); ta.focus(); };
  GV._crSend = t => { GV.aiAsk('طلب مخصص من اليوزر — اشتغل عليه معاه خطوة خطوة: افهم الداتا الأول بأدواتك، وقوله هتعمل إيه، وأي تعديل على البيانات اعرضه بأداة propose_edit عشان يوافق عليه (ولو كبير قسّمه). لو الطلب محتاج ميزة مش موجودة في البرنامج، اكتبله وصف دقيق للميزة يبعته للمطوّر. الطلب: ' + t.trim()); };
  { const tools = document.querySelector('#toolsSheet .tools'); if (tools) { const b = el('button', 'tool'); b.innerHTML = '<span>🛠</span><b>طلب مخصص</b><small>اطلب تكويد أو تعديل معين ونشتغله سوا خطوة خطوة</small>'; b.onclick = () => GV.customRequest(); tools.appendChild(b); } }
  GV._aiTools = TOOLS; // for tests
})();
