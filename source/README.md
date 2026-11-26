# GIS Viewer — source

The app source code, kept here so it is never lost.

- `src/`: the modules; `build.py` joins them into `dist/index.html`.
- Build: `python3 build.py`, copy `dist/index.html` to the repo root, set `__VER__` and bump the cache name in `sw.js` and `version.txt`.
- Synced work (layers) lives in the private repo `gis-data`, not here.
