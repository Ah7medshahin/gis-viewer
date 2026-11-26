import os
N='node_modules/'
libs=[N+'leaflet/dist/leaflet.js',N+'proj4/dist/proj4.js',N+'jszip/dist/jszip.min.js',N+'shpjs/dist/shp.min.js',N+'@tmcw/togeojson/dist/togeojson.umd.js',N+'dxf-parser/dist/dxf-parser.js',N+'sql.js/dist/sql-asm.js','dwg/libredwg.bundle.js','src/fgdb.js','src/writers.js','src/vendor_dxf.js','src/dxfmodern.js','src/desktiles.js','src/app.js','src/platform.js','src/cad.js','src/netqc.js','src/cadstd.js','src/qc.js','src/dash.js','src/ws.js','src/netbuild.js','src/cadtable.js','src/fix.js','src/org.js','src/legend.js','src/attrsrc.js','src/ole.js','src/amanah.js','src/ai.js','src/flow.js','src/persist.js','src/edit.js','src/compare.js','src/derive.js','src/sample.js','src/netstd.js','src/boq.js','src/vendor_geo.js','src/services.js','src/rasters.js','src/civil.js','src/join.js','src/theme.js',N+'../../g3/node_modules/gdal3.js/dist/package/gdal3.js']
h=open('src/index.html').read()
h=h.replace('/*LEAFLET_CSS*/',open(N+'leaflet/dist/leaflet.css').read())
scripts=''
for l in libs:
    js=open(l).read().replace('</script','<\\/script')
    scripts+='<script>\n'+js+'\n</script>\n'
h=h.replace('<!--LIBS-->',scripts)
os.makedirs('dist',exist_ok=True)
open('dist/index.html','w').write(h)
print(len(h)/1e6,'MB')
