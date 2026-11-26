// Guided pipeline: CAD → check → tables to Excel → organize network layers → GIS per network type → topology & QC → report
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  let F = null; // {src, tables, tablesDone, checkW}

  function cadList() { return GV.sources.filter(s => s.isCad && !s.orgOut && !GV.superseded(s) && s.layers.some(l => l.features.length)); }
  function open() {
    const cs = cadList();
    if (!cs.length) return GV.showMsg('افتح ملف الكاد (DWG/DXF) الأول وحدد نظام الإحداثيات، وبعدين ارجع هنا.');
    if (!F || cs.indexOf(F.src) < 0) {
      if (cs.length > 1) { const box = $('#flowBody'); box.textContent = ''; box.appendChild(el('p', 'muted', 'اختار ملف الكاد:')); cs.forEach(s => { const b = el('button', 'crs-opt', s.name); b.onclick = () => { F = { src: s }; render(); }; box.appendChild(b); }); GV.openSheet('#flowSheet'); return; }
      F = { src: cs[0] };
    }
    render(); GV.openSheet('#flowSheet');
  }
  const orgNet = () => GV.sources.find(s => s.orgOut === F.src.name + '|net');
  const orgBg = () => GV.sources.find(s => s.orgOut === F.src.name + '|bg');
  const wsOut = () => GV.sources.find(s => s.wsOut);
  const tblSrc = () => GV.sources.find(s => s.flowTables === F.src.name);

  function step(n, title, state, desc, body) {
    const d = el('div', 'flow-step ' + state); const h = el('div', 'flow-h');
    h.append(el('span', 'flow-n', state === 'done' ? '✓' : String(n)), el('b', null, title));
    d.appendChild(h); if (desc) d.appendChild(el('p', 'small muted', desc)); if (body) d.appendChild(body); return d;
  }
  // one step open at a time, with back / next; done steps fold to one line
  function wizard(box, st, rerender) {
    const steps = Array.from(box.querySelectorAll('.flow-step')); if (!steps.length) return;
    let cur = st.focus != null && st.focus < steps.length ? st.focus : steps.findIndex(d => !d.classList.contains('done'));
    if (cur < 0) cur = steps.length - 1;
    const prog = el('div', 'flow-prog'); steps.forEach((d, i) => { const b = el('span', 'pdot' + (d.classList.contains('done') ? ' done' : '') + (i === cur ? ' cur' : '')); b.title = d.querySelector('.flow-h b').textContent; b.onclick = () => { st.focus = i; rerender(); }; prog.appendChild(b); });
    box.insertBefore(el('div', 'flow-where', 'الخطوة ' + (cur + 1) + ' من ' + steps.length + ' — ' + steps[cur].querySelector('.flow-h b').textContent), box.querySelector('.flow-step'));
    box.insertBefore(prog, box.querySelector('.flow-where'));
    steps.forEach((d, i) => {
      if (!d.classList.contains('done')) d.querySelector('.flow-n').textContent = String(i + 1);
      d.classList.remove('cur'); if (i === cur) d.classList.add('cur'); else d.classList.add('fold');
      d.querySelector('.flow-h').onclick = () => { st.focus = i; rerender(); };
      if (i === cur) { const nav = el('div', 'flow-nav'); if (i > 0) { const b = el('button', 'chip', '→ الخطوة اللي قبلها'); b.onclick = () => { st.focus = i - 1; rerender(); }; nav.appendChild(b); } if (i < steps.length - 1) { const n = el('button', 'chip', 'الخطوة اللي بعدها ←'); n.onclick = () => { st.focus = i + 1; rerender(); }; nav.appendChild(n); } d.appendChild(nav); }
    });
  }
  function acts(...bs) { const a = el('div', 'fc-acts'); bs.filter(Boolean).forEach(b => a.appendChild(b)); return a; }
  function btn(t, fn, main) { const b = el('button', main ? 'open-btn sm' : 'chip', t); b.onclick = fn; return b; }

  function render() {
    if (GV.superseded(F.src)) F.src = F.src.copyRef;
    const box = $('#flowBody'); box.textContent = '';
    const src = F.src;
    box.appendChild(el('p', 'small muted', '📄 ' + src.name + ' · 🔒 الأصل محفوظ، الشغل على نسخة'));
    const ab = el('div', 'auto-bar'); const ag = el('button', 'open-btn', F.autoLog ? '⚡ شغّل كله أوتوماتيك تاني' : '⚡ شغّل كله أوتوماتيك'); ag.onclick = auto; ab.append(ag, el('small', 'muted', 'بعمل كل الخطوات لوحدي (أعرف الشبكة، الجداول، التنظيم، التحويل، الفحص) وأوقف بس عند اللي محتاج قرارك'));
    if (!F.autoLog) box.appendChild(ab); else autoCard(box, F.autoLog, auto);
    const net = GV.store.get('gv_orgnet'); F.net = F.net || (F.askedNet ? net : null);
    const nb = el('div', 'net-pick'); (GV.NETS || []).forEach(n => { const b = el('button', 'chip' + (F.net === n.id ? ' on' : ''), n.name); b.onclick = () => { F.net = n.id; F.askedNet = true; GV.orgSetNet(n.id); F.focus = null; render(); }; nb.appendChild(b); });
    box.appendChild(step(0, 'السؤال الأول: الاسبليت/الملف ده خاص بشبكة إيه؟', F.net ? 'done' : 'cur', F.net ? 'شغالين على: ' + (GV.NETS.find(n => n.id === F.net) || {}).name + ' — التصنيف والتسمية والسكيما هيمشوا على كده.' : 'اختار نوع الشبكة عشان أعرف أفهم الكاد صح (المواسير الرئيسية والفرعية والمحابس…).', nb));
    if (!F.net) { wizard(box, F, render); return; }
    if (F.schema && GV.sources.indexOf(F.schema) < 0) F.schema = null;
    const bs = el('div');
    if (F.schema) bs.appendChild(el('p', 'small', '✓ هتتحول على السكيما بتاعتك: ' + F.schema.name + ' (' + F.schema.layers.length + ' فيتشر كلاس)'));
    bs.appendChild(acts(btn(F.schema ? 'غيّرها' : '📂 افتح الـ GDB/GPKG الفاضية بتاعتك', () => { GV.pendingMode = 'schema'; GV.pickData(); }, !F.schema), F.schema ? btn('استخدم سكيما شركة المياه الجاهزة بدلها', () => { F.schema = null; render(); }) : btn('مش معايا — استخدم الجاهزة (' + ((GV.NETS.find(n => n.id === F.net) || {}).name || '') + ')', () => { F.schemaChosen = true; F.focus = null; render(); })));
    box.appendChild(step('S', 'السكيما اللي هنحوّل عليها', F.schema || F.schemaChosen ? 'done' : 'todo', F.schema ? 'السكيما بتاعتك: ' + F.schema.name : (F.schemaChosen ? 'السكيما الجاهزة لـ ' + ((GV.NETS.find(n => n.id === F.net) || {}).name || '') : 'لو عندك GDB فاضية بالسكيما المطلوبة (الفيتشر كلاسز والحقول والدومينز) افتحها هنا، والتحويل هيمشي عليها بالظبط.'), bs));
    const hasCRS = src.layers.some(l => l.leaf);
    // 1. check
    if (!F.checkW && hasCRS) { try { F.checkW = GV.analyzeCad(src).W; } catch (e) { F.checkW = []; } }
    const W = F.checkW || []; const bad = W.filter(w => w.sev === 'err'), warn = W.filter(w => w.sev === 'warn');
    const b1 = el('div'); if (!hasCRS) b1.appendChild(el('p', 'err', 'الكاد ملوش نظام إحداثيات — اختاره من ⌖ جنب الطبقة في قايمة الطبقات.'));
    W.slice(0, 6).forEach(w => b1.appendChild(el('div', 'small', (w.sev === 'err' ? '⛔ ' : w.sev === 'warn' ? '⚠ ' : 'ℹ ') + w.title)));
    b1.appendChild(acts(btn('التفاصيل والتصليح', () => GV.onCadLoaded(src, true)), btn('🛠 إصلاح الكاد والسنابينج', () => GV.openFix({ cad: true, src })), btn('↻ افحص تاني', () => { F.checkW = null; render(); })));
    box.appendChild(step(1, 'فحص الكاد (السكيل، الإحداثيات، الوحدات)', !hasCRS || bad.length ? 'todo' : 'done', bad.length ? 'فيه ' + bad.length + ' مشكلة لازم تتصلح قبل ما تكمّل.' : (warn.length ? warn.length + ' تحذير — مش بيمنعوا التحويل.' : 'السكيل والإحداثيات تمام.'), b1));
    // 2. tables
    const b2 = el('div');
    if (!F.tables) b2.appendChild(acts(btn('🔍 دوّر على الجداول في الرسمة', () => { F.tables = GV.ctFindTables().filter(t => t.src === src); render(); }, true)));
    else if (!F.tables.length) {
      const nT = src.layers.reduce((a, l) => a + l.features.filter(f => f.properties && f.properties.Text != null).length, 0);
      const sk = (src.cadInfo && src.cadInfo.skipped) || {}; const tbl = Object.keys(sk).filter(k => /TABLE/i.test(k)).reduce((a, k) => a + sk[k], 0);
      b2.appendChild(el('p', 'small', 'ملقتش جداول نقط في الرسمة. (عدد النصوص اللي اتقرت: ' + nT.toLocaleString('en') + ')'));
      if (tbl) b2.appendChild(el('p', 'small hint', '⚠ فيه ' + tbl + ' جدول معمول بأمر TABLE في الأوتوكاد ومحتواه مش بيتقري من ملف الـ DWG ده. الحل: افتح نسخة من الملف في الأوتوكاد، اعمل EXPLODE للجدول، واحفظها DXF وافتحها هنا.'));
      else if (nT < 20) b2.appendChild(el('p', 'small hint', 'النصوص قليلة جدًا — غالبًا الجدول معمول TABLE أو كتابته جوه بلوك. جرّب تحفظ نسخة DXF من الأوتوكاد بعد EXPLODE للجدول.'));
      b2.appendChild(acts(btn('حدده بإيدك', () => GV.openCadTable())));
    }
    else {
      F.tables.forEach((t, i) => {
        const r = el('div', 'flow-tbl'); const tb = t.table;
        const roles = ['e', 'n', 'z', 'id', 'desc'].filter(k => tb.roles.includes(k)).map(k => ({ e: 'E', n: 'N', z: 'منسوب', id: 'رقم', desc: 'وصف' })[k]).join('، ');
        r.append(el('b', null, 'جدول ' + (i + 1) + (tb.title ? ' (' + tb.title.slice(0, 50) + ')' : '') + ': ' + tb.rows.length + ' صف × ' + tb.head.length + ' عمود' + (tb.stacked ? ' · اترصّ من ' + tb.stacked + ' أجزاء' : '')), el('small', 'muted', ' ' + (tb.head.slice(0, 6).join(' | ')) + (roles ? ' — اتعرف: ' + roles : '')));
        r.appendChild(acts(btn('راجعه/عدّله', () => GV.ctShow(tb)), !t.ole && btn('وريني مكانه', () => { const crs = GV.resolveCRS(String(t.table.crs || (F.src.layers.find(l => l.crsDef) || {}).crsDef)); if (!crs) return; const a = crs.fn(t.bbw[0]), c = crs.fn(t.bbw[1]); GV.closeSheets(); GV.map.fitBounds([[a[1], a[0]], [c[1], c[0]]], { padding: [40, 40] }); }), t.hasXY ? el('span', 'chip ok', '✓ فيه إحداثيات') : el('span', 'chip', 'من غير E/N')));
        b2.appendChild(r);
      });
      b2.appendChild(acts(btn('⤓ كل الجداول في ملف Excel واحد', saveTables, true), F.tables.some(t => t.hasXY) && btn('📍 حوّل جداول الإحداثيات لنقط GIS', tablesToGIS), btn('↻ دوّر تاني', () => { F.tables = null; render(); })));
    }
    { const sk = (src.cadInfo && src.cadInfo.skipped) || {}; const ole = Object.keys(sk).filter(k => /OLE/i.test(k)).reduce((a, k) => a + sk[k], 0), img = Object.keys(sk).filter(k => /IMAGE|WIPEOUT|PDFUNDERLAY|DWFUNDERLAY/i.test(k)).reduce((a, k) => a + sk[k], 0), tb = Object.keys(sk).filter(k => /TABLE/i.test(k)).reduce((a, k) => a + sk[k], 0);
      const oleN = GV.oleCount ? GV.oleCount(src) : 0;
      if (ole && oleN && !F.oleRead) { b2.appendChild(el('p', 'small hint', '📋 فيه ' + ole + ' جدول ملزوق من Excel جوه الكاد (OLE). أقدر أطلّعه من جوه الملف: لو Excel كامل بقراه على طول، ولو صورة Claude بيقراها.')); b2.appendChild(acts(btn('🖼 طلّع الجداول الملزوقة واقراها', () => readOle(src), true), btn('⤓ نزّلها صور', () => GV.oleSaveImages(src)))); }
      else if (ole && F.oleRead) b2.appendChild(el('p', 'small ok-note', '✓ الجداول الملزوقة (OLE): اتقرا منها ' + F.oleRead.n + ' جدول' + (F.oleRead.logos ? ' · ' + F.oleRead.logos + ' لوجو/صورة اتسابت' : '') + (F.oleRead.err ? ' · ' + F.oleRead.err + ' مقدرتش أقراه — نزّله صورة وابعتهولي أو هات الـ Excel' : '') + '.'));
      else if (ole) b2.appendChild(el('p', 'small hint', '⚠ فيه ' + ole + ' جدول/حاجة ملزوقة من Excel جوه الكاد (OLE) ومقدرتش أوصل لمحتواها. هات ملف الـ Excel نفسه أو سكرين في "📎 بيانات من ملفات".'));
      if (img) b2.appendChild(el('p', 'small hint', 'ℹ فيه ' + img + ' صورة/PDF ملزوق جوه الكاد — مش بيتقري. لو فيه جدول، هات سكرين منه في "📎 بيانات من ملفات".'));
      if (tb) b2.appendChild(el('p', 'small hint', '⚠ ' + tb + ' جدول TABLE مقدرتش أقرا محتواه من الـ DWG ده. على نسخة من الملف: EXPLODE للجدول واحفظ DXF، أو هات سكرين منه في "📎 بيانات من ملفات".'));
      if ((ole && !oleN) || img || tb) b2.appendChild(acts(btn('📎 بيانات من ملفات', () => GV.openAttrSrc())));
    }
    b2.appendChild(acts(btn('📍 النقط/البلوكات المرسومة ووصفها من الأنوتيشن ← Excel', () => GV.ctAllPoints()), btn('🔑 الليجند', () => GV.openLegend())));
    box.appendChild(step(2, 'جداول النقط والمناسيب والإحداثيات ← Excel', F.tablesDone ? 'done' : (F.tables ? 'cur' : 'todo'), 'بدوّر على أي جدول مرسوم (رقم، E، N، منسوب، وصف…) مهما كان نوعه، وبحوّله لشيت.', b2));
    // 3. organize
    const nets = orgNet(); const b3 = el('div');
    if (nets) b3.appendChild(el('p', 'small', '✓ ' + nets.layers.length + ' لير شبكة' + (orgBg() ? ' · ' + orgBg().layers.length + ' لير خلفية اتفصلوا' : '') + ' · ' + nets.layers.slice(0, 8).map(l => l.name).join('، ') + (nets.layers.length > 8 ? '…' : '')));
    b3.appendChild(acts(btn(nets ? 'افتح التنظيم تاني' : '🗂 صنّف ونظّم اللايرات', () => GV.openOrg(), !nets), nets && btn('⤓ كاد الشبكة المنظم (DXF)', () => GV.exportCadDxf(nets)), btn('🧠 Claude يصنّف', () => GV.aiAsk('شوف تصنيف لايرات الكاد (org_categories) وصحّح أي تصنيف غلط بـ propose_category بعد ما تبص على محتوى كل لير بنفسك (البلوكات والنصوص والخطوط).'))));
    box.appendChild(step(3, 'الخطوط والرموز ← لايرات واضحة (محابس، مواسير بالقطر، توصيلات…)', nets ? 'done' : 'todo', 'بيتعرف على مكونات الشبكة ويسمّيها تسمية قياسية، ويفصل قطع الأراضي والطرق والإطار في ملف خلفية.', b3));
    // 4. GIS
    const ws = wsOut(); const b4 = el('div');
    if (ws) b4.appendChild(el('p', 'small', '✓ ' + ws.name + ': ' + ws.layers.filter(l => l.features.length).map(l => l.name + ' (' + l.features.length + ')').join('، ')));
    if (!nets && !ws) b4.appendChild(el('p', 'small hint', '🔒 نضّف ونظّم الكاد في خطوة 3 الأول عشان التحويل يطلع مظبوط.'));
    const sch = GV.wsSchemas ? GV.wsSchemas() : [];
    const mySch = F.schema && sch.find(x => x.name === F.schema.name); const go4 = () => mySch ? mySch.go() : GV.wsStart(F.net);
    b4.appendChild(acts(btn(ws ? 'افتح التحويل تاني' : '🏗 حوّل' + (mySch ? ' على ' + F.schema.name : ' بسكيما ' + ((GV.NETS.find(n => n.id === F.net) || {}).name || '')), go4, !ws && !!nets), !nets && !ws && btn('كمّل برضه', go4), ws && btn('📎 كمّل البيانات من Excel/PDF/صور', () => GV.openAttrSrc(ws.layers.find(l => l.features.length && l.kind === 'point') || ws.layers.find(l => l.features.length))), ws && btn('⇄ صدّر GDB', () => $('#btnExport').click())));
    box.appendChild(step(4, 'التحويل لداتا GIS حسب نوع الشبكة (السكيما)', ws ? 'done' : 'todo', 'بيربط كل لير بالفيتشر كلاس بتاعه (W_MAINLINE، W_VALVE…) ويقرا القطر والمادة من النصوص. وممكن تستخدم الـ GDB الفاضي بتاعك.', b4));
    // 5. topology
    const q = GV.qcLast; const target = ws || nets; const b5 = el('div');
    if (q) { const sm = GV.qcSmart(); const e = sm.problems.filter(p => p.sev === 'err').length, w = sm.problems.filter(p => p.sev === 'warn').length; b5.appendChild(el('p', 'small', 'آخر فحص: ' + e + ' مشكلة لازم تتحل · ' + w + ' تحذير · ' + sm.questions.length + ' سؤال ليك')); }
    b5.appendChild(acts(btn('✔ افحص الطوبولوجي والاتصال وUtility Network', () => { if (!target) return GV.toast('اعمل خطوة 3 أو 4 الأول'); GV.openQC(target.layers); setTimeout(() => { const u = $('#qc_un'); if (u) u.checked = !!ws; }, 50); }, true), q && btn('النتايج', () => GV.openSheet('#qcResSheet')), q && btn('🛠 حل أوتوماتيك', () => GV.openFix())));
    box.appendChild(step(5, 'الطوبولوجي والاتصال والمناسيب', q ? 'done' : 'todo', 'Dangles، مش متوصل، محابس في نص الخط، تقاطعات، مناسيب، بيانات ناقصة — بقواعدك وأسئلتك.', b5));
    // 6. review & report
    box.appendChild(step(6, 'مراجعة Claude والتقرير النهائي', 'todo', 'Claude يبص على الشغل كله بنفسه، والتقرير فيه الكميات والمطلوب منك.', acts(btn('🧠 Claude يراجع كل حاجة', () => GV.aiAsk('راجع الشغل كله: الكاد الأصلي، الجداول، اللايرات المنظمة، والداتا اللي اتحولت GIS. قارن الأعداد والأطوال بين الكاد والـ GIS عشان تتأكد إن مفيش حاجة وقعت في التحويل، وشغّل الفحص، وقولي المطلوب مني قبل التسليم.'), true), btn('📊 الداشبورد والتقرير', () => $('#btnDash').click()))));
    wizard(box, F, render);
  }

  function withElem(tb) {
    const di = tb.roles.indexOf('desc'); const t2 = { head: tb.head.concat(['نوع العنصر', 'لير الكاد']), roles: tb.roles.concat(['', '']), rows: [] };
    tb.rows.forEach(r => { const txt = di >= 0 ? r[di] : r.filter(v => v && isNaN(+String(v).replace(/,/g, ''))).join(' '); const e = GV.orgElementOf(txt, F.net); t2.rows.push(r.concat([e ? e.label : '', e ? e.code : ''])); });
    return t2;
  }
  /* ---------- autopilot: do everything that doesn't need a decision, then show only what needs you ---------- */
  const tick = t => { $('#busy').classList.add('show'); $('#busyText').textContent = t; return new Promise(r => setTimeout(r, 30)); };
  async function auto() {
    if (F.running) return; F.running = true; const log = [];
    try {
      const src = F.src;
      if (!F.schema) F.schemaChosen = true;
      if (!F.net) { F.net = GV.orgGuessNet(src); F.askedNet = true; F.guessed = true; GV.orgSetNet(F.net); }
      const nn = (GV.NETS.find(n => n.id === F.net) || {}).name;
      log.push(['ok', 'نوع الشبكة: ' + nn + (F.guessed ? ' (اتعرف لوحده من أسماء اللايرات — غيّره لو غلط)' : '')]);
      await tick('بفحص الكاد…'); try { F.checkW = GV.analyzeCad(src).W; } catch (e) { F.checkW = []; }
      const bad = F.checkW.filter(w => w.sev === 'err'); log.push([bad.length ? 'need' : 'ok', bad.length ? 'فحص الكاد: ' + bad.length + ' مشكلة محتاجة قرارك (' + bad.map(w => w.title).slice(0, 2).join('، ') + ')' : 'فحص الكاد: السكيل والإحداثيات تمام']);
      await tick('بدوّر على الجداول…'); F.tables = GV.ctFindTables().filter(t => t.src === src);
      log.push([F.tables.length ? 'ok' : 'info', F.tables.length ? 'لقيت ' + F.tables.length + ' جدول (' + F.tables.reduce((a, t) => a + t.table.rows.length, 0) + ' صف) — جاهزين للـ Excel' : 'مفيش جداول نقط في الرسمة']);
      { const sk = (src.cadInfo && src.cadInfo.skipped) || {}; const ole = Object.keys(sk).filter(k => /OLE/i.test(k)).reduce((a, k) => a + sk[k], 0), tb = Object.keys(sk).filter(k => /TABLE/i.test(k)).reduce((a, k) => a + sk[k], 0); let oleLeft = ole; if (ole && GV.oleCount && GV.oleCount(src)) { await tick('بطلّع الجداول الملزوقة (OLE)…'); const r = await readOle(src, true); if (r) { if (r.n) log.push(['ok', 'الجداول الملزوقة من Excel (OLE): اتقرا منها ' + r.n + ' جدول — اتضافوا لجداول الكاد']); if (r.logos) log.push(['info', r.logos + ' صورة ملزوقة في الكاد طلعت لوجوهات/أختام — اتسابت']); oleLeft = r.err; } }
        if (oleLeft || tb) log.push(['need', (oleLeft ? oleLeft + ' جدول ملزوق من Excel (OLE) ' : '') + (tb ? tb + ' جدول TABLE ' : '') + 'مقدرتش أقرا محتواهم — هات الـ Excel أو سكرين في "📎 بيانات من ملفات"']); }
      await tick('بدوّر على الليجند…'); const lg = GV.legendAuto(src); F.legend = lg;
      log.push([lg ? 'ok' : 'info', lg ? 'لقيت الليجند: ' + lg.entries.length + ' رمز، ' + lg.entries.filter(e => e.code).length + ' منهم اتعرف نوعه — اتستخدم في التصنيف والقطر والمادة' : 'ملقتش ليجند في الرسمة']);
      if (F.tables.some(t => t.hasXY) && !tblSrc()) { await tick('بحوّل جداول الإحداثيات لنقط…'); await tablesToGIS(true); }
      await tick('بصنّف وأنظّم لايرات الكاد…');
      let og = orgNet(); let r3 = null; if (!og) { r3 = await GV.orgAuto(src); og = orgNet(); }
      const unk = orgBg() ? orgBg().layers.filter(l => /^X-UNKN/.test(l.name)).length : 0;
      if (r3 && r3.traced) log.push(['ok', 'Tracing: ' + r3.traced + ' خط في لايرات مش معروفة (' + r3.tracedLayers.join('، ') + ') بيعدّي على نقط الرفع بتاعة الشبكة — اتضم للشبكة']);
      log.push([unk ? 'info' : 'ok', og ? og.layers.length + ' لير شبكة' + (orgBg() ? ' · ' + orgBg().layers.length + ' خلفية اتفصلت' : '') + (unk ? ' · ' + unk + ' لير مش معروف اتحط مع الخلفية (مش هيطلع في ملف الشبكة)' : '') : 'التنظيم مااشتغلش']);
      await tick('بحوّل لـ GIS على السكيما…');
      let ws = wsOut(); if (!ws) { const r = await GV.wsAuto(F.net, F.schema); ws = r && r.src; F.wsReport = r && r.report; F.build = r && r.build; const B = F.build;
        if (B) { if (B.surveyMatched || B.surveyAdded) log.push(['ok', 'نقط الرفع: ' + B.surveyMatched + ' رمز اتنقل لإحداثيات جدول الرفع' + (B.surveyAdded ? ' · ' + B.surveyAdded + ' نقطة من الجدول ملهاش رمز اتضافت' : '')]);
          B.notes.filter(n => /اتنقل على الخط/.test(n)).forEach(n => log.push(['ok', n]));
          log.push(['ok', 'بناء الشبكة: ' + B.endsSnapped + ' طرف خط اتوصل بجهازه · ' + B.splits + ' تقسيم عند الأجهزة/Tee · ' + B.vertices + ' vertex عند نقط الاتصال']);
          if (B.nodesOff || B.danglingEnds) log.push(['need', 'لسه مش متوصل: ' + (B.nodesOff ? B.nodesOff + ' جهاز مش على أي خط' : '') + (B.nodesOff && B.danglingEnds ? ' · ' : '') + (B.danglingEnds ? B.danglingEnds + ' طرف خط سايب' : '') + ' — هتلاقيهم في الفحص']); } }
      if (ws) { const empty = ws.layers.filter(l => !l.features.length).length; log.push([empty ? 'info' : 'ok', 'التحويل: ' + ws.layers.filter(l => l.features.length).map(l => l.name + ' ' + l.features.length).join('، ') + (empty ? ' · ' + empty + ' كلاس فاضي' : '')]); }
      if (ws) {
        await tick('بفحص الطوبولوجي وقواعد ' + nn + '…');
        GV.openQC(ws.layers.filter(l => l.features.length)); $('#qcNet').value = F.net; 
        await GV.runQC(); GV.closeSheets();
        const sm = GV.qcSmart(); const e = sm.problems.filter(p => p.sev === 'err').length, w = sm.problems.filter(p => p.sev === 'warn').length;
        log.push([e || sm.questions.length ? 'need' : 'ok', 'الفحص: ' + e + ' مشكلة لازم تتحل · ' + w + ' تحذير · ' + sm.questions.length + ' سؤال ليك']);
      }
    } catch (e) { log.push(['need', 'وقفت عند: ' + (e.message || e)]); console.error(e); }
    finally { $('#busy').classList.remove('show'); F.running = false; }
    showOnly(); F.autoLog = log; result(); return;
    F.autoLog = log; const needCheck = log[1] && log[1][0] === 'need', needOrg = log.some(x => x[0] === 'need' && /مش متأكد/.test(x[1])), needQC = log.some(x => x[0] === 'need' && /^الفحص/.test(x[1]));
    F.focus = needCheck ? 2 : needOrg ? 4 : needQC ? 6 : null; render(); GV.openSheet('#flowSheet');
  }
  // map: show the final GIS result only, zoomed; the CAD stays loaded but hidden
  function showOnly(withCad) {
    const ws = wsOut(); if (!ws) return;
    GV.sources.forEach(s => { if (s === ws) s.layers.forEach(l => { if (l.features.length) GV.setVis(l, true); }); else if (s.id !== 'qc' && s.id !== 'field') s.layers.forEach(l => GV.setVis(l, !!withCad && s === orgNet())); s._fold = s === ws ? false : true; });
    GV.renderLayers(); GV.refreshLabels();
    let b = null; ws.layers.forEach(l => { if (l.leaf && l.features.length) { const bb = l.leaf.getBounds(); if (bb.isValid()) b = b ? b.extend(bb) : L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); } }); if (b) GV.map.fitBounds(b, { padding: [40, 40] });
  }
  /* ---------- the result: what came out, where it is, what was fixed, what is left ---------- */
  function result() {
    const box = $('#resBody'); box.textContent = '';
    const ws = wsOut(), og = orgNet(), bg = orgBg(), sm = GV.qcLast ? GV.qcSmart() : null; const nn = (GV.NETS.find(n => n.id === F.net) || {}).name || '';
    const sec = (t, cls) => { const d = el('div', 'res-sec ' + (cls || '')); d.appendChild(el('h3', null, t)); box.appendChild(d); return d; };
    box.appendChild(el('p', 'res-top', '📄 ' + F.src.name + ' → شبكة ' + nn));
    // 1. the database
    const s1 = sec('① الداتا بيز الجديدة (GIS)', 'main');
    if (!ws) s1.appendChild(el('p', 'err', 'التحويل مااتعملش — افتح "الخطوات بالتفصيل" وكمّل من خطوة التحويل.'));
    else {
      s1.appendChild(el('p', 'small muted', 'اسمها في قايمة الطبقات: "' + ws.name + '" — وهي اللي ظاهرة على الخريطة دلوقتي.'));
      const rep = F.wsReport || [];
      ws.layers.forEach(l => { const r = el('div', 'res-row' + (l.features.length ? '' : ' empty')); const nm = el('div'); nm.append(el('b', 'mono', l.name), el('small', 'muted', l.features.length ? ' · ' + l.features.length.toLocaleString('en') + ' عنصر' : ' · فاضي (مفيش حاجة في الكاد اتربطت بيه)'));
        const rp = rep.find(x => x.name === l.name); if (rp && rp.fill && rp.fill.length && l.features.length) { const fl = el('div', 'fill-list'); const fs = rp.fill.filter(x => x.p > 0).sort((a, b) => b.p - a.p); fs.slice(0, 8).forEach(x => fl.appendChild(el('span', 'fill ' + (x.p === 100 ? 'ok' : 'mid'), x.f + ' ' + x.p + '%'))); const z = rp.fill.length - fs.length; if (z) fl.appendChild(el('span', 'fill no', z + ' حقل لسه فاضي')); nm.appendChild(fl); }
        r.appendChild(nm); if (l.features.length) { const t = el('button', 'chip', '☰'); t.title = 'الجدول'; t.onclick = () => GV.openTable(l, true); r.appendChild(t); } s1.appendChild(r); });
      s1.appendChild(el('p', 'small muted', 'النسب = قد إيه الحقل اتملى (أخضر كامل · أصفر ناقص · أحمر فاضي).'));
      s1.appendChild(acts(btn('⤓ نزّلها GDB', () => GV.openExport(ws.layers), true), btn('🗺 شوفها على الخريطة', () => { showOnly(); GV.closeSheets(); }), btn('اعرض الكاد جنبها', () => { showOnly(true); GV.closeSheets(); })));
    }
    // 2. files
    const s2 = sec('③ ملفات تانية طلعت');
    const fr = (t, d, b) => { const r = el('div', 'res-row'); const x = el('div'); x.append(el('b', null, t), el('small', 'muted', ' ' + d)); r.append(x, b); s2.appendChild(r); };
    if (F.tables && F.tables.length) fr('جداول الكاد ← Excel', F.tables.length + ' جدول · ' + F.tables.reduce((a, t) => a + t.table.rows.length, 0) + ' صف', btn('⤓ Excel', saveTables));
    if (F.legend) fr('الليجند ← Excel', F.legend.entries.length + ' رمز ووصفه ونوعه', btn('⤓ Excel', () => GV.legendSave()));
    if (tblSrc()) fr('نقط الجداول (GIS)', tblSrc().layers.reduce((a, l) => a + l.features.length, 0) + ' نقطة — في قايمة الطبقات باسم "' + tblSrc().name + '"', btn('🗺', () => { tblSrc().layers.forEach(l => GV.setVis(l, true)); GV.renderLayers(); GV.closeSheets(); }));
    if (ws && ws.layers.some(l => l.features.length)) fr('تقرير الأودِت (زي تقرير ArcGIS Pro بتاعكم)', 'لكل طبقة وكل قطر: العدد، الطول، ACTUALLENGTH، الفجوات، الحقول الفاضية، Health Score', btn('⤓ Excel', async () => GV.saveFile('Unified_GIS_Audit_Report.xlsx', await GV.xlsx([{ name: 'Unified_GIS_Audit_Report', rows: GV.unifiedAudit(ws.layers.filter(l => l.features.length)) }]))));
    if (ws && GV.amanahHas && GV.amanahHas(ws.layers, F.net)) fr('Excel بنموذج الأمانة', 'نفس أعمدة نموذج ' + (F.net === 'storm' ? 'قاعدة بيانات السيول' : 'بيانات الإنارة') + ' + شيت يوضح كل عمود اتملى من أنهي حقل', btn('⤓ Excel', () => GV.amanahExport(ws.layers, F.net)));
    if (og) fr('كاد الشبكة المنظّم', og.layers.length + ' لير بأسماء واضحة', btn('⤓ DXF', () => GV.exportCadDxf(og)));
    if (bg) fr('كاد الخلفية', bg.layers.length + ' لير (قطع أراضي، طرق…) اتفصلوا', btn('⤓ DXF', () => GV.exportCadDxf(bg)));
    // 3. done automatically
    const s3 = sec('④ اتعمل لوحده ✓', 'ok');
    (F.autoLog || []).filter(x => x[0] !== 'need').forEach(x => s3.appendChild(el('div', 'auto-l ok', '✓ ' + x[1])));
    // 4. needs you
    const s4 = sec('② محتاج منك', 'need'); let n = 0;
    const todo = (t, b) => { n++; const r = el('div', 'res-todo'); r.append(el('span', 'res-n', String(n)), el('span', null, t), b); s4.appendChild(r); };
    (F.autoLog || []).filter(x => x[0] === 'need' && /(OLE|TABLE)/.test(x[1])).forEach(x => todo(x[1], btn('📎 هاتها', () => GV.openAttrSrc())));
    const bad = (F.checkW || []).filter(w => w.sev === 'err'); if (bad.length) todo('مشاكل في الكاد نفسه: ' + bad.map(w => w.title).slice(0, 2).join('، '), btn('شوف', () => GV.onCadLoaded(F.src, true)));
    const unk = orgBg() ? orgBg().layers.filter(l => /^X-UNKN/.test(l.name) && l.features.some(f => f.geometry && /Line/.test(f.geometry.type))) : []; if (unk.length > 0 && false) todo(unk.length + ' لير في الكاد مش عارف هو إيه: ' + unk.map(l => l.name.replace(/^X-UNKN-/, '')).slice(0, 3).join('، '), btn('صنّفهم', () => GV.openOrg()));
    const empt = ws ? ws.layers.filter(l => !l.features.length) : []; if (empt.length) todo('كلاسات فاضية في الداتا بيز: ' + empt.map(l => l.name).join('، ') + ' — لو المفروض فيها حاجة اربطها يدوي', btn('اربط', () => F.schema ? (GV.wsSchemas().find(x => x.name === F.schema.name) || { go: () => GV.wsStart(F.net) }).go() : GV.wsStart(F.net)));
    if (sm) { const e = sm.problems.filter(p => p.sev === 'err'); if (e.length) todo(e.length + ' مشكلة لازم تتحل (' + e.slice(0, 2).map(p => p.title || p.type).join('، ') + ')', btn('شوفها', () => GV.openSheet('#qcResSheet'))); if (sm.questions.length) todo(sm.questions.length + ' سؤال — جاوب بـ "طبيعي" أو "غلط"', btn('جاوب', () => GV.openSheet('#qcResSheet'))); const w = sm.problems.filter(p => p.sev === 'warn').length; if (w) todo(w + ' تحذير — بص عليهم', btn('شوف', () => GV.openSheet('#qcResSheet'))); }
    if (!n) s4.appendChild(el('p', 'ok-note', 'مفيش حاجة مستنياك 👌 — نزّل الداتا بيز والتقرير.'));
    box.insertBefore(s4, s2);
    // 5. original
    const s5 = sec('⑤ الأصل'); s5.appendChild(el('p', 'small', '🔒 ملف الكاد الأصلي "' + F.src.name.replace(/^نسخة شغل — /, '') + '" محفوظ زي ما هو ومخفي في قايمة الطبقات. مفيش حاجة اتعدلت فيه.'));
    box.appendChild(acts(btn('📊 التقرير (Excel)', () => $('#btnDash').click(), true), btn('🧭 الخطوات بالتفصيل', () => { F.focus = null; render(); GV.openSheet('#flowSheet'); }), btn('🧠 اسأل Claude عن النتيجة', () => GV.aiAsk('اشرحلي ببساطة اللي حصل في تحويل الكاد ده لـ GIS: الداتا بيز الجديدة فيها إيه، وإيه اللي ناقص، وإيه اللي لازم أعمله قبل التسليم.'))));
    GV.openSheet('#resSheet');
  }
  GV.openResult = () => { if (F && F.autoLog) result(); else open(); };
  function autoCard(box, log, again) {
    const c = el('div', 'auto-card'); c.appendChild(el('b', null, '⚡ اللي عملته لوحدي'));
    log.forEach(([k, t]) => c.appendChild(el('div', 'auto-l ' + k, ({ ok: '✓ ', need: '👉 ', info: 'ℹ ' })[k] + t)));
    const need = log.filter(x => x[0] === 'need').length; c.appendChild(el('p', 'small', need ? 'المحتاج منك متعلّم بـ 👉 — والخطوات تحت مفتوحة على أول حاجة محتاجاك.' : 'كله تمام — راجع النتيجة ونزّل التقرير.'));
    const a = el('div', 'fc-acts'); const rs = el('button', 'open-btn sm', '📦 النتيجة'); rs.onclick = result; const r = el('button', 'chip', '↻ أعد التشغيل'); r.onclick = again; a.append(rs, r); c.appendChild(a);
    box.insertBefore(c, box.firstChild.nextSibling);
  }
  async function saveTables() {
    const sheets = F.tables.map((t, i) => ({ name: 'جدول ' + (i + 1), rows: GV.ctRows(withElem(t.table)) }));
    const all = []; F.tables.forEach((t, i) => { const r = GV.ctRows(withElem(t.table)); if (!all.length) all.push(['الجدول'].concat(r[0])); r.slice(1).forEach(x => all.push(['جدول ' + (i + 1)].concat(x))); });
    if (F.tables.length > 1) { const hi = all[0].findIndex(h => /^(point|pt|no|id|رقم)/i.test(String(h).trim())); if (hi > 0) { const hd = all.shift(); all.sort((a, b) => GV.ctNatCmp(a[hi], b[hi])); all.unshift(hd); } sheets.unshift({ name: 'كل الجداول', rows: all }); }
    await GV.saveFile(F.src.name.replace(/\.(dwg|dxf)$/i, '') + '_tables.xlsx', await GV.xlsx(sheets));
    F.tablesDone = true; render();
  }
  async function readOle(src, quiet) {
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بطلّع الجداول الملزوقة من الكاد…';
    try { const r = await GV.oleReadTables(src); F.tables = F.tables || [];
      r.tables.forEach(o => { const t = o.t; F.tables.push({ table: t, src, ole: true, hasXY: t.roles.includes('e') && t.roles.includes('n'), hasZ: t.roles.includes('z'), score: 0 }); });
      F.oleRead = { n: r.tables.length, err: r.errors.length, logos: r.logos, msg: r.errors.map(e => e.err)[0] };
      if (!quiet && r.errors.length && !r.tables.length) GV.showMsg('مقدرتش أقرا الجداول الملزوقة:\n' + r.errors[0].err);
    } catch (e) { F.oleRead = { n: 0, err: 1, msg: e.message }; if (!quiet) GV.showMsg(e.message || String(e)); }
    finally { $('#busy').classList.remove('show'); }
    if (!quiet) render(); return F.oleRead;
  }
  async function tablesToGIS(quiet) {
    const crs = String((F.src.layers.find(l => l.crsDef) || {}).crsDef || '');
    // split the surveyed points by what their description says they are (GATE VALVE → valves, LP5 → poles …)
    const groups = new Map(); F.tables.filter(t => t.hasXY).forEach((t, i) => GV.ctToFeats(withElem(t.table)).forEach(f => { const code = f.properties['لير الكاد'] || ''; const k = code || 'نقط جدول ' + (i + 1); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }));
    const layers = Array.from(groups.entries()).map(([k, fs]) => ({ name: k, features: fs, crs: crs || null }));
    if (!layers.some(l => l.features.length)) return GV.toast('مفيش صفوف فيها إحداثيات صالحة');
    const old = tblSrc(); if (old) GV.removeSource(old);
    const added = await GV.addGroups([{ name: 'نقط جداول ' + F.src.name, type: 'CSV', layers }], { quiet: true, before: ad => { ad[0].flowTables = F.src.name; } });
    GV.renderLayers(); if (GV.onDirty) GV.onDirty();
    // compare table points with the drawing: how many fall on a CAD point/block within 0.05 m
    const pts = []; F.src.layers.forEach(l => l.features.forEach(f => { if (f.geometry && f.geometry.type === 'Point' && !f._sym && !(f.properties && f.properties.Text != null)) pts.push(f.geometry.coordinates); }));
    let hit = 0, tot = 0; added[0].layers.forEach(l => l.features.forEach(f => { tot++; const c = f.geometry.coordinates; if (pts.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.05)) hit++; }));
    F.tablesDone = true; if (quiet === true) return; render();
    GV.toast(tot + ' نقطة اتحولت GIS' + (pts.length ? ' · ' + hit + ' منهم فوق نقطة/بلوك في الرسمة' : ''), 5000);
  }
  /* ---------- GIS check & delivery flow ---------- */
  const gisSources = () => GV.sources.filter(s => !s.isCad && !s.isSchema && s.id !== 'qc' && s.id !== 'field' && !GV.superseded(s) && s.layers.some(l => l.features.length && l.kind !== 'table'));
  const G = {};
  function openGis(noOpen) {
    const box = $('#gflowBody'); box.textContent = '';
    const ss = gisSources();
    const b1 = el('div');
    if (!ss.length) b1.appendChild(acts(btn('📂 افتح GDB / SHP / GPKG', () => { GV.pendingMode = 'gis'; GV.pickData(); }, true)));
    else ss.forEach(s => b1.appendChild(el('div', 'small', '• ' + s.name + ' — ' + s.layers.filter(l => l.features.length).length + ' طبقة · ' + s.layers.reduce((a, l) => a + l.features.length, 0).toLocaleString('en') + ' عنصر' + (s.isCopy ? ' (نسخة شغل)' : ''))));
    box.appendChild(el('p', 'small', '🔒 الأصل مش بيتعدّل — أي حل بيتعمل على "نسخة شغل".'));
    box.appendChild(step(1, 'الداتا', ss.length ? 'done' : 'cur', null, b1));
    if (!ss.length) { if (noOpen !== true) GV.openSheet('#gflowSheet'); return; }
    const layers = ss.flatMap(s => s.layers.filter(l => l.features.length && l.kind !== 'table'));
    const gb = el('div', 'auto-bar'); const gnet = el('select', 'chip'); (GV.NETS || []).forEach(n => { const o = el('option', null, n.name); o.value = n.id; gnet.appendChild(o); }); gnet.value = GV.store.get('gv_orgnet') || 'water'; gnet.onchange = () => GV.store.set('gv_orgnet', gnet.value);
    const gg = el('button', 'open-btn', '⚡ افحص كله أوتوماتيك'); gg.onclick = async () => { await tick('بفحص الطوبولوجي وقواعد الشبكة…'); try { GV.openQC(layers); $('#qcNet').value = gnet.value;  await GV.runQC(); GV.closeSheets(); } finally { $('#busy').classList.remove('show'); } G.focus = null; openGis(); };
    gb.append(gg, gnet, el('small', 'muted', 'نوع الشبكة'));
    box.insertBefore(gb, box.children[1] || null);
    const q = GV.qcLast; const sm = q ? GV.qcSmart() : null;
    const b2 = el('div'); if (sm) { const e = sm.problems.filter(p => p.sev === 'err').length, w = sm.problems.filter(p => p.sev === 'warn').length; b2.appendChild(el('p', 'small', '⛔ ' + e + ' مشكلة لازم تتحل · ⚠ ' + w + ' تحذير')); }
    b2.appendChild(acts(btn(q ? '↻ افحص تاني' : '✔ افحص كل حاجة', () => { GV.openQC(layers); setTimeout(() => {  }, 50); }, !q), q && btn('النتايج', () => GV.openSheet('#qcResSheet'))));
    box.appendChild(step(2, 'الفحص (طوبولوجي + قواعد الشبكة + البيانات)', q ? 'done' : 'cur', 'بتختار دور كل طبقة (خطوط/نقط) وبعدين "افحص".', b2));
    box.appendChild(step(2.5, 'استكمال البيانات من ملفات (اختياري)', 'todo', 'لو عندك جداول Excel أو PDF أو سكرينات فيها الأقطار والمواد والمناسيب، هاتها وأنا أملى بيها الحقول الناقصة.', acts(btn('📎 هات الملفات', () => GV.openAttrSrc()))));
    const nq = sm ? sm.questions.length : 0;
    box.appendChild(step(3, 'أسئلة ليك (اللي "طبيعي" مش هيتحسب خطأ)', !q ? 'todo' : nq ? 'cur' : 'done', q ? (nq ? nq + ' سؤال مستني إجابتك' : 'مفيش أسئلة') : 'بعد الفحص', q && nq ? acts(btn('جاوب', () => GV.openSheet('#qcResSheet'), true)) : null));
    box.appendChild(step(4, 'الحل الأوتوماتيك', !q ? 'todo' : 'cur', 'سنابينج، رؤوس عند الوصلات، تقسيم، دابلكيت… وتقدر ترجع فيه.', q ? acts(btn('🛠 حل أوتوماتيك', () => GV.openFix(), true)) : null));
    box.appendChild(step(5, 'مراجعة Claude', 'todo', 'بيبص على السكيما والدومينز والقيم الشاذة والاتصال بنفسه.', acts(btn('🧠 راجع جاهزية التسليم', () => GV.aiAsk('راجع الطبقات المفتوحة كأنها هتتسلم لشركة المياه وتتحول Utility Network: السكيما والحقول الإجبارية والدومينز والقيم الشاذة والاتصال والمناسيب. شغّل run_qc مع utility_network وقولي المطلوب مني بالترتيب.')))));
    box.appendChild(step(6, 'التقرير والتصدير', 'todo', 'تقرير Excel فيه الكميات و"المطلوب منك"، وتصدير GDB.', acts(btn('📊 التقرير', () => $('#btnDash').click(), true), btn('⇄ صدّر GDB / SHP', () => $('#btnExport').click()), btn('🏛 Excel بنموذج الأمانة', () => { const ls = GV.sources.filter(s => !s.isSchema && s.id !== 'qc').flatMap(s => s.layers).filter(l => l.features.length); GV.amanahExport(ls, GV.amanahHas(ls, 'storm') && !GV.amanahHas(ls, 'lighting') ? 'storm' : (GV.amanahHas(ls, 'lighting') ? 'lighting' : null)); }))));
    wizard(box, G, () => openGis(true));
    if (noOpen !== true) GV.openSheet('#gflowSheet');
  }
  $('#btnGisFlow').addEventListener('click', openGis);
  GV.openGisFlow = openGis;
  GV.sheetRefresh = Object.assign(GV.sheetRefresh || {}, { '#resSheet': () => { if (F && F.autoLog) { result(); } }, '#gflowSheet': () => openGis(true), '#flowSheet': () => { if (F) render(); } });
  // home screen modes
  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.mode;
    if (m === 'field') return $('#btnTeam').click();
    GV.pendingMode = m === 'view' ? null : m; GV.pickData();
  }));
  const markSchema = s => { s.isSchema = true; s._fold = true; s.layers.forEach(l => GV.setVis(l, false)); GV.renderLayers(); };
  GV.afterOpen = added => {
    const m = GV.pendingMode; GV.pendingMode = null;
    const gdb = added.find(s => !s.isCad && /Geodatabase|GeoPackage/.test(s.type || ''));
    if (m === 'schema' && gdb) { markSchema(gdb); if (!F) { const cs = cadList(); if (cs.length) F = { src: cs[0] }; } if (F) { F.schema = gdb; F.focus = null; } return open(); }
    if (m === 'cad' && gdb && added.some(s => s.isCad)) { markSchema(gdb); F = null; open(); if (F) { F.schema = gdb; render(); if (F.src.layers.some(l => l.leaf)) setTimeout(auto, 300); } return; }
    if (m === 'cad' && added.some(s => s.isCad)) { F = null; open(); if (F && F.src.layers.some(l => l.leaf)) setTimeout(auto, 300); }
    else if (m === 'gis') openGis();
  };
  $('#btnResult').addEventListener('click', () => GV.openResult());
  // simplified dock
  const homeOff = () => document.body.classList.remove('show-home');
  $('#dkLayers').addEventListener('click', () => $('#btnLayers').click());
  $('#dkMore').addEventListener('click', () => $('#btnTools').click());
  $('#dkReport').addEventListener('click', () => $('#btnDash').click());
  $('#dkCheck').addEventListener('click', () => { if (F && F.autoLog) return GV.openResult(); const cs = cadList(); const hasGis = GV.sources.some(s => !s.isCad && !s.isSchema && s.id !== 'qc' && s.id !== 'field' && s.layers.some(l => l.features.length)); if (cs.length && !hasGis) return open(); openGis(); });
  $('#btnSaveT').addEventListener('click', () => $('#btnSave').click());
  document.querySelector('.brand').addEventListener('click', () => { if (document.body.classList.contains('has-data')) document.body.classList.toggle('show-home'); });
  $('#homeClose').addEventListener('click', homeOff);
  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', homeOff));
  { const lc = $('#layerCount'), dc = $('#dkCount'); new MutationObserver(() => { dc.textContent = lc.textContent; }).observe(lc, { childList: true, characterData: true, subtree: true }); dc.textContent = lc.textContent; }
  $('#btnFlow').addEventListener('click', open);
  GV.openFlow = open;
})();
