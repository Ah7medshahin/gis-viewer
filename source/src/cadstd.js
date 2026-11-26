// CAD drawing standard for GIS → CAD: NCS-style layer names, APWA utility colour code, lineweight by diameter,
// existing assets screened + dashed, and engineering annotation per element type.
(function () {
  'use strict';
  const GV = window.GV;
  // APWA / ANSI Z535.1 uniform utility colour code (AutoCAD ACI)
  const DISC = {
    water: { code: 'C-WATR', aci: 5, name: 'مياه' }, irrigation: { code: 'C-IRRG', aci: 6, name: 'ري' }, sewer: { code: 'C-SSWR', aci: 3, name: 'صرف صحي' },
    storm: { code: 'C-STRM', aci: 94, name: 'أمطار' }, gas: { code: 'C-NGAS', aci: 2, name: 'غاز' }, lighting: { code: 'E-LITE', aci: 1, name: 'إنارة' },
    power: { code: 'E-POWR', aci: 1, name: 'كهرباء' }, telecom: { code: 'C-COMM', aci: 30, name: 'اتصالات' }
  };
  const discOf = (n, net) => /^w_|water|wtr|مياه/i.test(n) ? 'water' : /^stw|storm|strm|rain|catch|سيول|أمطار|امطار/i.test(n) ? 'storm' : /sewer|sswr|sanit|صرف/i.test(n) ? 'sewer' : /light|lite|pole|cabel|lsp|إنارة|انارة/i.test(n) ? 'lighting' : /irrig|irrg|\bri\b/i.test(n) ? 'irrigation' : /gas|ngas/i.test(n) ? 'gas' : /telec|comm|fiber|fibre/i.test(n) ? 'telecom' : /power|powr|mv|lv/i.test(n) ? 'power' : (net && DISC[net] ? net : 'water');
  const MAJOR = { MAIN: 'MAIN', FORC: 'FORC', SERV: 'SERV', VALV: 'VALV', FITT: 'FITT', HYDT: 'HYDT', METR: 'METR', MHOL: 'MHOL', INSP: 'MHOL', INLT: 'INLT', OUTF: 'OUTF', CULV: 'CULV', POLE: 'POLE', CABL: 'CABL', PANL: 'PANL', MVCB: 'CABL', DUCT: 'DUCT', SUBS: 'SUBS' };
  // engineering annotation per element ({A|B} = first non-empty field, {LEN} = measured length)
  const ANNO = {
    water: { MAIN: ['Ø{DIAMETER} {MATERIAL}'], FORC: ['Ø{DIAMETER} {MATERIAL}'], SERV: null, VALV: ['{FEATURETYPE|VALVETYPE|TYPE}', 'Ø{DIAMETER}'], FITT: ['{FEATURETYPE|TYPE}', 'GL={GROUNDELEVATION|ELEVATION}'], HYDT: ['FH Ø{DIAMETER}'], METR: ['WM Ø{DIAMETER}'], MHOL: ['{FEATURETYPE|TYPE}', 'CL={COVERLEVEL|GROUNDELEVATION}'] },
    storm: { MAIN: ['Ø{DIAMETER|PIPE_SIZE} {MATERIAL}', 'L={LENGTH|LEN}m S={SLOPE}%'], SERV: ['Ø{DIAMETER}'], MHOL: ['{MANHOLE_ANNO|MH_ID|ID}', 'CL={COVER_LEVEL}', 'IL={INVERT_LEVEL}'], INLT: ['{CATCHBASIN_ANNO|CB_ID|CATCHBASIN_ID|ID}'], OUTF: ['OUTFALL', 'IL={INVERT_LEVEL}'] },
    sewer: { MAIN: ['Ø{DIAMETER} {MATERIAL}', 'L={LENGTH|LEN}m S={SLOPE}%'], FORC: ['Ø{DIAMETER} {MATERIAL}'], SERV: ['Ø{DIAMETER}'], MHOL: ['{MH_ID|MANHOLE_ANNO|ID}', 'CL={COVER_LEVEL|GROUNDELEVATION}', 'IL={INVERT_LEVEL}'] },
    lighting: { POLE: ['{ASSET_NUMBER|POLE_NO|ID}', '{POLE_TYPE} H={POLE_HEIGHT}m'], CABL: ['{CABEL_NUMBER|CABLE_NUMBER|ASSET_NUMBER}', '{NUMBER_OF_CONDUCTORS}Cx{CROSS_SECTIONAL_AREA|CABLE_SIZE}mm² L={LEN}m'], MAIN: ['{CABLE_SIZE|SIZE} L={LEN}m'], PANL: ['{PANEL_NAME|PANEL|NAME}'] },
    power: { CABL: ['{CABLE_SIZE|SIZE} L={LEN}m'], SUBS: ['{NAME|ID}'] },
    irrigation: { MAIN: ['Ø{DIAMETER} {MATERIAL}'], SERV: ['Ø{DIAMETER}'], VALV: ['{FEATURETYPE|TYPE}', 'Ø{DIAMETER}'] },
    gas: { MAIN: ['Ø{DIAMETER} {MATERIAL}'], VALV: ['{FEATURETYPE|TYPE}'] },
    telecom: { DUCT: ['{DUCT_TYPE|TYPE} {NO_OF_DUCTS}'] }
  };
  // colour per element (points) and per diameter class (pipes), so every item reads apart in the drawing and the legend
  const PT_ACI = { VALV: 200, HYDT: 2, FITT: 92, METR: 141, MHOL: 34, INSP: 34, INLT: 44, OUTF: 24, POLE: 3, PANL: 6, SUBS: 6 };
  const DIA_ACI = [[63, 4], [90, 140], [110, 3], [160, 5], [200, 30], [250, 210], [315, 6], [400, 40], [500, 174], [Infinity, 12]];
  const SERV_ACI = [[25, 150], [32, 120], [50, 82], [63, 62], [110, 52], [Infinity, 22]];
  const colorFor = (S, d) => { if (!S) return 7; if (S.status) return 8; if (!isFinite(d) || d <= 0) return S.aci; const T = S.el === 'SERV' ? SERV_ACI : S.byDia ? DIA_ACI : null; if (!T) return S.aci; return T.find(r => d <= r[0])[1]; };
  const lwForDia = d => !isFinite(d) || d <= 0 ? 35 : d <= 63 ? 18 : d <= 110 ? 25 : d <= 200 ? 35 : d <= 315 ? 50 : d <= 500 ? 70 : 100;
  const nk = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); const findKey = (p, k) => { const t = nk(k); return Object.keys(p).find(x => nk(x) === t); };
  function val(p, spec, len) {
    for (const k of spec.split('|')) {
      if (k === 'LEN') return len != null ? len.toFixed(2) : '';
      const kk = findKey(p, k); if (!kk) continue; let v = p[kk]; if (v == null || String(v).trim() === '' || /^null$/i.test(String(v))) continue;
      if (typeof v === 'number' || /^-?\d+\.\d{3,}$/.test(String(v))) { const n = +v; v = Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) >= 100 && !/LEVEL|ELEV|IL|CL/i.test(k) ? 1 : 2); }
      return String(v).trim();
    }
    return '';
  }
  // each space-separated token with an empty placeholder is dropped; a line with nothing left is dropped
  function annoLines(tpls, p, len) {
    const out = []; (tpls || []).forEach(t => { const toks = t.split(' ').map(tok => { let empty = false; const s = tok.replace(/\{([^}]+)\}/g, (_, k) => { const v = val(p, k.toUpperCase(), len); if (!v) empty = true; return v; }); return empty ? '' : s; }).filter(Boolean); if (toks.length && toks.some(x => /[0-9A-Za-z؀-ۿ]/.test(x))) out.push(toks.join(' ')); });
    return out;
  }
  // style for one GIS layer
  function style(layerName, sample, net, opts) {
    opts = opts || {}; const n = String(layerName || ''); const disc = discOf(n, net); const D = DISC[disc];
    let el = (GV.netElemOf && GV.netElemOf(n)) || null; if (!el) el = /line|pipe|network|cable|cabel/i.test(n) ? 'MAIN' : 'POINT';
    if (disc === 'lighting' && el === 'MAIN') el = 'CABL';
    const exist = /exist|قائم|old/i.test(n); const major = MAJOR[el] || el;
    const name = D.code + '-' + major; const status = exist ? '-EXST' : '';
    const dia = sample ? parseFloat(val(sample, 'DIAMETER|PIPE_SIZE', null)) : NaN;
    const isLine = /^(MAIN|FORC|SERV|CABL|DUCT|CULV|MVCB)$/.test(el);
    const lw = !isLine ? 13 : el === 'SERV' ? 18 : el === 'CABL' || el === 'DUCT' ? 25 : lwForDia(dia);
    return { disc, el, name, status, annoLayer: name + '-IDEN' + status, aci: exist ? 8 : (!isLine && PT_ACI[major]) || D.aci, lt: exist ? 'HIDDEN' : 'CONTINUOUS', lw, anno: (ANNO[disc] || {})[el] || null, byDia: isLine && el !== 'SERV' && el !== 'CABL' };
  }

  // full engineering label for a point (like the team's Civil 3D point labels): type, E, N, G.L, IL
  const FULL = { VALV: 1, FITT: 1, HYDT: 1, MHOL: 1, INSP: 1, OUTF: 1, SUBS: 1, PANL: 1 };
  const SHORT = { INLT: '{CATCHBASIN_ANNO|CB_ID|CATCHBASIN_ID|ID}', POLE: '{ASSET_NUMBER|POLE_NO|ID}' };
  const TYPE = { VALV: 'VALVE', FITT: 'FITTING', HYDT: 'FIRE HYDRANT', MHOL: 'MANHOLE', INSP: 'INSPECTION CHAMBER', OUTF: 'OUTFALL', SUBS: 'SUBSTATION', PANL: 'LIGHTING PANEL', METR: 'WATER METER', INLT: 'CATCH BASIN', POLE: 'LIGHTING POLE' };
  function pointLabel(S, p, xy, geographic, title, extra) {
    if (!S) return null; p = p || {}; extra = extra || [];
    const fmtV = v => { const n = +v; return String(v).trim() !== '' && isFinite(n) && /\.\d{3,}/.test(String(v)) ? n.toFixed(Math.abs(n) >= 100000 ? 4 : /level|elev|il$|gl$/i.test('') ? 3 : 2) : String(v); };
    // the user's own label: the fields they ticked, in the order they ticked them (known ones get the short engineering prefix)
    if (extra.length) {
      if (S.el === 'FITT' && /saddle/i.test(val(p, 'FEATURETYPE|TYPE|SUBTYPE', null))) return null;
      const PFX = [[/^(x|e|easting|x_?coord(inate)?|coord_?x|point_?x)$/i, 'E=', 4], [/^(y|n|northing|y_?coord(inate)?|coord_?y|point_?y)$/i, 'N=', 4], [/^(ground_?elevation|ground_?level|gl|cover_?level|coverlevel|cl|z)$/i, 'G.L=', 2], [/^(elevation|elev|invert_?level|invertlevel|il|us_?pipe_?il|pipe_?elevation)$/i, 'IL=', 3]];
      const lines = extra.map(([k, v]) => { const m = PFX.find(q => q[0].test(k)); if (m) { const n = +v; return m[1] + (isFinite(n) && String(v).trim() !== '' ? n.toFixed(m[2]) : v); } if (/(^|_)?(feature_?type|valve_?type|type|subtype|subtype_?(cd|code))$/i.test(k) || /(id|no|num|number|anno|label|tag|code|name)$/i.test(k)) return String(title && /type$/i.test(k) ? title : v).toUpperCase(); return k.toUpperCase() + '=' + fmtV(v); });
      return { lines, box: true };
    }
    const isId = k => /(id|no|num|number|anno|label|tag|code|name)$/i.test(k) && !/street|district|road|contract|consult|manufact|zone|area|owner/i.test(k) || /اسم|رقم/.test(k); const exId = extra.filter(e => isId(e[0])).map(e => e[1]); const exOther = extra.filter(e => !isId(e[0])).map(e => e[0].toUpperCase() + '=' + e[1]);
    const ft = title || val(p, 'FEATURETYPE|VALVETYPE|TYPE|SUBTYPE', null);
    if (S.el === 'FITT' && /saddle/i.test(val(p, 'FEATURETYPE|TYPE|SUBTYPE', null) + ' ' + ft)) return null;
    if (FULL[S.el]) {
      const id = exId.length ? exId.join(' / ') : val(p, 'MANHOLE_ANNO|MH_ID|ASSET_NUMBER|ID_NO|NAME', null);
      const head = [id, ft || TYPE[S.el]].filter(Boolean).join(' - ').toUpperCase();
      const L = [head].concat(exOther);
      if (!geographic && xy) { L.push('E=' + (+xy[0]).toFixed(4)); L.push('N=' + (+xy[1]).toFixed(4)); }
      const gl = val(p, 'GROUNDELEVATION|COVER_LEVEL|COVERLEVEL|GROUND_LEVEL|GL|Z', null); if (gl) L.push('G.L=' + (+gl).toFixed(2));
      const il = val(p, 'INVERT_LEVEL|INVERTLEVEL|IL|ELEVATION|PIPE_ELEVATION|US_PIPE_IL', null); if (il && il !== gl) L.push('IL=' + (+il).toFixed(3));
      return { lines: L, box: true };
    }
    if (SHORT[S.el]) { const L = exId.length ? [exId.join(' / ')] : annoLines([SHORT[S.el]], p, null); L.push(...exOther); return L.length ? { lines: L, box: false } : null; }
    if (extra.length) return { lines: extra.map(e => e[1]), box: false };
    return null;
  }
  // legend row text for one group of features
  function legendName(S, key, props) {
    const mat = props ? val(props, 'MATERIAL', null) : '';
    if (S.el === 'SERV') return S.disc === 'storm' ? 'CATCH BASIN CONNECTION %%C' + key : 'HOUSE CONNECTION ' + key + ' MM' + (mat ? ' ' + mat : '');
    if (S.el === 'CABL') return 'CABLE ' + key;
    if (/^(MAIN|FORC|CULV)$/.test(S.el)) return '%%C' + key + (mat ? ' ' + mat : '') + ' PIPE';
    return String(key || TYPE[S.el] || S.el).toUpperCase();
  }
  GV.cadPointLabel = pointLabel; GV.cadLegendName = legendName; GV.cadTypeName = TYPE;
  GV.cadStyle = style; GV.cadAnnoLines = annoLines; GV.cadVal = val; GV.CAD_DISC = DISC; GV.cadLwForDia = lwForDia; GV.cadColor = colorFor;
})();
