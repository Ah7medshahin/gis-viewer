// CAD organizer: classify every element, standard layer naming, separate background layers
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const NET = {
    water: { name: 'مياه', p: 'C-WATR', el: [
      ['MAIN', 'مواسير', 'line', /(main|prpl|pipe|w-?line|w-w-pipe|ir-pipe|irr.?st|watr|water|خط|ماسور|مواسير)/i, 'dia', /(serv|lat\b|hc\b|house|conn|text|iden|anno|dim|prf|profile|tabl|label)/i],
      ['SERV', 'توصيلات منزلية', 'line', /(serv|lateral|\blat\b|\bhc\b|house|conn|وصل|توصيل)/i, 'dia'],
      ['VALV', 'محابس', 'point', /(valv|vlv|\bgv\b|\bbv\b|\bav\b|\bsv\b|\bwo\b|arv|bgv|qcv|air|wash|scour|butter|gate|check|prv|surface box|محبس)/i, 'vtype', /(text|txt|tabl)/i],
      ['HYDT', 'حنفيات حريق', 'point', /(hydr|\bfh\b|fire|حريق|طفاي)/i],
      ['SADL', 'سادلات', 'point', /(saddle|\btap\b|سادل)/i],
      ['FITT', 'فيتنجز', 'point', /(tee|bend|reduc|\bred\b|-red\b|\bcap\b|plug|cross|elbow|fitt|thrust|coupl|flange|sleev|كوع|مشترك|مسلوب|طبة)/i],
      ['METR', 'عدادات', 'point', /(meter|metr|عداد)/i],
      ['CHMB', 'غرف', 'point', /(chamber|\bmh\b|manhole|غرفة)/i]] },
    sewer: { name: 'صرف صحي', p: 'C-SSWR', el: [['GRAV', 'خطوط انحدار', 'line', /(sewer|sswr|grav|pipe|main|صرف)/i, 'dia', /(force|rising|lat\b|serv|hc\b|text)/i], ['FORC', 'خطوط ضغط', 'line', /(force|rising|\bfm\b)/i, 'dia'], ['LATR', 'توصيلات', 'line', /(lat\b|serv|\bhc\b|house|conn)/i, 'dia'], ['MHOL', 'غرف تفتيش', 'point', /(\bmh\b|[-_ ]mh\b|manhol|غرفة|chamber|node|structure|concentric)/i, null, /(text|txt|tabl|prf|anno|v-node)/i], ['INSP', 'غرف منزلية', 'point', /(\bic\b|inspection|iiiic|working.?ic)/i], ['CLNO', 'كلين أوت', 'point', /(clean.?out|\bg?co\b|\$gco\b|cccooo|\bcco\b)/i]] },
    storm: { name: 'أمطار', p: 'C-STRM', el: [['PIPE', 'مواسير', 'line', /(storm|strm|\bsw\b|drain|pipe|main|@\s*\d{3,4})/i, 'dia', /(culv|text|txt|tabl|prf|profile|arr|anno)/i], ['CULV', 'عبّارات', 'line', /(culv|box)/i], ['MHOL', 'غرف', 'point', /(\bmh\b|manhol|chamber|node|structure)/i, null, /(text|txt|tabl|prf|anno|v-node)/i], ['INLT', 'مصائد', 'point', /(inlet|gully|catch|\bc\.?b\b|cb final|grat)/i], ['OUTF', 'مخارج', 'point', /(outfall|outlet)/i]] },
    power: { name: 'كهرباء', p: 'E-POWR', el: [['MVCB', 'كابلات متوسط', 'line', /(\bmv\b|11\s?kv|13\.8|33\s?kv|medium)/i], ['LVCB', 'كابلات منخفض', 'line', /(\blv\b|0\.4|380|low|cable)/i, null, /(mv|text)/i], ['SUBS', 'محطات', 'point', /(\bsub|s\/s|substation|محطة)/i], ['RMU', 'RMU', 'point', /(\brmu\b|ring)/i], ['FPIL', 'فيدر بيلر', 'point', /(\bfp\b|pillar|mdb)/i]] },
    lighting: { name: 'إنارة', p: 'E-LITE', el: [['POLE', 'أعمدة', 'point', /(pole|\blp\b|\blp\d|lt-?sym|e-lt-sym|lum|lamp|عمود)/i, null, /(text|txt|tabl)/i], ['CABL', 'كابلات', 'line', /(cable|ltg|كابل)/i, 'csize', /(text|txt|tabl)/i], ['PANL', 'لوحات', 'point', /(panel|\bslp|e-pw-equ|feeder|لوحة)/i]] },
    telecom: { name: 'اتصالات', p: 'C-COMM', el: [['DUCT', 'دكتات', 'line', /(duct|tele|comm|fib|\bft\b|stc)/i], ['MHOL', 'غرف', 'point', /(\bmh\b|manhole|\bjb\b)/i], ['HHOL', 'هاندهول', 'point', /(\bhh\b|handhole)/i], ['CABN', 'كبائن', 'point', /(cabinet|\bcab\b|fdh)/i]] },
    gas: { name: 'غاز', p: 'C-NGAS', el: [['MAIN', 'مواسير', 'line', /(gas|ngas|main|pipe)/i, 'dia', /(serv|text)/i], ['SERV', 'توصيلات', 'line', /(serv|lat\b|hc\b)/i, 'dia'], ['VALV', 'محابس', 'point', /(valv|vlv)/i], ['REGU', 'منظمات', 'point', /(regul|prs|drs)/i]] },
    irrigation: { name: 'ري', p: 'L-IRRG', el: [['MAIN', 'مواسير', 'line', /(irr|main|pipe)/i, 'dia', /(lat|drip|text)/i], ['LATR', 'فرعي', 'line', /(lat|drip|sub)/i, 'dia'], ['VALV', 'محابس', 'point', /(valv|vlv|solenoid)/i], ['SPRK', 'رشاشات', 'point', /(sprink|emitter|bubbler|rotor|spray)/i], ['CTRL', 'كنترولر', 'point', /(control|clock)/i]] }
  };
  const BG = [['G-PROF', 'قطاعات طولية (بروفايل)', /(prf|profile|band|section view|قطاع)/i], ['V-TOPO', 'نقط الرفع والمساحة', /(v-node|as.?built points|cogo|bmrk|benchmark|tinn|surface|contour|spot|survey|coord)/i], ['G-ANNO-TABL', 'الجداول', /(tabl|table|schedule|جدول)/i], ['G-ANNO-ARRW', 'أسهم الاتجاه', /(-arr\b|arr-|arrow|flowdir|flow dir)/i], ['V-PLOT', 'قطع الأراضي', /(plot|parcel|\blot\b|land|قطع|قطعة|أرض|ارض|plan[-_ ]?no|block[-_ ]?no|zoning|cadast)/i], ['V-BLDG', 'المباني والأسوار', /(bldg|build|house|villa|مبنى|مباني|فيلا|struct|wall|fence|سور)/i], ['V-ROAD', 'الطرق والأرصفة', /(road|street|curb|kerb|edge|r\.?o\.?w|pave|asph|sidewalk|walk|median|طريق|شارع|رصيف|اسفلت|جزيرة)/i], ['V-TOPO', 'الرفع المساحي والمناسيب', /(topo|contour|spot|level|survey|grid|coord|benchmark|\bbm\b|منسوب|كنتور|رفع)/i], ['G-ANNO-DIMS', 'الأبعاد', /(dim)/i], ['G-ANNO-TTLB', 'الإطار ولوحة العنوان', /(title|frame|border|sheet|vport|viewport|\btb\b|legend|north|scale|logo|stamp|revision|لوحة|اطار|إطار)/i], ['G-ANNO-TEXT', 'نصوص عامة', /(text|txt|anno|label|note|كتابة|نص)/i], ['V-HATCH', 'تهشير', /(hatch)/i], ['X-OTHER', 'لير 0 و Defpoints', /^(0|defpoints)$/i]];
  const VTYPE = [['GATE', /(gate|\bgv\b|sluice|بوابة)/i], ['AIR', /(air|\bav\b|ارو|هواء)/i], ['WASH', /(wash|scour|\bwo\b|drain|غسيل)/i], ['BUTF', /(butter|\bbv\b|فراشة)/i], ['CHCK', /(check|nrv|non.?return)/i], ['PRV', /(prv|reduc.*valv|pressure)/i], ['ISOL', /(isol)/i]];
  const DIA_RE = /(?:Ø|ø|DN\s*|D\s*=\s*|DIA\.?\s*|^|\s)(\d{2,4})\s*(?:mm|MM)?(?=\s|$|[^\d])/;
  let st = null; // {src, net, rows:[{l, cat, stats}], opts}
  // diameter / cable size / depth class written in layer names (W-W-PIPE-160, @600 FROM 2 TO 3 M, HC-LTG-CABLE-4Cx35, IRR ST 160mm)
  function layerDia(n) { let m = /@\s*(\d{2,4})/.exec(n) || /(\d{2,4})\s*mm\b/i.exec(n) || /(?:pipe|dia|Ø|DN)[-_ ]?(\d{2,4})\b/i.exec(n) || /[-_ ](\d{2,4})\s*$/.exec(n) || /^(\d{2,4})\s*$/.exec(n); if (!m) return null; const d = +m[1]; return d >= 15 && d <= 3000 ? String(d) : null; }
  function layerExtra(n) { const o = {}; let m = /(\d)\s*C\s*[xX×]\s*(\d{1,3})/.exec(n); if (m) o.CABLE_SIZE = m[1] + 'Cx' + m[2]; m = /from\s*(\d+(?:\.\d+)?)\s*to\s*(\d+(?:\.\d+)?)/i.exec(n); if (m) o.DEPTH_RANGE = m[1] + '-' + m[2] + ' م'; else if ((m = /(?:less|liss)\s*than\s*(\d+(?:\.\d+)?)/i.exec(n))) o.DEPTH_RANGE = '< ' + m[1] + ' م'; else if ((m = /more\s*than\s*(\d+(?:\.\d+)?)/i.exec(n))) o.DEPTH_RANGE = '> ' + m[1] + ' م'; return o; }

  const isText = f => f.properties && f.properties.Text != null;
  function stats(l) { const s = { line: 0, point: 0, text: 0, closed: 0, blocks: new Map() }; l.features.forEach(f => { if (f._sym) return; const g = f.geometry; if (!g) return; if (isText(f)) { s.text++; if (DIA_RE.test(String(f.properties.Text)) || /(valv|محبس|hydr|pipe|upvc|hdpe|di\b|ductile|gate|air|saddle|سادل|ماسور|^\s*[LS]\s*=\s*\d|^\s*(I\.?L|G\.?L|C\.?L)\s*=|^\s*LINE\s+\w)/i.test(String(f.properties.Text))) s.netText = (s.netText || 0) + 1; } else if (g.type === 'Point') { s.point++; const b = f.properties.Block; if (b) s.blocks.set(b, (s.blocks.get(b) || 0) + 1); } else { s.line++; const c = g.type === 'LineString' ? g.coordinates : null; if (c && c.length > 3 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 1e-6) s.closed++; } }); return s; }
  const FTYPE = { sewer: { MHOL: 'Manhole', INSP: 'Inspection Chamber', CLNO: 'Clean Out' }, storm: { MHOL: 'Manhole', INLT: 'Catch Basin', OUTF: 'Outfall' } };
  // a layer belongs to another network only on a full word (WATER, STORM…); short codes like W-/SW-/SS- are too ambiguous (W-SW-PIPE-200 is a sewer main)
  const IDN_STRONG = { water: /(watr|water|potable|مياه)/i, sewer: /(sewer|sswr|sanit|صرف)/i, storm: /(storm|strm|drain|rain|امطار|أمطار|سيول)/i, power: /(elec|powr|power|\bmv\b|\blv\b|كهرب)/i, lighting: /(light|lite|ltg|انارة|إنارة)/i, telecom: /(tele|comm|\bstc\b|fib|اتصالات)/i, gas: /(\bgas\b|ngas|غاز)/i, irrigation: /(irrig|irrg|\bri\b|ري)/i };
  const IDN = { water: /(\bw[-_ ]|watr|water|potable|مياه)/i, sewer: /(sewer|sswr|\bss[-_ ]|sanit|صرف)/i, storm: /(storm|strm|\bsw[-_ ]|drain|rain|امطار|أمطار|سيول)/i, power: /(elec|powr|power|\bmv\b|\blv\b|كهرب)/i, lighting: /(light|lite|ltg|انارة|إنارة)/i, telecom: /(tele|comm|\bstc\b|fib|اتصالات)/i, gas: /(\bgas\b|ngas|غاز)/i, irrigation: /(irrig|irrg|\bri\b|ري)/i };
  function classify(l, s, net) {
    const N = NET[net]; const nm = l.name;
    const weak = Object.keys(IDN).filter(k => k !== net && IDN[k].test(nm)); const other = Object.keys(IDN_STRONG).find(k => k !== net && IDN_STRONG[k].test(nm) && !IDN[net].test(nm)) || (weak.length === 1 && !IDN[net].test(nm) ? weak[0] : null);
    if (other) return { kind: 'bg', code: 'X-UTIL-' + NET[other].p.split('-')[1], label: 'شبكة ' + NET[other].name };
    if (s.text && !s.line && !s.point && (IDN[net].test(nm) || s.netText >= Math.max(1, s.text * 0.3))) return { kind: 'net', code: 'IDEN', label: 'نصوص الشبكة' };
    const dom = s.line >= s.point ? 'line' : 'point';
    for (const [code, ar, geom, re, split, not] of N.el) if (re.test(nm) && !(not && not.test(nm)) && (geom === dom || (s.line + s.point === 0))) return { kind: 'net', code, label: ar };
    for (const [code, ar, geom, re, split, not] of N.el) if (re.test(nm) && !(not && not.test(nm))) return { kind: 'net', code, label: ar };
    if (nm === '0' || /^defpoints$/i.test(nm)) return { kind: 'bg', code: 'X-LYR0', label: 'لير 0 / Defpoints' };
    if (s.point && GV.legend && Array.from(s.blocks.keys()).some(b => GV.legend.byBlock[b] && GV.legend.byBlock[b].code)) return { kind: 'net', code: 'BLOCKS', label: 'رموز الشبكة (من الليجند)' };
    if (s.point && Array.from(s.blocks.keys()).some(b => N.el.some(e => e[2] === 'point' && e[3].test(b)))) return { kind: 'net', code: 'BLOCKS', label: 'رموز الشبكة (حسب اسم البلوك)' };
    if (/\$0\$|^xr[._ -]|\|/i.test(nm)) return { kind: 'bg', code: 'X-XREF', label: 'XREF / بيز مربوط' };
    if (/(^|[-_ ])base([-_ ]|$)|basemap|base[-_ ]?map/i.test(nm)) return { kind: 'bg', code: 'X-BASE', label: 'بيز' };
    for (const [code, ar, re] of BG) if (re && re.test(nm)) return { kind: 'bg', code, label: ar };
    for (const k in NET) if (k !== net && NET[k].el.some(e => e[3].test(nm) && !(e[5] && e[5].test(nm))) && new RegExp(NET[k].p.split('-')[1], 'i').test(nm)) return { kind: 'bg', code: 'X-UTIL-' + NET[k].p.split('-')[1], label: 'شبكة ' + NET[k].name };
    if (s.text && !s.line && !s.point) return { kind: 'bg', code: 'G-ANNO-TEXT', label: 'نصوص عامة' };
    return { kind: 'unk', code: null, label: 'مش معروف' };
  }

  function open() {
    const cs = GV.sources.filter(s => s.isCad && !s.orgOut && !GV.superseded(s) && s.layers.some(l => l.features.length));
    if (!cs.length) return GV.showMsg('افتح ملف الكاد (DWG/DXF) الأول وحدد نظام الإحداثيات بتاعه.');
    start(cs.length === 1 ? cs[0] : null, cs);
  }
  function start(src, list) {
    const box = $('#orgBody'); box.textContent = '';
    if (!src) { box.appendChild(el('p', 'muted', 'اختار ملف الكاد:')); list.forEach(s => { const b = el('button', 'crs-opt', s.name); b.onclick = () => start(s); box.appendChild(b); }); GV.openSheet('#orgSheet'); return; }
    const net = GV.store.get('gv_orgnet') || 'water';
    st = { src, net, opts: { dia: true, vtype: true, iden: true }, rows: src.layers.filter(l => l.features.length).map(l => { const s = stats(l); let cat = classify(l, s, net); const ov = GV.orgOverrides[l.name]; if (ov) { const [k, c] = ov.split(':'); const o = catOptions(net).find(x => x[0] === ov); cat = { kind: k, code: c || null, label: (o ? o[1] : ov) + ' · Claude' }; } return { l, s, cat }; }) };
    if (start._auto) return;
    render();
    GV.openSheet('#orgSheet');
  }
  function catOptions(net) {
    const N = NET[net]; const o = [];
    N.el.forEach(([code, ar]) => o.push(['net:' + code, 'شبكة: ' + ar + ' (' + N.p + '-' + code + ')']));
    o.push(['net:BLOCKS', 'شبكة: رموز حسب اسم البلوك']); o.push(['net:IDEN', 'شبكة: نصوص الشبكة (' + N.p + '-IDEN)']);
    BG.forEach(([code, ar]) => o.push(['bg:' + code, 'خلفية: ' + ar + ' (' + code + ')']));
    for (const k in NET) if (k !== net) o.push(['bg:X-UTIL-' + NET[k].p.split('-')[1], 'خلفية: شبكة ' + NET[k].name]);
    o.push(['keep:', 'سيبه زي ما هو في ملف الشبكة']); o.push(['drop:', 'امسحه']);
    return o;
  }
  function render() {
    const box = $('#orgBody'); box.textContent = '';
    box.appendChild(el('p', 'muted small', 'بقرا أسماء اللايرات والبلوكات والنصوص اللي جنب كل عنصر، وبحدد هو إيه. راجع التصنيف وعدّل اللي محتاج، وبعدين "نظّم".'));
    const r1 = el('div', 'row2');
    const ns = el('select'); Object.keys(NET).forEach(k => { const o = el('option', null, NET[k].name + ' (' + NET[k].p + ')'); o.value = k; ns.appendChild(o); }); ns.value = st.net;
    ns.onchange = () => { GV.store.set('gv_orgnet', ns.value); st.net = ns.value; st.rows.forEach(r => r.cat = classify(r.l, r.s, st.net)); render(); };
    const lab = el('label', 'fld'); lab.append(el('span', null, 'نوع الشبكة'), ns); r1.appendChild(lab);
    const ck = el('div'); [['dia', 'قسّم المواسير حسب القطر'], ['vtype', 'قسّم المحابس حسب النوع'], ['iden', 'نصوص الشبكة على لير ‎-IDEN']].forEach(([k, t]) => { const l = el('label', 'ck small'); const c = el('input'); c.type = 'checkbox'; c.checked = st.opts[k]; c.onchange = () => st.opts[k] = c.checked; l.append(c, el('span', null, t)); ck.appendChild(l); });
    r1.appendChild(ck); box.appendChild(r1);
    const cnt = { net: 0, bg: 0, unk: 0 }; st.rows.forEach(r => cnt[r.cat.kind === 'keep' ? 'net' : r.cat.kind === 'drop' ? 'bg' : r.cat.kind]++);
    box.appendChild(el('p', 'small', '🟢 ' + cnt.net + ' لير شبكة · ⚪ ' + cnt.bg + ' لير خلفية · 🟠 ' + cnt.unk + ' مش معروف (راجعهم)'));
    const opts = catOptions(st.net);
    const sorted = st.rows.slice().sort((a, b) => ({ unk: 0, net: 1, keep: 1, bg: 2, drop: 3 }[a.cat.kind] - { unk: 0, net: 1, keep: 1, bg: 2, drop: 3 }[b.cat.kind]));
    sorted.forEach(r => {
      const row = el('div', 'org-row ' + r.cat.kind);
      const nm = el('div', 'org-nm'); nm.appendChild(el('b', null, r.l.name));
      const parts = []; if (r.s.line) parts.push(r.s.line + ' خط'); if (r.s.point) parts.push(r.s.point + ' رمز/نقطة'); if (r.s.text) parts.push(r.s.text + ' نص');
      if (r.s.blocks.size) parts.push('بلوكات: ' + Array.from(r.s.blocks.keys()).slice(0, 3).join('، '));
      nm.appendChild(el('small', 'muted', parts.join(' · ')));
      const sel = el('select'); opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); });
      if (r.cat.kind === 'unk') { const o = el('option', null, '؟ مش معروف (اختار)'); o.value = 'unk:'; sel.prepend(o); }
      sel.value = r.cat.kind + ':' + (r.cat.code || '');
      sel.onchange = () => { const [k, c] = sel.value.split(':'); r.cat = { kind: k, code: c || null, label: sel.options[sel.selectedIndex].text }; render(); };
      row.append(nm, sel); box.appendChild(row);
    });
    const go = el('button', 'open-btn', 'نظّم الكاد'); go.style.width = '100%'; go.style.justifyContent = 'center'; go.style.marginTop = '10px'; go.onclick = run; box.appendChild(go);
  }

  function run() {
    const N = NET[st.net], P = N.p, src = st.src; const o = st.opts; const net = st.net;
    // text index (native coords) for diameters
    const texts = []; src.layers.forEach(l => l.features.forEach(f => { if (isText(f) && f.geometry) texts.push({ x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], t: String(f.properties.Text) }); }));
    const R = 3, tg = new Map(); texts.forEach((t, i) => { const k = Math.floor(t.x / R) + ',' + Math.floor(t.y / R); if (!tg.has(k)) tg.set(k, []); tg.get(k).push(i); });
    const nearDia = c => { let best = null, bd = R; const sm = []; for (let i = 0; i < c.length; i++) { sm.push(c[i]); if (i) { const a = c[i - 1], b = c[i]; const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.min(200, Math.floor(L0 / R)); for (let q = 1; q <= n; q++) sm.push([a[0] + (b[0] - a[0]) * q / (n + 1), a[1] + (b[1] - a[1]) * q / (n + 1)]); } } sm.forEach(p => { const ci = Math.floor(p[0] / R), cj = Math.floor(p[1] / R); for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) (tg.get(a + ',' + b) || []).forEach(ti => { const t = texts[ti]; const d = Math.hypot(t.x - p[0], t.y - p[1]); if (d < bd) { const m = t.t.match(DIA_RE); if (m) { bd = d; best = +m[1]; } } }); }); return best; };
    const pad = v => String(Math.round(v)).padStart(4, '0');
    const elOf = code => N.el.find(e => e[0] === code);
    const LG = GV.legend || { byLayer: {}, byBlock: {} };
    const inLeg = f => { if (!LG.box || LG.src !== src) return false; const c = GV.firstCoord(f.geometry); return c && c[0] >= LG.box[0] && c[0] <= LG.box[2] && c[1] >= LG.box[1] && c[1] <= LG.box[3]; };
    const ptByBlock = b => { const lg = b && LG.byBlock[b]; if (lg && lg.code) { const e = N.el.find(x => x[0] === lg.code && x[2] === 'point'); if (e) return e; } return N.el.find(e => e[2] === 'point' && b && e[3].test(b)); };
    const vtypeOf = s => { const m = VTYPE.find(([k, re]) => re.test(s || '')); return m ? m[0] : null; };
    const outNet = new Map(), outBg = new Map(); const report = new Map();
    const put = (map, name, f, extra) => { if (!map.has(name)) map.set(name, []); const nf = Object.assign({}, f, { properties: Object.assign({}, f.properties, { Layer: name, ORIG_LAYER: f.properties.Layer || '' }, extra || {}) }); delete nf.wgs; delete nf._lbl; map.get(name).push(nf); if (!f._sym) report.set(name, (report.get(name) || 0) + 1); return nf; };
    // tracing: a line on an unknown layer that runs through 2+ surveyed network points IS network (connectivity, not layer name)
    const TR = { n: 0, layers: new Set() }; const SV = []; try { const c0 = (src.layers.find(l => l.crsDef) || {}).crsDef; const crs = c0 && GV.resolveCRS(String(c0)); if (crs && crs.inv) GV.sources.filter(x => x.flowTables).forEach(x => x.layers.forEach(l => l.features.forEach(f => { if (f.wgs && f.wgs.geometry && f.wgs.geometry.type === 'Point') SV.push(crs.inv(f.wgs.geometry.coordinates)); }))); } catch (e) { }
    const SVG = new Map(); SV.forEach((p, i) => { const k = Math.floor(p[0] / 5) + ',' + Math.floor(p[1] / 5); if (!SVG.has(k)) SVG.set(k, []); SVG.get(k).push(i); });
    const traced = f => { const g = f.geometry; if (!SV.length || !g || g.type !== 'LineString' || f._sym) return 0; const c = g.coordinates; let L = 0; for (let i = 1; i < c.length; i++) L += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); if (L < 8) return 0; const hit = new Set();
      for (let i = 1; i < c.length; i++) { const a = c[i - 1], b = c[i]; for (let x = Math.floor((Math.min(a[0], b[0]) - 0.1) / 5); x <= Math.floor((Math.max(a[0], b[0]) + 0.1) / 5); x++) for (let y = Math.floor((Math.min(a[1], b[1]) - 0.1) / 5); y <= Math.floor((Math.max(a[1], b[1]) + 0.1) / 5); y++) (SVG.get(x + ',' + y) || []).forEach(j => { const q = SV[j]; const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); if (Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy) <= 0.1) hit.add(j); }); }
      return hit.size >= 2 ? hit.size : 0; };
    st.rows.forEach(r => {
      const l = r.l, cat = r.cat; const lnum = layerDia(l.name); const lx = layerExtra(l.name);
      if (cat.kind === 'drop') return;
      let lastIns = null;
      l.features.forEach(f => {
        const g = f.geometry; if (!g) return; if (inLeg(f)) { put(outBg, 'G-ANNO-LGND', f); return; }
        if (cat.kind === 'bg') { put(outBg, cat.code, f); return; }
        if (cat.kind === 'unk') { const tr = traced(f); if (tr) { const e = N.el.find(x => x[2] === 'line'); put(outNet, P + '-' + e[0], f, { ELEMENT: e[1], TRACED: tr }); TR.n++; TR.layers.add(l.name); } else put(outBg, 'X-UNKN-' + l.name, f); return; }
        if (cat.kind === 'keep') { put(outNet, l.name, f); return; }
        // network
        if (f._sym) { if (lastIns) put(outNet, lastIns, f); else put(outNet, P + '-' + (cat.code === 'BLOCKS' ? 'SYMB' : cat.code), f); return; }
        if (isText(f)) { put(outNet, o.iden || cat.code === 'IDEN' ? P + '-IDEN' : P + '-' + (cat.code === 'BLOCKS' ? 'SYMB' : cat.code), f); return; }
        if (g.type === 'Point') {
          const b = f.properties.Block || ''; const e = ptByBlock(b) || (cat.code !== 'BLOCKS' && elOf(cat.code) && elOf(cat.code)[2] === 'point' ? elOf(cat.code) : null);
          let name, extra = Object.assign({}, lx);
          const lgb = LG.byBlock[b];
          if (e) { name = P + '-' + e[0]; if (FTYPE[net] && FTYPE[net][e[0]]) extra.FEATURETYPE = FTYPE[net][e[0]]; if (e[0] === 'VALV' && o.vtype) { const vt = (lgb && lgb.vtype) || vtypeOf(b + ' ' + l.name + ' ' + (lgb ? lgb.desc : '')); if (vt) { name += '-' + vt; extra.VALVE_TYPE = vt; } } extra.ELEMENT = e[1]; }
          if (lgb) { extra.LEGEND = lgb.desc; if (lgb.dia) extra.DIAMETER = lgb.dia; if (lgb.mat) extra.MATERIAL = lgb.mat; }
          if (!e) name = P + '-' + (elOf(cat.code) && elOf(cat.code)[2] === 'line' ? 'FITT' : 'SYMB');
          lastIns = f._ins ? name : null; put(outNet, name, f, extra); return;
        }
        // a CIRCLE drawn on a structure layer (manhole ring) is the structure itself → its centre point
        { const ep = elOf(cat.code); if (ep && ep[2] === 'point' && g.type === 'LineString' && (f.properties.Radius != null || f.properties.Entity === 'CIRCLE')) { const cc = g.coordinates; let x = 0, y = 0; const n = cc.length > 1 && cc[0][0] === cc[cc.length - 1][0] && cc[0][1] === cc[cc.length - 1][1] ? cc.length - 1 : cc.length; for (let i = 0; i < n; i++) { x += cc[i][0]; y += cc[i][1]; } const extra = Object.assign({ ELEMENT: ep[1], FROM_CIRCLE: 1 }, lx); if (FTYPE[net] && FTYPE[net][ep[0]]) extra.FEATURETYPE = FTYPE[net][ep[0]]; put(outNet, P + '-' + ep[0], Object.assign({}, f, { geometry: { type: 'Point', coordinates: [x / n, y / n] } }), extra); return; } }
        // lines / polygons
        const e = elOf(cat.code);
        if (e && e[2] === 'line') {
          let name = P + '-' + e[0], extra = { ELEMENT: e[1] };
          const lgl = LG.byLayer[l.name];
          Object.assign(extra, lx);
          if (o.dia && e[4] === 'dia') { const d = lnum ? +lnum : (lgl && lgl.dia) || (g.type === 'LineString' ? nearDia(g.coordinates) : null); if (d) { name += '-' + pad(d); extra.DIAMETER = d; } }
          if (lgl) { extra.LEGEND = lgl.desc; if (lgl.mat) extra.MATERIAL = lgl.mat; }
          put(outNet, name, f, extra); return;
        }
        put(outNet, P + '-' + (cat.code === 'BLOCKS' ? 'SYMB' : (e ? e[0] : 'SYMB')), f);
      });
    });
    // one structure = one point: a block, a ring and a second ring at the same spot are merged (block kept)
    { const PTL = [...outNet.keys()].filter(k => N.el.some(e => e[2] === 'point' && k === P + '-' + e[0])); const all = []; PTL.forEach(k => outNet.get(k).forEach(f => { if (f.geometry && f.geometry.type === 'Point') all.push({ k, f }); }));
      all.sort((a, b) => (a.f.properties.FROM_CIRCLE ? 1 : 0) - (b.f.properties.FROM_CIRCLE ? 1 : 0)); const G = new Map(), drop = new Set(); const cell = c => Math.floor(c[0] / 0.6) + ',' + Math.floor(c[1] / 0.6);
      all.forEach(o => { const c = o.f.geometry.coordinates; const cx = Math.floor(c[0] / 0.6), cy = Math.floor(c[1] / 0.6); let dup = null; for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1 && !dup; j++) (G.get((cx + i) + ',' + (cy + j)) || []).forEach(q => { if (!dup && q.k === o.k && Math.hypot(q.f.geometry.coordinates[0] - c[0], q.f.geometry.coordinates[1] - c[1]) < 0.5) dup = q; }); if (dup) { drop.add(o.f); dup.f.properties.MERGED = (dup.f.properties.MERGED || 1) + 1; return; } const kk = cell(c); if (!G.has(kk)) G.set(kk, []); G.get(kk).push(o); });
      if (drop.size) { PTL.forEach(k => outNet.set(k, outNet.get(k).filter(f => !drop.has(f)))); st.merged = drop.size; } }
    const colorOf = name => { const s = src.layers.find(l => l.name === name); if (s) return s.color; const h = Array.from(name).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); return GV.PALETTE[h % GV.PALETTE.length]; };
    const crs = (src.layers.find(l => l.crsDef) || {}).crsDef;
    const mk = (map, nm) => ({ name: nm + src.name, type: 'CAD (DXF)', layers: Array.from(map.keys()).sort().map(k => ({ name: k, features: map.get(k), crs, color: colorOf(k), cad: true })) });
    [GV.sources.find(s => s.orgOut === src.name + '|net'), GV.sources.find(s => s.orgOut === src.name + '|bg')].forEach(s => s && GV.removeSource(s));
    const groups = [mk(outNet, 'منظّم: ')]; if (outBg.size) groups.push(mk(outBg, 'خلفية: '));
    return GV.addGroups(groups, { quiet: true, before: added => { added.forEach((s, i) => { s.orgOut = src.name + (i ? '|bg' : '|net'); s.cadInfo = { blocks: (src.cadInfo && src.cadInfo.blocks) || {}, skipped: {} }; s.anno = src.anno; if (i) s.layers.forEach(l => l.visible = false); }); } }).then(added => {
      src.layers.forEach(l => GV.setVis(l, false));
      GV.renderLayers(); GV.refreshLabels(); if (GV.onDirty) GV.onDirty();
      done(added, report, outNet, outBg);
      return { added, net: outNet.size, bg: outBg.size, unknown: Array.from(outBg.keys()).filter(k => /^X-UNKN/.test(k)).length, traced: TR.n, tracedLayers: Array.from(TR.layers) };
    });
  }
  function done(added, report, outNet, outBg) {
    const box = $('#orgBody'); box.textContent = '';
    box.appendChild(el('div', 'ok-note', '✓ اتنظّم: ' + outNet.size + ' لير شبكة' + (outBg.size ? ' و ' + outBg.size + ' لير خلفية اتفصلوا' : '')));
    const sec = el('div', 'step'); sec.appendChild(el('b', null, 'لايرات الشبكة'));
    Array.from(outNet.keys()).sort().forEach(k => { const r = el('div', 'qc-type'); const d = el('span', 'qc-dot'); d.style.background = /^X-UNKN/.test(k) ? '#f08c00' : '#2f9e44'; r.append(d, el('span', 'qc-t mono', k), el('small'), el('b', null, (report.get(k) || 0).toLocaleString('en'))); sec.appendChild(r); });
    box.appendChild(sec);
    if (outBg.size) { const sb = el('div', 'step'); sb.appendChild(el('b', null, 'الخلفية (اتفصلت ومخفية)')); Array.from(outBg.keys()).sort().forEach(k => { const r = el('div', 'qc-type'); const d = el('span', 'qc-dot'); d.style.background = '#adb5bd'; r.append(d, el('span', 'qc-t mono', k), el('small'), el('b', null, (report.get(k) || 0).toLocaleString('en'))); sb.appendChild(r); }); box.appendChild(sb); }
    if (Array.from(outNet.keys()).some(k => /^X-UNKN/.test(k))) box.appendChild(el('p', 'small hint', 'اللايرات اللي بتبدأ بـ X-UNKN اتسابت في ملف الشبكة لأني مش متأكد هي إيه. رجّع وصنّفها.'));
    const acts = el('div', 'fc-acts');
    const a1 = el('button', 'open-btn sm', 'نزّل كاد الشبكة (DXF)'); a1.onclick = () => GV.exportCadDxf(added[0]);
    acts.appendChild(a1);
    if (added[1]) { const a2 = el('button', 'chip', 'نزّل كاد الخلفية (DXF)'); a2.onclick = () => GV.exportCadDxf(added[1]); acts.appendChild(a2); }
    const a3 = el('button', 'chip', 'حوّل لـ GIS'); a3.onclick = () => GV.openWorkspaces && GV.openWorkspaces();
    const a4 = el('button', 'chip', 'افحص الشبكة'); a4.onclick = () => GV.openQC && GV.openQC(added[0].layers);
    const a5 = el('button', 'chip', '→ رجوع للتصنيف'); a5.onclick = render;
    acts.append(a3, a4, a5); box.appendChild(acts);
  }
  // map display: dots only for network components; background layers hidden on load
  function catOf(l) { if (l._cat && l._cat.n === l.features.length) return l._cat.c; const net = GV.store.get('gv_orgnet') || 'water'; const c = classify(l, stats(l), net); l._cat = { n: l.features.length, c }; return c; }
  const anyNetBlock = b => b && Object.keys(NET).some(k => NET[k].el.some(e => e[2] === 'point' && e[3].test(b)));
  GV.cadDot = (l, f) => { const c = catOf(l); const p = f.properties || {}; if (c.kind === 'bg' && c.code !== 'X-OTHER') return false; if (c.kind === 'net' && c.code !== 'IDEN') return true; if (anyNetBlock(p.Block)) return true; if (!p.Block) return true; const bl = l.src && l.src.cadInfo && l.src.cadInfo.blocks && l.src.cadInfo.blocks[p.Block]; return !(bl && (bl.length || Object.keys(bl).length)); };
  function netOnly(src, on, quiet) {
    src.netOnly = on; let n = 0;
    src.layers.forEach(l => { if (!l.features.length) return; const c = catOf(l); if (c.kind === 'bg' && HIDE_BG.test(c.code || '') && !mostlyText(l)) { if (on && l.visible) { GV.setVis(l, false); n++; } else if (!on && !l.visible) { GV.setVis(l, true); n++; } } });
    GV.renderLayers(); GV.refreshLabels(); if (GV.onDirty) GV.onDirty();
    if (!quiet || n) GV.toast(on ? (n ? 'خفيت ' + n + ' لير خلفية (قطع أراضي، طرق، إطار…). ترجعهم من زرار "الشبكة بس"' : 'مفيش لايرات خلفية') : 'رجعت كل اللايرات');
  }
  const HIDE_BG = /^(V-PLOT|V-BLDG|V-ROAD|V-HATCH|X-UTIL)/;
  const mostlyText = l => { const s = stats(l); return s.text > 0 && s.text >= (s.line + s.point) * 0.3; };
  GV.cadNetOnly = netOnly;
  GV.orgOverrides = {};
  GV.orgAuto = async src => { start._auto = true; try { start(src); } finally { start._auto = false; } return run(); };
  GV.orgGuessNet = src => { const sc = {}; Object.keys(NET).forEach(k => { sc[k] = 0; src.layers.forEach(l => { const n = l.features.length; if (IDN[k].test(l.name)) sc[k] += n * 2; if (NET[k].el.some(e => e[3].test(l.name) && !(e[5] && e[5].test(l.name)))) sc[k] += n; }); }); const fn = String(src.name || ''); const FN = { lighting: /(\bSTL\b|[-_]STL[-_]|light|ltg|إنارة|انارة)/i, storm: /(storm|\bSTW\b|[-_]STW[-_]|rain|catch.?basin|سيول|أمطار|امطار)/i, sewer: /(\bSEW\b|[-_]SEW[-_]|sewer|sanitary|صرف)/i, water: /(water|[-_]WTR[-_]|مياه)/i, irrigation: /(\bIRR\b|[-_]IRR[-_]|irrigation|ري)/i }; const byName = Object.keys(FN).find(k => sc[k] != null && FN[k].test(fn)); if (byName) return byName; const best = Object.keys(sc).sort((a, b) => sc[b] - sc[a])[0]; return sc[best] > 0 ? best : 'water'; };
  GV.NETS = Object.keys(NET).map(k => ({ id: k, name: NET[k].name, p: NET[k].p }));
  GV.orgSetNet = k => { if (!NET[k]) return; GV.store.set('gv_orgnet', k); GV.sources.forEach(s => s.layers.forEach(l => { l._cat = null; if (s.isCad && l.leaf) GV.rebuild(l); })); GV.refreshLabels(); };
  GV.orgElementOf = (txt, net) => { const N = NET[net || GV.store.get('gv_orgnet') || 'water']; const t = String(txt || ''); const e = N.el.find(x => x[2] === 'point' && x[3].test(t)); if (!e) return null; let code = N.p + '-' + e[0]; let label = e[1]; if (e[0] === 'VALV') { const v = VTYPE.find(([k, re]) => re.test(t)); if (v) { code += '-' + v[0]; label += ' ' + v[0]; } } return { code, label }; };
  GV.orgCategories = () => { const net = GV.store.get('gv_orgnet') || 'water'; return { network: net, prefix: NET[net].p, options: catOptions(net).map(o => o[0] + ' = ' + o[1]) }; };
  GV.orgClassify = l => catOf(l);
  const prevLoaded = GV.onCadLoaded;
  GV.onCadLoaded = (src, force) => { if (!force && !src.orgOut && src.netOnly == null) netOnly(src, true, true); return prevLoaded && prevLoaded(src, force); };
  $('#btnOrg').addEventListener('click', open);
  GV.openOrg = open;
})();
