/* After every bulk edit the app shows a SAMPLE of what changed (Ahmed: "always give me a sample of everything you edited
   so we're sure we work right"): up to 8 cases spread over the whole change, each zoomed on the map with its fields
   before → after, then "looks right" or "undo all". */
(function () {
  'use strict';
  const GV = window.GV; const { el } = GV;
  const idOf = f => { const p = (f && f.properties) || {}; for (const k of ['OBJECTID', 'objectid', 'FID', 'fid', 'OID']) if (p[k] != null) return p[k]; return ''; };
  const show = v => v == null || v === '' ? '—' : String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v);
  // items: [{ l, f, before: {..props}, after?: {..props}, note?, ll?: [lon,lat] }]
  GV.editSample = (title, items, undoFn) => {
    items = (items || []).filter(Boolean); if (!items.length) return;
    const n = Math.min(8, items.length); const smp = []; for (let k = 0; k < n; k++) smp.push(items[Math.floor(k * items.length / n)]);
    let k = 0; let w = document.getElementById('editSample'); if (w) w.remove(); w = el('div', 'qc-rev'); w.id = 'editSample';
    const head = el('div', 'qc-rev-h'); head.appendChild(el('b', null, '🔍 عينة للمراجعة — ' + title)); const cnt = el('span', 'muted small'); const x = el('button', 'icon-btn', '✕'); x.onclick = () => w.remove(); head.append(cnt, x);
    const body = el('div', 'small'); body.style.maxHeight = '38vh'; body.style.overflow = 'auto';
    const draw = () => {
      const it = smp[k]; cnt.textContent = 'مثال ' + (k + 1) + ' من ' + n + ' (من ' + items.length.toLocaleString('en') + ' تعديل)';
      body.textContent = ''; body.appendChild(el('div', null, (it.l ? it.l.name : '') + (idOf(it.f) !== '' ? ' · OBJECTID ' + idOf(it.f) : '') + (it.note ? ' · ' + it.note : '')));
      const a = it.after || (it.f && it.f.properties) || {}; const b = it.before || {};
      const keys = Object.keys(Object.assign({}, b, a)).filter(kk => String(b[kk]) !== String(a[kk]));
      if (keys.length) { const t = el('table', 'smp-t'); const hr = el('tr'); ['الحقل', 'قبل', 'بعد'].forEach(h => hr.appendChild(el('th', null, h))); t.appendChild(hr);
        keys.slice(0, 20).forEach(kk => { const r = el('tr'); r.append(el('td', null, kk), el('td', 'old', show(b[kk])), el('td', 'new', show(a[kk]))); t.appendChild(r); }); body.appendChild(t); }
      else if (!it.note) body.appendChild(el('div', 'muted', 'اتغيّر الرسم (الشكل/المكان) من غير ما الحقول تتغير'));
      let ll = it.ll ? L.latLng(it.ll[1], it.ll[0]) : null; if (!ll && it.f && it.f.wgs) { try { ll = L.geoJSON(it.f.wgs).getBounds().getCenter(); } catch (e) { } }
      if (ll) { GV.map.setView(ll, Math.max(GV.map.getZoom(), 19)); GV.markSel && GV.markSel(ll.lat, ll.lng); }
    };
    const nav = el('div', 'fc-acts');
    const pv = el('button', 'chip', '◀ اللي قبله'); pv.onclick = () => { k = (k + n - 1) % n; draw(); };
    const nx = el('button', 'chip', 'اللي بعده ▶'); nx.onclick = () => { k = (k + 1) % n; draw(); };
    const ok = el('button', 'chip ok', '✓ تمام كده'); ok.onclick = () => w.remove();
    nav.append(pv, nx, ok);
    if (undoFn) { const u = el('button', 'chip danger', '↶ تراجع عن الكل'); u.onclick = () => { w.remove(); const r = undoFn(); GV.toast('اتراجعت' + (typeof r === 'number' ? ' عن ' + r + ' تعديل' : ''), 3000); }; nav.appendChild(u); }
    w.append(head, body, nav); document.body.appendChild(w); draw();
  };
  const st = document.createElement('style');
  st.textContent = '.smp-t{width:100%;border-collapse:collapse;margin-top:6px}.smp-t th,.smp-t td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:start}.smp-t .old{color:var(--warn);text-decoration:line-through}.smp-t .new{color:#40c057;font-weight:600}';
  document.head.appendChild(st);
})();
