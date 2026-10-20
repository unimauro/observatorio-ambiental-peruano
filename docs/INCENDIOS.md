# Módulo de incendios forestales y focos de calor

Sección **Incendios** (`#/incendios`) del Observatorio Ambiental Peruano: focos de calor
satelitales casi en tiempo real en el Perú y registro administrativo de incendios del MINAM.

## 1. Diagnóstico de la arquitectura (oct-2026)

| Aspecto | Situación | Decisión para incendios |
|---|---|---|
| Frontend | Vite 6 + React 19 + TS + Tailwind, `HashRouter` | Nueva ruta `/incendios` + ítem de menú; mismo diseño |
| Mapas | Leaflet + `leaflet.markercluster` (OSM) | Se reutilizan; **no** se agrega otra librería |
| Gráficos | Recharts (`isAnimationActive={false}`) | Se reutilizan |
| Datos | 100 % estático en `public/data/` | JSON/GeoJSON estático generado por la ingesta |
| Backend | No existe | No hace falta: la ingesta corre en GitHub Actions |
| ETL | Python **solo stdlib** + Actions semanal | `etl/build_incendios.py` con el mismo estilo |
| Deploy | GitHub Pages vía `deploy.yml` | `deploy.yml` corre además **cada 15 min** |

PostgreSQL/PostGIS no se justifica todavía: Perú genera ~10–15 mil detecciones por semana
(≈2,7 MB en JSON columnar, ~400 kB comprimido). Ver §7 si se necesita histórico completo.

## 2. Fuentes (verificadas el 19-oct-2026)

### NASA FIRMS — primaria, satelital
- **Sin clave (modo actual):** archivos públicos de Sudamérica, sin registro:
  `https://firms.modaps.eosdis.nasa.gov/data/active_fire/<producto>/csv/<archivo>_South_America_{24h,7d}.csv`
  - `suomi-npp-viirs-c2/…/SUOMI_VIIRS_C2_…` (VIIRS 375 m, Suomi NPP)
  - `noaa-20-viirs-c2/…/J1_VIIRS_C2_…` (VIIRS, NOAA-20)
  - `noaa-21-viirs-c2/…/J2_VIIRS_C2_…` (VIIRS, NOAA-21)
  - `modis-c6.1/…/MODIS_C6_1_…` (MODIS 1 km, Terra/Aqua)
- **Con `FIRMS_MAP_KEY`:** API oficial de área
  `/api/area/csv/{MAP_KEY}/{VIIRS_SNPP_NRT|VIIRS_NOAA20_NRT|VIIRS_NOAA21_NRT|MODIS_NRT}/{O,S,E,N}/{1-5}/{fecha}`
  (máx. 5 días por consulta → la ingesta trocea 7 días en 5+2). Límite: 5 000 transacciones / 10 min por clave;
  usamos ≤ 8 por corrida. Clave gratuita: https://firms.modaps.eosdis.nasa.gov/api/map_key/
- Campos: latitude, longitude, bright_ti4/brightness, bright_ti5/bright_t31, scan, track, acq_date,
  acq_time (UTC, HHMM), satellite, confidence (VIIRS l/n/h; MODIS 0–100), version (NRT), frp (MW), daynight.
- Latencia: los productos NRT aparecen ~3 h después del paso del satélite. Cada satélite pasa ~2 veces al día.
- Los archivos públicos **ignoran** `If-None-Match`/`If-Modified-Since` (responden 200): la ingesta hace un
  `HEAD` y compara `ETag`/`Last-Modified`; si no cambió, no descarga (13 s → 3 s).

### MINAM GeoServidor — secundaria, administrativa
`https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer` (ArcGIS 10.71,
`maxRecordCount` 1000, soporta paginación, coordenadas nativas UTM 18S → se piden en `outSR=4326`).

| Capa | Contenido | Uso |
|---|---|---|
| 0 | Registro de incendios 2026 (770 puntos; INDECI 152 + MINAM… ) | `minam-2026.geojson`, capa opcional en el mapa |
| 1 | Registro histórico 2000–2025 (54 493 puntos) | solo conteos por año y departamento (`outStatistics`) |
| 18–19 | Condiciones favorables de incendios set/oct-2026 (ráster) | no integrado (ráster mensual; candidato a capa WMS) |
| 3–17 | Vías, ANP, comunidades, límites | no se usan (ya existen en el observatorio) |

- **Rezago:** al 19-oct-2026 el último registro 2026 es del **27-ago-2026**. Es un registro de emergencias
  (fecha de emergencia/término, localidad, reportante), **no** un estado de incendios activos.
- El campo `COB_AFECTA` no documenta su unidad: se exporta tal cual y no se presenta como hectáreas.

## 3. Modelo común de una detección

`focos.json` es columnar (`campos` + `filas`) para pesar ~3× menos que GeoJSON:

`id, fuente_id, satelite, instrumento, lat, lon, adq_utc, confianza (baja|nominal|alta), confianza_raw,
frp, brillo, brillo2, scan, track, dia_noche, version, recibido_utc, departamento, anp`

- `id = fuente:YYYYMMDDTHHMM:lat,lon` (4 decimales ≈ 11 m). **Deduplicación** solo de duplicados exactos:
  otro satélite, otro paso u otro píxel del mismo incendio se conservan como detecciones distintas.
- **Validación:** lat/lon numéricas y en rango (se descarta 0,0), fecha/hora parseables, dentro de la ventana.
- **Recorte espacial:** bbox + punto-en-polígono con `peru-departamentos.geojson`; `anp` por cruce con
  `anp-sernanp.geojson`.
