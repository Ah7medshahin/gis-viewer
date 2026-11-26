// Dark mode: converts every light colour in the app's style sheets (and inline styles) to a dark equivalent.
// Default = dark. Toggle button 🌙/☀️ in the side buttons; choice saved in localStorage (gv_theme).
(function () {
  'use strict';
  const KEY = 'gv_theme';
  let dark = true; try { dark = (localStorage.getItem(KEY) || 'dark') === 'dark'; } catch (e) { }
  const VARS = '--ink:#e3eef0;--muted:#93a9ae;--line:#2c3d42;--bg:#0f1719;--card:#172226;--accent:#2bb3be;--accent-d:#9fe3e8;--warn:#ff6b6b;';
  // ---- colour helpers
  function parse(c) {
    let m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]; }
    m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4]];
    if (/^white$/i.test(c)) return [255, 255, 255, 1];
    if (/^black$/i.test(c)) return [0, 0, 0, 1];
    return null;
  }
  function hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function rgb(h, s, l) { if (!s) { const v = Math.round(l * 255); return [v, v, v]; } const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(x => Math.round(x * 255)); }
  const out = (c, a) => a < 1 ? 'rgba(' + c.join(',') + ',' + (+a.toFixed(3)) + ')' : '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
  // role: 'bg' (backgrounds), 'fg' (text), 'bd' (borders/shadows)
  function conv(c, role) {
    const p = parse(c); if (!p) return c; const [h, s, l] = hsl(p[0], p[1], p[2]);
    if (role === 'fg') { if (l > 0.55) return c; return out(rgb(h, Math.min(s, 0.55), 0.94 - l * 0.35), p[3]); }
    if (role === 'bd') { if (l < 0.6) return c; return out(rgb(h, s * 0.4, 0.14 + (1 - l) * 0.5), p[3]); }
    if (l < 0.55) return c; // dark or saturated accents stay
    return out(rgb(h, s * 0.45, 0.09 + (1 - l) * 0.55), p[3]);
  }
  const COLRE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/gi;
  const swap = (v, role) => v.replace(COLRE, m => conv(m, role));
  const PROPS = { background: 'bg', 'background-color': 'bg', 'background-image': 'bg', color: 'fg', fill: 'fg', stroke: 'fg', 'border-color': 'bd', 'border-top-color': 'bd', 'border-bottom-color': 'bd', 'border-left-color': 'bd', 'border-right-color': 'bd', 'outline-color': 'bd', 'box-shadow': 'bd', 'caret-color': 'fg' };
  // ---- build override sheet from all same-origin style sheets
  let sheet = null;
  function build() {
    const rules = [];
    const walk = list => { for (const r of list) {
      if (r.cssRules && !r.selectorText) { if (r.media) { const inner = []; const save = rules.length; walk(r.cssRules); const add = rules.splice(save); if (add.length) rules.push('@media ' + r.media.mediaText + '{' + add.join('') + '}'); } continue; }
      if (!r.style || !r.selectorText) continue;
      if (/leaflet-tile|leaflet-marker|leaflet-overlay|\.legend-sw|\.leg-c|\.sw\b/.test(r.selectorText)) continue;
      const decl = [];
      if (/background(-color)?\s*:\s*var\(--accent-d\)/.test(r.style.cssText)) decl.push('background:#134a52');
      for (let i = 0; i < r.style.length; i++) {
        const k = r.style[i]; const role = PROPS[k]; if (!role) continue; const v = r.style.getPropertyValue(k); if (role === 'bg' && /var\(--accent-d\)/.test(v)) { decl.push(k + ':' + v.replace(/var\(--accent-d\)/g, '#134a52') + (r.style.getPropertyPriority(k) ? '!important' : '')); continue; } if (!COLRE.test(v)) { COLRE.lastIndex = 0; continue; } COLRE.lastIndex = 0;
        const nv = swap(v, role); if (nv !== v) decl.push(k + ':' + nv + (r.style.getPropertyPriority(k) ? '!important' : ''));
      }
      if (decl.length) rules.push(r.selectorText.split(',').map(s => 'html.dark ' + s.trim().replace(/^html\s*/, '').replace(/^:root/, '')).join(',') + '{' + decl.join(';') + '}');
    } };
    for (const s of document.styleSheets) { if (s.ownerNode && s.ownerNode.id === 'gvDark') continue; try { walk(s.cssRules); } catch (e) { } }
    rules.unshift('html.dark{color-scheme:dark;' + VARS + '}');
    rules.push('html.dark body{background:#0f1719;color:#e3eef0}',
      'html.dark input,html.dark select,html.dark textarea{background:#101b1e;color:#e3eef0;border-color:#2c3d42}',
      'html.dark .leaflet-container{background:#0d1416}',
      'html.dark .leaflet-control-attribution{background:rgba(15,23,25,.7)!important;color:#93a9ae}',
      'html.dark .leaflet-control-attribution a{color:#7fd3da}',
      'html.dark ::-webkit-scrollbar{width:10px;height:10px;background:#111a1d}html.dark ::-webkit-scrollbar-thumb{background:#2f4247;border-radius:6px}');
    if (!sheet) { sheet = document.createElement('style'); sheet.id = 'gvDark'; document.head.appendChild(sheet); }
    sheet.textContent = rules.join('\n');
  }
  // inline styles written by scripts (backgrounds of chips, notes…)
  function fixInline(el) {
    if (!dark || !el || !el.style || el.closest && el.closest('.leaflet-pane,.leg-c,.legend-sw')) return;
    const st = el.style; if (!st.length) return; if (!el.textContent.trim() && !el.children.length) return; // colour swatches stay true
    for (const k of ['background', 'background-color', 'color', 'border-color']) { const v = st.getPropertyValue(k); if (!v) continue; COLRE.lastIndex = 0; if (!COLRE.test(v)) continue; COLRE.lastIndex = 0; if (el.dataset.gvDk === k + v) continue; const nv = swap(v, PROPS[k]); if (nv !== v) { st.setProperty(k, nv); el.dataset.gvDk = k + nv; } }
  }
  function sweep(root) { if (!dark) return; (root.querySelectorAll ? root.querySelectorAll('[style]') : []).forEach(fixInline); }
  const mo = new MutationObserver(ms => { if (!dark) return; ms.forEach(m => { if (m.type === 'attributes') fixInline(m.target); else m.addedNodes.forEach(n => { if (n.nodeType === 1) { fixInline(n); sweep(n); } }); }); });
  function apply() {
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = dark ? '#0f1719' : '#0b3d45';
    if (dark) { build(); sweep(document.body); }
    const b = document.getElementById('btnTheme'); if (b) { b.textContent = dark ? '☀️' : '🌙'; b.title = dark ? 'الوضع الفاتح' : 'الوضع الداكن'; }
  }
  function toggle() { dark = !dark; try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (e) { } if (!dark) location.reload(); else apply(); }
  function init() {
    const col = document.querySelector('.fab-col');
    if (col && !document.getElementById('btnTheme')) { const b = document.createElement('button'); b.className = 'round'; b.id = 'btnTheme'; b.style.fontSize = '18px'; b.onclick = toggle; col.appendChild(b); }
    apply();
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  }
  window.GV = window.GV || {}; window.GV.theme = { toggle, isDark: () => dark, rebuild: build };
  if (dark) document.documentElement.classList.add('dark');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
