// Workspace persistence: auto-save to this device (IndexedDB) + to the user's account (artifact db + assets) for cross-device restore
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const VER = 1;
  let restoring = true, timer = null, saving = false, again = false, lastSaved = null, cloudOK = false;
  let auto = GV.store.get('gv_autosave') !== '0';

  /* ---------- IndexedDB ---------- */
  let idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise(res => {
      try { const r = indexedDB.open('gis-platform', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); }
    });
    return idbP;
  }
  async function iget(k) { const d = await idb(); if (!d) return null; return new Promise(r => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result == null ? null : q.result); q.onerror = () => r(null); } catch (e) { r(null); } }); }
  async function iset(k, v) { const d = await idb(); if (!d) return false; return new Promise(r => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => r(true); t.onerror = () => r(false); } catch (e) { r(false); } }); }
  async function idel(k) { const d = await idb(); if (!d) return; return new Promise(r => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => r(); t.onerror = () => r(); } catch (e) { r(); } }); }
  async function ikeys() { const d = await idb(); if (!d) return []; return new Promise(r => { try { const q = d.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); } catch (e) { r([]); } }); }

  /* ---------- cloud: Claude account (artifact) or GitHub private repo ---------- */
  async function cap(n) { try { if (!window.claude || !window.claude.use) return null; return await window.claude.use(n); } catch (e) { return null; } }
  let cloud = null;
  const ghCfg = () => { try { const c = JSON.parse(GV.store.get('gv_ghsync') || 'null'); return c && c.token && c.repo ? c : null; } catch (e) { return null; } };
  function b64(str) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(new Blob([str])); }); }
  function unb64(s) { const bin = atob(String(s).replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
  function ghCloud(cfg) {
    const base = 'https://api.github.com/repos/' + cfg.repo + '/contents/';
    const call = async (path, o = {}) => {
      const h = { Authorization: 'Bearer ' + cfg.token, Accept: o.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (o.body) h['Content-Type'] = 'application/json';
      const r = await fetch(base + path + (o.method ? '' : (path.includes('?') ? '&' : '?') + 't=' + Date.now()), { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined, cache: 'no-store' });
      if (r.status === 404 && !o.method) return null;
      if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) { } const e = new Error(r.status === 401 ? 'الكود (التوكن) غلط أو انتهى' : r.status === 403 || r.status === 404 ? 'التوكن مالوش صلاحية على الريبو ' + cfg.repo + ' (' + (m || r.status) + ')' : (m || ('GitHub ' + r.status))); e.code = r.status; throw e; }
      return o.raw ? r.text() : r.status === 204 ? {} : r.json();
    };
    const put = async (path, str, sha, msg) => { const body = { message: msg || 'sync', content: await b64(str) }; if (sha) body.sha = sha; return call(path, { method: 'PUT', body }); };
    let metaSha = null;
    return {
      kind: 'gh', label: 'GitHub (' + cfg.repo + ')',
      async getMeta() { const j = await call('ws.json'); if (!j) { metaSha = null; return null; } metaSha = j.sha; return JSON.parse(j.content ? unb64(j.content) : await call('ws.json', { raw: true })); },
      async putMeta(o) {
        const s = JSON.stringify(o);
        try { const r = await put('ws.json', s, metaSha, 'workspace ' + o.savedAt); metaSha = r.content.sha; }
        catch (e) { if (e.code !== 409 && e.code !== 422) throw e; const j = await call('ws.json'); metaSha = j ? j.sha : null; const r = await put('ws.json', s, metaSha, 'workspace ' + o.savedAt); metaSha = r.content.sha; }
      },
      async putLayer(key, str, prev) { const path = 'layers/' + key + '.json'; let sha = prev && prev.sha; let r; try { r = await put(path, str, sha, 'layer ' + key); } catch (e) { if (e.code !== 409 && e.code !== 422) throw e; const j = await call(path); r = await put(path, str, j && j.sha, 'layer ' + key); } return { cid: path, sha: r.content.sha }; },
      async getLayer(m) { return m.cid ? call(m.cid, { raw: true }) : null; },
      async delLayer(m) { if (m.cid && m.sha) await call(m.cid, { method: 'DELETE', body: { message: 'remove ' + m.key, sha: m.sha } }).catch(() => { }); },
      async clear() { const j = await this.getMeta(); if (j) { for (const m of j.layers || []) await this.delLayer(m); await call('ws.json', { method: 'DELETE', body: { message: 'clear', sha: metaSha } }).catch(() => { }); metaSha = null; } }
    };
  }
  function claudeCloud(db, assets, uid) {
    const ref = db.doc('data/users/' + uid + '/workspace');
    return {
      kind: 'claude', label: 'حسابك على Claude',
      async getMeta() { const d = await ref.get(); return d.exists ? d.data() : null; },
      async putMeta(o) { await ref.set(o); },
      async putLayer(key, str, prev) { if (str.length > 19.5 * 1048576) return { tooBig: true }; const a = await assets.upload(new Blob([str], { type: 'application/json' })); if (prev && prev.assetId) assets.delete(prev.assetId).catch(() => { }); return { assetId: a.id, url: a.url }; },
      async getLayer(m) { if (!m.url && !m.assetId) return null; const r = await fetch(m.url || ('/_blob/' + m.assetId)); return r.ok ? r.text() : null; },
      async delLayer(m) { if (m.assetId) assets.delete(m.assetId).catch(() => { }); },
      async clear() { const d = await this.getMeta(); if (d) { (d.layers || []).forEach(m => this.delLayer(m)); await ref.delete(); } }
    };
  }
  async function getCloud() {
    if (cloud !== null) return cloud;
    const g = ghCfg();
    if (g) return (cloud = ghCloud(g));
    const db = await cap('db'), user = await cap('user'), assets = await cap('assets');
    let uid = null; try { uid = user ? await user.id() : null; } catch (e) { }
    cloud = db && uid && assets ? claudeCloud(db, assets, uid) : false;
    return cloud;
  }
  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '.' + s.length.toString(36); }
  const DEV = GV.store.get('gv_dev') || (() => { const d = Math.random().toString(36).slice(2, 8); GV.store.set('gv_dev', d); return d; })();
  const seen = { get: () => GV.store.get('gv_cloudSeen') || '', set: v => GV.store.set('gv_cloudSeen', v || '') };
  const unsynced = { get: () => GV.store.get('gv_unsynced') === '1', set: v => GV.store.set('gv_unsynced', v ? '1' : '0') };

  /* ---------- serialize ---------- */
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  function snapshot() {
    const layers = [];
    GV.sources.forEach(s => {
      if (s.id === 'field' || s.id === 'qc') return;
      s.layers.forEach(l => {
        if (!l.saveKey) l.saveKey = 'L_' + rid();
        layers.push({ key: l.saveKey, src: s.name, srcType: s.type || '', srcKey: s.saveKey || (s.saveKey = 'S_' + rid()), sharedId: s.sharedId || null, name: l.name, crs: l.crsDef == null ? null : String(l.crsDef), color: l.color, cad: !!l.cad, visible: l.visible !== false, theme: l.theme && !l.isField && s.id !== 'qc' ? { field: l.theme.field, mode: l.theme.mode || 'auto' } : null, labelField: l.labelField || null, count: l.features.length, types: l.schemaTypes || null, sfields: l.schemaFields || null, kind: l.kind, wsOut: s.wsOut || null, orgOut: s.orgOut || null, isCopy: s.isCopy ? s.origName || '' : null, netOnly: s.netOnly == null ? null : s.netOnly, anno: s.anno === false ? false : true });
      });
    });
    const c = GV.map.getCenter();
    const lg = GV.lgState ? GV.lgState() : null;
    if (lg) layers.forEach(m => { const l = GV.sources.flatMap(s => s.layers).find(x => x.saveKey === m.key); m.grp = l ? lg.grpId(l) : ''; });
    return { v: VER, savedAt: new Date().toISOString(), view: { lat: c.lat, lng: c.lng, z: GV.map.getZoom() }, base: GV.getBase(), layers, groups: lg ? lg.groups.map(g => ({ id: g.id, name: g.name, keys: g.keys })) : undefined };
  }
  function layerData(l) {
    return JSON.stringify(l.features.map(f => { const o = { p: f.properties || {}, g: f.geometry || null }; if (f._color) o.c = f._color; if (f._sym) o.s = 1; if (f._ins) o.i = f._ins; return o; }));
  }

  /* ---------- save ---------- */
  function onDirty() {
    if (restoring || !auto) return;
    setState('pending');
    clearTimeout(timer); timer = setTimeout(saveNow, 2500);
  }
  GV.onDirty = onDirty;
  GV.map.on('moveend', onDirty);

  async function saveNow(manual) {
    if (saving) { again = true; return; }
    saving = true; clearTimeout(timer); timer = null; setState('saving');
    let ok = true, cloudErr = null, c = null;
    try {
      const snap = snapshot(); snap.dev = DEV;
      const live = new Map(); GV.sources.forEach(s => s.layers.forEach(l => { if (l.saveKey) live.set(l.saveKey, l); }));
      const prevLocal = await iget('ws'); const prevH = new Map(((prevLocal && prevLocal.layers) || []).map(m => [m.key, m.h]));
      const have = new Set(await ikeys()); const datas = new Map();
      for (const m of snap.layers) {
        const l = live.get(m.key); if (!l) continue;
        const d = layerData(l); m.h = hash(d); datas.set(m.key, d);
        if (!have.has('data:' + m.key) || prevH.get(m.key) !== m.h) await iset('data:' + m.key, d);
      }
      for (const s of GV.sources) if (s.isCad && s.cadInfo && s.cadInfo.blocks && s.saveKey) await iset('blk:' + s.saveKey, s.cadInfo.blocks);
      const localOK = await iset('ws', snap);
      for (const k of have) if ((k.startsWith('data:') && !snap.layers.some(m => 'data:' + m.key === k)) || (k.startsWith('blk:') && !snap.layers.some(m => 'blk:' + m.srcKey === k))) await idel(k);
      if (!localOK) ok = false;
      const sig = x => JSON.stringify([((x && x.layers) || []).map(m => Object.assign({}, m, { count: 0 })), (x && x.groups) || null]);
      const changed = !prevLocal || sig(prevLocal) !== sig(snap);
      if (changed) unsynced.set(true);
      c = await getCloud();
      if (c && (changed || unsynced.get() || manual)) {
        try {
          const pd = await c.getMeta();
          if (pd && pd.savedAt && seen.get() && pd.savedAt !== seen.get() && pd.dev !== DEV) { cloudErr = 'newer'; throw Object.assign(new Error('newer'), { soft: 1 }); }
          if (!snap.layers.length && pd && pd.layers && pd.layers.length) { throw Object.assign(new Error('empty'), { soft: 1 }); } // never wipe the synced work from an empty device
          const prev = new Map(((pd && pd.layers) || []).map(m => [m.key, m]));
          const cl = [];
          for (const m of snap.layers) {
            const o = Object.assign({}, m); const p = prev.get(m.key);
            if (p && p.h && p.h === m.h && (p.cid || p.assetId)) { ['cid', 'sha', 'assetId', 'url'].forEach(k => { if (p[k] != null) o[k] = p[k]; }); }
            else { const d = datas.get(m.key); if (d != null) Object.assign(o, await c.putLayer(m.key, d, p)); }
            cl.push(o);
          }
          await c.putMeta(Object.assign({}, snap, { layers: cl }));
          for (const [k, p] of prev) if (!cl.some(m => m.key === k)) await c.delLayer(p);
          seen.set(snap.savedAt); unsynced.set(false); cloudOK = true;
          if (cl.some(m => m.tooBig)) cloudErr = 'big';
        } catch (e) { if (!e.soft) { cloudErr = e && (e.message || e.code) || 'err'; cloudOK = false; } }
      }
      lastSaved = new Date();
      setState(ok ? 'saved' : 'error', cloudErr);
      if (cloudErr === 'newer') checkRemote(true);
      else if (manual) GV.toast(cloudErr ? 'اتحفظ على الجهاز ده' + (cloudErr === 'big' ? ' (فيه طبقة أكبر من 20 MB مش هتتزامن مع باقي أجهزتك)' : ' بس المزامنة وقفت: ' + cloudErr) : (c ? 'اتحفظ على الجهاز واتزامن ✓' : 'اتحفظ ✓'), 4000);
    } catch (e) { setState('error'); }
    saving = false;
    if (again) { again = false; saveNow(); }
  }

  /* ---------- restore ---------- */
  async function hydrate(snap, getData) {
    if (!snap || !snap.layers || !snap.layers.length) return false;
    const groups = new Map();
    for (const m of snap.layers) {
      let raw = null; try { raw = await getData(m); } catch (e) { raw = null; }
      if (raw == null) continue;
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const feats = arr.map(o => { const f = { type: 'Feature', properties: o.p, geometry: o.g }; if (o.c) f._color = o.c; if (o.s) f._sym = true; if (o.i) f._ins = o.i; return f; });
      if (!groups.has(m.srcKey)) groups.set(m.srcKey, { name: m.src, type: m.srcType, layers: [], meta: [], srcKey: m.srcKey, sharedId: m.sharedId });
      const g = groups.get(m.srcKey); g.layers.push({ name: m.name, features: feats, crs: m.crs, color: m.color, cad: m.cad }); g.meta.push(m);
    }
    if (!groups.size) return false;
    const gl = Array.from(groups.values());
    await GV.addGroups(gl, {
      noAsk: true, quiet: true, before: added => {
        added.forEach((s, i) => {
          const g = gl[i]; s.saveKey = g.srcKey; if (g.sharedId) s.sharedId = g.sharedId; if (s.isCad) iget('blk:' + g.srcKey).then(b => { if (b) s.cadInfo = Object.assign(s.cadInfo || {}, { blocks: b }); });
          s.layers.forEach((l, j) => {
            const m = g.meta[j]; l.saveKey = m.key; l.visible = m.visible; l.labelField = m.labelField; l.color = m.color || l.color; if (m.types) l.schemaTypes = m.types; if (m.sfields) l.schemaFields = m.sfields; if (!l.features.length && m.kind) l.kind = m.kind; if (m.wsOut) s.wsOut = m.wsOut; if (m.orgOut) s.orgOut = m.orgOut; if (m.isCopy != null) { s.isCopy = true; s.origName = m.isCopy; } if (m.netOnly != null) s.netOnly = m.netOnly; if (m.anno === false) s.anno = false;
            if (m.theme && l.leaf) { try { l.theme = GV.makeTheme(l, m.theme.field, m.theme.mode); l.theme.mode = m.theme.mode; } catch (e) { } }
            if (l.leaf && (m.theme || m.color)) { l.leaf = GV.buildLeaf(l); }
          });
        });
      }
    });
    GV.sources.filter(s => s.isCopy && s.origName).forEach(c => { const o = GV.sources.find(x => x.name === c.origName && !x.isCopy); if (o) { o.copyRef = c; o.isOrig = true; } }); GV.renderLayers();
    if (snap.groups && GV.lgApply) GV.lgApply(snap.groups, new Map(snap.layers.map(m => [m.key, m.grp || ''])));
    if (snap.base) GV.setBase(snap.base);
    if (snap.view) GV.map.setView([snap.view.lat, snap.view.lng], snap.view.z, { animate: false });
    GV.refreshLabels();
    return true;
  }
  async function restore() {
    const local = await iget('ws');
    const localP = local && local.layers && local.layers.length ? hydrate(local, m => iget('data:' + m.key)) : Promise.resolve(false);
    let restoredLocal = false;
    try { restoredLocal = await localP; } catch (e) { }
    if (restoredLocal) { lastSaved = new Date(local.savedAt); GV.toast('رجّعت شغلك اللي فات ✓'); }
    restoring = false;
    setState(lastSaved || restoredLocal ? 'saved' : 'idle');
    await checkRemote();
  }
  // Pull a newer workspace saved from another device. Automatic unless this device has its own unsynced changes.
  let checking = false;
  async function checkRemote(force) {
    if (checking || saving || restoring) return; checking = true;
    try {
      const c = await getCloud(); if (!c) return;
      let cd = null; try { cd = await c.getMeta(); } catch (e) { cloudOK = false; renderSaveSheet(e.message); return; }
      cloudOK = true;
      const hasLocal = GV.sources.some(s => s.id !== 'field' && s.id !== 'qc' && s.layers.length);
      if (!cd || !cd.layers || !cd.layers.length) { if (hasLocal && auto) onDirty(); return; }
      if (cd.savedAt === seen.get() && !force) return;
      if (!hasLocal) { await loadCloud(cd); return; }
      if (!seen.get() || unsynced.get()) { offerCloud(cd); return; }
      await loadCloud(cd, true);
    } finally { checking = false; }
  }
  GV.syncCheck = checkRemote;
  async function loadCloud(cd, silent) {
    const c = await getCloud(); if (!c) return;
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بجيب آخر نسخة من شغلك…';
    const view = { c: GV.map.getCenter(), z: GV.map.getZoom() };
    try {
      restoring = true;
      GV.sources.filter(s => s.id !== 'field').slice().forEach(s => GV.removeSource(s));
      const ok = await hydrate(cd, m => c.getLayer(m));
      if (silent) GV.map.setView(view.c, view.z, { animate: false });
      GV.sources.filter(s => s.isCopy && s.origName).forEach(c => { const o = GV.sources.find(x => x.name === c.origName && !x.isCopy); if (o) { o.copyRef = c; o.isOrig = true; } }); GV.renderLayers(); GV.updateEmpty();
      if (ok) GV.toast(silent ? '🔄 اتحدّث شغلك من جهازك التاني' : 'رجّعت شغلك من ' + c.label + ' ✓', 3500);
      seen.set(cd.savedAt); unsynced.set(false);
      restoring = false; await saveLocalOnly(cd.layers);
    } catch (e) { GV.showMsg('مقدرتش أجيب الشغل المتزامن: ' + (e.message || e)); }
    finally { restoring = false; $('#busy').classList.remove('show'); }
  }
  async function saveLocalOnly(hs) {
    const hm = new Map((hs || []).map(m => [m.key, m.h]));
    const snap = snapshot(); const live = new Map(); GV.sources.forEach(s => s.layers.forEach(l => { if (l.saveKey) live.set(l.saveKey, l); }));
    for (const m of snap.layers) { const l = live.get(m.key); if (l) { const d = layerData(l); m.h = hm.get(m.key) || hash(d); await iset('data:' + m.key, d); } }
    await iset('ws', snap); lastSaved = new Date(); setState('saved');
  }
  function offerCloud(cd) {
    const n = $('#syncOffer'); n.classList.add('show');
    $('#syncOfferTxt').textContent = 'فيه نسخة أحدث من شغلك اتحفظت من جهاز تاني (' + new Date(cd.savedAt).toLocaleString('en-GB') + ')، والجهاز ده كمان فيه تعديلات لسه ماتزامنتش. تحب تاخد أنهي؟';
    $('#syncOfferYes').onclick = () => { n.classList.remove('show'); loadCloud(cd); };
    $('#syncOfferNo').onclick = () => { n.classList.remove('show'); seen.set(cd.savedAt); onDirty(); };
  }

  /* ---------- sync setup (GitHub private repo) ---------- */
  function renderSync() {
    let box = $('#syncBox');
    if (!box) { const foot = $('#saveBody .fb-foot'); if (!foot) return; box = el('div'); box.id = 'syncBox'; box.style.cssText = 'border:1px solid var(--line,#ccd);border-radius:12px;padding:10px 12px;margin:10px 0;line-height:1.7'; foot.parentNode.insertBefore(box, foot); }
    if (window.claude && window.claude.use && !ghCfg()) { box.style.display = 'none'; return; }
    box.style.display = ''; box.innerHTML = '';
    const g = ghCfg();
    box.appendChild(el('b', '', '🔄 مزامنة بين أجهزتك (لابتوب + موبايل)'));
    if (g) {
      box.appendChild(el('div', 'muted small', (cloudOK ? '✅ متوصل' : '⚠️ متوصل بس آخر مزامنة ماكملتش') + ' — الريبو: ' + g.repo));
      const row = el('div', 'mp-btns');
      const now = el('button', 'chip', 'زامن دلوقتي'); now.onclick = async () => { await checkRemote(true); if (!$('#syncOffer').classList.contains('show')) saveNow(true); };
      const cp = el('button', 'chip', '📋 انسخ كود الربط لجهاز تاني'); cp.onclick = () => { const code = 'GVSYNC:' + btoa(JSON.stringify(g)); (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => GV.toast('اتنسخ — الصقه في نفس المكان على الجهاز التاني'), () => GV.askText ? GV.askText('انسخ الكود ده', code) : GV.showMsg(code)); };
      const off = el('button', 'chip danger', 'افصل المزامنة'); off.onclick = () => { GV.store.set('gv_ghsync', ''); cloud = null; seen.set(''); renderSaveSheet(); GV.toast('اتفصلت المزامنة على الجهاز ده (شغلك لسه موجود)'); };
      row.append(now, cp, off); box.appendChild(row); box.appendChild(wipeBtn()); return;
    }
    box.appendChild(el('div', 'muted small', 'الصق كود الربط (لو وصّلت جهاز قبل كده) أو اكتب اسم الريبو والتوكن:'));
    const inp = el('input'); inp.placeholder = 'كود الربط  أو  التوكن (github_pat_…)'; inp.style.cssText = 'width:100%;margin:6px 0;direction:ltr'; inp.autocomplete = 'off';
    const rp = el('input'); rp.placeholder = 'الريبو: Ah7medshahin/gis-data'; rp.value = (location.hostname.match(/^([^.]+)\.github\.io$/) ? location.hostname.split('.')[0] : 'Ah7medshahin') + '/gis-data'; rp.style.cssText = 'width:100%;margin:0 0 6px;direction:ltr';
    const go = el('button', 'chip done', 'وصّل'); const msg = el('div', 'small');
    go.onclick = async () => {
      let cfg = null; const v = inp.value.trim();
      if (/^GVSYNC:/.test(v)) { try { cfg = JSON.parse(atob(v.slice(7))); } catch (e) { } }
      else if (v) cfg = { token: v, repo: rp.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '') };
      if (!cfg || !cfg.token || !/^[^/\s]+\/[^/\s]+$/.test(cfg.repo || '')) { msg.textContent = 'الكود أو اسم الريبو مش مظبوط'; return; }
      go.disabled = true; msg.textContent = '⏳ بجرّب الاتصال…';
      try { const t = ghCloud(cfg); await t.getMeta(); GV.store.set('gv_ghsync', JSON.stringify(cfg)); cloud = t; seen.set(''); msg.textContent = '✅ اتوصل'; GV.toast('✅ المزامنة اشتغلت'); await checkRemote(true); if (!$('#syncOffer').classList.contains('show')) saveNow(true); renderSaveSheet(); }
      catch (e) { msg.textContent = '❌ ' + (e.message || e); go.disabled = false; }
    };
    box.append(inp, rp, go, msg, el('br'), wipeBtn());
  }
  // Wipe this device completely (e.g. before handing a work laptop back): nothing personal stays, the synced copy is untouched.
  async function wipeDevice() {
    for (const k of await ikeys()) await idel(k);
    try { Object.keys(localStorage).forEach(k => localStorage.removeItem(k)); } catch (e) { }
    try { sessionStorage.clear(); } catch (e) { }
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (e) { }
    try { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { }
    try { indexedDB.deleteDatabase('gis-platform'); } catch (e) { }
    location.replace(location.pathname + '?wiped=1');
  }
  let wipeArm = 0;
  function wipeBtn() {
    const armed = () => Date.now() - wipeArm < 8000;
    const w = el('button', 'chip danger', armed() ? '⚠️ متأكد؟ هيمسح كل حاجة من الجهاز ده بس — دوس تاني' : '🧹 امسح كل حاجة من الجهاز ده (قبل تسليمه)'); w.style.marginTop = '8px';
    w.title = 'بيمسح من الجهاز ده: الشغل المحفوظ، كود المزامنة، وكل الإعدادات. النسخة المتزامنة على حسابك بتفضل سليمة';
    w.onclick = () => { if (!armed()) { wipeArm = Date.now(); w.textContent = '⚠️ متأكد؟ هيمسح كل حاجة من الجهاز ده بس — دوس تاني'; return; } wipeArm = 0; w.textContent = '⏳ بيمسح…'; restoring = true; clearTimeout(timer); wipeDevice(); };
    return w;
  }
  setInterval(() => { if (!document.hidden && ghCfg()) checkRemote(); }, 90 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(checkRemote, 800); });

  /* ---------- UI ---------- */
  function setState(s, cloudErr) {
    const b = $('#btnSave'); b.dataset.state = s;
    const t = { idle: 'الحفظ', pending: 'فيه تغييرات…', saving: 'بيحفظ…', saved: 'محفوظ', error: 'مش محفوظ' }[s] || '';
    b.title = t; $('#saveDot').className = 'save-dot ' + s;
    renderSaveSheet(cloudErr);
  }
  function renderSaveSheet(cloudErr) {
    const box = $('#saveBody'); if (!box) return;
    const st = $('#btnSave').dataset.state;
    $('#saveStatus').textContent = st === 'saving' ? 'بيحفظ دلوقتي…' : st === 'pending' ? 'فيه تغييرات هتتحفظ كمان ثواني' : lastSaved ? 'آخر حفظ: ' + lastSaved.toLocaleTimeString('en-GB') : 'لسه متحفظش حاجة';
    $('#saveWhere').textContent = cloud ? (cloudOK ? 'على الجهاز ده ومتزامن مع ' + cloud.label + '. أي جهاز متوصل بنفس المزامنة بيشوف نفس الشغل لوحده.' : 'على الجهاز ده.' + (cloudErr && cloudErr !== 'big' && cloudErr !== 'newer' ? ' المزامنة مش شغالة دلوقتي: ' + cloudErr : '')) : 'على الجهاز ده بس. وصّل المزامنة تحت عشان شغلك يظهر على كل أجهزتك.';
    renderSync();
    $('#saveAuto').checked = auto;
  }
  $('#btnSave').addEventListener('click', () => { renderSaveSheet(); GV.openSheet('#saveSheet'); });
  $('#saveNow').addEventListener('click', () => saveNow(true));
  $('#saveAuto').addEventListener('change', e => { auto = e.target.checked; GV.store.set('gv_autosave', auto ? '1' : '0'); if (auto) onDirty(); });
  $('#saveClear').addEventListener('click', async () => {
    const b = $('#saveClear'); if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = 'متأكد؟ اضغط تاني'; return; }
    b.dataset.c = ''; b.textContent = 'امسح الشغل المحفوظ';
    for (const k of await ikeys()) await idel(k);
    seen.set(''); // local only: the copy synced to your other devices stays safe
    lastSaved = null; auto = false; GV.store.set('gv_autosave', '0'); setState('idle');
    GV.toast('اتمسح الشغل المحفوظ على الجهاز ده بس (النسخة المتزامنة سليمة)، والحفظ التلقائي اتقفل');
  });
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); saveLocalOnly(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); saveNow(); } });

  setState('idle');
  restore().catch(() => { restoring = false; });
})();
