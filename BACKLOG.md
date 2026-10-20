# Backlog — Observatorio Ambiental Peruano

Punto de retomada rápido. Estado al **2026-10-19**. Live: https://unimauro.github.io/observatorio-ambiental-peruano/

## ✅ Hecho (módulo Incendios forestales, 2026-10-19)

- Nueva sección **Incendios** (`#/incendios`, en el menú): mapa Leaflet con clustering de focos de calor NASA FIRMS (VIIRS SNPP/NOAA-20/NOAA-21 + MODIS), filtros 6/12/24/72 h/7 d, satélite, confianza, departamento; leyenda por antigüedad; popup con UTC + hora de Lima + fecha de recepción + enlace a FIRMS; indicador de última sincronización/fuentes caídas/datos desactualizados; restablecer filtros y centrar en Perú; KPIs y 6 gráficos; capa opcional del **registro MINAM 2026** y serie histórica 2000–2025.
- Ingesta `etl/build_incendios.py` (stdlib): normaliza, valida, deduplica, conserva la última versión válida por fuente, HEAD+ETag para no redescargar, `estado.json` con tiempos/errores, enmascara la MAP_KEY. Corre **cada 15 min** dentro de `deploy.yml` (sin commitear).
- Pruebas: `npm test` (19 Python + 8 Node). Doc: [`docs/INCENDIOS.md`](docs/INCENDIOS.md).
- Eje "Incendios" de Temas pasa a **con datos**; contexto del asistente incluye incendios.

## ✅ Hecho (sesión Amazonía — sitios impactados, 2026-09-01)

- 4 capas nuevas desde el paquete de aliados "Bases de datos - sitios impactados por hidrocarburos" (grupo **"Amazonía: sitios impactados"** en el mapa, ver detalle en [`ACTUALIZACION-2026-09-01.md`](ACTUALIZACION-2026-09-01.md)):
  - **`monitoreo-indigena`** (PUINAMUDT) — 994 impactos, 567 mapeados. **Es la data del StoryMap que pedía Kely.** Activa por defecto.
  - **`oefa-isim-amazonia`** — 86 puntos únicos de monitoreo OEFA (agua/suelo/sedimento/biota).
  - **`pash-amazonia`** — 22 pasivos hidrocarburos Amazonía (MINEM).
  - **`planes-rehabilitacion-amazonia`** — 30 sitios con costo de rehabilitación (MINEM, ≈ S/ 669 M).
- ETL nuevo `etl/build_hidrocarburos_amazonia.py` (parte de Excel locales, convierte UTM→lat/lon, limpia coords sucias, fusiona `_manifest.json`). Requiere `openpyxl`.
- Fuentes originales versionadas en `etl/fuentes/hidrocarburos-amazonia/`. Doc en `research/fuentes.md`. Contexto del asistente actualizado. `npm run build` OK.
- **Desplegado en vivo** (commit `ee4d3f6`, GitHub Actions OK). Se resolvió un conflicto de `_manifest.json` con el refresco del bot ETL (2026-08-31) por rebase.
- Reporte para compartir: [`ACTUALIZACION-2026-09-01.md`](ACTUALIZACION-2026-09-01.md) + PDF con branding en `~/Downloads/Actualizacion-Observatorio-Amazonia-2026-09-01.pdf` (regenerable desde `etl/fuentes/hidrocarburos-amazonia/` → HTML → weasyprint).

## ✅ Hecho (sesión derrames + refresco)

- Capa **pasivos de hidrocarburos** (OEFA, nacional) — 3,266 puntos.
- Capa **suelos empetrolados del Lote X / Talara** (OEFA) — 3,233 locaciones.
- Capa **traza del Oleoducto Norperuano** (Petroperú vía GISEM) — desde 803 progresivas.
- `derrames.json` — KPIs agregados que consumen Dashboard, Temas y el bot.
- Grupo de capas **"Derrames y pasivos"** en el mapa (panel a 4 columnas).
- Sección **"La huella de los derrames"** en el Dashboard + 6 gráficos nuevos en Temas.
- **Exportación CSV** de las 16 capas + `derrames-resumen.csv`, con enlaces de descarga en la UI.
- **Catálogo de endpoints** oficiales en `research/endpoints.json` (los que sirven y los caídos).
- **Refresco 2026-08-05:** ETL corrido local (salta el 403 de OEFA). Relaves 107 → 206.

## 🔜 Pendiente / próximo

