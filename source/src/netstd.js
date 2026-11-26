/* Network standards library: components, structure and topology of each infrastructure network, taken from official /
   authoritative sources (SEC distribution planning standards, CST OSP technical standards, EXPRO national utility design aids,
   Esri Utility Network foundations, Jeddah Stormwater Design Manual, Gulf utility guidelines), plus the extra QC checks they imply.
   Every rule can be switched off (saved in localStorage gv_stdoff). Rules marked ask:1 wait for the user's decision. */
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const SRC = {
    sec: ['SEC DPS-02 Rev.02 — Design Guideline of Underground LV Network', 'https://pt.slideshare.net/RaymundCortez/dps-02-rev02'],
    secpil: ['SEC 31-SDMS-02A — LV Distribution Pillar (Mini-Pillar)', 'https://www.se.com.sa/-/media/1106385B680744368EDCD19AF5473058.ashx'],
    cst: ['CST — Rules & Technical Standards for ICT Infrastructure in New Developments (OSP, Annex A)', 'https://www.cst.gov.sa/ar/Decisionsoffers/Decisions/Documents/attach392_2.pdf'],
    expro: ['EXPRO — Utilities Design Aids (Water / Sewer / Storm / Irrigation design criteria templates)', 'https://expro.gov.sa/api/uploads/Utilities Design Aids.pdf'],
    esriW: ['Esri Water Utility Network Foundation (asset groups: System/Service valve, Hydrant, Fitting, Service connection)', 'https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-water-distribution-utility-network-foundation.htm'],
    esriS: ['Esri Sewer Utility Network Foundation (cleanout → lateral → gravity main rules, flow direction)', 'https://www.esri.com/arcgis-blog/products/utility-network/water/utility-network-wastewater-data'],
    esriSt: ['Esri Stormwater Utility Network Foundation (inlets, gravity mains, outfalls)', 'https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-stormwater-utility-network-foundation.htm'],
    esriG: ['Esri UPDM / Gas Utility Network (main → service tap → service → meter set; regulator stations)', 'https://doc.arcgis.com/en/arcgis-solutions/11.5/reference/other/UPDM_UtilityNetwork.html'],
    jed: ['Jeddah Stormwater Design Manual (MOMRA/Amanah, AECOM 2013)', 'https://www.scribd.com/document/707787257/Jeddah-AECOM-Stormwater-Design-manual-31-May-2013'],
    gulfS: ['Gulf sewerage design guidelines (ADSSC / Dubai Municipality 2025)', 'https://www.dm.gov.ae/wp-content/uploads/2025/01/comp-DM_Sewerage-Guidelines-F.24.01.25.pdf'],
    our: ['طريقة التسليم الفعلية (الداتا المسلّمة لـ NWC والأمانة + قواعد أحمد)', '']
  };
  // ---- the library: what each network is made of and how it must be connected
  const LIB = {
    water: { comp: 'خط رئيسي (Main) · توصيلة منزلية (Lateral/Service) · محابس (Gate/Butterfly/Air/Washout/PRV) · حنفيات حريق · قطع (Tee/Bend/Reducer/Cap/Saddle) · عدادات · غرف محابس',
      topo: ['المصدر/الخزان ← خطوط رئيسية (شبكة حلقية غالبًا) ← تفريعة (Saddle/Tee) ← توصيلة ← عداد', 'كل محبس/قطعة/عداد قاعد على vertex الخط', 'الحنفية بتتوصل بفرعة عليها محبس عزل', 'آخر الخط المفتوح لازم يقفل بـ Cap أو Washout أو حنفية'],
      src: ['esriW', 'expro', 'our'] },
    sewer: { comp: 'خط انحدار رئيسي · خط ضغط (Force main) · غرف تفتيش (Manhole) · كلين أوت رئيسي وفرعي · غرفة تفتيش منزلية (IC) · وصلة منزلية · واي (WYE) · محطة رفع · مخرج',
      topo: ['السريان بالجاذبية من فوق لتحت ← محطة رفع أو محطة معالجة', 'غرفة عند: أول الخط وآخره، تغيير القطر، تغيير الميل، تغيير الاتجاه، وكل تلاقي خطين رئيسيين', 'الوصلة المنزلية: من IC/كلين أوت منزلي جنب القطعة ← واي على الخط أو غرفة', 'القطر مايصغرش مع اتجاه السريان', 'أقصى مسافة بين غرفتين على الخط المستقيم بتزيد مع القطر'],
      src: ['esriS', 'gulfS', 'expro', 'our'] },
    storm: { comp: 'خط تصريف رئيسي (Trunk) · خط فرعي (Lateral) · غرف · مصايد/جالي (Inlet/Catch basin) · خط توصيل مصيدة · عبّارات · مخرج (Outfall)',
      topo: ['المصيدة ← خط توصيل ← غرفة أو الخط الرئيسي ← مخرج', 'غرف كل ≤ 100 م (أو حد معدات التنظيف) وعند تغيير القطر/الاتجاه/الميل؛ الأقطار ≥ 1500 مم ممكن لحد 250 م', 'أقل قطر في جدة: رئيسي 600 مم وفرعي 450 مم'],
      src: ['jed', 'esriSt', 'expro', 'our'] },
    power: { comp: 'محطة توزيع (Unit/Package 300–1500 kVA) · RMU · لوحة جهد منخفض · بيلر توزيع (Mini-pillar) · كابل جهد منخفض رئيسي 4×300 Al · كابل خدمة 4×185 / 4×70 Al · صندوق عدادات · كابل جهد متوسط 13.8/33 kV',
      topo: ['متوسط ← RMU ← محطة ← كابل 300 ← بيلر ← كابل خدمة 185/70 ← عداد', 'الشبكة المنخفضة شعاعية من طرف واحد (مفيش تغذية عكسية) — الحلقة مسموحة بموافقة وبنقطة فتح', 'البيلر: 2 مداخل (واحد كل جنب) + 5 مخارج', 'ممكن بيلرين ورا بعض للأحمال الخفيفة، وتوصيل مباشر من المحطة للأحمال الكبيرة'],
      src: ['sec', 'secpil'] },
    lighting: { comp: 'لوحة إنارة (Feeder pillar / SLP) · أعمدة (LP) · كابلات 4C (10/16/25/35 مم²) · أرضي',
      topo: ['اللوحة ← دواير ← كابل من عمود لعمود (كابل لكل باكية)', 'العمود على أقرب كابل بس، والكابلات المتوازية بتفضل منفصلة', 'كل مجموعة أعمدة لازم توصل للوحة'],
      src: ['our'] },
    telecom: { comp: 'دكت (HDPE ≥ 50 مم فيدر / ≥ 20 مم توزيع) · مايكرو دكت · مانهول ≥ 1200×1200 · هاندهول 600×600 · كابينة شارع (SC) · نقطة وصول (AP) · ODF عند حدود المخطط · دكت دخول للمبنى',
      topo: ['ODF عند الحدود ← فيدر (حلقة/مسارين) ← كابينة ← مانهول تجميع ← AP لكل قطعة ← المبنى', 'غرفة كل ≤ 250 م من الدكت', 'غرفة في حدود 5 م من أي لفة ≥ 90°', 'مايزيدش عن لفتين 90° بين غرفتين', 'الهاندهول ≤ 4 دكتات', 'AP على بعد ≤ 1 م من حد القطعة'],
      src: ['cst'] },
    gas: { comp: 'خط رئيسي (حسب الضغط) · خط خدمة · نقطة تفريع (Service tap) · محابس · منظم/محطة تخفيض · طقم عداد (Meter set)',
      topo: ['محطة/منظم ← رئيسي ← Service tap ← خط خدمة ← عداد', 'تغيير الضغط بيحصل عند منظم بس'],
      src: ['esriG'] },
    irrigation: { comp: 'خط رئيسي مضغوط (Mainline) · محبس تحكم/سولينويد في صندوق · خط فرعي (Lateral/Dripline) · نقاط ري (Emitter/Bubbler/Sprinkler) · كنترولر · محبس رئيسي · غسيل',
      topo: ['المصدر ← رئيسي (مضغوط دايمًا) ← محبس تحكم ← فرعي ← نقاط ري', 'الفرعي مايتوصلش بالرئيسي غير من خلال محبس'],
      src: ['expro'] }
  };
  // ---- the extra checks (id, network(s), severity, Arabic title, source, ask = needs Ahmed's decision)
  const RULES = [
    { id: 'S_SPACING', def: false, nets: ['sewer'], sev: 'warn', t: 'المسافة بين غرفتين أكبر من المسموح للقطر', d: '≤ 600 مم: 100 م · ≤ 1200 مم: 120 م · أكبر: 150 م', src: 'gulfS' },
    { id: 'ST_SPACING', nets: ['storm'], sev: 'warn', t: 'المسافة بين غرفتين أكبر من المسموح (تصريف أمطار)', d: '< 1500 مم: 100 م · ≥ 1500 مم: 250 م', src: 'jed' },
    { id: 'G_MAINJUNC', nets: ['storm'], sev: 'warn', t: 'خطين رئيسيين بيتلاقوا من غير غرفة', d: 'التلاقي بين خطين رئيسيين لازم يبقى في غرفة. في الصرف التلاقي على واي مسموح (قرار أحمد) فالقاعدة دي للأمطار بس', src: 'gulfS' },
    { id: 'S_MHJUNC', nets: ['sewer'], sev: 'err', t: 'مواسير جاية من شوارع مختلفة بتتقابل من غير منهول', d: 'نفس الشارع بين منهولين ومتوصل بواي = عادي. لو 3 مواسير أو أكتر، أو ماسورتين بزاوية أكبر من 30° أو أسامي شوارع مختلفة = لازم منهول (قرار أحمد)', src: 'our' },
    { id: 'G_FLOWLOOP', nets: ['sewer', 'storm'], sev: 'err', t: 'اتجاه السريان بيلف في دايرة', d: 'مواسير الجاذبية لازم تمشي في اتجاه واحد لحد المخرج — الدايرة معناها إن خط أو أكتر مرسوم بالعكس', src: 'our' },
    { id: 'G_FLOWHEAD', nets: ['sewer', 'storm'], sev: 'err', t: 'سريان من اتجاهين بيتقابل ومفيش خروج', d: 'ماسورتين أو أكتر داخلين على نقطة ومفيش ولا ماسورة خارجة منها (ومش مخرج/محطة رفع) — غالبًا واحدة منهم معكوسة', src: 'our' },
    { id: 'G_FLOWOUT', nets: ['sewer', 'storm'], sev: 'warn', t: 'السريان مش بيوصل لمخرج الشبكة', d: 'لو مشيت مع اتجاه السريان من الماسورة دي بتقف عند نهاية تانية غير المخرج الرئيسي للشبكة', src: 'our' },
    { id: 'H_BACKFLOW', nets: ['sewer', 'storm'], sev: 'err', t: 'ارتداد: المنسوب اللي بيستقبل أعلى من اللي بيصب فيه', d: 'في اتجاه السريان كل نقطة لازم تكون أوطى من اللي جاية منها: منهول ← واي ← منهول، IC/كلين أوت ← الخط الرئيسي، كاتش بيزن ← المنهول', src: 'our' },
    { id: 'H_FLAT', nets: ['sewer', 'storm'], sev: 'err', t: 'ميل صفر في شبكة جاذبية', d: 'المنسوب اللي جاي منه السريان زي اللي رايح له بالظبط — في الصرف والسيول لازم يكون فيه ميل (قرار أحمد)', src: 'our' },
    { id: 'G_DIACHG', nets: ['sewer', 'storm'], sev: 'warn', t: 'تغيير قطر في نص الخط من غير غرفة', d: 'خطين ورا بعض بقطرين مختلفين ومفيش غرفة بينهم', src: 'gulfS' },
    { id: 'ST_MINDIA', def: false, nets: ['storm'], sev: 'info', t: 'قطر خط الأمطار أقل من الحد الأدنى', d: 'رئيسي < 600 مم أو فرعي < 450 مم (دليل جدة) — مقفولة: المشروع مش ماشي على دليل جدة', src: 'jed' },
    { id: 'W_HYDVALVE', nets: ['water'], sev: 'warn', t: 'فرعة حنفية الحريق مفيهاش محبس عزل', d: 'الحنفية بتتوصل بفرعة عليها محبس (Hydrant with service and valve)', src: 'esriW' },
    { id: 'P_PILLAR', nets: ['power'], sev: 'err', t: 'بيلر عليه كابلات أكتر من سعته', d: 'أقصى 7: مدخلين + 5 مخارج', src: 'secpil' },
    { id: 'P_VDROP', nets: ['power'], sev: 'warn', t: 'كابل جهد منخفض أطول من حد هبوط الجهد', d: '300 مم²: 295 م · 185: 276 م · 70: 201 م (5% عند السعة المؤكدة)', src: 'sec' },
    { id: 'P_SIZE', nets: ['power'], sev: 'info', t: 'مقطع كابل منخفض مش من مقاسات الشركة', d: 'القياسي: 4×300 رئيسي · 4×185 و 4×70 خدمة (ألومنيوم)', src: 'sec' },
    { id: 'P_SOURCE', nets: ['power'], sev: 'err', t: 'مجموعة بيلرات/كابلات مش واصلة لمحطة', d: 'كل شبكة منخفضة لازم تتغذى من محطة توزيع', src: 'sec' },
    { id: 'P_LOOP', nets: ['power'], sev: 'warn', t: 'حلقة في شبكة الجهد المنخفض', d: 'الشبكة شعاعية من طرف واحد — الحلقة محتاجة موافقة ونقطة فتح', src: 'sec' },
    { id: 'T_SPAN', nets: ['telecom'], sev: 'warn', t: 'دكت أطول من 250 م من غير غرفة', d: 'إلا لو طريقة التمديد (Blowing) تسمح', src: 'cst' },
    { id: 'T_BEND', nets: ['telecom'], sev: 'warn', t: 'لفة ≥ 90° بعيدة عن الغرفة', d: 'لازم مانهول في حدود 5 م من أي لفة ≥ 90°', src: 'cst' },
    { id: 'T_BENDS2', nets: ['telecom'], sev: 'warn', t: 'أكتر من لفتين 90° بين غرفتين', d: 'الحد الأقصى لفتين 90° (أو ما يعادلها)', src: 'cst' },
    { id: 'T_HH4', nets: ['telecom'], sev: 'info', t: 'هاندهول داخل عليه أكتر من 4 دكتات', d: 'الهاندهول عادة ≤ 4 دكتات — لو أكتر يبقى مانهول', src: 'cst' },
    { id: 'G_SVCMETER', nets: ['gas'], sev: 'warn', t: 'خط خدمة غاز آخره مفيهوش عداد', d: 'Service tap ← خط خدمة ← Meter set', src: 'esriG' },
    { id: 'I_LATVALVE', nets: ['irrigation'], sev: 'warn', t: 'خط ري فرعي متوصل بالرئيسي من غير محبس تحكم', d: 'الفرعي بيبدأ من محبس التحكم (سولينويد) مش من الرئيسي مباشرة', src: 'expro' }
  ];
  const OFFK = 'gv_stdoff';
  const ONK = 'gv_stdon';
  const rd = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch (e) { return new Set(); } };
  // a rule is off when switched off, or when it is off by default (def:false) and not switched on
  const off = () => { const o = rd(OFFK), n = rd(ONK); RULES.forEach(r => { if (r.def === false && !n.has(r.id)) o.add(r.id); }); return o; };
  const setOff = s => { try { localStorage.setItem(OFFK, JSON.stringify([...s].filter(id => { const r = RULES.find(x => x.id === id); return !(r && r.def === false); }))); localStorage.setItem(ONK, JSON.stringify(RULES.filter(r => r.def === false && !s.has(r.id)).map(r => r.id))); } catch (e) { } };

  // ---- checks; h = helpers handed over by netqc.run
  function run(h) {
    const { net, L, P, lineNear, ptNear, endsAt, tol, near, A, diaOf, segD } = h; const OFF = off();
    const on = id => { const r = RULES.find(x => x.id === id); return r && r.nets.indexOf(net) >= 0 && !OFF.has(id); };
    const R = (id, x, detail) => { const r = RULES.find(q => q.id === id); A(r.sev, r.t, x, detail, { std: id, src: SRC[r.src][0] }); };
    const ends = ln => [ln.c[0], ln.c[ln.c.length - 1]];
    const mains = L.filter(x => x.el === 'MAIN' || x.el === 'FORC');
    const R1 = Math.max(tol, 0.5);
    const isStruct = p => /^(MHOL|INSP|CLNO|OUTF|INLT|CHMB)$/.test(p.el || '');
    if (net === 'sewer' || net === 'storm') {
      mains.forEach(m => {
        const d = diaOf(m.l, m.f) || 0;
        if (net === 'sewer' && on('S_SPACING')) { const lim = d && d > 1200 ? 150 : d > 600 ? 120 : 100; if (m.len > lim) R('S_SPACING', m, m.len.toFixed(1) + ' م والحد ' + lim + ' م لقطر ' + (d || '?') + ' مم'); }
        if (net === 'storm' && on('ST_SPACING')) { const lim = d >= 1500 ? 250 : 100; if (m.len > lim) R('ST_SPACING', m, m.len.toFixed(1) + ' م والحد ' + lim + ' م'); }
        if (net === 'storm' && on('ST_MINDIA') && d && d < 450) R('ST_MINDIA', m, d + ' مم');
        ends(m).forEach((c, k) => {
          const st = ptNear(c, R1, isStruct); if (st) return;
          if (on('G_MAINJUNC')) { const mid = lineNear(c, tol, ln => ln !== m && (ln.el === 'MAIN' || ln.el === 'FORC')); const oth = endsAt(c, tol, ln => ln.el === 'MAIN' || ln.el === 'FORC', m); if ((mid && !ends(mid.ln).some(e => Math.hypot(e[0] - c[0], e[1] - c[1]) <= tol)) || oth.length >= 2) R('G_MAINJUNC', m, (k ? 'آخر' : 'أول') + ' الخط'); }
          if (on('G_DIACHG') && k === m.c.length - 1 || on('G_DIACHG') && k === 1) { const oth = endsAt(c, tol, ln => ln.el === 'MAIN', m); if (oth.length === 1) { const d2 = diaOf(oth[0].ln.l, oth[0].ln.f); if (d && d2 && d !== d2) R('G_DIACHG', m, d + ' ← ' + d2 + ' مم'); } }
        });
      });
    }
    // ---- one flow direction for gravity networks (Ahmed: the whole network must run one way) ----
    if ((net === 'sewer' || net === 'storm') && (on('G_FLOWLOOP') || on('G_FLOWHEAD') || on('G_FLOWOUT'))) {
      const grav = mains.filter(m => m.el === 'MAIN'); const KN = c => Math.round(c[0] / 0.5) + ',' + Math.round(c[1] / 0.5);
      const nodes = new Map(); const node = c => { const k = KN(c); let o = nodes.get(k); if (!o) { o = { k, c, out: [], inn: [] }; nodes.set(k, o); } return o; };
      grav.forEach(m => { const a = node(m.c[0]), b = node(m.c[m.c.length - 1]); a.out.push(m); b.inn.push(m); m._a = a; m._b = b; });
      // a pipe can also end on another pipe's middle (WYE): treat that as flowing into the host pipe's end
      grav.forEach(m => { if (m._b.out.length) return; const e = m.c[m.c.length - 1]; const host = lineNear(e, tol, ln => ln !== m && ln.el === 'MAIN' && Math.hypot(ln.c[0][0] - e[0], ln.c[0][1] - e[1]) > 0.5 && Math.hypot(ln.c[ln.c.length - 1][0] - e[0], ln.c[ln.c.length - 1][1] - e[1]) > 0.5); if (host && host.ln._b) m._b2 = host.ln._b; });
      const isOutlet = c => !!ptNear(c, Math.max(tol, 0.5), p => /^(OUTF|LIFT|PUMP|STP|TRMT)/.test(p.el || ''));
      // loops: DFS on node graph
      if (on('G_FLOWLOOP')) { const st = new Map(); const rep = new Set();
        const next = n => n.out.map(m => m._b2 || m._b);
        const dfs = (n, path) => { st.set(n, 1); for (const m of n.out) { const t = m._b2 || m._b; const s2 = st.get(t); if (s2 === 1) { if (!rep.has(m)) { rep.add(m); R('G_FLOWLOOP', m, 'الماسورة دي بتقفل دايرة في اتجاه السريان'); } } else if (!s2) dfs(t); } st.set(n, 2); };
        try { nodes.forEach(n => { if (!st.get(n)) dfs(n); }); } catch (e) { /* very deep networks: skip */ } }
      if (on('G_FLOWHEAD')) nodes.forEach(n => { if (n.inn.length >= 2 && !n.out.length && !n.inn.some(m => m._b2) && !isOutlet(n.c)) R('G_FLOWHEAD', n.inn[0], n.inn.length + ' مواسير داخلة ومفيش خروج'); });
      if (on('G_FLOWOUT')) { // terminal sinks per connected network; the biggest catchment is the outlet, others are flagged
        const sinkOf = new Map(); const follow = n => { const seen = new Set(); let cur = n; while (cur && cur.out.length && !seen.has(cur)) { seen.add(cur); const m = cur.out[0]; cur = m._b2 || m._b; } return cur; };
        const cnt = new Map(); grav.forEach(m => { const sk = follow(m._b2 || m._b); sinkOf.set(m, sk); cnt.set(sk, (cnt.get(sk) || 0) + 1); });
        const main = [...cnt.entries()].sort((a, b) => b[1] - a[1]); const big = main.length ? main[0][1] : 0;
        main.slice(1).forEach(([sk, n]) => { if (isOutlet(sk.c) || n >= big * 0.25) return; const first = grav.find(m => sinkOf.get(m) === sk); if (first) R('G_FLOWOUT', first, n + ' ماسورة بتصب في نهاية جانبية بدل المخرج الرئيسي'); });
      }
    }
    // ---- hydraulic level logic (Ahmed): along the flow every receiving point must sit LOWER than what feeds it ----
    if ((net === 'sewer' || net === 'storm') && (on('H_BACKFLOW') || on('H_FLAT'))) {
      const RX = GV.deriveRE || {}; const kOf = (p, re) => re ? Object.keys(p || {}).find(k => re.test(k)) : null; const nv = v => { if (v == null || v === '') return null; const n = parseFloat(v); return isFinite(n) ? n : null; };
      const ptIL = p => { const pr = (p.f && p.f.properties) || {}; return nv(pr[kOf(pr, RX.pi)]); };
      const lnIL = (ln, end) => { const pr = ln.f.properties || {}; return nv(pr[kOf(pr, end ? RX.ei : RX.si)]); };
      const NAME = { MHOL: 'المنهول', INSP: 'الـ IC', CLNO: 'الكلين أوت', FITT: 'الواي', INLT: 'الكاتش بيزن', OUTF: 'المخرج' };
      const nm = p => p ? (NAME[p.el] || 'النقطة') : 'الخط';
      const R1 = Math.max(tol, 0.5); const seen = new Set();
      const cmp = (up, dn, upName, dnName, x, ctx) => { if (up == null || dn == null) return; const key = x.l.name + '#' + x.fi + '#' + ctx; if (seen.has(key)) return; seen.add(key);
        if (dn > up + 0.001) { if (on('H_BACKFLOW')) R('H_BACKFLOW', x, dnName + ' (' + dn.toFixed(2) + ') أعلى من ' + upName + ' (' + up.toFixed(2) + ') بـ ' + ((dn - up) * 100).toFixed(0) + ' سم — هيحصل ارتداد'); }
        else if (Math.abs(dn - up) <= 0.001 && on('H_FLAT')) R('H_FLAT', x, upName + ' = ' + dnName + ' = ' + up.toFixed(3) + ' — مفيش ميل'); };
      // 1) mains: node → node along the digitized flow (manhole → wye → manhole), using the points' inverts, else the pipe's own end levels
      L.filter(x => x.el === 'MAIN').forEach(m => {
        const a = m.c[0], b = m.c[m.c.length - 1]; const pa = ptNear(a, R1, p => ptIL(p) != null && /^(MHOL|INSP|CLNO|FITT|OUTF)$/.test(p.el || '')), pb = ptNear(b, R1, p => ptIL(p) != null && /^(MHOL|INSP|CLNO|FITT|OUTF)$/.test(p.el || ''));
        const up = pa ? ptIL(pa.p) : lnIL(m, 0), dn = pb ? ptIL(pb.p) : lnIL(m, 1);
        cmp(up, dn, pa ? nm(pa.p) + ' اللي جاي منه السريان' : 'أول الماسورة', pb ? nm(pb.p) + ' اللي بعده' : 'آخر الماسورة', m, 'main');
      });
      if (on('H_FLAT')) L.filter(x => x.el === 'MAIN' || x.el === 'SERV').forEach(x => { const pr = x.f.properties || {}; const k = kOf(pr, RX.slope); const v = k ? nv(pr[k]) : null; if (v === 0) { const key = x.l.name + '#' + x.fi + '#slope'; if (!seen.has(key)) { seen.add(key); R('H_FLAT', x, 'حقل ' + k + ' = 0'); } } });
      // 2) laterals / connection lines: the end on the main or the manhole is downstream; the house side (IC / clean-out) or the catch basin is upstream
      L.filter(x => x.el !== 'MAIN' && x.el !== 'FORC').forEach(s => {
        const e = [s.c[0], s.c[s.c.length - 1]];
        const onMain = e.map(c => lineNear(c, tol, ln => ln.el === 'MAIN')); const onMH = e.map(c => ptNear(c, R1, p => /^(MHOL|OUTF|FITT)$/.test(p.el || '') && ptIL(p) != null));
        let di = onMH[1] || onMain[1] ? 1 : onMH[0] || onMain[0] ? 0 : -1; if (di < 0) return; const ui = 1 - di;
        const upP = ptNear(e[ui], R1, p => ptIL(p) != null && /^(INSP|CLNO|INLT|FITT)$/.test(p.el || ''));
        const up = upP ? ptIL(upP.p) : lnIL(s, ui === 1);
        let dn = null, dnName = '';
        if (onMH[di] && ptIL(onMH[di].p) != null) { dn = ptIL(onMH[di].p); dnName = nm(onMH[di].p) + ' اللي بيصب فيه'; }
        else if (onMain[di]) { // the main's invert at the connection point, interpolated along the main between its start and end levels
          const mn = onMain[di].ln; const si = lnIL(mn, 0), ei = lnIL(mn, 1);
          if (si != null && ei != null) { let acc = 0, best = Infinity, at = 0; for (let i = 1; i < mn.c.length; i++) { const p0 = mn.c[i - 1], p1 = mn.c[i]; const sl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); const t = sl ? Math.max(0, Math.min(1, ((e[di][0] - p0[0]) * (p1[0] - p0[0]) + (e[di][1] - p0[1]) * (p1[1] - p0[1])) / sl / sl)) : 0; const d = Math.hypot(p0[0] + t * (p1[0] - p0[0]) - e[di][0], p0[1] + t * (p1[1] - p0[1]) - e[di][1]); if (d < best) { best = d; at = acc + t * sl; } acc += sl; }
            dn = si + (ei - si) * (mn.len ? at / mn.len : 0); dnName = 'الخط الرئيسي عند نقطة الصب'; } }
        if (up == null && lnIL(s, di === 1) != null && dn != null) { /* only the lateral's own end level is known: compare that */ }
        cmp(up, dn, upP ? nm(upP.p) : 'أول الوصلة', dnName || 'آخر الوصلة', s, 'lat');
        // the lateral's own downstream end must not sit below the main/manhole either? (that is fine: a drop) — only the upstream side matters
      });
      // 3) storm: catch basin → its manhole directly (no line)
      if (net === 'storm') P.filter(p => p.el === 'INLT' && ptIL(p) != null).forEach(p => { const mh = ptNear(p.c, 2, q => q.el === 'MHOL' && ptIL(q) != null); if (mh && !L.some(x => x.el !== 'MAIN' && [x.c[0], x.c[x.c.length - 1]].some(c => Math.hypot(c[0] - p.c[0], c[1] - p.c[1]) <= R1))) cmp(ptIL(p), ptIL(mh.p), 'الكاتش بيزن', 'المنهول اللي بيصب فيه', p, 'cb'); });
    }
    if (net === 'sewer' && on('S_MHJUNC')) {
      const SK = /^(street_?name|streetname|street|road_?name|اسم_?الشارع|الشارع)$/i;
      const stOf = ln => { const p = ln.f.properties || {}; const k = Object.keys(p).find(x => SK.test(x)); return k && p[k] != null && String(p[k]).trim() !== '' ? String(p[k]).trim() : null; };
      const dirAt = (ln, c) => { const a = ln.c, e0 = Math.hypot(a[0][0] - c[0], a[0][1] - c[1]) <= Math.max(tol, 0.5); const p0 = e0 ? a[0] : a[a.length - 1], p1 = e0 ? a[1] : a[a.length - 2]; return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); };
      const seen = new Set();
      mains.forEach(m => ends(m).forEach(c => {
        const key = Math.round(c[0] * 10) + ',' + Math.round(c[1] * 10); if (seen.has(key)) return; seen.add(key);
        if (ptNear(c, Math.max(tol, 0.5), isStruct)) return;
        const at = endsAt(c, Math.max(tol, 0.5), ln => ln.el === 'MAIN', null); const ms = [...new Set(at.map(x => x.ln))];
        const thru = lineNear(c, tol, ln => ln.el === 'MAIN' && ms.indexOf(ln) < 0); const n = ms.length + (thru ? 2 : 0);
        if (n < 2) return;
        let why = null;
        if (n >= 3) why = n + ' مواسير رئيسية بتتقابل في النقطة دي';
        else if (ms.length === 2) { let d = Math.abs(dirAt(ms[0], c) - dirAt(ms[1], c)) * 180 / Math.PI; if (d > 180) d = 360 - d; const defl = 180 - d; if (defl > 30) why = 'زاوية الانحراف ' + defl.toFixed(0) + '° (أكبر من 30°)'; const s1 = stOf(ms[0]), s2 = stOf(ms[1]); if (!why && s1 && s2 && s1 !== s2) why = 'شارعين مختلفين: ' + s1 + ' / ' + s2; }
        if (why) R('S_MHJUNC', ms[0], why);
      }));
    }
    if (net === 'water' && on('W_HYDVALVE')) {
      P.filter(p => p.el === 'HYDT').forEach(p => {
        const br = L.filter(x => x.el !== 'MAIN' && ends(x).some(c => Math.hypot(c[0] - p.c[0], c[1] - p.c[1]) <= R1));
        if (!br.length) return; // hydrant sits on the main itself
        const hasV = br.some(b => P.some(q => q.el === 'VALV' && lineNear(q.c, tol, ln => ln === b)) || ends(b).some(c => ptNear(c, R1, q => q.el === 'VALV')));
        if (!hasV) R('W_HYDVALVE', p, 'الفرعة ' + br[0].len.toFixed(1) + ' م ومفيش عليها محبس');
      });
    }
    if (net === 'power') {
      const cab = L.filter(x => x.el === 'CABL' || x.el === 'SERV' || x.el === 'MAIN');
      const sizeOf = x => { const pr = x.f.properties || {}; const t = [pr.CABLE_SIZE, pr.SIZE, pr.SECTION, pr.CROSS_SECTION, pr.TYPE, x.l.name].filter(v => v != null).join(' '); const m = /(?:\d\s*[xX×]\s*)?(\d{2,3})\s*(?:mm2|mm²|sq|مم)?/.exec(String(t).replace(/(\d)\s*[cC]\s*[xX×]/, '$1x')); const v = m ? +m[1] : null; return v && v >= 6 && v <= 630 ? v : null; };
      if (on('P_PILLAR')) P.filter(p => p.el === 'FPIL').forEach(p => { let n = 0; cab.forEach(x => ends(x).forEach(c => { if (Math.hypot(c[0] - p.c[0], c[1] - p.c[1]) <= Math.max(near, 0.5)) n++; })); if (n > 7) R('P_PILLAR', p, n + ' كابل'); });
      cab.forEach(x => { const s = sizeOf(x); if (!s) return; if (on('P_SIZE') && [300, 185, 70].indexOf(s) < 0 && x.el !== 'MVCB') R('P_SIZE', x, s + ' مم²'); const lim = { 300: 295, 185: 276, 70: 201 }[s]; if (on('P_VDROP') && lim && x.len > lim) R('P_VDROP', x, x.len.toFixed(0) + ' م والحد ' + lim + ' م لـ ' + s + ' مم²'); });
      if (on('P_SOURCE') || on('P_LOOP')) {
        const nodes = cab.concat(P.filter(p => /FPIL|SUBS|RMU|PANL|METR/.test(p.el || ''))); const id = new Map(nodes.map((n, i) => [n, i])); const par = nodes.map((_, i) => i); const fd = i => par[i] === i ? i : (par[i] = fd(par[i]));
        let loops = []; const uni = (a, b, x) => { const ra = fd(a), rb = fd(b); if (ra === rb) { if (x) loops.push(x); } else par[ra] = rb; };
        // node per device; a cable joins its two ends
        cab.forEach(x => { const e = ends(x).map(c => { const p = ptNear(c, Math.max(near, 0.5), q => id.has(q)); return p ? id.get(p.p) : null; }); e.forEach(i => { if (i != null) uni(id.get(x), i); }); });
        if (on('P_LOOP')) { const par2 = nodes.map((_, i) => i); const f2 = i => par2[i] === i ? i : (par2[i] = f2(par2[i])); cab.forEach(x => { const e = ends(x).map(c => { const p = ptNear(c, Math.max(near, 0.5), q => id.has(q) && !/SUBS|PANL/.test(q.el || '')); return p ? id.get(p.p) : null; }); if (e[0] != null && e[1] != null && e[0] !== e[1]) { const a = f2(e[0]), b = f2(e[1]); if (a === b) R('P_LOOP', x, 'الكابل ده بيقفل حلقة بين بيلرات'); else par2[a] = b; } }); }
        if (on('P_SOURCE') && P.some(p => p.el === 'SUBS')) { const g = new Map(); nodes.forEach((n, i) => { const r = fd(i); if (!g.has(r)) g.set(r, { s: 0, first: null, n: 0 }); const o = g.get(r); if (n.el === 'SUBS') o.s++; if (n.el === 'FPIL' || n.el === 'METR') { o.n++; o.first = o.first || n; } }); g.forEach(o => { if (o.n && !o.s) R('P_SOURCE', o.first, o.n + ' عنصر (بيلر/عداد) متوصلين ببعض ومش واصلين لمحطة'); }); }
      }
    }
    if (net === 'telecom') {
      const ducts = L.filter(x => x.el === 'DUCT' || x.el === 'CABL' || x.el === 'MAIN');
      const ch = p => /MHOL|HHOL|CABN/.test(p.el || '');
      ducts.forEach(x => {
        if (on('T_SPAN') && x.len > 250) R('T_SPAN', x, x.len.toFixed(0) + ' م');
        if (on('T_BEND') || on('T_BENDS2')) {
          let n90 = 0; let far = null;
          for (let i = 1; i < x.c.length - 1; i++) { const a = x.c[i - 1], b = x.c[i], c = x.c[i + 1]; const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]]; const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2); if (l1 < 0.3 || l2 < 0.3) continue; const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / l1 / l2))) * 180 / Math.PI; if (ang >= 80) { n90++; if (!ptNear(b, 5, ch) && !far) far = b; } }
          if (on('T_BEND') && far) R('T_BEND', x, 'لفة ≥ 90° ومفيش غرفة في حدود 5 م');
          if (on('T_BENDS2') && n90 > 2) R('T_BENDS2', x, n90 + ' لفات');
        }
      });
      if (on('T_HH4')) P.filter(p => p.el === 'HHOL').forEach(p => { let n = 0; ducts.forEach(x => ends(x).forEach(c => { if (Math.hypot(c[0] - p.c[0], c[1] - p.c[1]) <= Math.max(near, 0.5)) n++; })); if (n > 4) R('T_HH4', p, n + ' دكت'); });
    }
    if (net === 'gas' && on('G_SVCMETER') && P.some(p => p.el === 'METR')) {
      L.filter(x => x.el === 'SERV').forEach(s => { const e = ends(s); const onMain = e.map(c => lineNear(c, tol, ln => ln.el === 'MAIN')); const far = onMain[0] ? e[1] : onMain[1] ? e[0] : null; if (far && !ptNear(far, R1, p => p.el === 'METR' || p.el === 'REGU')) R('G_SVCMETER', s); });
    }
    if (net === 'irrigation' && on('I_LATVALVE')) {
      L.filter(x => x.el === 'SERV').forEach(s => ends(s).forEach(c => { if (lineNear(c, tol, ln => ln.el === 'MAIN') && !ptNear(c, R1, p => p.el === 'VALV')) R('I_LATVALVE', s); }));
    }
  }

  // ---- viewer: "📚 معايير الشبكات"
  const sheet = el('div', 'sheet panel right'); sheet.id = 'stdSheet';
  sheet.innerHTML = '<div class="grab"></div><div class="sh-head"><h2>📚 معايير الشبكات</h2><button class="icon-btn" data-close>✕</button></div><div class="sh-body" id="stdBody"></div>';
  document.body.appendChild(sheet);
  sheet.querySelector('[data-close]').addEventListener('click', () => sheet.classList.remove('open'));
  function open(netSel) {
    const box = $('#stdBody'); box.textContent = '';
    const sel = el('select'); Object.keys(LIB).forEach(k => { const o = el('option', null, GV.NET_NAMES[k] || k); o.value = k; sel.appendChild(o); });
    sel.value = netSel || ($('#qcNet') && $('#qcNet').value) || 'water';
    const body = el('div');
    const draw = () => {
      body.textContent = ''; const k = sel.value; const L0 = LIB[k]; const OFF = off();
      body.appendChild(el('h3', null, 'المكونات')); body.appendChild(el('p', 'small', L0.comp));
      body.appendChild(el('h3', null, 'التركيب والطوبولوجي')); const ul = el('ul', 'small'); L0.topo.forEach(t => ul.appendChild(el('li', null, t))); body.appendChild(ul);
      body.appendChild(el('h3', null, 'القواعد اللي بيفحصها البرنامج (زيادة على الفحص الأساسي)'));
      RULES.filter(r => r.nets.indexOf(k) >= 0).forEach(r => {
        const row = el('label', 'std-rule'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !OFF.has(r.id);
        cb.onchange = () => { const s = off(); cb.checked ? s.delete(r.id) : s.add(r.id); setOff(s); };
        const tx = el('div'); tx.appendChild(el('b', null, (r.ask ? '❓ ' : '') + r.t)); tx.appendChild(el('div', 'muted small', r.d + ' — ' + SRC[r.src][0]));
        row.append(cb, tx); body.appendChild(row);
      });
      if (!RULES.some(r => r.nets.indexOf(k) >= 0)) body.appendChild(el('p', 'muted small', 'القواعد الأساسية للشبكة دي موجودة في الفحص العادي.'));
      body.appendChild(el('h3', null, 'المصادر'));
      L0.src.forEach(s => { const [n, u] = SRC[s]; const p = el('p', 'small'); if (u) { const a = el('a', null, n); a.href = u; a.target = '_blank'; a.rel = 'noopener'; p.appendChild(a); } else p.textContent = n; body.appendChild(p); });
    };
    sel.onchange = draw; box.append(sel, body); draw(); GV.openSheet('#stdSheet');
  }
  { const tools = document.querySelector('#toolsSheet .tools'); if (tools) { const b = el('button', 'tool'); b.innerHTML = '<span>📚</span><b>معايير الشبكات</b><small>مكونات وطوبولوجي كل شبكة ومصادرها الرسمية</small>'; b.onclick = () => open(); tools.appendChild(b); } }
  const st = document.createElement('style'); st.textContent = '.std-rule{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)}.std-rule input{margin-top:4px}#stdBody h3{margin:14px 0 6px;font-size:15px}#stdBody ul{padding-inline-start:18px;margin:0}#stdBody select{width:100%;margin-bottom:6px}';
  document.head.appendChild(st);
  GV.netStd = { run, open, LIB, RULES, SRC };
})();