- `recibido_utc` = primera vez que la plataforma vio la detección; se preserva entre corridas.

## 4. Salidas (`public/data/incendios/`)

| Archivo | Contenido |
|---|---|
| `focos.json` | detecciones de la ventana (7 días por defecto) |
| `focos-24h.geojson` | últimas 24 h en GeoJSON estándar |
| `serie-diaria.json` | conteo diario (hora de Lima) que **crece** más allá de la ventana; último día `parcial` |
| `minam-2026.geojson`, `minam-resumen.json` | registro MINAM |
| `estado.json` | última ejecución, última sincronización, por fuente: estado `ok/sin-cambios/error`, error, registros, inválidos, duración, último éxito |
| `../csv/incendios-focos.csv`, `../csv/incendios-minam-2026.csv` | descargas (UTF-8 con BOM) |

## 5. Ejecución automática

`.github/workflows/deploy.yml` corre en cada push y **cada 15 min** (`cron: '*/15 * * * *'`; GitHub puede
retrasarlo algunos minutos en horas pico):

1. Descarga la versión publicada de `incendios/*` desde Pages (solo si es JSON válido).
2. `python etl/build_incendios.py` (si falla una fuente, conserva su último dato válido).
3. En push: `npm test`. Luego `npm run build`, verificación de que la MAP_KEY no está en `dist/`, y deploy.

No se commitea cada 15 min: los datos viajan en el artefacto de Pages. Ningún visitante dispara
consultas a FIRMS/MINAM; el navegador solo lee los archivos estáticos (y los relee cada 10 min).
`concurrency: pages` + `cancel-in-progress: false` evita ejecuciones simultáneas; localmente lo
evita un `flock` en `/tmp/oap-incendios.lock`.

### Variables

| Dónde | Nombre | Default | Uso |
|---|---|---|---|
| Secret del repo | `FIRMS_MAP_KEY` | (vacío → archivos públicos) | API oficial FIRMS. Solo backend/CI. |
| Variable del repo | `INCENDIOS_DIAS` | `7` | ventana 1–10 días |
| Variable del repo | `INCENDIOS_ALCANCE` | `peru` | `sudamerica` para ampliar (archivo mucho más pesado) |
| Local | `INCENDIOS_SIN_MINAM=1` | — | omitir MINAM (pruebas rápidas) |

```bash
gh secret set FIRMS_MAP_KEY          # pega la clave cuando la pida; nunca en el repo
gh variable set INCENDIOS_DIAS --body 7
```

Para cambiar la frecuencia, editar el `cron` de `deploy.yml` (GitHub no permite que lo lea de una variable).

### Registros y recuperación
- Logs: cada corrida imprime una línea JSON por fuente (`estado`, `registros`, `invalidos`, `duracion_ms`,
  `error`) en el job *Ingesta de incendios*. La MAP_KEY se enmascara (`***`) en errores y logs.
- `estado.json` publicado = diagnóstico en vivo: `…/data/incendios/estado.json`.
- Si todas las fuentes satelitales fallan, el paso emite un *warning* y se publica la última versión válida;
  la página muestra el aviso "datos desactualizados" si pasan > 2 h sin sincronizar.
- **GitHub desactiva los workflows programados tras 60 días sin actividad en el repo**: si el mapa deja de
  actualizarse, reactivarlo en *Actions → Deploy to GitHub Pages → Enable workflow* (el ETL semanal que
  commitea suele mantener la actividad).
- Reprocesar a mano: *Actions → Deploy to GitHub Pages → Run workflow*, o local
  `python etl/build_incendios.py` y commitear `public/data/incendios`.

## 6. Pruebas

`npm test` = 19 pruebas Python (`etl/tests/test_incendios.py`: normalización, coordenadas, fechas,
confianza, deduplicación, troceo de la API, serie diaria; integración con fuentes simuladas: caída de una
fuente, respuestas vacías o HTML, todas caídas, 304/sin cambios, MINAM caído, la clave no aparece en logs
ni archivos) + 8 pruebas Node de la lógica de filtros (`tests/incendios.test.mjs`: ventanas 6/12/24/72 h/7 d,
satélite, confianza, departamento, frescura, indicadores, hora de Lima). Las fixtures son sintéticas y viven
solo en las pruebas; **nunca** se escriben datos de demostración en `public/data`.

## 7. Alternativa VPS (no implementada)

Si se necesitara histórico completo de detecciones o consultas espaciales, la ingesta puede correr en el
VPS con un `systemd timer` y escribir en PostgreSQL/PostGIS, publicando el mismo `estado.json`/`focos.json`.
Antes de tocar el VPS hay que revisar contenedores, Caddy y firewall existentes. Esqueleto:

```ini
# /etc/systemd/system/oap-incendios.service
[Service]
Type=oneshot
EnvironmentFile=/opt/oap-incendios/.env      # FIRMS_MAP_KEY=…  (chmod 600)
ExecStart=/usr/bin/python3 /opt/oap-incendios/etl/build_incendios.py
# /etc/systemd/system/oap-incendios.timer
[Timer]
OnCalendar=*:0/15
Persistent=true
```

## 8. Límites conocidos
- Detección ≠ incendio confirmado ≠ superficie quemada (se advierte en la UI, el bot y aquí).
- Nubes y humo densos ocultan focos; un incendio pequeño o de corta duración puede no detectarse.
- Departamento/ANP por punto-en-polígono con límites simplificados: puntos en el borde pueden asignarse al vecino.
- Los archivos públicos de FIRMS cubren 7 días como máximo; el histórico lo acumula `serie-diaria.json`.
- El registro MINAM tiene rezago de ~2 meses y depende de reportes de INDECI/COER.