- [x] ~~Incendios NASA FIRMS~~ → hecho 2026-10-19 (ver arriba).
- [ ] **Incendios — opcional:** pedir `FIRMS_MAP_KEY` gratuita y cargarla con `gh secret set FIRMS_MAP_KEY` (hoy funciona sin clave con los CSV públicos).
- [ ] **Incendios — ráster "Condiciones favorables"** del MINAM (capas 18–19 de ServicioCFOI) como capa superpuesta.
- [ ] **Incendios — histórico de detecciones** más allá de 7 días (hoy solo la serie diaria acumulada): requeriría PostGIS en el VPS (ver §7 de docs/INCENDIOS.md).
- [ ] **Incendios — capa de focos en el Mapa general** (hoy viven en su propia sección).
- [ ] **Eventos de derrame con fecha/volumen/responsable** — NO hay capa pública (ver `research/endpoints.json`). Camino: sistematizar informes/PAS del OEFA o la base CNDDHH 2000–2019.
- [ ] **Deforestación por departamento/distrito** desde Geobosques (hoy solo total nacional, `porRegion2023` es estimado).
- [ ] **Capas candidatas del OEFA** ya identificadas en `endpoints.json`: REINFO (minería ilegal área), áreas degradadas por residuos sólidos, conflictos socioambientales, monitoreo mensual de playas post-Pampilla.
- [ ] **Analytics GA4 por sección** (SPA con hash routing solo cuenta la primera carga) — propuesto, sin hacer.
- [ ] Concesiones forestales (2,922) / energía GISEM — opcional, baja prioridad.
- [ ] `apoyo.json` — Carlos debe dar Yape/Plin/PayPal reales y poner `activo:true`.

### Del chat del equipo (WhatsApp, ago-2026) — quedan pendientes

- [ ] **UNDP — Estudio técnico del Lote 8** (base SIG): ver si trae shapefiles/coordenadas para capa propia. https://www.undp.org/es/peru/publicaciones/estudio-tecnico-independiente-del-lote-8
- [ ] **Concesiones — geoportal CooperAcción** (http://cooperaccion-geoportal.org/): mapear concesiones mineras/forestales.
- [ ] **Bibliografía de Kely** (ResearchGate): subir a la Biblioteca sus docs de valoración económica y economía feminista de la zona. https://www.researchgate.net/profile/Kely-Alfaro-Montoya
- [ ] **Visores ArcGIS instant** que pasó Kely (appid `97f64504…` y `5ce50d15…`): son otro tipo de visor; la data de fondo es la que ya integramos con el paquete de sitios impactados. Si comparten sus capas/puntos exactos, se mapean directo.

## ⚠️ Recordatorios de operación

- **Incendios se refresca cada 15 min sin commits**: el estado vivo está en `…/data/incendios/estado.json` publicado, no en el repo (la copia del repo es solo semilla). Si GitHub desactiva el cron por inactividad (60 días), reactivarlo en Actions.

- **El cron semanal NO refresca las 4 capas OEFA** (PIFA da 403 a IPs de datacenter). Hay que correr `python etl/build_data.py` **local** (IP residencial) cada cierto tiempo para actualizar relaves, riesgo, pasivos y suelos.
- **El refresco del bot deja `_manifest.json` incompleto:** como falla el fetch de las 4 capas OEFA, el manifest que commitea el cron NO las lista (baja de 13 a 9 capas base). Los **archivos geojson sí persisten** en el repo, así que el mapa (catálogo hardcodeado en `Mapa.tsx`) no se ve afectado; es solo cosmético/documental. Se corrige corriendo `build_data.py` local.
- **Las capas de la Amazonía** (`monitoreo-indigena`, `oefa-isim-amazonia`, `pash-amazonia`, `planes-rehabilitacion-amazonia`) NO las toca ningún cron: se regeneran con `python etl/build_hidrocarburos_amazonia.py` (que re-fusiona el manifest) solo si cambian los Excel de `etl/fuentes/`.
- Al pushear: el bot ETL puede haber commiteado antes → `git pull --rebase` primero.
- No levantar servidores en local para probar; el deploy y la verificación van por GitHub Actions / en vivo.

## Cómo retomar

```bash
cd ~/Documents/Repos/observatorio-ambiental-peruano
git pull --rebase origin main
python etl/build_data.py                     # refresca capas oficiales (correr local por el 403 de OEFA)
python etl/build_hidrocarburos_amazonia.py   # regenera capas Amazonía si cambiaron los Excel (needs openpyxl)
npm run build                                # verifica que compila
git add -A && git commit && git push         # deploy automático a Pages
```
