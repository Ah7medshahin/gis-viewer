/* Basemap tiles inside the installed desktop app. The artifact page itself may not load images from other sites, so in the
   desktop app (desktop capability, "full-access") tiles are downloaded with the system's curl into a local cache
   (~/.gis-viewer/tiles) and shown from there. Elsewhere Leaflet loads them normally. */
(function () {
  'use strict';
  const GV = window.GV = window.GV || {};
  let desk = null, ready = null, home = null, curl = 'curl', sep = '/';
  async function getDesk() {
    if (ready) return ready;
    ready = (async () => {
      try { if (!window.claude || !window.claude.use) return null; desk = await window.claude.use('desktop'); } catch (e) { desk = null; }
      if (!desk || !desk.childProcess) return null;
      try { const st = await desk.permissions.state('full-access'); if (st !== 'granted') return null; } catch (e) { return null; }
      try { const pf = await desk.os.platform(); if (pf === 'win32') { curl = 'curl.exe'; sep = '\\'; } home = await desk.os.homedir(); } catch (e) { return null; }
      return desk;
    })();
    return ready;
  }
  GV.deskTiles = {
    state: async () => { try { if (!window.claude || !window.claude.use) return 'none'; const d = await window.claude.use('desktop'); if (!d) return 'none'; if (!d.childProcess) return (await d.install.state()) === 'available' ? 'install' : 'none'; return await d.permissions.state('full-access'); } catch (e) { return 'none'; } },
    request: async () => { const d = await window.claude.use('desktop'); if (d && d.install && !d.childProcess) { if ((await d.install.state()) === 'available') return d.install.request(); return; } const r = await d.permissions.request(['full-access']); ready = null; return r; },
    install: async () => { const d = await window.claude.use('desktop'); return d && d.install.request(); }
  };
  // ---- batched downloader
  const mem = new Map(); let queue = [], timer = null, running = 0;
  const pathOf = (key, z, x, y) => [home, '.gis-viewer', 'tiles', key, z, x, y + '.img'].join(sep);
  async function readTile(p) { try { const b = await desk.fs.readFile(p, 'base64'); return b && b.length > 100 ? b : null; } catch (e) { return null; } }
  function flush() {
    timer = null; if (running >= 3 || !queue.length) return;
    const batch = queue.splice(0, 20); running++;
    (async () => {
      const dirs = new Set(batch.map(t => t.p.slice(0, t.p.lastIndexOf(sep))));
      await Promise.all([...dirs].map(d => desk.fs.mkdir(d, { recursive: true }).catch(() => { })));
      const args = ['-s', '-f', '-L', '-m', '25', '--parallel', '--parallel-max', '8', '-A', 'Mozilla/5.0 GIS-Viewer'];
      batch.forEach(t => args.push('-o', t.p, t.url));
      await new Promise(res => { try { const cp = desk.childProcess.spawn(curl, args); cp.on('exit', res); cp.on('error', res); } catch (e) { res(); } });
      await Promise.all(batch.map(async t => { const b = await readTile(t.p); t.done(b); }));
    })().finally(() => { running--; if (queue.length) flush(); });
    if (queue.length && running < 3) timer = setTimeout(flush, 0);
  }
  function fetchTile(key, url, z, x, y) {
    const k = key + '/' + z + '/' + x + '/' + y; if (mem.has(k)) return mem.get(k);
    const pr = (async () => {
      const p = pathOf(key, z, x, y); const c = await readTile(p); if (c) return c;
      return new Promise(done => { queue.push({ p, url, done }); if (!timer) timer = setTimeout(flush, 25); });
    })();
    mem.set(k, pr); pr.then(v => { if (!v) mem.delete(k); });
    if (mem.size > 3000) mem.delete(mem.keys().next().value);
    return pr;
  }
  const mime = b => b.startsWith('/9j/') ? 'image/jpeg' : b.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  L.TileLayer.Desk = L.TileLayer.extend({
    createTile: function (coords, done) {
      const tile = document.createElement('img'); tile.alt = ''; tile.setAttribute('role', 'presentation');
      const url = this.getTileUrl(coords); const key = this.options.cacheKey || 'base';
      getDesk().then(d => {
        if (!d) { L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile)); L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile)); tile.src = url; return; }
        fetchTile(key, url, coords.z, coords.x, coords.y).then(b => {
          if (!b) { done(new Error('tile'), tile); return; }
          tile.onload = () => done(null, tile); tile.onerror = () => done(new Error('tile'), tile);
          tile.src = 'data:' + mime(b) + ';base64,' + b;
        });
      });
      return tile;
    }
  });
  GV.tileLayer = (url, opt) => new L.TileLayer.Desk(url, opt);
  // app icon for the installed desktop app
  (async () => { try { if (!window.claude || !window.claude.use) return; const d = await window.claude.use('desktop'); if (!d || !d.app) return;
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#0e7c86'); gr.addColorStop(1, '#0b3d45'); g.fillStyle = gr; g.beginPath(); g.roundRect(8, 8, 240, 240, 52); g.fill();
    g.strokeStyle = '#9fe3e8'; g.lineWidth = 10; g.lineCap = 'round'; g.beginPath(); g.moveTo(58, 180); g.lineTo(120, 118); g.lineTo(198, 150); g.moveTo(120, 118); g.lineTo(150, 62); g.stroke();
    g.fillStyle = '#fff'; [[58, 180], [120, 118], [198, 150], [150, 62]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 17, 0, 7); g.fill(); });
    await d.app.dock.setIcon(c.toDataURL('image/png')); } catch (e) { } })();
  getDesk();
})();
